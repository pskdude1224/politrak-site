// Leads tab: one card per PT.derived.leads entry, grouped by kind with a
// count chip per group and a kind filter row. Each card shows the kind, the
// "check" text with every person/entity/issue id swapped for a link to that
// node (address ids stay as plain ids by design — the lead text is
// published, so no address text or tooltip is ever shown here), the raw ids
// list, and — when the lead carries a `proposed` relationship row — a "Copy
// relationship row" button that copies a CSV line (in the relationships
// table's column order) to the clipboard.
import { escapeHtml } from '../lib/format.mjs';

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
const STYLE_ID = 'leads-style';
const CSS = `
.lead-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.lead-filters .chip { border: none; font: inherit; }
.chip-count { display: inline-block; margin-left: 2px; padding: 1px 7px; border-radius: 999px;
  background: rgba(159,176,195,.16); color: var(--mut); font-size: 11px; font-weight: 700; }
.lead-group { margin-bottom: 24px; }
.lead-group h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--mut);
  margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.lead-card { margin-bottom: 12px; }
.lead-card.lead-touched { border-color: rgba(45,212,191,.6); box-shadow: 0 18px 44px rgba(0,0,0,.34), 0 0 0 1px rgba(45,212,191,.35); }
.lead-check { font-size: 14px; line-height: 1.5; margin: 8px 0; }
.lead-check a { color: var(--ink); font-weight: 600; }
.lead-ids { font-size: 12px; color: var(--mut); margin: 0 0 10px; }
.lead-ids a { color: var(--mut); }
.lead-copy { margin-top: 6px; display: flex; align-items: center; gap: 10px; }
.lead-copy-msg { font-size: 12px; color: var(--teal); }
.csv-fallback-wrap { margin-top: 8px; }
.csv-fallback-label { font-size: 11px; color: var(--amber); margin-bottom: 4px; }
.csv-fallback { display: block; width: 100%; box-sizing: border-box; resize: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
  color: var(--ink); background: linear-gradient(180deg, rgba(28,38,54,.72), rgba(16,22,32,.72));
  border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 8px 10px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.leads-show-all-wrap { margin-top: 4px; }
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- module-scope state (kept across re-renders) ----------------------------
let activeKind = '';
let expanded = false;
let lastSelId = '';

// ---- kind label / grouping ---------------------------------------------------
function kindLabel(kind) {
  return String(kind || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

// ---- id token -> link or plain text ------------------------------------------
// P/E/I ids link to the labelled node; A (address) ids stay plain ids with no
// tooltip and no address text (the lead text is published, by design);
// C (candidacy) ids render as "candidacy <id>", also unlinked.
function tokenHtml(id, ix) {
  const letter = id[0];
  if (letter === 'A') return escapeHtml(id);
  if (letter === 'C') return `candidacy ${escapeHtml(id)}`;
  const view = letter === 'P' ? 'person' : letter === 'E' ? 'entity' : letter === 'I' ? 'issue' : '';
  if (!view) return escapeHtml(id);
  return navLink(id, ix.labelOf(id));
}

function checkTextHtml(text, ix) {
  return escapeHtml(text).replace(/\b([PEIAC]\d+)\b/g, tok => tokenHtml(tok, ix));
}

function idsListHtml(ids, ix) {
  return ids.map(id => tokenHtml(id, ix)).join(', ');
}

// ---- CSV (relationships column order) ----------------------------------------
const FALLBACK_REL_COLUMNS = [
  'rel_id', 'from_type', 'from_id', 'to_type', 'to_id', 'rel_type', 'detail', 'amount',
  'start_date', 'end_date', 'issue_id', 'source_id', 'confidence', 'verified_by',
  'verified_date', 'added_date', 'notes',
];

function relColumns(PT) {
  const sample = (PT.tables.relationships || [])[0];
  return sample ? Object.keys(sample) : FALLBACK_REL_COLUMNS;
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvLineFor(proposed, columns) {
  return columns.map(col => csvField(proposed[col])).join(',');
}

// ---- copy button --------------------------------------------------------------
// When the Clipboard API is unavailable or rejects (e.g. an unfocused document,
// which is exactly what a blurred/background tab or automation gives us), we
// can't silently succeed — the user needs something to actually select and
// copy. So we render a small visible, read-only textarea with the CSV line
// pre-selected, directly under the button, and leave it in the DOM until the
// button is clicked again (which replaces it) or the tab re-renders (which
// clears the whole panel). We still attempt `execCommand('copy')` once on the
// selected text — if that happens to succeed we flash "copied" too, but the
// textarea stays visible either way so the user can verify/copy manually.
function removeFallback(card) {
  const existing = card.querySelector('.csv-fallback-wrap');
  if (existing) existing.remove();
}

function showFallback(copyWrap, csv) {
  const card = copyWrap.closest('.card');
  removeFallback(card);
  const wrap = document.createElement('div');
  wrap.className = 'csv-fallback-wrap';
  wrap.innerHTML = '<div class="csv-fallback-label">Clipboard blocked — select and copy</div>';
  const ta = document.createElement('textarea');
  ta.className = 'csv-fallback';
  ta.readOnly = true;
  ta.rows = 2;
  ta.value = csv;
  wrap.appendChild(ta);
  copyWrap.insertAdjacentElement('afterend', wrap);
  ta.focus();
  ta.select();
  return ta;
}

async function copyCsv(copyWrap, btn, msgEl) {
  const csv = btn.dataset.csv;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(csv);
      msgEl.textContent = 'copied';
      msgEl.hidden = false;
      setTimeout(() => { msgEl.hidden = true; }, 1500);
      return;
    } catch { /* fall through to the visible textarea fallback */ }
  }
  const ta = showFallback(copyWrap, csv);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.focus();
  ta.select();
  if (ok) {
    msgEl.textContent = 'copied';
    msgEl.hidden = false;
    setTimeout(() => { msgEl.hidden = true; }, 1500);
  }
}

// ---- card ---------------------------------------------------------------------
function leadCardHtml(lead, ix, PT, touched, leadIndex) {
  const copyHtml = lead.proposed
    ? `<div class="lead-copy">
        <button class="chip lead-copy-btn" type="button" data-lead-index="${leadIndex}" data-csv="${escapeHtml(csvLineFor(lead.proposed, relColumns(PT)))}">Copy relationship row</button>
        <span class="lead-copy-msg" hidden></span>
      </div>`
    : '';
  return `<div class="card lead-card${touched ? ' lead-touched' : ''}">
    <div class="lead-head"><span class="pill type">${escapeHtml(kindLabel(lead.kind))}</span></div>
    <p class="lead-check">${checkTextHtml(lead.check, ix)}</p>
    <p class="lead-ids"><b>IDs</b> ${idsListHtml(lead.ids, ix)}</p>
    ${copyHtml}
  </div>`;
}

// ---- main render ----------------------------------------------------------------
function draw(container, ctx) {
  ensureStyle();
  const { PT, ix, route } = ctx;
  const allLeads = PT.derived.leads || [];
  const kindsOrder = [...new Set(allLeads.map(l => l.kind))];
  if (activeKind && !kindsOrder.includes(activeKind)) activeKind = '';

  const selId = ['person', 'entity', 'issue'].includes(route.view) ? route.id : '';
  if (selId !== lastSelId) { lastSelId = selId; expanded = false; }

  const countsByKind = new Map();
  for (const l of allLeads) countsByKind.set(l.kind, (countsByKind.get(l.kind) || 0) + 1);

  const filterRowHtml = `<div class="lead-filters">
    <button class="chip${!activeKind ? ' on' : ''}" type="button" data-kind="">All <span class="chip-count">${allLeads.length}</span></button>
    ${kindsOrder.map(k => `<button class="chip${activeKind === k ? ' on' : ''}" type="button" data-kind="${escapeHtml(k)}">${escapeHtml(kindLabel(k))} <span class="chip-count">${countsByKind.get(k)}</span></button>`).join('')}
  </div>`;

  const filtered = activeKind ? allLeads.filter(l => l.kind === activeKind) : allLeads;
  const byKind = new Map();
  for (const l of filtered) {
    if (!byKind.has(l.kind)) byKind.set(l.kind, []);
    byKind.get(l.kind).push(l);
  }

  let hiddenCount = 0;
  const sections = [];
  let cardIndex = 0;
  for (const k of kindsOrder) {
    const group = byKind.get(k);
    if (!group) continue;
    let visible = group;
    if (selId) {
      const matched = group.filter(l => l.ids.includes(selId));
      const rest = group.filter(l => !l.ids.includes(selId));
      hiddenCount += expanded ? 0 : rest.length;
      visible = expanded ? matched.concat(rest) : matched;
    }
    if (!visible.length) continue;
    const cardsHtml = visible.map(l => {
      const html = leadCardHtml(l, ix, PT, selId && l.ids.includes(selId), cardIndex);
      cardIndex += 1;
      return html;
    }).join('');
    sections.push(`<div class="lead-group">
      <h4>${escapeHtml(kindLabel(k))} <span class="chip-count">${group.length}</span></h4>
      ${cardsHtml}
    </div>`);
  }

  const showAllHtml = (selId && hiddenCount > 0)
    ? `<div class="leads-show-all-wrap"><button class="chip" type="button" id="leads-show-all">Show all ${hiddenCount}</button></div>`
    : '';

  container.innerHTML = `
    ${filterRowHtml}
    ${sections.join('') || '<p class="empty">No leads match this filter.</p>'}
    ${showAllHtml}
  `;

  container.querySelectorAll('[data-kind]').forEach(node => {
    node.addEventListener('click', () => { activeKind = node.dataset.kind; draw(container, ctx); });
  });
  const showAllBtn = container.querySelector('#leads-show-all');
  if (showAllBtn) showAllBtn.addEventListener('click', () => { expanded = true; draw(container, ctx); });
  container.querySelectorAll('.lead-copy-btn').forEach(node => {
    node.addEventListener('click', () => {
      const copyWrap = node.closest('.lead-copy');
      const msgEl = copyWrap.querySelector('.lead-copy-msg');
      copyCsv(copyWrap, node, msgEl);
    });
  });
  wireNav(container, ctx);
}

export default {
  id: 'leads',
  label: 'Leads',
  render: draw,
};
