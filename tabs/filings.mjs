// Filings + Records + Timeline tabs.
//
// `filingsTab`: PT.tables.filings joined to people/entities/sources, grouped
// by filer (selected person/entity's group first, then alphabetical; each
// group sorted by submitted_date desc).
//
// `recordsTab`: PT.tables.records_requests, then PT.tables.timeline, sorted
// by date desc with future dates (>= PT.meta.builtDate) marked with a dot.
import { escapeHtml, dateText } from '../lib/format.mjs';

// ---- small helpers copied from profile.mjs / app.mjs conventions -----------
function navLink(id, label) {
  return `<a href="#" data-nav="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
}

function wireNav(container, ctx) {
  container.querySelectorAll('[data-nav]').forEach(node => {
    node.addEventListener('click', e => {
      e.preventDefault();
      ctx.select(node.dataset.nav);
    });
  });
}

// ---- injected stylesheet ------------------------------------------------------
const STYLE_ID = 'filings-style';
const CSS = `
.filing-group { margin-bottom: 20px; }
.filing-group h4 { font-size: 13px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.filing-group.filing-touched { border-color: rgba(45,212,191,.6); box-shadow: 0 18px 44px rgba(0,0,0,.34), 0 0 0 1px rgba(45,212,191,.35); }
.chip-count { display: inline-block; margin-left: 2px; padding: 1px 7px; border-radius: 999px;
  background: rgba(159,176,195,.16); color: var(--mut); font-size: 11px; font-weight: 700; }
.future-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--teal);
  margin-right: 6px; box-shadow: 0 0 6px rgba(45,212,191,.8); }
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- filings: filer + document link ------------------------------------------
function filerOf(f, ix) {
  if (f.filer_person_id) return { id: f.filer_person_id, label: ix.labelOf(f.filer_person_id) };
  if (f.filer_entity_id) return { id: f.filer_entity_id, label: ix.labelOf(f.filer_entity_id) };
  return { id: '', label: 'Unknown filer' };
}

function filingDocLink(f, ix) {
  const src = ix.sourceOf(f.source_id);
  if (!src) return '';
  const label = [f.form, f.period_label].filter(Boolean).join(' ') || src.title || src.source_id;
  return `<a class="src" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener" title="${escapeHtml(src.title || src.source_id)}">${escapeHtml(label)}</a>`;
}

function groupFilings(filings, ix, selId) {
  const groups = new Map();
  for (const f of filings) {
    const filer = filerOf(f, ix);
    const key = filer.id || `~${filer.label}`;
    if (!groups.has(key)) groups.set(key, { id: filer.id, label: filer.label, rows: [] });
    groups.get(key).rows.push(f);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => String(b.submitted_date || '').localeCompare(String(a.submitted_date || '')));
  }
  const list = [...groups.values()];
  list.sort((a, b) => {
    if (selId) {
      const aSel = a.id === selId ? 0 : 1;
      const bSel = b.id === selId ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
    }
    return String(a.label).localeCompare(String(b.label));
  });
  return list;
}

function filingsHtml(groups, ix, selId) {
  if (!groups.length) return '<p class="empty">No filings on file.</p>';
  return groups.map(g => {
    const header = g.id ? navLink(g.id, g.label) : escapeHtml(g.label);
    const touched = selId && g.id === selId;
    const rows = g.rows.map(f => `<tr>
      <td>${escapeHtml(f.system)}</td>
      <td>${escapeHtml(f.form)}</td>
      <td>${escapeHtml(f.period_label)}</td>
      <td>${escapeHtml(dateText(f.submitted_date))}</td>
      <td>${filingDocLink(f, ix)}</td>
    </tr>`).join('');
    return `<div class="card filing-group${touched ? ' filing-touched' : ''}">
      <h4>${header} <span class="chip-count">${g.rows.length}</span></h4>
      <table class="tbl"><thead><tr>
        <th>System</th><th>Form</th><th>Period</th><th>Submitted</th><th>Document</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
}

export const filingsTab = {
  id: 'filings',
  label: 'Filings',
  render(container, ctx) {
    ensureStyle();
    const { PT, ix, route } = ctx;
    const filings = PT.tables.filings || [];
    const selId = (route.view === 'person' || route.view === 'entity') ? route.id : '';
    const groups = groupFilings(filings, ix, selId);
    container.innerHTML = `
      <p class="profile-meta"><span>${filings.length} filings on file</span></p>
      ${filingsHtml(groups, ix, selId)}
    `;
    wireNav(container, ctx);
  },
};

// ---- records requests ----------------------------------------------------------
function recordsRequestsHtml(rows) {
  if (!rows.length) return '<p class="empty">No records requests on file.</p>';
  const body = rows.map(r => `<tr>
    <td>${escapeHtml(r.who)}</td>
    <td>${escapeHtml(r.record)}</td>
    <td>${escapeHtml(r.where_to_request)}</td>
    <td>${escapeHtml(r.why)}</td>
    <td><span class="pill type">${escapeHtml(r.status)}</span></td>
  </tr>`).join('');
  return `<table class="tbl"><thead><tr>
    <th>Who</th><th>Record</th><th>Where to request</th><th>Why</th><th>Status</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

// ---- timeline -------------------------------------------------------------------
function timelineHtml(rows, ix, built) {
  if (!rows.length) return '<p class="empty">No timeline entries.</p>';
  const sorted = rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const body = sorted.map(t => {
    const future = !!(t.date && built && t.date >= built);
    const issueLink = t.issue_id ? navLink(t.issue_id, ix.labelOf(t.issue_id)) : '';
    const electionText = t.election_id ? escapeHtml(t.election_id) : '';
    const extra = [issueLink, electionText].filter(Boolean).join(' &middot; ');
    return `<tr>
      <td>${future ? '<span class="future-dot" title="Upcoming"></span>' : ''}${escapeHtml(dateText(t.date))}</td>
      <td>${escapeHtml(t.event)}</td>
      <td><span class="pill type">${escapeHtml(t.type)}</span></td>
      <td>${extra}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr>
    <th>Date</th><th>Event</th><th>Type</th><th>Issue / election</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

export const recordsTab = {
  id: 'records',
  label: 'Records',
  render(container, ctx) {
    ensureStyle();
    const { PT, ix } = ctx;
    const reqRows = PT.tables.records_requests || [];
    const timelineRows = PT.tables.timeline || [];
    container.innerHTML = `
      <div class="profile-section"><h3>Records requests (${reqRows.length})</h3>${recordsRequestsHtml(reqRows)}</div>
      <div class="profile-section"><h3>Timeline</h3>${timelineHtml(timelineRows, ix, PT.meta.builtDate)}</div>
    `;
    wireNav(container, ctx);
  },
};
