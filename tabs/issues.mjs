// Issues tab: a table of every issue; selecting one (or arriving at
// `#/issue/<id>` with this tab active) shows its summary, its related
// entities and who is tied to them, and a subject-by-subject matrix of
// votes, ties, stated positions and contributions from tied people.
import { escapeHtml, dateText, money, relLabel } from '../lib/format.mjs';

// ---- small helpers copied from profile.mjs / app.mjs conventions -----------
function srcLink(ix, sourceId) {
  const src = ix.sourceOf(sourceId);
  if (!src) return '';
  const label = src.title || src.source_id;
  return `<a class="src" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

function personPillHtml(p) {
  if (!p) return '';
  if (p.display_level === 'full' && ['official', 'candidate', 'staff'].includes(p.kind)) {
    return `<span class="pill ${escapeHtml(p.kind)}">${escapeHtml(p.kind)}</span>`;
  }
  const kind = p.kind || 'other';
  return `<span class="pill limited">${escapeHtml(kind)}</span><span class="badge-muted">limited</span>`;
}

function wireNav(container, ctx) {
  container.querySelectorAll('[data-nav]').forEach(node => {
    node.addEventListener('click', e => {
      e.preventDefault();
      ctx.select(node.dataset.nav);
    });
  });
}

function navLink(id, label) {
  return `<a href="#" data-nav="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
}

// ---- injected stylesheet ------------------------------------------------------
const STYLE_ID = 'issues-style';
const CSS = `
.iss-tbl-wrap { margin-bottom: 26px; }
.tbl tbody tr[data-id] { cursor: pointer; }
.tbl tbody tr.on { background: linear-gradient(100deg, rgba(70,166,255,.14), rgba(45,212,191,.14)); }
.tbl tbody tr.row-tied td:first-child { border-left: 3px solid var(--amber); }
.matrix-cell { font-size: 12px; line-height: 1.5; }
.matrix-cell .mc-row { margin-bottom: 4px; }
.matrix-cell .mc-row:last-child { margin-bottom: 0; }
.matrix-cell .src { display: inline-block; margin-left: 4px; }
.iss-tags .pill { margin-right: 4px; text-transform: none; }
.iss-see { display: inline-block; margin-top: 6px; font-size: 12px; }
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- issues table ------------------------------------------------------------
function issuesTableHtml(issues, bodiesById, selectedId) {
  if (!issues.length) return '<p class="empty">No issues on file.</p>';
  const rows = issues.map(i => {
    const body = bodiesById.get(i.body_id);
    const tags = String(i.tags || '').split(';').map(s => s.trim()).filter(Boolean);
    const tagsHtml = tags.length
      ? `<span class="iss-tags">${tags.map(t => `<span class="pill limited">${escapeHtml(t)}</span>`).join('')}</span>`
      : '';
    return `<tr data-id="${escapeHtml(i.issue_id)}"${i.issue_id === selectedId ? ' class="on"' : ''}>
      <td>${escapeHtml(i.title)}</td>
      <td><span class="pill type">${escapeHtml(i.status)}</span></td>
      <td>${escapeHtml(dateText(i.first_date))}</td>
      <td>${escapeHtml(dateText(i.next_date))}</td>
      <td>${tagsHtml}</td>
      <td>${escapeHtml(body ? body.name : i.body_id)}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr>
    <th>Title</th><th>Status</th><th>First date</th><th>Next date</th><th>Tags</th><th>Body</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- related entities: who's tied to each ------------------------------------
function relatedEntitiesHtml(relatedIds, ix, PT) {
  if (!relatedIds.length) return '<p class="empty">No related entities.</p>';
  return relatedIds.map(eid => {
    const e = ix.entities.get(eid);
    const name = e ? e.name : eid;
    const rels = PT.tables.relationships.filter(r => r.from_id === eid || r.to_id === eid);
    const relsHtml = rels.length ? rels.map(r => {
      const otherId = r.from_id === eid ? r.to_id : r.from_id;
      const conf = r.confidence || 'inferred';
      return `<div class="tie-row conf-${escapeHtml(conf)}">
        <div class="tr-main">${navLink(otherId, ix.labelOf(otherId))} <span class="tr-detail">${escapeHtml(relLabel(r.rel_type))}</span> <span class="pill limited">${escapeHtml(conf)}</span></div>
        ${srcLink(ix, r.source_id)}
      </div>`;
    }).join('') : '<p class="empty">No ties on file.</p>';
    return `<div class="tie-group"><div class="tg-label">${navLink(eid, name)}</div>${relsHtml}</div>`;
  }).join('');
}

// ---- per-subject matrix -------------------------------------------------------
function endOk(end, built) {
  if (!end) return true;
  let e = String(end);
  if (/^\d{4}$/.test(e)) e = e + '-12-31';
  return e >= built;
}

function issueSubjects(issue, ix, PT) {
  const seatsOnBody = new Set((PT.tables.seats || []).filter(s => s.body_id === issue.body_id).map(s => s.seat_id));
  const built = PT.meta.builtDate;
  const currentIds = new Set((PT.tables.terms || [])
    .filter(t => seatsOnBody.has(t.seat_id) && endOk(t.end_date, built))
    .map(t => t.person_id));
  const candidacyIds = new Set((PT.tables.candidacies || []).map(c => c.person_id));
  const map = new Map();
  for (const p of ix.subjects) if (currentIds.has(p.person_id)) map.set(p.person_id, p);
  for (const pid of candidacyIds) { const p = ix.people.get(pid); if (p) map.set(pid, p); }
  return [...map.values()];
}

function subjectCastHtml(personId, votesForIssue, PT, ix) {
  const hits = [];
  for (const v of votesForIssue) {
    const vc = (PT.tables.vote_casts || []).find(x => x.vote_id === v.vote_id && x.person_id === personId);
    if (vc) hits.push(vc);
  }
  if (!hits.length) return { html: '—', has: false };
  const html = hits.map(vc => `<div class="mc-row">${escapeHtml(vc.cast)}${srcLink(ix, vc.source_id)}</div>`).join('');
  return { html, has: true };
}

function subjectTiesHtml(personId, relatedIds, PT, ix) {
  if (!relatedIds.length) return { html: '—', has: false };
  const rels = PT.tables.relationships.filter(r =>
    (r.from_id === personId && relatedIds.includes(r.to_id)) ||
    (r.to_id === personId && relatedIds.includes(r.from_id)));
  if (!rels.length) return { html: '—', has: false };
  const html = rels.map(r => {
    const entityId = relatedIds.includes(r.to_id) ? r.to_id : r.from_id;
    const conf = r.confidence || 'inferred';
    return `<div class="mc-row">${escapeHtml(relLabel(r.rel_type))} ${navLink(entityId, ix.labelOf(entityId))} <span class="pill limited">${escapeHtml(conf)}</span>${srcLink(ix, r.source_id)}</div>`;
  }).join('');
  return { html, has: true };
}

function subjectPositionHtml(personId, issueId, PT, ix) {
  const rows = (PT.tables.positions || []).filter(p => p.person_id === personId && p.issue_id === issueId);
  if (!rows.length) return '—';
  return rows.map(p => `<div class="mc-row">${escapeHtml(p.stance)}${p.quote ? ` — "${escapeHtml(p.quote)}"` : ''}${srcLink(ix, p.source_id)}</div>`).join('');
}

function subjectContributionsHtml(personId, relatedIds, PT, ix) {
  const candidacies = (PT.tables.candidacies || []).filter(c => c.person_id === personId);
  if (!candidacies.length || !relatedIds.length) return { html: '—', has: false };
  const candidacyIds = new Set(candidacies.map(c => c.candidacy_id));
  const tiedIds = new Set();
  for (const r of PT.tables.relationships) {
    if (relatedIds.includes(r.from_id)) tiedIds.add(r.to_id);
    if (relatedIds.includes(r.to_id)) tiedIds.add(r.from_id);
  }
  const rows = (PT.tables.contributions || []).filter(c =>
    c.recipient_type === 'candidacy' && candidacyIds.has(c.recipient_id) &&
    tiedIds.has(c.contributor_person_id || c.contributor_entity_id));
  if (!rows.length) return { html: '—', has: false };
  const html = rows.map(c => `<div class="mc-row">${escapeHtml(money(c.amount))} — ${escapeHtml(dateText(c.date))}${srcLink(ix, c.source_id)}</div>`).join('');
  return { html, has: true };
}

function matrixHtml(issue, ix, PT) {
  const subjects = issueSubjects(issue, ix, PT);
  const relatedIds = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
  const votesForIssue = [...ix.votes.values()].filter(v => v.issue_id === issue.issue_id);
  if (!subjects.length) return '<p class="empty">No subjects on this body.</p>';

  const rows = subjects.map(p => {
    const cast = subjectCastHtml(p.person_id, votesForIssue, PT, ix);
    const ties = subjectTiesHtml(p.person_id, relatedIds, PT, ix);
    const position = subjectPositionHtml(p.person_id, issue.issue_id, PT, ix);
    const contrib = subjectContributionsHtml(p.person_id, relatedIds, PT, ix);
    const tied = ties.has || contrib.has;
    return { p, cast, ties, position, contrib, tied };
  });
  rows.sort((a, b) => (b.tied ? 1 : 0) - (a.tied ? 1 : 0));

  const body = rows.map(r => `<tr${r.tied ? ' class="row-tied"' : ''}>
    <td>${navLink(r.p.person_id, r.p.full_name)} ${personPillHtml(r.p)}</td>
    <td class="matrix-cell">${r.cast.html}</td>
    <td class="matrix-cell">${r.ties.html}</td>
    <td class="matrix-cell">${r.position}</td>
    <td class="matrix-cell">${r.contrib.html}</td>
  </tr>`).join('');

  return `<table class="tbl"><thead><tr>
    <th>Subject</th><th>Cast</th><th>Ties to related entities</th><th>Stated position</th><th>Contributions from tied people</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

// ---- issue detail --------------------------------------------------------------
function issueDetailHtml(issue, ix, PT) {
  const relatedIds = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
  return `
    <div class="profile-section">
      ${issue.summary ? `<p class="profile-meta">${escapeHtml(issue.summary)}</p>` : ''}
      ${issue.source_id ? `<div class="row"><b>Source</b>${srcLink(ix, issue.source_id)}</div>` : ''}
      <a class="iss-see" href="#/issue/${escapeHtml(issue.issue_id)}">See in the web →</a>
    </div>
    <div class="profile-section"><h3>Related entities</h3>${relatedEntitiesHtml(relatedIds, ix, PT)}</div>
    <div class="profile-section"><h3>Subject matrix</h3>${matrixHtml(issue, ix, PT)}</div>
  `;
}

export default {
  id: 'issues',
  label: 'Issues',
  render(container, ctx) {
    ensureStyle();
    const { ix, PT, route } = ctx;
    const issues = [...ix.issues.values()].sort((a, b) => String(a.issue_id).localeCompare(String(b.issue_id)));
    const bodiesById = new Map((PT.tables.bodies || []).map(b => [b.body_id, b]));
    const selectedId = route.view === 'issue' && ix.issues.has(route.id) ? route.id : '';

    container.innerHTML = `
      <div class="iss-tbl-wrap">${issuesTableHtml(issues, bodiesById, selectedId)}</div>
      <div id="iss-detail"></div>
    `;
    container.querySelectorAll('tr[data-id]').forEach(node => {
      node.addEventListener('click', () => ctx.navigate(`#/issue/${node.dataset.id}/issues`));
    });

    const detailEl = container.querySelector('#iss-detail');
    if (!selectedId) { detailEl.innerHTML = '<p class="empty">Select an issue above.</p>'; return; }
    const issue = ix.issues.get(selectedId);
    if (!issue) { detailEl.innerHTML = '<p class="empty">Not found.</p>'; return; }
    detailEl.innerHTML = issueDetailHtml(issue, ix, PT);
    wireNav(detailEl, ctx);
  },
};
