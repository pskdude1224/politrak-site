// Pure relationship-graph builder over a built PT payload. No imports of node
// built-ins; only pulls in the sibling pure libraries.
import { indexData } from './index.mjs';
import { linkKind, money } from './format.mjs';

const CONFIDENCE_RANK = { documented: 3, reported: 2, inferred: 1 };

function strongestConfidence(items) {
  let best = null, bestRank = -1;
  for (const it of items) {
    const rank = CONFIDENCE_RANK[it.confidence] ?? 0;
    if (rank > bestRank) { best = it.confidence; bestRank = rank; }
  }
  return best;
}

// Build the full merged edge list once: relationships, contributions,
// employment, issue<->entity ties and vote casts, collapsed so parallel
// edges between the same (source, target, rel) become one link.
function buildLinks(PT) {
  const tables = PT.tables || {};
  const ix = indexData(PT);
  const known = new Set([...ix.people.keys(), ...ix.entities.keys(), ...ix.issues.keys()]);

  const raw = [];
  const push = (source, target, rel, { sourceId = '', amount = 0, label = '', confidence = 'documented' } = {}) => {
    if (!known.has(source) || !known.has(target)) return;
    raw.push({ source, target, rel, sourceId, amount: Number(amount) || 0, label, confidence });
  };

  for (const r of tables.relationships || []) {
    push(r.from_id, r.to_id, r.rel_type, { sourceId: r.source_id, amount: r.amount, label: r.detail || '', confidence: r.confidence });
  }

  for (const c of tables.contributions || []) {
    const contributor = c.contributor_person_id || c.contributor_entity_id;
    let target = null;
    if (c.recipient_type === 'candidacy') {
      target = ix.personOfCandidacy(c.recipient_id) || null;
    } else if (c.recipient_type === 'entity') {
      target = c.recipient_id;
    }
    if (!contributor || !target) continue;
    const amount = Number(c.amount) || 0;
    push(contributor, target, 'contributed', { sourceId: c.source_id, amount, label: `${money(amount)} on ${c.date}` });
  }

  for (const e of tables.employment || []) {
    push(e.person_id, e.employer_entity_id, 'employed_by', { sourceId: e.source_id, label: e.title || '' });
  }

  // A campaign treasurer only ever exists as a candidacies column — there is no
  // relationships row for it — so the candidate/treasurer tie is built here or
  // it is invisible.
  for (const c of tables.candidacies || []) {
    const treasurer = String(c.treasurer_person_id || '').trim();
    if (!treasurer || treasurer === c.person_id) continue;
    push(treasurer, c.person_id, 'treasurer_for', {
      sourceId: String(c.packet_source_id || c.source_id || '').trim(),
      label: 'campaign treasurer',
    });
  }

  // A licence that names an employer ties the licensee to that company.
  for (const l of tables.licenses || []) {
    const employer = String(l.employer_entity_id || '').trim();
    if (!employer) continue;
    push(l.person_id, employer, 'employed_by', {
      sourceId: l.source_id,
      label: l.license_type || 'licensed employer',
    });
  }

  for (const issue of tables.issues || []) {
    const ids = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
    for (const entityId of ids) push(entityId, issue.issue_id, 'named_on', { sourceId: issue.source_id });
  }

  for (const vc of tables.vote_casts || []) {
    const vote = (tables.votes || []).find(v => v.vote_id === vc.vote_id);
    // Most council votes (a consent resolution, a vendor award) belong to no tracked issue. A cast
    // on one draws no link: the vote's related entities are what it was about, not a tie between
    // the voter and that vendor, and a "voted" edge to a company would read as one.
    if (!vote || !String(vote.issue_id || '').trim()) continue;
    push(vc.person_id, vote.issue_id, 'voted', { sourceId: vc.source_id, label: vc.cast || '', confidence: 'documented' });
  }

  const groups = new Map();
  for (const e of raw) {
    const id = `${e.source}|${e.target}|${e.rel}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(e);
  }

  const links = [];
  for (const [id, items] of groups) {
    const { source, target, rel } = items[0];
    const targetType = ix.entities.get(target)?.type || '';
    const sources = [...new Set(items.map(i => i.sourceId).filter(Boolean))].sort();
    const amount = items.reduce((sum, i) => sum + i.amount, 0);
    const labels = [...new Set(items.map(i => i.label).filter(Boolean))].sort();
    links.push({
      id, source, target, rel, kind: linkKind(rel, targetType),
      confidence: strongestConfidence(items),
      amount, label: labels.join('; '), sources,
    });
  }
  return links;
}

function neighborMap(links) {
  const map = new Map();
  const add = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const l of links) { add(l.source, l.target); add(l.target, l.source); }
  return map;
}

export const HUB_DEGREE = 40;

// The merged edge list depends only on the payload, and the network tab rebuilds
// the graph on every filter click, so it is built once per PT object.
const LINKS_CACHE = new WeakMap();
function buildLinksMemo(PT) {
  let links = LINKS_CACHE.get(PT);
  if (!links) { links = buildLinks(PT); LINKS_CACHE.set(PT, links); }
  return links;
}

export function buildGraph(PT, { focus = null, depth = 1, expanded = [], kinds = null, hubDegree = HUB_DEGREE } = {}) {
  const tables = PT.tables || {};
  const ix = indexData(PT);
  const allLinks = buildLinksMemo(PT);
  const neighbors = neighborMap(allLinks);
  const neighborsOf = id => [...(neighbors.get(id) || [])];

  // Everything mode seeds every full subject AND every issue that has a tie on file: an issue is
  // what the tracker exists to follow, and RM-30's applicant and architect sat two hops from any
  // member, so the one matter that started the project was missing from the default view.
  const seeds = focus != null
    ? [focus]
    : [
      ...(tables.people || []).filter(p => p.display_level === 'full').map(p => p.person_id),
      ...(tables.issues || []).map(i => i.issue_id).filter(id => neighbors.has(id)),
    ];
  const seedSet = new Set(seeds);

  const expandedSet = new Set(expanded);
  const isHub = id => !seedSet.has(id) && !expandedSet.has(id) && neighborsOf(id).length >= hubDegree;

  // Breadth-first from the seeds out to `depth` hops. A hub is reached but never walked through.
  const visited = new Set(seeds);
  let frontier = new Set(seeds);
  for (let d = 0; d < depth && frontier.size; d++) {
    const next = new Set();
    for (const id of frontier) {
      if (d > 0 && isHub(id)) continue;
      for (const n of neighborsOf(id)) {
        if (!visited.has(n)) { visited.add(n); next.add(n); }
      }
    }
    frontier = next;
  }

  // `expanded` nodes bring in their direct neighbours even beyond depth.
  for (const id of expanded) {
    visited.add(id);
    for (const n of neighborsOf(id)) visited.add(n);
  }

  // Everything mode also pulls in any issue touching an already-included node.
  if (focus == null) {
    for (const issue of tables.issues || []) {
      if (visited.has(issue.issue_id)) continue;
      if (neighborsOf(issue.issue_id).some(n => visited.has(n))) visited.add(issue.issue_id);
    }
  }

  const neighbourhoodLinks = allLinks.filter(l => visited.has(l.source) && visited.has(l.target));
  const filteredLinks = kinds ? neighbourhoodLinks.filter(l => kinds.has(l.kind)) : neighbourhoodLinks;

  const touched = new Set();
  for (const l of filteredLinks) { touched.add(l.source); touched.add(l.target); }
  // A person seed (and the focus) is always drawn; an issue seed only while a filter leaves it a
  // tie, or a Property-only view would float every issue alone in the middle of the ring.
  const alwaysDrawn = id => seedSet.has(id) && (focus != null || !ix.issues.has(id));
  const finalNodeIds = [...visited].filter(id => alwaysDrawn(id) || touched.has(id));
  const finalNodeSet = new Set(finalNodeIds);
  const finalLinks = filteredLinks.filter(l => finalNodeSet.has(l.source) && finalNodeSet.has(l.target));

  const kindOf = id => {
    if (ix.people.has(id)) return ix.people.get(id).kind;
    if (ix.entities.has(id)) return ix.entities.get(id).type;
    if (ix.issues.has(id)) return ix.issues.get(id).status;
    return undefined;
  };

  const nodes = finalNodeIds.map(id => {
    const full = neighborsOf(id);
    const hidden = full.filter(n => !finalNodeSet.has(n)).length;
    return {
      id, type: ix.typeOf(id), label: ix.labelOf(id),
      subject: !!(ix.people.has(id) && ix.people.get(id).display_level === 'full'),
      kind: kindOf(id), degree: full.length, hidden, hub: isHub(id),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  // Copies, never the cached objects: d3's forceLink rewrites a link's `source`
  // and `target` from ids into node objects, and a poisoned cache would make
  // every later build see objects where it expects ids and drop every tie.
  const links = finalLinks.map(l => ({ ...l, sources: l.sources.slice() }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, links };
}
