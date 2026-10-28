// Money tab: a view switch (money to Village campaigns, the officials' own giving
// elsewhere, or both), filters, a totals strip, a ranked list (by campaign or by
// giver), contributions by employer (a d3 treemap) and by month (grouped by year,
// older years collapsed), then the sortable contributions and expenditures
// tables. Everything below the switch follows the view and the filters, so
// narrowing to one recipient or one year narrows the charts with it.
import { escapeHtml, dateText, money } from '../lib/format.mjs';

// ---- small helpers copied from profile.mjs / app.mjs conventions -----------
function srcLink(ix, sourceId) {
  const src = ix.sourceOf(sourceId);
  if (!src) return '';
  const label = src.title || src.source_id;
  return `<a class="src" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

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

const FALLBACK_TOKENS = { teal: '#2dd4bf', blue: '#46a6ff', mut: '#9fb0c3', violet: '#8b7cff', amber: '#f5b342' };
let TOKENS = null;
function tokens() {
  if (TOKENS) return TOKENS;
  TOKENS = Object.assign({}, FALLBACK_TOKENS);
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const name of Object.keys(FALLBACK_TOKENS)) {
      const v = cs.getPropertyValue('--' + name).trim();
      if (v) TOKENS[name] = v;
    }
  } catch { /* keep fallbacks */ }
  return TOKENS;
}

// ---- injected stylesheet ------------------------------------------------------
const STYLE_ID = 'money-style';
const CSS = `
.mf-card { margin-bottom: 20px; }
.mf-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; }
.mf-row label { display: flex; flex-direction: column; gap: 5px; font-size: 11px;
  color: var(--mut); text-transform: uppercase; letter-spacing: .4px; }
.mf-row input, .mf-row select { background: var(--panel2); border: 1px solid var(--line);
  color: var(--ink); padding: 7px 10px; border-radius: 8px; font-size: 13px; font-family: inherit; }
.mf-row input:focus, .mf-row select:focus { outline: none; border-color: var(--teal); }
.mf-row .chip { align-self: flex-end; border: none; }
.mf-row select { width: 290px; max-width: 100%; }
.mf-row select optgroup { color: var(--mut); }
.mf-row select option { color: var(--ink); }
/* Phone width: five stacked fields filled the first screen of the tab, so they fold
   behind one Filters button (with a count of what is set), and a ranked row puts its
   name on a line of its own instead of a 300px column that pushed the amounts off. */
.mf-toggle { display: none; }
@media (max-width: 640px) {
  .card.mf-card { padding: 0; }
  .mf-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between;
    padding: 12px 14px; background: none; border: 0; cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 700; color: var(--ink); }
  .mf-toggle b { color: var(--teal); margin-left: 4px; }
  .mf-caret { color: var(--teal); transition: transform .15s; }
  .mf-card:not(.folded) .mf-caret { transform: rotate(180deg); }
  .mf-card.folded .mf-row { display: none; }
  .mf-row { padding: 0 14px 14px; gap: 10px; }
  .mf-row label { flex: 1 1 130px; }
  .mf-row label:first-child { flex-basis: 100%; }
  .mf-row input, .mf-row select { width: 100%; }
  .rk-row { flex-wrap: wrap; gap: 2px 10px; padding: 5px 6px; }
  .rk-label { width: 100%; }
  .rk-amt { width: auto; }
  .rk-n { width: auto; }
}
.tiles-row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 22px; }
.tiles-row .tile { min-width: 130px; }
.tiles-row.six { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.tiles-row.six .tile { min-width: 0; padding: 12px 12px; }
.tiles-row.six .tile b { font-size: 21px; white-space: nowrap; }
.tiles-row.six .tile span { display: block; font-size: 10px; letter-spacing: .3px; line-height: 1.35; }
@media (max-width: 1100px) { .tiles-row.six { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .tiles-row.six { gap: 8px; } .tiles-row.six .tile { padding: 10px 9px; } .tiles-row.six .tile b { font-size: 17px; } }
.muted-sub { display: block; color: var(--mut2); font-size: 11px; }
.tm-wrap { position: relative; width: 100%; height: 280px; overflow: hidden; }
.tm-tile { position: absolute; overflow: hidden; border: 1px solid rgba(7,11,17,.55);
  border-radius: 4px; box-sizing: border-box; padding: 5px 7px; color: #04121d; }
.tm-tile .tm-label { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-tile .tm-amt { font-size: 11px; opacity: .85; white-space: nowrap; }

/* ---- view switch ---- */
.mv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.mv-row .mv-label { font-size: 11px; color: var(--mut); text-transform: uppercase; letter-spacing: .4px; margin-right: 4px; }
.mv-note { flex-basis: 100%; color: var(--mut2); font-size: 12px; margin-top: 2px; }

/* ---- ranked list: by campaign / by giver ---- */
.rk-legend { display: flex; flex-wrap: wrap; gap: 14px; margin: -4px 0 10px; font-size: 11px; color: var(--mut); }
.rk-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.rk-list { max-height: 560px; overflow-y: auto; padding-right: 4px; scrollbar-color: var(--line) transparent; scrollbar-width: thin; }
.rk-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 3px 6px; margin: 0 0 1px; line-height: 18px;
  background: none; border: 1px solid transparent; border-radius: 6px; color: inherit; font: inherit;
  font-size: 12px; text-align: left; cursor: pointer; }
.rk-row:hover { background: rgba(255,255,255,.04); }
.rk-row.on { border-color: rgba(45,212,191,.6); background: rgba(45,212,191,.08); }
.rk-label { width: 300px; flex: none; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rk-label em { font-style: normal; color: var(--mut); }
.rk-bar-wrap { flex: 1; display: flex; background: var(--panel2); border-radius: 6px; overflow: hidden; height: 12px; }
.rk-bar-wrap span { display: block; height: 100%; }
.rk-amt { width: 96px; flex: none; text-align: right; color: var(--ink); }
.rk-n { width: 64px; flex: none; text-align: right; color: var(--mut2); font-size: 11px; }
.rk-year { font-size: 11px; color: var(--mut2); text-transform: uppercase; letter-spacing: .4px; margin: 12px 0 4px 6px; }
.rk-year:first-child { margin-top: 0; }

/* ---- by month, grouped by year ---- */
.mb-tools { display: flex; gap: 6px; margin: -4px 0 10px; }
.mb-year { border-bottom: 1px solid var(--line); }
.mb-year > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 7px 4px; font-size: 12px; border-radius: 6px; }
.mb-year > summary::-webkit-details-marker { display: none; }
.mb-year > summary:hover { background: rgba(255,255,255,.04); }
.mb-year > summary .mb-caret { width: 12px; flex: none; color: var(--mut2); transition: transform .15s; }
.mb-year[open] > summary .mb-caret { transform: rotate(90deg); }
.mb-year > summary .mb-label { color: var(--ink); font-weight: 700; }
.mb-n { width: 38px; flex: none; color: var(--mut2); font-size: 11px; }
.mb-months { padding: 2px 4px 8px 26px; }
.mb-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12px; }
.mb-label { width: 72px; flex: none; color: var(--mut); }
.mb-bar-wrap { flex: 1; background: var(--panel2); border-radius: 6px; overflow: hidden; height: 12px; }
.mb-bar { height: 100%; background: linear-gradient(90deg, var(--teal), var(--blue)); }
.mb-year > summary .mb-bar { opacity: .7; }
.mb-amt { width: 90px; flex: none; text-align: right; color: var(--ink); }

/* ---- sortable headers ---- */
.tbl th.sortable { cursor: pointer; user-select: none; }
.tbl th.sortable:hover { color: var(--ink); }
.tbl th.sortable .arr { display: inline-block; width: 10px; margin-left: 3px; color: var(--mut2); }
.tbl th.sorted { color: var(--teal); }
.tbl th.sorted .arr { color: var(--teal); }
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- module-scope state (kept across re-renders) --------------------------------
export const VIEWS = [
  ['village', 'Village campaigns'],
  ['own', "Officials' own giving"],
  ['all', 'All'],
];
const VIEW_NOTES = {
  village: "Money given to Village of Key Biscayne candidates and the local PAC, from their campaign treasurer's reports: the Village Clerk's archive through 2024, and the EasyVote portal for the 2026 race.",
  own: "Gifts the officials and candidates made themselves to outside committees: federal (FEC) and Miami-Dade County / Florida filings.",
  all: 'Both kinds of contribution in one list.',
};
let view = 'village';
// ?moneyview=own (or village / all) picks the opening view once, as a deep link;
// after that the chips own it.
let viewFromUrlRead = false;
function readViewFromUrl() {
  if (viewFromUrlRead) return;
  viewFromUrlRead = true;
  try {
    const v = new URLSearchParams(location.search).get('moneyview');
    if (VIEWS.some(([id]) => id === v)) view = v;
  } catch { /* no location: keep the default */ }
}

const filters = { recipient: '', contributor: '', employer: '', dateFrom: '', dateTo: '' };
// Newest first is what a reader almost always wants from a finance table.
const sorts = {
  contrib: { key: 'date', dir: 'desc' },
  exp: { key: 'date', dir: 'desc' },
};
// Year groups the reader opened or closed by hand; anything not in here follows
// the default (the two most recent years open, the rest collapsed).
const yearOpen = new Map();

// ---- which rows belong to which view ------------------------------------------------
// A lookup that takes either a Map or a plain object keyed by id.
function getBy(byId, id) {
  if (!byId || !id) return undefined;
  return typeof byId.get === 'function' ? byId.get(id) : byId[id];
}

const isFederal = row => /^FEC\b/.test(row.report_label || '');

// Money to a Village campaign: a candidacy, or a local PAC, and never a federal
// filing whatever the committee's type. The same rule as the pipeline's
// isLocalRecipient, kept here so the dashboard does not import from pipeline/.
export function isVillageCampaign(row, entityById) {
  if (isFederal(row)) return false;
  if (row.recipient_type === 'candidacy') return true;
  if (row.recipient_type !== 'entity') return false;
  const e = getBy(entityById, row.recipient_id);
  return !!e && e.type === 'pac';
}

// Spending by a Village campaign: filed by a candidacy or by a local PAC.
export function isVillageExpenditure(e, entityById) {
  if (isFederal(e)) return false;
  if (e.filer_type === 'candidacy') return true;
  if (e.filer_type !== 'entity') return false;
  const ent = getBy(entityById, e.filer_id);
  return !!ent && ent.type === 'pac';
}

// The officials' own giving elsewhere: not to a Village campaign, and given by
// a full subject.
export function isOwnGiving(row, entityById, personById) {
  if (isVillageCampaign(row, entityById)) return false;
  const p = getBy(personById, row.contributor_person_id);
  return !!p && p.display_level === 'full';
}

function viewContributions(rows, ix) {
  if (view === 'village') return rows.filter(c => isVillageCampaign(c, ix.entities));
  if (view === 'own') return rows.filter(c => isOwnGiving(c, ix.entities, ix.people));
  return rows;
}

function viewExpenditures(rows, ix) {
  if (view === 'village') return rows.filter(e => isVillageExpenditure(e, ix.entities));
  if (view === 'own') return [];
  return rows;
}

const r2 = n => Math.round(n * 100) / 100;

// One row per recipient: [{ id, monetary, inKind, loans, count }]. Monetary is
// everything that is neither in-kind nor a loan. Candidacies come first, newest
// election first (the date comes from the candidacy's own election_date, or
// from electionById), then the largest total; any other recipient (a local PAC)
// follows, largest first.
export function campaignTotals(rows, candidacyById, electionById) {
  const m = new Map();
  for (const r of rows) {
    const id = r.recipient_id;
    if (!id) continue;
    if (!m.has(id)) m.set(id, { id, monetary: 0, inKind: 0, loans: 0, count: 0 });
    const g = m.get(id);
    const a = Number(r.amount) || 0;
    if (r.kind === 'in_kind') g.inKind += a;
    else if (r.kind === 'loan') g.loans += a;
    else g.monetary += a;
    g.count++;
  }
  const dateOf = id => {
    const c = getBy(candidacyById, id);
    if (!c) return '';
    if (c.election_date) return c.election_date;
    const e = getBy(electionById, c.election_id);
    return (e && e.date) || '';
  };
  const total = g => g.monetary + g.inKind + g.loans;
  const out = [...m.values()];
  for (const g of out) { g.monetary = r2(g.monetary); g.inKind = r2(g.inKind); g.loans = r2(g.loans); }
  return out.sort((a, b) => {
    const ca = !!getBy(candidacyById, a.id), cb = !!getBy(candidacyById, b.id);
    if (ca !== cb) return ca ? -1 : 1;
    const d = dateOf(b.id).localeCompare(dateOf(a.id));
    if (d) return d;
    return (total(b) - total(a)) || String(a.id).localeCompare(String(b.id));
  });
}

// One row per giving subject: [{ id, federal, countyState, count }], largest
// first. Federal is an FEC filing; everything else is county or state.
export function giverTotals(rows) {
  const m = new Map();
  for (const r of rows) {
    const id = r.contributor_person_id;
    if (!id) continue;
    if (!m.has(id)) m.set(id, { id, federal: 0, countyState: 0, count: 0 });
    const g = m.get(id);
    const a = Number(r.amount) || 0;
    if (isFederal(r)) g.federal += a; else g.countyState += a;
    g.count++;
  }
  const out = [...m.values()];
  for (const g of out) { g.federal = r2(g.federal); g.countyState = r2(g.countyState); }
  return out.sort((a, b) => ((b.federal + b.countyState) - (a.federal + a.countyState)) || String(a.id).localeCompare(String(b.id)));
}

const KIND_TEXT = { check: 'check', cash: 'cash', in_kind: 'in-kind', loan: 'loan' };
export const kindText = k => KIND_TEXT[k] || String(k || '').replace(/_/g, '-');

// ---- shared lookups -----------------------------------------------------------
function recipientOf(row, ix) {
  if (row.recipient_type === 'candidacy') {
    const pid = ix.personOfCandidacy(row.recipient_id);
    return pid ? { id: pid, text: ix.labelOf(pid) } : { id: '', text: row.recipient_id };
  }
  return { id: row.recipient_id, text: ix.labelOf(row.recipient_id) };
}

function contributorOf(c, ix) {
  const id = c.contributor_person_id || c.contributor_entity_id;
  if (id && (ix.people.has(id) || ix.entities.has(id))) return { id, text: ix.labelOf(id) };
  return { id: '', text: c.name_as_reported || '' };
}

function filerOf(e, ix) {
  if (e.filer_type === 'candidacy') {
    const pid = ix.personOfCandidacy(e.filer_id);
    return pid ? { id: pid, text: ix.labelOf(pid) } : { id: '', text: e.filer_id };
  }
  return { id: e.filer_id, text: ix.labelOf(e.filer_id) };
}

function payeeOf(e, ix) {
  const id = e.payee_person_id || e.payee_entity_id;
  if (id) return { id, text: ix.labelOf(id) };
  return { id: '', text: e.payee_as_reported || '' };
}

function electionYearOf(candidacyId, ix, PT) {
  const c = ix.candidacies.get(candidacyId);
  if (!c) return '';
  const e = (PT.tables.elections || []).find(x => x.election_id === c.election_id);
  return e ? String(e.date || '').slice(0, 4) : '';
}

// { name: "Joe I. Rasco", rest: "2022 Mayor" } for a candidacy,
// { name: "Key Biscayne United", rest: "PAC" } for a local committee.
function campaignLabel(id, ix, PT) {
  const c = ix.candidacies.get(id);
  if (c) {
    const who = c.person_id ? ix.labelOf(c.person_id) : (c.ballot_name || id);
    return { name: who, rest: [electionYearOf(id, ix, PT), c.office].filter(Boolean).join(' ') };
  }
  const e = ix.entities.get(id);
  return { name: ix.labelOf(id), rest: e && e.type === 'pac' ? 'PAC' : '' };
}

// Contributions may carry a full "YYYY-MM-DD" date or just "YYYY-MM"; pad
// the short form out to a month-spanning range before comparing as strings.
function dateInRange(dateStr, from, to) {
  if (!dateStr) return !from && !to;
  const lo = dateStr.length === 7 ? dateStr + '-01' : dateStr;
  const hi = dateStr.length === 7 ? dateStr + '-31' : dateStr;
  if (from && hi < from) return false;
  if (to && lo > to) return false;
  return true;
}

function textMatch(hay, needle) {
  if (!needle.trim()) return true;
  return String(hay || '').toLowerCase().includes(needle.trim().toLowerCase());
}

// ---- filtering ------------------------------------------------------------------
function filterContributions(rows, ix) {
  return rows.filter(c => {
    if (filters.recipient && c.recipient_id !== filters.recipient) return false;
    if (!dateInRange(c.date, filters.dateFrom, filters.dateTo)) return false;
    if (!textMatch(contributorOf(c, ix).text, filters.contributor)) return false;
    if (!textMatch(c.employer_as_reported, filters.employer)) return false;
    return true;
  });
}

function filterExpenditures(rows, ix) {
  return rows.filter(e => {
    if (!dateInRange(e.date, filters.dateFrom, filters.dateTo)) return false;
    if (!textMatch(payeeOf(e, ix).text, filters.contributor)) return false;
    return true;
  });
}

// ---- sorting --------------------------------------------------------------------
// Sorts a copy. `valueOf(row)` returns a number for numeric columns and a string
// otherwise; blanks always sink to the bottom whichever way the column is
// sorted, so "newest first" never opens on a page of undated rows. Ties keep
// their original order (Array.prototype.sort is stable).
export function sortRows(rows, valueOf, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const blank = v => v === '' || v == null || (typeof v === 'number' && Number.isNaN(v));
  return rows.slice().sort((a, b) => {
    const va = valueOf(a), vb = valueOf(b);
    const ba = blank(va), bb = blank(vb);
    if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true }) * sign;
  });
}

// Clicking the sorted column flips it; clicking another column starts it at its
// natural first direction — newest date and largest amount first, A to Z for text.
export function nextSort(current, key) {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' };
}

const CONTRIB_COLS = [
  ['date', 'Date', c => c.date || ''],
  ['contributor', 'Contributor', (c, ix) => contributorOf(c, ix).text],
  ['occupation', 'Occupation', c => c.occupation_as_reported || ''],
  ['employer', 'Employer', c => c.employer_as_reported || ''],
  ['amount', 'Amount', c => Number(c.amount)],
  ['kind', 'Kind', c => kindText(c.kind)],
  ['recipient', 'Recipient', (c, ix) => recipientOf(c, ix).text],
  ['report', 'Report', c => c.report_label || ''],
  ['source', 'Source', null],
];

const EXP_COLS = [
  ['date', 'Date', e => e.date || ''],
  ['filer', 'Filer', (e, ix) => filerOf(e, ix).text],
  ['payee', 'Payee', (e, ix) => payeeOf(e, ix).text],
  ['purpose', 'Purpose', e => e.purpose || ''],
  ['amount', 'Amount', e => Number(e.amount)],
  ['report', 'Report', e => e.report_label || ''],
  ['source', 'Source', null],
];

function applySort(rows, cols, sort, ix) {
  const col = cols.find(c => c[0] === sort.key && c[2]);
  return col ? sortRows(rows, r => col[2](r, ix), sort.dir) : rows;
}

function headHtml(table, cols, sort) {
  return cols.map(([key, label, valueOf]) => {
    if (!valueOf) return `<th>${escapeHtml(label)}</th>`;
    const on = sort.key === key;
    const arrow = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
    const aria = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th class="sortable${on ? ' sorted' : ''}" data-sort="${table}:${key}" aria-sort="${aria}" ` +
      `title="Sort by ${escapeHtml(label.toLowerCase())}">${escapeHtml(label)}<span class="arr">${arrow}</span></th>`;
  }).join('');
}

// ---- tables -----------------------------------------------------------------
function contributionsTableHtml(rows, ix) {
  if (!rows.length) return '<p class="empty">No contributions match these filters.</p>';
  const body = applySort(rows, CONTRIB_COLS, sorts.contrib, ix).map(c => {
    const contributor = contributorOf(c, ix);
    const city = c.address_id ? ix.personPlace(c.contributor_person_id || c.contributor_entity_id, c.address_id) : '';
    const recipient = recipientOf(c, ix);
    return `<tr>
      <td class="nw">${escapeHtml(dateText(c.date))}</td>
      <td>${contributor.id ? navLink(contributor.id, contributor.text) : escapeHtml(contributor.text)}${city ? `<span class="muted-sub">${escapeHtml(city)}</span>` : ''}</td>
      <td>${escapeHtml(c.occupation_as_reported)}</td>
      <td>${escapeHtml(c.employer_as_reported)}</td>
      <td class="nw">${escapeHtml(money(c.amount))}</td>
      <td class="nw">${escapeHtml(kindText(c.kind))}</td>
      <td>${recipient.id ? navLink(recipient.id, recipient.text) : escapeHtml(recipient.text)}</td>
      <td>${escapeHtml(c.report_label)}</td>
      <td>${srcLink(ix, c.source_id)}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr>${headHtml('contrib', CONTRIB_COLS, sorts.contrib)}</tr></thead><tbody>${body}</tbody></table>`;
}

function expendituresTableHtml(rows, ix) {
  if (!rows.length) return '<p class="empty">No expenditures match these filters.</p>';
  const body = applySort(rows, EXP_COLS, sorts.exp, ix).map(e => {
    const filer = filerOf(e, ix);
    const payee = payeeOf(e, ix);
    return `<tr>
      <td class="nw">${escapeHtml(dateText(e.date))}</td>
      <td>${filer.id ? navLink(filer.id, filer.text) : escapeHtml(filer.text)}</td>
      <td>${payee.id ? navLink(payee.id, payee.text) : escapeHtml(payee.text)}</td>
      <td>${escapeHtml(e.purpose)}</td>
      <td class="nw">${escapeHtml(money(e.amount))}</td>
      <td>${escapeHtml(e.report_label)}</td>
      <td>${srcLink(ix, e.source_id)}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr>${headHtml('exp', EXP_COLS, sorts.exp)}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- totals strip ------------------------------------------------------------------
const tile = (value, label) => `<div class="tile"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
const donorKey = c => c.contributor_person_id || c.contributor_entity_id || String(c.name_as_reported || '').trim().toLowerCase();

// Village tiles as numbers: raised is monetary money only (no in-kind, no
// loans); donors and the largest gift leave out candidate loans too.
export function villageTotals(rows) {
  let raised = 0, inKind = 0, loans = 0, largest = 0;
  const donors = new Set();
  for (const c of rows) {
    const a = Number(c.amount) || 0;
    if (c.kind === 'loan') { loans += a; continue; }
    if (c.kind === 'in_kind') inKind += a; else raised += a;
    donors.add(donorKey(c));
    largest = Math.max(largest, a);
  }
  return {
    raised: r2(raised), inKind: r2(inKind), loans: r2(loans),
    donors: donors.size, campaigns: new Set(rows.map(c => c.recipient_id)).size, largest,
  };
}

function totalsHtml(contribRows, expRows) {
  if (view === 'village') {
    const t = villageTotals(contribRows);
    return `<div class="tiles-row six">
      ${tile(money(t.raised), 'Raised')}${tile(money(t.inKind), 'In-kind')}${tile(money(t.loans), 'Candidate loans')}
      ${tile(t.donors, 'Donors')}${tile(t.campaigns, 'Campaigns')}${tile(money(t.largest), 'Largest gift')}
    </div>`;
  }
  if (view === 'own') {
    const given = contribRows.reduce((s, c) => s + Number(c.amount || 0), 0);
    const recipients = new Set(contribRows.map(c => c.recipient_id));
    const givers = new Set(contribRows.map(c => c.contributor_person_id));
    const largest = contribRows.reduce((m, c) => Math.max(m, Number(c.amount || 0)), 0);
    return `<div class="tiles-row">
      ${tile(money(given), 'Given')}${tile(recipients.size, 'Recipients')}
      ${tile(givers.size, 'Givers')}${tile(money(largest), 'Largest gift')}
    </div>`;
  }
  const raised = contribRows.reduce((s, c) => s + Number(c.amount || 0), 0);
  const spent = expRows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const contributors = new Set(contribRows.map(c => c.contributor_person_id || c.contributor_entity_id || c.name_as_reported));
  const largest = contribRows.reduce((m, c) => Math.max(m, Number(c.amount || 0)), 0);
  return `<div class="tiles-row">
    ${tile(money(raised), 'Raised')}${tile(money(spent), 'Spent')}
    ${tile(contributors.size, 'Contributors')}${tile(money(largest), 'Largest gift')}
  </div>`;
}

// ---- recipient select options -------------------------------------------------
// Grouped by election year, newest first ("2024", "2022", "2020"), then "Committees".
function recipientOptionsHtml(rows, ix, PT) {
  const groups = new Map();
  const seen = new Set();
  for (const c of rows) {
    const id = c.recipient_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let group = 'Committees';
    let text = recipientOf(c, ix).text;
    if (c.recipient_type === 'candidacy' && ix.candidacies.has(id)) {
      group = electionYearOf(id, ix, PT) || 'Committees';
      text = `${text} · ${ix.candidacies.get(id).office}`;
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([id, text]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === 'Committees') return 1;
    if (b === 'Committees') return -1;
    return b.localeCompare(a);
  });
  return `<option value="">All recipients</option>` + order.map(g => {
    const opts = groups.get(g).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return `<optgroup label="${escapeHtml(g)}">` +
      opts.map(([id, text]) => `<option value="${escapeHtml(id)}">${escapeHtml(text)}</option>`).join('') + '</optgroup>';
  }).join('');
}

// ---- ranked list: by campaign (Village) or by giver (own giving) --------------------
function legendHtml(parts) {
  return parts.map(([color, label]) => `<span><i style="background:${escapeHtml(color)}"></i>${escapeHtml(label)}</span>`).join('');
}

function stackHtml(parts, max) {
  return parts.filter(([, v]) => v > 0).map(([color, v]) =>
    `<span style="width:${((v / max) * 100).toFixed(2)}%;background:${escapeHtml(color)}"></span>`).join('');
}

const gifts = n => `${n} gift${n === 1 ? '' : 's'}`;

function byCampaignHtml(rows, ix, PT) {
  const t = tokens();
  const electionById = new Map((PT.tables.elections || []).map(e => [e.election_id, e]));
  const list = campaignTotals(rows, ix.candidacies, electionById);
  if (!list.length) return '<p class="empty">No campaign contributions for these filters.</p>';
  const max = list.reduce((m, g) => Math.max(m, g.monetary + g.inKind + g.loans), 0) || 1;
  let lastGroup = null;
  return list.map(g => {
    const group = electionYearOf(g.id, ix, PT) || 'Committees';
    const head = group !== lastGroup ? `<div class="rk-year">${escapeHtml(group)}</div>` : '';
    lastGroup = group;
    const { name, rest } = campaignLabel(g.id, ix, PT);
    const label = rest ? `${name} · ${rest}` : name;
    const on = filters.recipient === g.id;
    const tip = `${label}: ${money(g.monetary)} contributions, ${money(g.inKind)} in-kind, ${money(g.loans)} candidate loans`;
    return head + `<button type="button" class="rk-row${on ? ' on' : ''}" data-rank-recipient="${escapeHtml(g.id)}" title="${escapeHtml(tip)}" aria-pressed="${on}">
      <span class="rk-label">${escapeHtml(name)}${rest ? ` <em>· ${escapeHtml(rest)}</em>` : ''}</span>
      <span class="rk-bar-wrap">${stackHtml([[t.teal, g.monetary], [t.violet, g.inKind], [t.amber, g.loans]], max)}</span>
      <span class="rk-amt">${escapeHtml(money(r2(g.monetary + g.inKind + g.loans)))}</span>
      <span class="rk-n">${escapeHtml(gifts(g.count))}</span>
    </button>`;
  }).join('');
}

function byGiverHtml(rows, ix) {
  const t = tokens();
  const list = giverTotals(rows);
  if (!list.length) return '<p class="empty">No giving for these filters.</p>';
  const max = list.reduce((m, g) => Math.max(m, g.federal + g.countyState), 0) || 1;
  return list.map(g => {
    const name = ix.labelOf(g.id);
    const on = filters.contributor.trim().toLowerCase() === String(name).toLowerCase();
    const tip = `${name}: ${money(g.federal)} federal, ${money(g.countyState)} county / state`;
    return `<button type="button" class="rk-row${on ? ' on' : ''}" data-rank-contributor="${escapeHtml(name)}" title="${escapeHtml(tip)}" aria-pressed="${on}">
      <span class="rk-label">${escapeHtml(name)}</span>
      <span class="rk-bar-wrap">${stackHtml([[t.blue, g.federal], [t.teal, g.countyState]], max)}</span>
      <span class="rk-amt">${escapeHtml(money(r2(g.federal + g.countyState)))}</span>
      <span class="rk-n">${escapeHtml(gifts(g.count))}</span>
    </button>`;
  }).join('');
}

// ---- aggregates over the filtered rows -------------------------------------------
// The same keys the pipeline's derived aggregates use (employer, falling back to
// occupation; the YYYY-MM of the date), computed here over whatever the filters
// left so the charts and the tables always describe the same rows.
export function byEmployer(rows) {
  const out = {};
  for (const c of rows) {
    const k = c.employer_as_reported || c.occupation_as_reported || '';
    out[k] = (out[k] || 0) + (Number(c.amount) || 0);
  }
  return out;
}

// Months grouped by year, both newest first: [{ year, total, count, months: [[ym, total]] }].
export function monthGroups(rows) {
  const months = new Map();
  for (const c of rows) {
    const ym = String(c.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    months.set(ym, (months.get(ym) || 0) + (Number(c.amount) || 0));
  }
  const years = new Map();
  for (const [ym, v] of months) {
    const y = ym.slice(0, 4);
    if (!years.has(y)) years.set(y, { year: y, total: 0, count: 0, months: [] });
    const g = years.get(y);
    g.total += v; g.count++; g.months.push([ym, v]);
  }
  const out = [...years.values()].sort((a, b) => b.year.localeCompare(a.year));
  for (const g of out) g.months.sort((a, b) => b[0].localeCompare(a[0]));
  return out;
}

// ---- treemap ------------------------------------------------------------------
function drawTreemap(el, rows) {
  // The treemap is the only part of this tab that needs d3. Without this gate a CDN miss threw
  // out of render() and took the by-month bars - plain HTML - down with it.
  if (typeof d3 === 'undefined' || typeof d3.treemap !== 'function') {
    el.innerHTML = '<p class="empty">The chart library did not load.</p>';
    return;
  }
  const entries = Object.entries(byEmployer(rows))
    .map(([k, v]) => ({ name: k || 'not reported', value: Number(v) || 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
  el.classList.remove('tm-wrap');
  if (!entries.length) { el.innerHTML = '<p class="empty">No employer data for these filters.</p>'; return; }

  const width = Math.max(el.clientWidth || el.parentElement.clientWidth || 600, 200);
  const height = 280;
  const root = d3.hierarchy({ children: entries }).sum(d => d.value).sort((a, b) => b.value - a.value);
  d3.treemap().size([width, height]).paddingInner(2).round(true)(root);

  const t = tokens();
  const n = entries.length;
  const colorAt = i => n <= 1 ? t.teal : d3.interpolateRgb(t.teal, t.blue)(i / (n - 1));

  el.innerHTML = '';
  el.classList.add('tm-wrap');
  // root.leaves() preserves the descending-value order set by the hierarchy
  // sort above (which matches `entries`), so the leaf's own index is its rank.
  root.leaves().forEach((leaf, i) => {
    const w = leaf.x1 - leaf.x0, h = leaf.y1 - leaf.y0;
    const div = document.createElement('div');
    div.className = 'tm-tile';
    div.style.left = leaf.x0 + 'px';
    div.style.top = leaf.y0 + 'px';
    div.style.width = w + 'px';
    div.style.height = h + 'px';
    div.style.background = colorAt(i);
    div.title = `${leaf.data.name} — ${money(leaf.data.value)}`;
    if (w >= 70) {
      div.innerHTML = `<div class="tm-label">${escapeHtml(leaf.data.name)}</div><div class="tm-amt">${escapeHtml(money(leaf.data.value))}</div>`;
    }
    el.appendChild(div);
  });
}

// ---- by-month, grouped by year ---------------------------------------------------
function barHtml(label, value, max, extra = '') {
  const pct = Math.max(2, Math.round((value / max) * 100));
  return `<span class="mb-label">${escapeHtml(label)}</span>${extra}
    <div class="mb-bar-wrap"><div class="mb-bar" style="width:${pct}%"></div></div>
    <span class="mb-amt">${escapeHtml(money(value))}</span>`;
}

function monthsHtml(rows) {
  const groups = monthGroups(rows);
  if (!groups.length) return '<p class="empty">No monthly data for these filters.</p>';
  // Year bars and month bars have their own scales: a year's total would
  // otherwise flatten every month bar to a sliver.
  const yearMax = groups.reduce((m, g) => Math.max(m, g.total), 0) || 1;
  const monthMax = groups.reduce((m, g) => Math.max(m, ...g.months.map(x => x[1])), 0) || 1;
  const newest = Number(groups[0].year);
  const tools = groups.length > 2
    ? `<div class="mb-tools"><button type="button" class="chip" data-years="open">Expand all</button>` +
      `<button type="button" class="chip" data-years="close">Collapse all</button></div>`
    : '';
  return tools + groups.map(g => {
    const open = yearOpen.has(g.year) ? yearOpen.get(g.year) : Number(g.year) >= newest - 1;
    const months = g.months.map(([ym, v]) =>
      `<div class="mb-row">${barHtml(dateText(ym), v, monthMax, '<span class="mb-n"></span>')}</div>`).join('');
    const n = `<span class="mb-n">${g.count} mo</span>`;
    return `<details class="mb-year" data-year="${escapeHtml(g.year)}"${open ? ' open' : ''}>
      <summary class="mb-row"><span class="mb-caret">▶</span>${barHtml(g.year, g.total, yearMax, n)}</summary>
      <div class="mb-months">${months}</div>
    </details>`;
  }).join('');
}

// ---- main render ----------------------------------------------------------------
export default {
  id: 'money',
  label: 'Money',
  render(container, ctx) {
    ensureStyle();
    readViewFromUrl();
    const { ix, PT } = ctx;
    const allContributions = PT.tables.contributions || [];
    const allExpenditures = PT.tables.expenditures || [];

    // Everything lives in one wrapper created here: the shell reuses its panel
    // across renders, so a listener on the panel itself would stack up.
    container.innerHTML = `
      <div class="money-tab">
        <div class="mv-row" role="group" aria-label="Which money">
          <span class="mv-label">View</span>
          ${VIEWS.map(([id, label]) => `<button type="button" class="chip" data-view="${id}">${escapeHtml(label)}</button>`).join('')}
          <span class="mv-note" id="mv-note"></span>
        </div>
        <div class="card mf-card folded">
          <button type="button" class="mf-toggle" aria-expanded="false">
            <span>Filters <b id="mf-count"></b></span><span class="mf-caret">&#9662;</span></button>
          <div class="mf-row">
            <label>Recipient
              <select id="f-recipient"></select>
            </label>
            <label>Contributor / payee
              <input id="f-contributor" type="text" placeholder="Name">
            </label>
            <label>Employer
              <input id="f-employer" type="text" placeholder="Employer">
            </label>
            <label>From
              <input id="f-from" type="date">
            </label>
            <label>To
              <input id="f-to" type="date">
            </label>
            <button id="f-clear" class="chip" type="button">Clear filters</button>
          </div>
        </div>
        <div id="money-totals"></div>
        <div class="profile-section" id="money-rank-sec">
          <h3 id="money-rank-title"></h3>
          <div class="rk-legend" id="money-rank-legend"></div>
          <div class="rk-list" id="money-rank"></div>
        </div>
        <div class="profile-section">
          <h3>Contributions by employer</h3>
          <div id="money-treemap"></div>
        </div>
        <div class="profile-section">
          <h3>Contributions by month</h3>
          <div id="money-months"></div>
        </div>
        <div class="profile-section">
          <h3>Contributions (<span id="contrib-count"></span>)</h3>
          <div id="money-contrib"></div>
        </div>
        <div class="profile-section" id="money-exp-sec">
          <h3>Expenditures (<span id="exp-count"></span>)</h3>
          <div id="money-exp"></div>
        </div>
      </div>
    `;
    const root = container.querySelector('.money-tab');
    const $ = sel => root.querySelector(sel);

    const recipientSel = $('#f-recipient');
    const contributorInput = $('#f-contributor');
    const employerInput = $('#f-employer');
    const fromInput = $('#f-from');
    const toInput = $('#f-to');
    const clearBtn = $('#f-clear');
    contributorInput.value = filters.contributor;
    employerInput.value = filters.employer;
    fromInput.value = filters.dateFrom;
    toInput.value = filters.dateTo;

    const noteEl = $('#mv-note');
    const totalsEl = $('#money-totals');
    const rankSec = $('#money-rank-sec');
    const rankTitle = $('#money-rank-title');
    const rankLegend = $('#money-rank-legend');
    const rankEl = $('#money-rank');
    const treemapEl = $('#money-treemap');
    const monthsEl = $('#money-months');
    const contribEl = $('#money-contrib');
    const expSec = $('#money-exp-sec');
    const expEl = $('#money-exp');
    const contribCount = $('#contrib-count');
    const expCount = $('#exp-count');

    let baseContribs = [];
    let baseExps = [];
    let contribRows = [];
    let expRows = [];

    function drawTables() {
      contribEl.innerHTML = contributionsTableHtml(contribRows, ix);
      expEl.innerHTML = expendituresTableHtml(expRows, ix);
      wireNav(contribEl, ctx);
      wireNav(expEl, ctx);
    }

    // The view decides the rows everything else starts from, the recipients the
    // select offers, and which ranked list (if any) sits above the charts.
    function applyView() {
      baseContribs = viewContributions(allContributions, ix);
      baseExps = viewExpenditures(allExpenditures, ix);
      root.querySelectorAll('[data-view]').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      noteEl.textContent = VIEW_NOTES[view];
      recipientSel.innerHTML = recipientOptionsHtml(baseContribs, ix, PT);
      if (filters.recipient && !baseContribs.some(c => c.recipient_id === filters.recipient)) filters.recipient = '';
      recipientSel.value = filters.recipient;
      const t = tokens();
      rankSec.hidden = view === 'all';
      if (view === 'village') {
        rankTitle.textContent = 'By campaign';
        rankLegend.innerHTML = legendHtml([[t.teal, 'Contributions'], [t.violet, 'In-kind'], [t.amber, 'Candidate loans']]) +
          '<span>Click a campaign to filter to it.</span>';
      } else if (view === 'own') {
        rankTitle.textContent = 'By giver';
        rankLegend.innerHTML = legendHtml([[t.blue, 'Federal (FEC)'], [t.teal, 'County / state']]) +
          '<span>Click a giver to filter to them.</span>';
      }
      expSec.hidden = view === 'own';
      refresh();
    }

    function refresh() {
      const active = [filters.recipient, filters.contributor, filters.employer, filters.dateFrom, filters.dateTo]
        .filter(Boolean).length;
      $('#mf-count').textContent = active ? String(active) : '';
      contribRows = filterContributions(baseContribs, ix);
      expRows = filterExpenditures(baseExps, ix);
      totalsEl.innerHTML = totalsHtml(contribRows, expRows);
      // The ranked list ignores its own filter (recipient for campaigns, the
      // name for givers) so the other rows stay in reach to switch to.
      if (view === 'village') {
        const saved = filters.recipient;
        filters.recipient = '';
        const rows = filterContributions(baseContribs, ix);
        filters.recipient = saved;
        rankEl.innerHTML = byCampaignHtml(rows, ix, PT);
      } else if (view === 'own') {
        const saved = filters.contributor;
        filters.contributor = '';
        const rows = filterContributions(baseContribs, ix);
        filters.contributor = saved;
        rankEl.innerHTML = byGiverHtml(rows, ix);
      } else {
        rankEl.innerHTML = '';
      }
      contribCount.textContent = contribRows.length;
      expCount.textContent = expRows.length;
      drawTreemap(treemapEl, contribRows);
      monthsEl.innerHTML = monthsHtml(contribRows);
      drawTables();
    }

    // A header click re-sorts only its own table; the filters, the charts and
    // the other table stay as they are.
    root.addEventListener('click', ev => {
      const th = ev.target.closest('th[data-sort]');
      if (th) {
        const [table, key] = th.dataset.sort.split(':');
        sorts[table] = nextSort(sorts[table], key);
        drawTables();
        return;
      }
      const chip = ev.target.closest('[data-view]');
      if (chip) {
        if (chip.dataset.view !== view) { view = chip.dataset.view; applyView(); }
        return;
      }
      const camp = ev.target.closest('[data-rank-recipient]');
      if (camp) {
        const id = camp.dataset.rankRecipient;
        filters.recipient = filters.recipient === id ? '' : id;
        recipientSel.value = filters.recipient;
        refresh();
        return;
      }
      const giver = ev.target.closest('[data-rank-contributor]');
      if (giver) {
        const name = giver.dataset.rankContributor;
        filters.contributor = filters.contributor.trim().toLowerCase() === name.toLowerCase() ? '' : name;
        contributorInput.value = filters.contributor;
        refresh();
        return;
      }
      const all = ev.target.closest('[data-years]');
      if (all) {
        const open = all.dataset.years === 'open';
        monthsEl.querySelectorAll('details.mb-year').forEach(d => {
          d.open = open;
          yearOpen.set(d.dataset.year, open);
        });
      }
    });
    // Remember a year the reader opened or closed, so a filter change that
    // redraws the list keeps it the way they left it.
    monthsEl.addEventListener('toggle', ev => {
      const d = ev.target;
      if (d.matches && d.matches('details.mb-year')) yearOpen.set(d.dataset.year, d.open);
    }, true);

    recipientSel.addEventListener('change', () => { filters.recipient = recipientSel.value; refresh(); });
    contributorInput.addEventListener('input', () => { filters.contributor = contributorInput.value; refresh(); });
    employerInput.addEventListener('input', () => { filters.employer = employerInput.value; refresh(); });
    fromInput.addEventListener('change', () => { filters.dateFrom = fromInput.value; refresh(); });
    toInput.addEventListener('change', () => { filters.dateTo = toInput.value; refresh(); });
    $('.mf-toggle').addEventListener('click', ev => {
      const folded = $('.mf-card').classList.toggle('folded');
      ev.currentTarget.setAttribute('aria-expanded', String(!folded));
    });
    clearBtn.addEventListener('click', () => {
      filters.recipient = ''; filters.contributor = ''; filters.employer = ''; filters.dateFrom = ''; filters.dateTo = '';
      recipientSel.value = ''; contributorInput.value = ''; employerInput.value = ''; fromInput.value = ''; toInput.value = '';
      refresh();
    });

    applyView();
  },
};
