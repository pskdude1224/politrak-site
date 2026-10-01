// Pure formatting helpers shared by the dashboard pages. No imports, no DOM.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const money = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-US');

// '2026-10-13' -> 'Oct 13, 2026'; '2026-11' -> 'Nov 2026'; '' -> ''
// Parsed from the string's own parts so no timezone shifts the day.
export const dateText = iso => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || '');
  if (!m) return '';
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return '';
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
};

const toUTCDays = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
};

export const daysUntil = (iso, today) => {
  const a = toUTCDays(iso);
  const b = toUTCDays(today);
  if (a == null || b == null) return null;
  return Math.round(a - b);
};

const REL_LABELS = {
  income_from: 'income from', owns_property: 'owns', owner_of: 'owner of', manager_of: 'manager of',
  officer_of: 'officer of', treasurer_for: 'treasurer for', registered_agent_of: 'registered agent of',
  lobbyist_for: 'lobbyist for', relative_of: 'relative of', employed_by: 'employed by',
  contributed: 'contributed to', named_on: 'named on', voted: 'voted',
  vendor_of: 'vendor of', member_of: 'member of',
};

export const relLabel = rel_type => REL_LABELS[rel_type] || String(rel_type || '').replace(/_/g, ' ');

// Up to two letters: first letter of the first token, then first letter of the
// token that starts the surname group (nicknames/parentheticals stripped,
// single-letter middle initials like "F." dropped).
export const initials = name => {
  const stripped = String(name || '').replace(/"[^"]*"/g, ' ').replace(/\([^)]*\)/g, ' ');
  const tokens = stripped.split(/\s+/).filter(Boolean).filter(t => !/^[A-Za-z]\.$/.test(t));
  if (tokens.length === 0) return '';
  const first = tokens[0][0].toUpperCase();
  const second = tokens.length > 1 ? tokens[1][0].toUpperCase() : '';
  return first + second;
};

const LINK_KINDS = {
  contributed: 'money', income_from: 'money',
  owner_of: 'business', manager_of: 'business', officer_of: 'business',
  registered_agent_of: 'business', treasurer_for: 'business',
  owns_property: 'property',
  lobbyist_for: 'lobbying',
  employed_by: 'staff',
  voted: 'vote',
  named_on: 'issue',
  relative_of: 'family',
  vendor_of: 'vendor',
  member_of: 'board',
};

// `targetType` is the entity type at the far end of the edge, when the caller knows it. A seat
// on a nonprofit's board arrives from Sunbiz as officer_of/manager_of/owner_of/
// registered_agent_of - the same rel_types a stake in a company uses - so the rel_type alone
// cannot tell the two apart, and without the entity type the Board chip filtered nothing at all
// (member_of, its only other source, appears nowhere in the corpus).
const BOARD_RELS = new Set(['officer_of', 'manager_of', 'owner_of', 'registered_agent_of']);
export const linkKind = (rel_type, targetType) =>
  (targetType === 'nonprofit' && BOARD_RELS.has(rel_type)) ? 'board' : (LINK_KINDS[rel_type] || 'other');

export const escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
