// PoliTrak app shell: hash routing, rails, search, and the tab registry.
import { indexData } from './lib/index.mjs';
import { escapeHtml, dateText } from './lib/format.mjs';
import networkTab from './tabs/network.mjs';
import profileTab from './tabs/profile.mjs';
import issuesTab from './tabs/issues.mjs';
import moneyTab from './tabs/money.mjs';
import leadsTab from './tabs/leads.mjs';
import { filingsTab, recordsTab } from './tabs/filings.mjs';

const PT = window.PT;
const ix = indexData(PT);

// ---- tab registry ----------------------------------------------------------
// Every tab is a real module; each one carries its own `id`, `label` and `render`.
const TABS = [
  networkTab,
  profileTab,
  issuesTab,
  moneyTab,
  leadsTab,
  filingsTab,
  recordsTab,
];
const TAB_IDS = new Set(TABS.map(t => t.id));

// ---- routing ----------------------------------------------------------------
function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return null;
  const [head, a, b] = parts;
  if (head === 'web') return { view: 'web', id: '', tab: 'network' };
  if (head === 'tab') {
    const tab = TAB_IDS.has(a) ? a : 'network';
    return { view: 'tab', id: '', tab };
  }
  if (head === 'person' || head === 'entity' || head === 'issue') {
    if (!a) return null;
    const tab = b && TAB_IDS.has(b) ? b : 'network';
    return { view: head, id: a, tab };
  }
  return null;
}

let currentRoute = null;

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function select(id) {
  const t = ix.typeOf(id);
  const view = t === 'property' ? 'entity' : t;
  if (view !== 'person' && view !== 'entity' && view !== 'issue') { navigate('#/web'); return; }
  const tab = (currentRoute && currentRoute.tab) || 'network';
  navigate(tab === 'network' ? `#/${view}/${id}` : `#/${view}/${id}/${tab}`);
}

function tabHashFor(route, tabId) {
  if (route.id) {
    return tabId === 'network' ? `#/${route.view}/${route.id}` : `#/${route.view}/${route.id}/${tabId}`;
  }
  return tabId === 'network' ? '#/web' : `#/tab/${tabId}`;
}

// ---- person kind pill --------------------------------------------------------
// A full subject (official/candidate/staff) keeps its own pill. Anyone else
// (limited display_level, or a kind outside that set) shows their actual
// kind — lobbyist, officer, donor, treasurer, staff, other — styled like the
// existing `.pill.limited`, with a small muted "limited" badge alongside it.
function personPillHtml(p) {
  if (!p) return '';
  if (p.display_level === 'full' && ['official', 'candidate', 'staff'].includes(p.kind)) {
    return `<span class="pill ${escapeHtml(p.kind)}">${escapeHtml(p.kind)}</span>`;
  }
  const kind = p.kind || 'other';
  return `<span class="pill limited">${escapeHtml(kind)}</span><span class="badge-muted">limited</span>`;
}

// ---- search -------------------------------------------------------------------
let searchQuery = '';

function searchMatches(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return { subjects: [], entities: [], issues: [] };
  const subjects = ix.subjects.filter(p => p.full_name.toLowerCase().includes(q)).slice(0, limit);
  const entities = [...ix.entities.values()]
    .filter(e => (e.name || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
  const issues = [...ix.issues.values()].filter(i => (i.title || '').toLowerCase().includes(q)).slice(0, limit);
  return { subjects, entities, issues };
}

function renderSearchDropdown(query) {
  const drop = document.getElementById('qdrop');
  const { subjects, entities, issues } = searchMatches(query);
  if (!subjects.length && !entities.length && !issues.length) {
    drop.innerHTML = query.trim() ? '<div class="search-item"><span class="kind">No matches</span></div>' : '';
    drop.hidden = !query.trim();
    return;
  }
  const subjGroup = !subjects.length ? '' :
    `<div class="grp-label">Subjects</div>` + subjects.map(p =>
      `<div class="search-item" data-id="${escapeHtml(p.person_id)}"><span>${escapeHtml(p.full_name)}</span>${personPillHtml(p)}</div>`
    ).join('');
  const group = (label, rows, idKey, textKey, kind) => !rows.length ? '' :
    `<div class="grp-label">${escapeHtml(label)}</div>` + rows.map(r =>
      `<div class="search-item" data-id="${escapeHtml(r[idKey])}"><span>${escapeHtml(r[textKey])}</span><span class="kind">${escapeHtml(kind)}</span></div>`
    ).join('');
  drop.innerHTML =
    subjGroup +
    group('Entities', entities, 'entity_id', 'name', 'entity') +
    group('Issues', issues, 'issue_id', 'title', 'issue');
  drop.hidden = false;
  drop.querySelectorAll('[data-id]').forEach(node => {
    node.addEventListener('click', () => {
      select(node.dataset.id);
      drop.hidden = true;
    });
  });
}

function wireSearch() {
  const q = document.getElementById('q');
  const drop = document.getElementById('qdrop');
  q.addEventListener('input', () => {
    searchQuery = q.value;
    renderLeftRail(currentRoute);
    renderSearchDropdown(searchQuery);
  });
  q.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const { subjects, entities, issues } = searchMatches(q.value);
    const first = subjects[0] || entities[0] || issues[0];
    if (!first) return;
    const id = first.person_id || first.entity_id || first.issue_id;
    select(id);
    drop.hidden = true;
  });
  q.addEventListener('blur', () => { setTimeout(() => { drop.hidden = true; }, 150); });
  q.addEventListener('focus', () => { if (q.value.trim()) renderSearchDropdown(q.value); });
}

// ---- left rail ------------------------------------------------------------
const KIND_GROUPS = [['official', 'Officials'], ['candidate', 'Candidates'], ['staff', 'Staff']];

function renderLeftRail(route) {
  const el = document.getElementById('left');
  const q = searchQuery.trim().toLowerCase();
  const byKind = {};
  for (const p of ix.subjects) {
    if (q && !p.full_name.toLowerCase().includes(q)) continue;
    (byKind[p.kind] || (byKind[p.kind] = [])).push(p);
  }
  let html = `<div class="rail-item everything${route.view === 'web' ? ' on' : ''}" data-web="1">Everything</div>`;
  for (const [kind, label] of KIND_GROUPS) {
    const rows = byKind[kind] || [];
    if (!rows.length) continue;
    html += `<div class="rail-group-label">${escapeHtml(label)}</div>`;
    html += rows.map(p => {
      const active = route.id === p.person_id;
      return `<div class="rail-item${active ? ' on' : ''}" data-id="${escapeHtml(p.person_id)}">
        <span class="ri-name">${escapeHtml(p.full_name)}</span>
        <span class="ri-meta">${personPillHtml(p)}<span class="status">${escapeHtml(p.status || '')}</span></span>
      </div>`;
    }).join('');
  }
  el.innerHTML = `<div class="rail-list">${html}</div>`;
  el.querySelector('[data-web]')?.addEventListener('click', () => navigate('#/web'));
  el.querySelectorAll('[data-id]').forEach(node => {
    node.addEventListener('click', () => select(node.dataset.id));
  });
}

// ---- right rail -------------------------------------------------------------
function srcLink(sourceId) {
  const src = ix.sourceOf(sourceId);
  if (!src) return '';
  return `<a class="src" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener" title="${escapeHtml(src.title || src.source_id)}">${escapeHtml(src.title || src.source_id)}</a>`;
}

function renderSourceRows(sources) {
  if (!sources.length) return '<p class="empty">No sources.</p>';
  return sources.map(s => `<div class="row">${srcLink(s.source_id)}</div>`).join('');
}

function sectionNextDates() {
  const built = PT.meta.builtDate;
  const items = (PT.tables.timeline || [])
    .filter(t => t.date && t.date >= built)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  const body = items.length
    ? items.map(t => `<div class="row">${escapeHtml(dateText(t.date))} — ${escapeHtml(t.event)}</div>`).join('')
    : '<p class="empty">No upcoming dates.</p>';
  return `<div class="right-section"><h4>Next dates</h4>${body}</div>`;
}

function relatedIssueIdsForEntities(entityIds) {
  const found = [];
  for (const issue of ix.issues.values()) {
    const related = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
    if (related.some(id => entityIds.has(id))) found.push(issue.issue_id);
  }
  return found;
}

function sectionRelatedIssues(ids) {
  const body = ids.length
    ? ids.map(iid => {
        const issue = ix.issues.get(iid);
        return `<div class="row"><a href="#" data-id="${escapeHtml(iid)}">${escapeHtml(issue ? issue.title : iid)}</a></div>`;
      }).join('')
    : '<p class="empty">No related issues.</p>';
  return `<div class="right-section"><h4>Related issues</h4>${body}</div>`;
}

function personEntityTies(personId) {
  const ids = new Set();
  for (const r of PT.tables.relationships) {
    if (r.from_id === personId && r.to_type === 'entity') ids.add(r.to_id);
    if (r.to_id === personId && r.from_type === 'entity') ids.add(r.from_id);
  }
  return ids;
}

function personRelatedIssueIds(personId) {
  const issueIds = new Set(relatedIssueIdsForEntities(personEntityTies(personId)));
  for (const vc of PT.tables.vote_casts || []) {
    if (vc.person_id !== personId) continue;
    const v = ix.votes.get(vc.vote_id);
    if (v && v.issue_id) issueIds.add(v.issue_id);
  }
  return [...issueIds];
}

function sourcesForPerson(id) {
  const profile = ix.profileOf(id);
  if (profile) return profile.sources;
  const ids = new Set();
  for (const r of PT.tables.relationships) {
    if ((r.from_id === id || r.to_id === id) && r.source_id) ids.add(r.source_id);
  }
  return [...ids].map(sid => ix.sourceOf(sid)).filter(Boolean);
}

function sourcesForEntity(id) {
  const e = ix.entities.get(id);
  const ids = new Set();
  if (e && e.source_id) ids.add(e.source_id);
  for (const r of PT.tables.relationships) {
    if ((r.from_id === id || r.to_id === id) && r.source_id) ids.add(r.source_id);
  }
  return [...ids].map(sid => ix.sourceOf(sid)).filter(Boolean);
}

function sourcesForIssue(id) {
  const issue = ix.issues.get(id);
  const ids = new Set();
  if (issue && issue.source_id) ids.add(issue.source_id);
  for (const v of ix.votes.values()) {
    if (v.issue_id === id && v.source_id) ids.add(v.source_id);
  }
  for (const r of PT.tables.relationships) {
    if (r.issue_id === id && r.source_id) ids.add(r.source_id);
  }
  return [...ids].map(sid => ix.sourceOf(sid)).filter(Boolean);
}

function sectionAboutPerson(id) {
  const p = ix.people.get(id);
  if (!p) return '<div class="right-section"><h4>About this person</h4><p class="empty">Not found.</p></div>';
  const rows = [];
  if (p.occupation) rows.push(`<div class="row"><b>Occupation</b>${escapeHtml(p.occupation)}</div>`);
  if (p.status) rows.push(`<div class="row"><b>Status</b>${escapeHtml(p.status)}</div>`);
  rows.push(`<div class="row"><b>Kind</b>${personPillHtml(p)}</div>`);
  return `<div class="right-section"><h4>About this person</h4>${rows.join('')}</div>`;
}

function sectionAboutEntity(id) {
  const e = ix.entities.get(id);
  if (!e) return '<div class="right-section"><h4>About this entity</h4><p class="empty">Not found.</p></div>';
  const rows = [];
  if (e.type) rows.push(`<div class="row"><b>Type</b>${escapeHtml(e.type)}</div>`);
  if (e.sunbiz_status) rows.push(`<div class="row"><b>Sunbiz status</b>${escapeHtml(e.sunbiz_status)}</div>`);
  return `<div class="right-section"><h4>About this entity</h4>${rows.join('') || '<p class="empty">No details.</p>'}</div>`;
}

function sectionAboutIssue(id) {
  const i = ix.issues.get(id);
  if (!i) return '<div class="right-section"><h4>About this issue</h4><p class="empty">Not found.</p></div>';
  const rows = [];
  if (i.status) rows.push(`<div class="row"><b>Status</b>${escapeHtml(i.status)}</div>`);
  if (i.tags) rows.push(`<div class="row"><b>Tags</b>${escapeHtml(i.tags)}</div>`);
  return `<div class="right-section"><h4>About this issue</h4>${rows.join('') || '<p class="empty">No details.</p>'}</div>`;
}

function renderRightRail(route) {
  const el = document.getElementById('right');
  const sections = [sectionNextDates()];
  if (route.id) {
    const kind0 = ix.typeOf(route.id);
    const kind = kind0 === 'property' ? 'entity' : kind0;
    if (kind === 'person') {
      sections.push(sectionRelatedIssues(personRelatedIssueIds(route.id)));
      sections.push(`<div class="right-section"><h4>Sources</h4>${renderSourceRows(sourcesForPerson(route.id))}</div>`);
      sections.push(sectionAboutPerson(route.id));
    } else if (kind === 'entity') {
      sections.push(sectionRelatedIssues(relatedIssueIdsForEntities(new Set([route.id]))));
      sections.push(`<div class="right-section"><h4>Sources</h4>${renderSourceRows(sourcesForEntity(route.id))}</div>`);
      sections.push(sectionAboutEntity(route.id));
    } else if (kind === 'issue') {
      sections.push(`<div class="right-section"><h4>Sources</h4>${renderSourceRows(sourcesForIssue(route.id))}</div>`);
      sections.push(sectionAboutIssue(route.id));
    }
  }
  el.innerHTML = `<div class="rail-list">${sections.join('')}</div>`;
  el.querySelectorAll('[data-id]').forEach(node => {
    node.addEventListener('click', e => { e.preventDefault(); select(node.dataset.id); });
  });
}

// ---- tabs strip + panel -----------------------------------------------------
function renderTabsStrip(route) {
  const el = document.getElementById('tabs');
  el.innerHTML = TABS.map(t =>
    `<div class="tab${t.id === route.tab ? ' on' : ''}" data-tab="${escapeHtml(t.id)}">${escapeHtml(t.label)}</div>`
  ).join('');
  el.querySelectorAll('[data-tab]').forEach(node => {
    node.addEventListener('click', () => navigate(tabHashFor(route, node.dataset.tab)));
  });
}

// The shell has no unmount hook of its own: it just empties `#panel`. A tab whose
// render reaches outside the panel — the network tab takes the page full screen,
// which locks `document.body` — cannot clean that up from its own `render`,
// because leaving it for another tab never calls its `render` again. So the tab
// that was rendered last is told it is going away first, through an optional
// `teardown` hook, before the panel is cleared under it.
let renderedTab = null;

function renderPanel(route, ctx) {
  const panel = document.getElementById('panel');
  const tab = TABS.find(t => t.id === route.tab) || TABS[0];
  if (renderedTab) renderedTab.teardown?.();
  renderedTab = tab;
  panel.innerHTML = '';
  tab.render(panel, ctx);
}

// ---- main render loop --------------------------------------------------------
function render() {
  const route = parseHash();
  if (!route) { location.hash = '#/web'; return; }
  currentRoute = route;
  const ctx = { PT, ix, route, navigate, select };
  renderLeftRail(route);
  renderTabsStrip(route);
  renderPanel(route, ctx);
  renderRightRail(route);
}

wireSearch();
window.addEventListener('hashchange', render);
render();
