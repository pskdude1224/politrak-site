// Network tab: a force-directed web of every subject and every tie.
//
// Two modes. Everything (route `#/web` or `#/tab/network`) lays the subjects on
// a ring with their satellites outside them and shared nodes pulled inward;
// Focus (a person/entity/issue route) pins that node at the centre. Depth,
// tie-kind filters, expansions, the labels toggle and the settled node
// positions are kept in module scope, keyed by route, so switching a filter or
// expanding a node never throws the layout away.
//
// The look is the Save Our Homes glass house style: the stage is a full-bleed
// deep-navy field with a soft centre bloom, the controls float on top of it as
// a glass toolbar, and the graph itself reads as a luminous constellation —
// glowing rings, hairline straight ties with arrowheads, a dot-grid stage.
import { buildGraph } from '../lib/graph.mjs';
import { money, relLabel, initials, escapeHtml } from '../lib/format.mjs';

// ---- constants ---------------------------------------------------------------
export const KIND_CHIPS = [
  ['money', 'Money'], ['business', 'Business'], ['property', 'Property'],
  ['lobbying', 'Lobbying'], ['staff', 'Staff'], ['vote', 'Votes'],
  ['issue', 'Issues'], ['family', 'Family'], ['vendor', 'Vendor'],
  ['board', 'Board'], ['other', 'Other'],
];
const ALL_KINDS = KIND_CHIPS.map(k => k[0]);

const LINK_DISTANCE = {
  money: 90, business: 70, property: 60, lobbying: 110,
  staff: 80, vote: 120, issue: 100, family: 50, vendor: 100, board: 80, other: 80,
};
// The point cloud wants air: the marks are small, so the rest lengths are
// stretched by half and the web reads as open space with hairlines across it
// rather than as clusters.
const DISTANCE_SCALE = 1.9;

// Hairline ties want hairline dashes: at 0.7px a '6 4' dash reads as a dotted
// line with gaps wide enough to lose the tie altogether.
const DASH = { documented: null, reported: '4 3', inferred: '1.5 3' };
const LABEL_ZOOM = 1.3;
const MAX_LABEL = 26;

const REST_LINK_OPACITY = 0.34;
const DIM_OPACITY = 0.08;
// Subjects need far more elbow room than their own 14px avatar: their names sit
// under them and two neighbours on the ring would otherwise print over.
const SUBJECT_COLLIDE = 40;
const RING_FRACTION = 0.48;
const ENTER_STAGGER = 6;
const ENTER_STAGGER_CAP = 800;
const ENTER_MS = 320;

// A tie's own colour on a near-black glass fill is what makes a ring read as
// hollow rather than as a flat chip.
const RING_FILL = 'rgba(7,11,17,.88)';

// The point `r` px short of (tx,ty) on the segment from (sx,sy): a tie stops at
// the target's rim so the arrowhead sits on the ring, not under it.
export function trimmedEnd(sx, sy, tx, ty, r) {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return { x: tx, y: ty };
  return { x: tx - (dx / len) * r, y: ty - (dy / len) * r };
}

const FALLBACK_TOKENS = {
  bg: '#070b11', line: '#283344', ink: '#eef3fa', mut: '#9fb0c3', mut2: '#6c7c90',
  blue: '#46a6ff', teal: '#2dd4bf', green: '#59d39a', red: '#ef6b6b',
  amber: '#f5b342', violet: '#8b7cff',
};

let TOKENS = null;
// Resolve the pt.css palette once: gradients and SVG presentation attributes do
// not understand `var(--x)`, so the graph needs concrete colours.
function tokens() {
  if (TOKENS) return TOKENS;
  TOKENS = Object.assign({}, FALLBACK_TOKENS);
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const name of Object.keys(FALLBACK_TOKENS)) {
      const v = cs.getPropertyValue('--' + name).trim();
      if (v) TOKENS[name] = v;
    }
  } catch { /* keep the fallbacks */ }
  return TOKENS;
}

const linkColors = t => ({
  money: t.amber, business: t.violet, property: t.green, lobbying: t.red,
  staff: '#7dd3fc', vote: '#f472b6', issue: t.red, family: '#fb923c',
  vendor: '#fbbf24', board: '#34d399', other: t.mut2,
});

const entityColors = t => ({
  llc: t.violet, corp: t.violet, other: t.violet, pac: t.amber,
  bank: t.mut2, government: t.mut2, law_firm: '#c084fc', nonprofit: '#7dd3fc',
  brokerage: '#f0abfc',
});

// Subjects carry the three "who they are" colours; everything else is typed.
const subjectColor = (kind, t) =>
  kind === 'candidate' ? t.teal : kind === 'staff' ? t.green : t.blue;

function nodeColor(d, t) {
  if (d.subject) return subjectColor(d.kind, t);
  if (d.type === 'person') return '#b9c7d8';
  if (d.type === 'property') return t.green;
  if (d.type === 'issue') return t.red;
  return entityColors(t)[d.kind] || t.violet;
}

// Satellites are sized by how many ties they carry, so the shared donors and
// the busy LLCs stand out from the one-off names without any extra chrome. A
// hub — a node the walk stops at because it carries 40+ ties — gets 2px more so
// the thing the reader has to double-click to open is the thing that looks big.
// Subjects are the one fixed size: they are the spine of the web, not a degree.
// The scale is the reference's point cloud: a person is a 3px spark, a company
// a 4-8px ring, a subject a 14px avatar.
export function radius(d) {
  if (d.subject) return 14;
  const hub = d.hub ? 2 : 0;
  if (d.type === 'issue') return 11 + hub;
  if (d.type === 'property') return 4.5 + hub;
  if (d.type === 'person') return 3 + Math.min(2.5, (d.degree || 0) * 0.4) + hub;
  return 4 + Math.min(4, (d.degree || 0) * 0.5) + hub;
}

// Hairlines: a money tie thickens with the log of the sum — a $10 gift and a
// $100,000 one should not draw the same line — and everything else stays at the
// reference's 0.7 px. The ramp is gentle enough that it keeps climbing past the
// $1,000 municipal contribution cap: at 0.5/decade every gift of a thousand
// dollars or more drew the same maximum line, which is exactly the range the
// county and state filings live in.
export function widthOf(l) {
  return l.kind === 'money'
    ? Math.min(2.4, 0.7 + 0.35 * Math.log10((l.amount || 0) + 1))
    : 0.7;
}

// ---- cluster colours and the issue lens -----------------------------------------
// One hue per subject, spread evenly round a sinebow. The formula is inlined
// rather than borrowed from d3 so node can test it; each channel is lifted 15 %
// toward white so no hue sinks into the navy stage. Ids are sorted first, so a
// subject keeps its hue whatever order the set arrives in.
export function subjectHues(ids) {
  const sorted = [...new Set(ids)].sort();
  const n = sorted.length;
  const hex = c => Math.round((c * 0.85 + 0.15) * 255).toString(16).padStart(2, '0');
  const out = new Map();
  sorted.forEach((id, i) => {
    const t = (i / n + 0.08) % 1;
    const ch = off => Math.sin(Math.PI * (t + off)) ** 2;
    out.set(id, '#' + hex(ch(0)) + hex(ch(1 / 3)) + hex(ch(2 / 3)));
  });
  return out;
}

// d3's forceLink swaps the string endpoints for node objects once it runs.
const endId = x => (x && typeof x === 'object' ? x.id : x);

function adjacency(links) {
  const adj = new Map();
  for (const l of links) {
    const a = endId(l.source), b = endId(l.target);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  return adj;
}

// Which subject's region a node belongs to: a breadth-first walk out from every
// subject at once over undirected ties. A node's owners are the subjects at its
// shortest distance — one owner puts it in that subject's colour, two or more
// make it a shared node. A subject owns only itself; a node no subject reaches
// has no owner.
export function clusterOwners(nodeIds, links, subjectIds) {
  const adj = adjacency(links);
  const dist = new Map();
  const owners = new Map();
  const queue = [];
  for (const s of subjectIds) {
    if (dist.has(s)) continue;
    dist.set(s, 0);
    owners.set(s, new Set([s]));
    queue.push(s);
  }
  // The queue is consumed in order, so every node at distance k has collected
  // all of its owners before the first node at k + 1 is expanded.
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    const du = dist.get(u);
    for (const v of adj.get(u) || []) {
      if (!dist.has(v)) {
        dist.set(v, du + 1);
        owners.set(v, new Set(owners.get(u)));
        queue.push(v);
      } else if (dist.get(v) === du + 1) {
        for (const o of owners.get(u)) owners.get(v).add(o);
      }
    }
  }
  const out = new Map();
  for (const id of nodeIds) out.set(id, owners.has(id) ? [...owners.get(id)].sort() : []);
  return out;
}

// Hops from one node over undirected ties, the start at 0, nothing past `max`.
export function hopsFrom(id, links, max) {
  const adj = adjacency(links);
  const hops = new Map([[id, 0]]);
  let frontier = [id];
  for (let h = 1; h <= max && frontier.length; h++) {
    const next = [];
    for (const u of frontier) {
      for (const v of adj.get(u) || []) {
        if (!hops.has(v)) { hops.set(v, h); next.push(v); }
      }
    }
    frontier = next;
  }
  return hops;
}

const truncate = s => {
  const str = String(s == null ? '' : s);
  return str.length > MAX_LABEL ? str.slice(0, MAX_LABEL - 1) + '…' : str;
};

// ---- injected stylesheet ------------------------------------------------------
const STYLE_ID = 'network-style';
const CSS = `
.net-wrap { position: relative; }

/* ---- the stage: a deep-navy field with a centre bloom and a vignette ---- */
.net-stage { position: relative; container-type: inline-size;
  height: max(640px, calc(100vh - 210px));
  border: 1px solid rgba(255,255,255,.08); border-radius: 18px; overflow: hidden;
  background:
    radial-gradient(60% 55% at 50% 48%, rgba(70,166,255,.10), transparent 70%),
    radial-gradient(46% 42% at 78% 16%, rgba(45,212,191,.07), transparent 72%),
    linear-gradient(180deg, #080d15, #05080d);
  box-shadow: inset 0 0 120px rgba(0,0,0,.55); }
/* The dot grid rides its own layer so it can be masked away at the edges: a grid
   that runs right into the vignette reads as a screen door, one that fades out
   reads as depth. */
.net-stage::before { content: ''; position: absolute; inset: 0; z-index: 0;
  pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,.075) 1px, transparent 1.4px) 0 0 / 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse 85% 80% at 50% 50%, #000 55%, transparent 100%);
  mask-image: radial-gradient(ellipse 85% 80% at 50% 50%, #000 55%, transparent 100%); }
.net-stage > svg { position: absolute; inset: 0; z-index: 1; display: block;
  width: 100%; height: 100%; background: transparent; cursor: grab; touch-action: none; }
.net-stage > svg:active { cursor: grabbing; }

/* ---- floating glass toolbar ---- */
.net-head { position: absolute; z-index: 20; top: 14px; left: 14px; right: 14px;
  display: flex; flex-direction: column; gap: 5px;
  padding: 8px 11px;
  background: linear-gradient(180deg, rgba(28,38,54,.72), rgba(16,22,32,.72));
  border: 1px solid rgba(255,255,255,.09); border-radius: 14px;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 14px 38px rgba(0,0,0,.42); }
.net-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; }
.net-grp { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.net-grp .lbl { font-size: 10px; color: var(--mut2); text-transform: uppercase;
  letter-spacing: .9px; font-weight: 700; }
.net-sep { width: 1px; height: 14px; background: rgba(255,255,255,.1); }
.net-head .chip { font-family: inherit; line-height: 1.45; border-radius: 999px;
  padding: 2px 9px; font-size: 11.5px; gap: 5px; }
.net-head .chip[disabled] { opacity: .35; cursor: not-allowed; }
.net-head .chip[disabled]:hover { border-color: var(--line); color: var(--mut); }
.net-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: none; }

/* ---- counts as stat pills ---- */
.net-counts { margin-left: auto; display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; justify-content: flex-end; }
.net-counts .net-stat { display: inline-flex; align-items: center; gap: 4px; flex: none;
  padding: 1px 8px; border-radius: 999px; font-size: 10.5px; color: var(--mut);
  background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07);
  white-space: nowrap; }
.net-counts .net-stat b { color: var(--ink); font-weight: 700; font-size: 11.5px; }

/* In the app's narrow middle column nine tie chips wrap to three lines and the
   toolbar eats a fifth of the stage. Below ~780px the tie chips and the stat
   pills each become a single line that scrolls sideways instead. */
@container (max-width: 780px) {
  /* A sideways scroll cost the last chips outright: in the three-column layout at 1400px the
     Board chip read "Bo…" against the toolbar's right edge with no way to reach the rest. A
     second line of toolbar is cheaper than an unreachable filter, so the tie chips wrap. */
  .net-grp.ties { flex: 1 1 100%; flex-wrap: wrap; padding-bottom: 1px; }
  /* With the Colour and Issue lens groups the second row has no room left for
     the stat pills, which were pushed clean off its end; they take a line of
     their own and scroll sideways inside it. */
  /* flex-end would push the overflow off the start edge, where a scroll
     container cannot reach it. */
  .net-counts { flex: 1 1 100%; margin-left: 0; flex-wrap: nowrap; overflow-x: auto;
    scrollbar-width: none; min-width: 0; justify-content: flex-start; }
  .net-counts::-webkit-scrollbar { display: none; }
  .net-search, .net-head .net-row + .net-row .chip { flex: none; }
  .net-head .net-lens { max-width: 150px; }
}

/* ---- search ---- */
.net-search { position: relative; }
.net-search input { width: 148px; background: rgba(8,12,19,.6);
  border: 1px solid rgba(255,255,255,.12); color: var(--ink);
  padding: 3px 11px; border-radius: 999px; font-size: 11.5px; font-family: inherit; }
.net-search input::placeholder { color: var(--mut2); }
.net-search input:focus { outline: none; border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(45,212,191,.14); }
.net-drop { position: absolute; top: calc(100% + 6px); left: 0; min-width: 230px;
  background: linear-gradient(180deg, rgba(23,31,44,.97), rgba(13,18,27,.97));
  border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0,0,0,.55); backdrop-filter: blur(14px);
  max-height: 260px; overflow-y: auto; z-index: 60; }
.net-drop .net-hit { padding: 6px 11px; font-size: 12px; cursor: pointer; display: flex;
  align-items: center; justify-content: space-between; gap: 10px; }
.net-drop .net-hit:hover { background: rgba(255,255,255,.06); }
.net-drop .net-hit .t { color: var(--mut2); font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }

/* ---- zoom pill ---- */
.net-zoom { position: absolute; z-index: 20; right: 14px; bottom: 14px;
  display: flex; flex-direction: column; gap: 2px; padding: 4px;
  background: linear-gradient(180deg, rgba(28,38,54,.72), rgba(16,22,32,.72));
  border: 1px solid rgba(255,255,255,.09); border-radius: 999px;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px rgba(0,0,0,.45); }
.net-zoom button { width: 24px; height: 24px; display: flex; align-items: center;
  justify-content: center; padding: 0; border: none; background: transparent;
  color: var(--mut); font-family: inherit; font-size: 14px; line-height: 1;
  border-radius: 50%; cursor: pointer; transition: color .12s, background .12s; }
.net-zoom button:hover { color: var(--ink); background: rgba(255,255,255,.08); }

/* ---- legend: a compact glass pill row ---- */
.net-legend { position: absolute; z-index: 20; left: 14px; bottom: 14px;
  max-width: calc(100% - 92px); display: flex; align-items: center; gap: 4px;
  padding: 5px 7px; font-size: 11px; line-height: 1.4; color: var(--mut);
  background: linear-gradient(180deg, rgba(28,38,54,.82), rgba(16,22,32,.82));
  border: 1px solid rgba(255,255,255,.09); border-radius: 16px;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px rgba(0,0,0,.45); }
.net-legend-toggle { display: inline-flex; align-items: center; flex: none;
  font-family: inherit; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08); color: var(--mut2); font-size: 10px;
  text-transform: uppercase; letter-spacing: .8px; font-weight: 700;
  padding: 3px 10px; border-radius: 999px; cursor: pointer; }
.net-legend-toggle:hover { color: var(--ink); }
/* Ten node types will not sit on one line in the app's middle column, and a
   sideways scroll clipped the last label ("Pr…"); let them wrap instead. */
.net-legend-body { display: flex; align-items: center; gap: 3px 2px; flex-wrap: wrap; }
.net-legend.collapsed { border-radius: 999px; }
.net-legend .lg-row { display: flex; align-items: center; gap: 5px; white-space: nowrap;
  padding: 3px 8px; border-radius: 999px; flex: none; }
.net-legend .lg-row:hover { background: rgba(255,255,255,.05); }
.net-legend svg { display: block; flex: none; }
.net-legend.collapsed .net-legend-body { display: none; }
.net-ties { position: relative; flex: none; }
.net-ties-btn { font-family: inherit; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08); color: var(--mut); font-size: 11px;
  padding: 3px 10px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.net-ties-btn:hover, .net-ties-btn.on { color: var(--ink); border-color: rgba(45,212,191,.5); }
.net-ties-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30;
  display: flex; gap: 18px; padding: 11px 14px; white-space: nowrap;
  background: linear-gradient(180deg, rgba(23,31,44,.96), rgba(13,18,27,.96));
  border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0,0,0,.55);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.net-ties-pop h5 { margin: 0 0 5px; font-size: 10px; text-transform: uppercase;
  letter-spacing: .7px; color: var(--mut2); font-weight: 700; }

/* ---- graph marks ---- */
.net-node { cursor: pointer; transition: opacity .16s ease; }
/* SVG defaults transform-box to view-box, which would resolve the origin
   against the whole viewport; pin it to the mark's own local origin. */
.net-node .net-scale { transform-origin: 0 0; transition: transform .16s ease; }
.net-node.hovered .net-scale { transform: scale(1.15); transition: transform .12s ease; }
.net-link { transition: opacity .16s ease; }
/* While the entrance wave is running the values are driven by d3, so the CSS
   transitions have to stand down or the two interpolate against each other. */
.net-node.net-in, .net-node.net-in .net-scale, .net-node.net-in .net-label,
.net-link.net-in { transition: none; }
.net-halo, .net-glow-line { pointer-events: none; }
/* Dots running along the hot ties: which way a gift or a contract actually
   flows is the one thing an arrowhead alone says quietly. */
@keyframes net-flow { to { stroke-dashoffset: -20; } }
.net-flow { pointer-events: none; animation: net-flow 1.1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .net-flow { animation: none; } }
.net-label { pointer-events: none; paint-order: stroke; stroke: #070b11;
  stroke-linejoin: round; transition: opacity .16s ease; }
.net-initials { pointer-events: none; user-select: none; }
@keyframes net-breathe {
  0%   { transform: scale(1);    opacity: .5; }
  100% { transform: scale(1.35); opacity: 0; }
}
.net-breathe { pointer-events: none; transform-origin: 0 0;
  animation: net-breathe 3.2s ease-out infinite; }
.net-node.hovered .net-breathe { display: none; }
@media (prefers-reduced-motion: reduce) { .net-breathe { animation: none; opacity: .18; } }
/* The issue under the lens sends a slow red ring out of itself. */
@keyframes net-lens-pulse {
  0%   { transform: scale(1);   opacity: .85; }
  100% { transform: scale(2.2); opacity: 0; }
}
.net-lens-pulse { pointer-events: none; transform-origin: 0 0;
  animation: net-lens-pulse 2.6s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .net-lens-pulse { animation: none; opacity: .4; } }
.net-hulls, .net-owners { pointer-events: none; }

/* ---- issue lens picker ---- */
.net-lens { font-family: inherit; font-size: 11.5px; color: var(--ink); color-scheme: dark;
  background: rgba(8,12,19,.6); border: 1px solid rgba(255,255,255,.12);
  border-radius: 999px; padding: 2px 8px; max-width: 200px; flex: none; cursor: pointer; }
.net-lens:focus { outline: none; border-color: var(--red);
  box-shadow: 0 0 0 3px rgba(239,107,107,.16); }
.net-lens.on { border-color: rgba(239,107,107,.6); }
.net-counts .net-stat.lens { border-color: rgba(239,107,107,.45); background: rgba(239,107,107,.1); }
.net-legend-nodes { display: contents; }
/* The two view groups keep their label on the same line as their controls. */
.net-grp.net-colour, .net-grp.net-lens-grp { flex-wrap: nowrap; flex: none; }

.net-empty { position: absolute; inset: 0; z-index: 15; display: flex;
  align-items: center; justify-content: center; }
.net-empty[hidden], .net-legend[hidden], .net-drop[hidden], .net-ties-pop[hidden] { display: none; }

/* ---- tooltip ---- */
.tooltip.net-tip { position: absolute; z-index: 45; border-left-width: 3px;
  padding: 9px 13px 9px 12px; }
.tooltip.net-tip.interactive { pointer-events: auto; }
.net-tip .tt-title { font-weight: 700; font-size: 13px; color: var(--ink); margin-bottom: 5px; }
.net-tip .tt-row { color: var(--mut); font-size: 11px; margin-top: 2px; }
.net-tip .tt-row b { color: var(--ink); font-weight: 600; }
.net-tip .src { display: block; margin-top: 3px; }
.net-badge-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--red); box-shadow: 0 0 6px rgba(239,107,107,.8); vertical-align: middle; margin-right: 3px; }

/* ---- expand pill ---- */
.net-expand { position: absolute; z-index: 20; left: 50%; bottom: 14px; transform: translateX(-50%);
  font-family: inherit; font-size: 11.5px; font-weight: 700; letter-spacing: .3px; color: var(--ink);
  padding: 6px 14px; border-radius: 999px; cursor: pointer;
  background: linear-gradient(180deg, rgba(28,38,54,.82), rgba(16,22,32,.82));
  border: 1px solid rgba(45,212,191,.35);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px rgba(0,0,0,.45), 0 0 0 0 rgba(45,212,191,0); transition: box-shadow .15s, border-color .15s; }
.net-expand:hover { border-color: rgba(45,212,191,.7); box-shadow: 0 12px 30px rgba(0,0,0,.45), 0 0 18px rgba(45,212,191,.25); }
/* Where the stage is wide the centre of the bottom edge belongs to the pill, so
   the legend stops half the stage less the pill's own half-width and a gap: an
   expanded legend used to run straight over the pill and swallow its clicks.
   Both of these have to sit after the .net-legend and .net-expand rules
   themselves — a container query carries no extra specificity, so an earlier
   block would simply lose to the base rules. */
@container (min-width: 780px) {
  /* 96px = half the wider "Exit full screen" label, the legend's own 14px
     offset from the left edge, and a gap wide enough to read as one. */
  .net-legend { max-width: calc(50% - 96px); }
}
/* Narrow, that reserve would squeeze the ten legend rows into a column eleven
   deep. Below 780px the legend keeps the full width instead and the pill gets
   out of its way, stacking above the zoom pill on the right edge. 779.98px, not
   780px: a min-width:780px block and a max-width:780px one both match at 780,
   which moved the pill to the right edge while the legend was still reserving
   the centre for it. */
@container (max-width: 779.98px) {
  .net-expand { left: auto; right: 14px; bottom: 108px; transform: none; }
}
/* Fallback overlay when the Fullscreen API is unavailable. */
.net-stage.net-full { position: fixed !important; inset: 0 !important; z-index: 1000 !important;
  width: auto !important; height: auto !important; border-radius: 0 !important; }
.net-stage:fullscreen { border-radius: 0; }
body.net-full-body { overflow: hidden; }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- per-route state ----------------------------------------------------------
let stateKey = null;
let st = null;
let lastFocusId = '';
// Collapsed/expanded choice for the bottom-left legend, remembered across
// renders and route changes for the life of the page. `null` means "not
// decided yet" — the first render picks a default from the stage width.
let legendCollapsed = null;
// Type or Cluster colouring: a view preference, so it is kept across routes
// and Reset leaves it alone.
let colourMode = 'type';
// `?colour=cluster&lens=I03` is a deep link read once per page load: Reset
// re-renders, and it must not bring the query back.
let deepLinkRead = false;

function routeKey(route) {
  const focused = route.id && ['person', 'entity', 'issue'].includes(route.view);
  return focused ? route.view + ':' + route.id : 'web';
}

// The Reset chip: everything a reader can change about a web goes back to
// what a first visit draws, including the settled positions, so the next build
// lays the web out afresh instead of nudging the old one.
function resetState(state) {
  state.depth = 1;
  state.kinds = new Set(ALL_KINDS);
  state.expanded = new Set();
  state.labelsAll = false;
  state.positions = new Map();
  state.lens = '';
}

function stateFor(route) {
  const key = routeKey(route);
  if (key !== stateKey) {
    stateKey = key;
    st = {
      depth: 1, kinds: new Set(ALL_KINDS), expanded: new Set(),
      labelsAll: false, positions: new Map(), lens: '',
    };
  }
  return st;
}

// ---- live render teardown -----------------------------------------------------
// `render` is called again with a fresh container on every route change, so the
// previous simulation, timers and window listeners have to be let go first. The
// app shell has no unmount hook — it just empties `#panel` — so the tooltip
// lives inside the container (it goes with the panel) and the window listeners
// hang off an AbortController that is fired here, and defensively by the
// listeners themselves once the stage is off the document.
let live = null;

// A route change while the web is full screen must not leave the page locked:
// drop the body scroll lock, the fallback overlay class, and the real fullscreen
// session if the stage still owns it. Both ways out of the tab need it:
// `teardown()`, which the shell now calls before it empties the panel, and
// `orphaned()`, for the case where the stage simply stops being on the document.
function releaseFullScreen(stage) {
  document.body.classList.remove('net-full-body');
  if (!stage) return;
  stage.classList.remove('net-full');
  if (document.fullscreenElement === stage && document.exitFullscreen) {
    try { Promise.resolve(document.exitFullscreen()).catch(() => {}); } catch { /* ignore */ }
  }
}

function teardown() {
  if (!live) return;
  if (live.savePositions) live.savePositions();
  if (live.sim) live.sim.stop();
  for (const t of live.timers) clearTimeout(t);
  if (live.abort) live.abort.abort();
  if (live.tip && live.tip.parentNode) live.tip.parentNode.removeChild(live.tip);
  releaseFullScreen(live.stage);
  live = null;
}

// ---- legend -------------------------------------------------------------------
// The rows the legend prints, in reading order. The middle column is either a
// token name (resolved through `tokens()` at render time) or a literal colour
// the palette has no token for.
export const NODE_LEGEND = [
  ['disc', 'blue', 'Subject'],
  ['dot', '#b9c7d8', 'Person'],
  ['ring', 'violet', 'Company'],
  ['ring', 'amber', 'PAC'],
  ['ring', 'mut2', 'Bank / gov'],
  ['ring', '#c084fc', 'Law firm'],
  ['ring', '#7dd3fc', 'Nonprofit'],
  ['ring', '#f0abfc', 'Brokerage'],
  ['bullseye', 'green', 'Property'],
  ['double', 'red', 'Issue'],
];

// The same four circle variants the stage draws, at 14×14.
function swatch(glyph, color) {
  const inner = glyph === 'disc' ? `<circle cx="7" cy="7" r="5" fill="${color}"/>`
    : glyph === 'dot' ? `<circle cx="7" cy="7" r="4" fill="${color}"/>`
      : glyph === 'bullseye'
        ? `<circle cx="7" cy="7" r="5" fill="${RING_FILL}" stroke="${color}" stroke-width="1.5"/>` +
          `<circle cx="7" cy="7" r="2.2" fill="${color}"/>`
        : glyph === 'double'
          ? `<circle cx="7" cy="7" r="5" fill="${RING_FILL}" stroke="${color}" stroke-width="1.5"/>` +
            `<circle cx="7" cy="7" r="3" fill="none" stroke="${color}" stroke-width="1"/>`
          : `<circle cx="7" cy="7" r="5" fill="${RING_FILL}" stroke="${color}" stroke-width="1.5"/>`;
  return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${inner}</svg>`;
}

function lineSwatch(color, dash) {
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return '<svg width="20" height="8" viewBox="0 0 20 8" aria-hidden="true">' +
    `<line x1="1" y1="4" x2="19" y2="4" stroke="${color}" stroke-width="2"${d}/></svg>`;
}

// Node types inline; edge colours and confidence dashes tucked into a popover so
// the row stays a single compact pill that never crowds the web.
function typeLegendRows(t) {
  return NODE_LEGEND
    .map(([g, key, label]) => `<div class="lg-row">${swatch(g, t[key] || key)}${label}</div>`).join('');
}

// Cluster mode: one row per subject in the web, in hue order, and a Shared row.
// `subjects` is [{ label, hue }]; the hues are generated hex strings.
const SHARED_COLOUR = '#f4f7fb';
function clusterLegendRows(subjects) {
  const short = s => {
    const str = String(s == null ? '' : s);
    return str.length > 18 ? str.slice(0, 17) + '…' : str;
  };
  const rows = subjects.map(s =>
    `<div class="lg-row"><i class="net-dot" style="background:${s.hue};width:8px;height:8px;` +
    `box-shadow:0 0 6px ${s.hue}"></i>${escapeHtml(short(s.label))}</div>`).join('');
  const a = (subjects[0] && subjects[0].hue) || '#46a6ff';
  const b = (subjects[Math.floor(subjects.length / 2)] && subjects[Math.floor(subjects.length / 2)].hue) || '#f5b342';
  const shared = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
    `<path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5" fill="none" stroke="${a}" stroke-width="1.3"/>` +
    `<path d="M7 12.5 A5.5 5.5 0 0 1 7 1.5" fill="none" stroke="${b}" stroke-width="1.3"/>` +
    `<circle cx="7" cy="7" r="3.2" fill="${SHARED_COLOUR}"/></svg>`;
  return `${rows}<div class="lg-row">${shared}Shared</div>`;
}

function legendHtml(t) {
  const lc = linkColors(t);
  const nodeRows = `<div class="net-legend-nodes">${typeLegendRows(t)}</div>`;
  const tieRows = KIND_CHIPS
    .map(([k, label]) => `<div class="lg-row">${lineSwatch(lc[k], null)}${label}</div>`).join('');
  const confRows = [
    [null, 'Documented'], [DASH.reported, 'Reported'], [DASH.inferred, 'Inferred'],
  ].map(([d, label]) => `<div class="lg-row">${lineSwatch(t.mut, d)}${label}</div>`).join('');
  return `${nodeRows}<div class="net-ties">
      <button type="button" class="net-ties-btn">Ties &#9662;</button>
      <div class="net-ties-pop" hidden>
        <div><h5>Ties</h5>${tieRows}</div>
        <div><h5>Confidence</h5>${confRows}</div>
      </div>
    </div>`;
}

// ---- header -------------------------------------------------------------------
function chipHtml(act, label, on, disabled) {
  return `<button class="chip${on ? ' on' : ''}" data-act="${escapeHtml(act)}"` +
    `${disabled ? ' disabled' : ''}>${label}</button>`;
}

// Every issue on file, by title. The "(not in this web)" suffixes are written
// by the build, which is the only thing that knows what the web holds.
function lensOptionsHtml(issues, selected) {
  const clip = s => {
    const str = String(s == null ? '' : s);
    return str.length > 40 ? str.slice(0, 39) + '…' : str;
  };
  return `<option value=""${selected ? '' : ' selected'}>None</option>` + issues.map(i =>
    `<option value="${escapeHtml(i.issue_id)}"${i.issue_id === selected ? ' selected' : ''}` +
    ` data-title="${escapeHtml(clip(i.title || i.issue_id))}">${escapeHtml(clip(i.title || i.issue_id))}</option>`).join('');
}

function headHtml(state, mode, focusEnabled, t, issues) {
  const lc = linkColors(t);
  const kindChips = KIND_CHIPS.map(([k, label]) =>
    chipHtml('kind:' + k, `<i class="net-dot" style="background:${lc[k]}"></i>${escapeHtml(label)}`,
      state.kinds.has(k), false)).join('');
  return `<div class="net-head">
    <div class="net-row">
      <div class="net-grp"><span class="lbl">View</span>
        ${chipHtml('mode:web', 'Everything', mode === 'web', false)}
        ${chipHtml('mode:focus', 'Focus', mode === 'focus', !focusEnabled)}
      </div>
      <span class="net-sep"></span>
      <div class="net-grp"><span class="lbl">Depth</span>
        ${chipHtml('depth:1', '1', state.depth === 1, false)}
        ${chipHtml('depth:2', '2', state.depth === 2, false)}
      </div>
      <span class="net-sep"></span>
      <div class="net-grp ties"><span class="lbl">Ties</span>${kindChips}<span class="net-sep"></span>${chipHtml('kinds:all', 'All', false, false)}${chipHtml('kinds:none', 'None', false, false)}</div>
    </div>
    <div class="net-row">
      <div class="net-search">
        <input type="text" placeholder="Find in web…" autocomplete="off" aria-label="Find a node">
        <div class="net-drop" hidden></div>
      </div>
      <div class="net-grp net-colour"><span class="lbl">Colour</span>
        ${chipHtml('colour:type', 'Type', colourMode === 'type', false)}
        ${chipHtml('colour:cluster', 'Cluster', colourMode === 'cluster', false)}
      </div>
      <div class="net-grp net-lens-grp"><span class="lbl">Issue lens</span>
        <select class="net-lens${state.lens ? ' on' : ''}" aria-label="Issue lens">${lensOptionsHtml(issues, state.lens)}</select>
      </div>
      ${chipHtml('labels', 'Labels: all', state.labelsAll, false)}
      ${chipHtml('reset', '↺ Reset', false, false)}
      <div class="net-counts"></div>
    </div>
  </div>`;
}

// ---- tooltips -----------------------------------------------------------------
function typePillHtml(d) {
  const label = d.subject ? (d.kind || 'subject')
    : d.type === 'entity' ? (d.kind || 'entity') : d.type;
  const cls = ['official', 'candidate', 'staff'].includes(label) ? label : 'type';
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}

function nodeTipHtml(d, ix) {
  const rows = [`<div class="tt-row">${typePillHtml(d)} <b>${d.degree}</b> ties</div>`];
  if (d.hidden > 0) {
    rows.push(`<div class="tt-row">+${d.hidden} more — ` +
      (d.hub ? 'a hub; double-click to open it' : 'double-click to expand') + '</div>');
  }
  if (d.issueTied && d.type !== 'issue') {
    rows.push('<div class="tt-row"><span class="net-badge-dot"></span> tied to an issue on file</div>');
  }
  if (d.type === 'person') {
    const p = ix.people.get(d.id);
    if (p && p.occupation) rows.push(`<div class="tt-row">${escapeHtml(p.occupation)}</div>`);
  } else if (d.type === 'entity' || d.type === 'property') {
    const e = ix.entities.get(d.id);
    if (e && e.sunbiz_status) {
      rows.push(`<div class="tt-row"><b>Sunbiz</b> ${escapeHtml(e.sunbiz_status)}</div>`);
    }
  }
  return `<div class="tt-title">${escapeHtml(d.label)}</div>${rows.join('')}`;
}

function linkTipHtml(l, ix) {
  const a = ix.labelOf(endId(l.source));
  const b = ix.labelOf(endId(l.target));
  const rows = [
    `<div class="tt-row">${escapeHtml(a)} → ${escapeHtml(b)}</div>`,
  ];
  if (l.label) rows.push(`<div class="tt-row">${escapeHtml(l.label)}</div>`);
  if (l.amount > 0) rows.push(`<div class="tt-row"><b>${escapeHtml(money(l.amount))}</b></div>`);
  if (l.confidence) {
    rows.push(`<div class="tt-row conf-${escapeHtml(l.confidence)}">${escapeHtml(l.confidence)}</div>`);
  }
  const srcs = (l.sources || []).map(sid => {
    const src = ix.sourceOf(sid);
    const label = (src && (src.title || src.source_id)) || sid;
    const url = (src && src.url) || '';
    return `<a class="src" href="${escapeHtml(url || '#')}" target="_blank" rel="noopener"` +
      ` title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
  }).join('');
  return `<div class="tt-title">${escapeHtml(relLabel(l.rel))}</div>${rows.join('')}${srcs}`;
}

// ---- the tab -------------------------------------------------------------------
const networkTab = {
  id: 'network',
  label: 'Network',
  // The shell calls this on the tab it rendered last, before it empties the
  // panel. `render` used to be the only way out of this tab, which meant that
  // leaving the network route for another tab left the full-screen scroll lock
  // on `document.body` with nothing to take it off again.
  teardown,
  render(container, ctx) {
    teardown();
    ensureStyle();

    const d3 = window.d3;
    const { PT, ix, route } = ctx;
    const state = stateFor(route);
    const t = tokens();
    const lc = linkColors(t);

    const focusId = ['person', 'entity', 'issue'].includes(route.view) ? route.id : '';
    if (focusId) lastFocusId = focusId;
    const mode = focusId ? 'focus' : 'web';

    // `?colour=cluster&lens=I03` — a cheap deep link, honoured on the first
    // render of the page only.
    if (!deepLinkRead) {
      deepLinkRead = true;
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.get('colour') === 'cluster') colourMode = 'cluster';
        if (q.get('lens')) state.lens = q.get('lens');
      } catch { /* no location: nothing to honour */ }
    }
    const issues = (PT.tables && PT.tables.issues) || [];

    // The toolbar, the legend and the zoom pill all float inside the stage, so
    // the stage is the only box the panel sees.
    container.innerHTML =
      '<div class="net-wrap"><div class="net-stage">' +
      headHtml(state, mode, !!(focusId || lastFocusId), t, issues) +
      '<div class="net-empty" hidden><p class="empty">' +
      'No ties on file yet for this item.</p></div>' +
      '<div class="net-zoom">' +
      '<button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-zoom="fit" title="Fit to view" aria-label="Fit to view">⤡</button>' +
      '</div>' +
      '<button type="button" class="net-expand" aria-label="Expand the web to full screen">' +
      '⤢ Expand</button>' +
      '</div></div>';

    const wrap = container.querySelector('.net-wrap');
    const stage = wrap.querySelector('.net-stage');
    const head = wrap.querySelector('.net-head');
    const emptyBox = wrap.querySelector('.net-empty');
    const countsEl = wrap.querySelector('.net-counts');
    const input = wrap.querySelector('.net-search input');
    const drop = wrap.querySelector('.net-drop');
    const lensSelect = wrap.querySelector('.net-lens');

    if (!d3 || typeof d3.forceSimulation !== 'function') {
      emptyBox.hidden = false;
      emptyBox.innerHTML = '<p class="empty">The graph library did not load.</p>';
      return;
    }

    // ---- tooltip -------------------------------------------------------------
    // It lives inside the panel, not on `document.body`, so that the shell's
    // `panel.innerHTML = ''` takes it away with everything else. `.net-wrap` is
    // the positioned ancestor and does not clip, so the tooltip can still hang
    // outside the stage.
    const tip = document.createElement('div');
    tip.className = 'tooltip net-tip';
    tip.hidden = true;
    wrap.appendChild(tip);

    let hideTimer = 0;
    let clickTimer = 0;
    const timers = [];
    const listeners = new AbortController();
    live = { sim: null, timers, abort: listeners, tip, stage, savePositions: null };

    // Placed in viewport space (so it flips away from the window edges), then
    // converted into the wrapper's own coordinates.
    function positionTip(ev) {
      const pad = 14;
      const box = tip.getBoundingClientRect();
      // The tooltip is absolutely positioned against whatever is actually
      // containing it: `.net-wrap` normally, but the stage itself once the web
      // is full screen (the wrapper is then outside the fullscreen subtree).
      const host = (tip.offsetParent || wrap).getBoundingClientRect();
      let x = ev.clientX + pad;
      let y = ev.clientY + pad;
      if (x + box.width > window.innerWidth - 8) x = ev.clientX - box.width - pad;
      if (y + box.height > window.innerHeight - 8) y = ev.clientY - box.height - pad;
      tip.style.left = (Math.max(8, x) - host.left) + 'px';
      tip.style.top = (Math.max(8, y) - host.top) + 'px';
    }
    function showTip(html, ev, interactive, accent) {
      clearTimeout(hideTimer);
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.borderLeftColor = accent || 'rgba(45,212,191,.5)';
      tip.classList.toggle('interactive', !!interactive);
      positionTip(ev);
    }
    // 250 ms of grace so the pointer can travel onto the tooltip and click a source.
    function hideTipSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { tip.hidden = true; applyFocus(null, null); }, 250);
      timers.push(hideTimer);
    }
    tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    tip.addEventListener('pointerleave', hideTipSoon);

    // ---- svg scaffold ---------------------------------------------------------
    // Full screen is either a real Fullscreen API session on the stage or, where
    // the browser refuses one, the `.net-full` fixed overlay. `sizeStage` runs
    // during this very render, so the test has to be declared above it.
    const isFull = () =>
      document.fullscreenElement === stage || stage.classList.contains('net-full');

    // The stylesheet asks for `max(640px, calc(100vh - 210px))`; once the panel
    // is measured the stage is trimmed to whatever is actually left on screen
    // (never below the 640px floor) so the fitted web never lands below the fold.
    // `getBoundingClientRect().top` is already viewport-relative — what is left
    // below it in the window is exactly `innerHeight - top`.
    function sizeStage() {
      // Full screen sizes the stage itself — a pixel height measured against the
      // panel would fight the fullscreen box (and the overlay's `inset: 0`).
      if (isFull()) { stage.style.height = ''; return; }
      const top = stage.getBoundingClientRect().top;
      stage.style.height = Math.max(640, Math.round(window.innerHeight - top - 20)) + 'px';
    }
    sizeStage();

    let width = stage.clientWidth || 900;
    let height = stage.clientHeight || 640;

    const svg = d3.select(stage).append('svg')
      .attr('width', '100%').attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');

    // A coloured bloom: blur the alpha, flood it with the mark's own colour and
    // lay the crisp mark back over the top.
    function colorGlow(id, color, sd, opacity) {
      const f = defs.append('filter').attr('id', id)
        .attr('x', '-90%').attr('y', '-90%').attr('width', '280%').attr('height', '280%');
      f.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', sd).attr('result', 'b');
      f.append('feFlood').attr('flood-color', color).attr('flood-opacity', opacity).attr('result', 'c');
      f.append('feComposite').attr('in', 'c').attr('in2', 'b').attr('operator', 'in').attr('result', 'g');
      const m = f.append('feMerge');
      m.append('feMergeNode').attr('in', 'g');
      m.append('feMergeNode').attr('in', 'SourceGraphic');
    }
    const SUBJECT_KINDS = ['official', 'candidate', 'staff'];
    for (const kind of SUBJECT_KINDS) {
      colorGlow('net-glow-' + kind, subjectColor(kind, t), 6, 0.55);
    }
    colorGlow('net-glow-issue', t.red, 5, 0.55);
    const subjectGlow = kind =>
      'url(#net-glow-' + (SUBJECT_KINDS.includes(kind) ? kind : 'official') + ')';

    // One small arrowhead per tie kind, in the tie's own colour. `refX 9` puts
    // the tip at the very end of the line, and the line itself already stops at
    // the target's rim, so the head lands on the ring instead of under it.
    // `markerUnits: userSpaceOnUse` keeps every head the same size whatever the
    // hairline's stroke-width says.
    function arrowMarker(id, color, cls) {
      defs.append('marker')
        .attr('id', id)
        .attr('class', cls || null)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9).attr('refY', 5)
        .attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('orient', 'auto-start-reverse')
        .attr('markerUnits', 'userSpaceOnUse')
        .append('path').attr('d', 'M1,1 L9,5 L1,9 Z')
        .attr('fill', color).attr('fill-opacity', 0.85);
    }
    for (const [kind] of KIND_CHIPS) arrowMarker('net-arrow-' + kind, lc[kind] || t.mut2);

    // One radial gradient per node colour (a lighter core over the flat token,
    // for the subject discs), one bloom disc gradient and one hover glow per
    // colour. Cluster hues and lens mixes are not known up front, so every
    // colour is registered the first time a mark asks for it. The glows are
    // only ever attached to the handful of marks under the pointer (and the
    // subjects): a few hundred filtered elements make dragging stutter.
    const paints = new Map();
    function paintOf(color) {
      let p = paints.get(color);
      if (p) return p;
      const i = paints.size;
      const parsed = d3.color(color);
      const core = parsed ? parsed.brighter(0.9).formatHex() : color;
      const grad = defs.append('radialGradient').attr('id', 'net-grad-' + i)
        .attr('cx', '35%').attr('cy', '28%').attr('r', '78%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', core);
      grad.append('stop').attr('offset', '100%').attr('stop-color', color);
      colorGlow('net-glow-c' + i, color, 4, 0.7);
      colorGlow('net-glow-s' + i, color, 6, 0.55);
      // The bloom behind a small mark: a radial fade from the colour to nothing.
      // A gradient-filled disc costs the renderer nothing next to a filter, so
      // every satellite can carry one at rest.
      const bloom = defs.append('radialGradient').attr('id', 'net-bloom-' + i);
      bloom.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.55);
      bloom.append('stop').attr('offset', '45%').attr('stop-color', color).attr('stop-opacity', 0.18);
      bloom.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
      p = {
        grad: 'url(#net-grad-' + i + ')', bloom: 'url(#net-bloom-' + i + ')',
        glow: 'url(#net-glow-c' + i + ')', subjectGlow: 'url(#net-glow-s' + i + ')',
      };
      paints.set(color, p);
      return p;
    }
    [t.blue, t.teal, t.green, t.red, t.violet, t.amber, t.mut2,
      '#b9c7d8', '#c084fc', '#7dd3fc', '#f0abfc'].forEach(paintOf);

    // ---- cluster colours and the issue lens -----------------------------------------
    // Recomputed by every build: the subject hues, each node's owning subjects,
    // and (with a lens on) every node's hops from the issue.
    let hues = new Map();
    let owners = new Map();
    let lensHops = null;
    const NEUTRAL_TIE = 'rgba(220,230,245,.55)';
    const LENS_FADE = 0.14;
    const hueIndex = new Map();
    let markerKey = '';

    function baseColour(d) {
      // An issue stays red in both modes: the red mark is what says "issue".
      if (colourMode !== 'cluster' || d.type === 'issue') return nodeColor(d, t);
      if (d.subject && hues.has(d.id)) return hues.get(d.id);
      const own = owners.get(d.id) || [];
      if (own.length === 1) return hues.get(own[0]) || nodeColor(d, t);
      if (own.length > 1) return SHARED_COLOUR;
      return t.mut2;
    }
    // The lens mixes the lit marks toward red, whatever the colour mode says.
    function colourOf(d) {
      const c = baseColour(d);
      if (!lensHops) return c;
      const h = lensHops.get(d.id);
      if (h === 0) return t.red;
      if (h === 1) return d3.color(d3.interpolateRgb(c, t.red)(0.8)).formatHex();
      if (h === 2) return d3.color(d3.interpolateRgb(c, t.red)(0.45)).formatHex();
      return c;
    }

    // With a lens on, a tie between two lit nodes is red: bright between the
    // issue and its first ring, softer out to the second. `0` = not a lens tie.
    function lensTie(l) {
      if (!lensHops) return 0;
      const a = lensHops.get(endId(l.source)), b = lensHops.get(endId(l.target));
      if (a == null || b == null) return 0;
      return Math.max(a, b) <= 1 ? 0.75 : 0.4;
    }
    function clusterOwnerOf(l) {
      const a = owners.get(endId(l.source)) || [];
      const b = owners.get(endId(l.target)) || [];
      return a.find(o => b.includes(o)) || null;
    }

    const bloomOf = d => paintOf(colourOf(d)).bloom;
    // A bloom disc is a few radii wide; the sparks (people) get the widest one
    // so they read as points of light rather than as grey pips.
    const bloomRadius = (d, r) => (d.type === 'person' ? r * 3.6 : r * 2.4);
    const fillOf = d => paintOf(colourOf(d)).grad;
    // Glassy edge: the mark's colour lifted 35 % of the way to white.
    const lighten = c => d3.interpolateRgb(c, '#ffffff')(0.35);

    const root = svg.append('g').attr('class', 'net-root');
    // The hover glow goes behind the ties so the hairline stays crisp on top of
    // it; the flow dots go in front of both.
    // The cluster hulls sit behind everything.
    const gHulls = root.append('g').attr('class', 'net-hulls');
    const gGlow = root.append('g').attr('class', 'net-glows');
    const gLinks = root.append('g').attr('class', 'net-links');
    const gFlow = root.append('g').attr('class', 'net-flows');
    const gHits = root.append('g').attr('class', 'net-hits');
    const gNodes = root.append('g').attr('class', 'net-nodes');

    let scale = 1;
    let userZoomed = false;
    // Bumped by every reader-driven zoom so a fit that is still gliding can tell
    // whether it was overtaken by a gesture.
    let userZoomSeq = 0;
    // Bumped by every fit, so a landing timer can tell whether a newer fit has superseded it.
    let fitSeq = 0;
    // The simulation has moved the nodes at least once (see fit), and how many fits have
    // actually framed something since this render began.
    let hasTicked = false;
    let fitsApplied = 0;
    const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', ev => {
      if (ev.sourceEvent) { userZoomed = true; userZoomSeq++; }
      root.attr('transform', ev.transform);
      const next = ev.transform.k;
      const crossed = (next >= LABEL_ZOOM) !== (scale >= LABEL_ZOOM);
      scale = next;
      if (crossed) applyLabels();
    });
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => applyFocus(null, null));

    // ---- legend ---------------------------------------------------------------
    const legend = document.createElement('div');
    legend.className = 'net-legend';
    legend.innerHTML =
      '<button type="button" class="net-legend-toggle">Legend</button>' +
      `<div class="net-legend-body">${legendHtml(t)}</div>`;
    stage.appendChild(legend);

    // Below ~700px the legend crowds the web, so it starts collapsed there
    // (and expanded above it) the first time this module sees a render; after
    // that the reader's own choice — remembered in module scope — wins.
    if (legendCollapsed === null) legendCollapsed = width < 700;
    function applyLegendCollapsed() {
      legend.classList.toggle('collapsed', legendCollapsed);
    }
    applyLegendCollapsed();
    const tiesBtn = legend.querySelector('.net-ties-btn');
    const tiesPop = legend.querySelector('.net-ties-pop');
    legend.querySelector('.net-legend-toggle').addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      if (legendCollapsed) { tiesPop.hidden = true; tiesBtn.classList.remove('on'); }
      applyLegendCollapsed();
    });
    tiesBtn.addEventListener('click', () => {
      tiesPop.hidden = !tiesPop.hidden;
      tiesBtn.classList.toggle('on', !tiesPop.hidden);
    });

    // ---- zoom pill -------------------------------------------------------------
    stage.querySelector('.net-zoom').addEventListener('click', ev => {
      const btn = ev.target.closest('[data-zoom]');
      if (!btn) return;
      const how = btn.dataset.zoom;
      if (how === 'fit') { fit(); return; }
      userZoomed = true;
      svg.transition().duration(220).ease(d3.easeCubicOut)
        .call(zoom.scaleBy, how === 'in' ? 1.35 : 1 / 1.35);
    });

    // ---- expand / full screen ------------------------------------------------------
    // The web is the one view that is worth the whole screen: a dozen subjects
    // and their satellites simply do not resolve inside the app's middle column.
    // The Fullscreen API is the real thing; where it is refused (no trusted user
    // gesture, an iframe without `allowfullscreen`, a browser that has it turned
    // off) a fixed overlay covers the viewport instead, and Escape has to be
    // wired by hand because only the real thing gets it for free.
    const expandBtn = stage.querySelector('.net-expand');
    function afterSizeChange() {
      expandBtn.textContent = isFull() ? '✕ Exit full screen' : '⤢ Expand';
      // The tooltip is positioned against its offsetParent; in full screen that
      // has to be the stage, since `.net-wrap` is outside the fullscreen subtree
      // and would not be painted at all.
      (isFull() ? stage : wrap).appendChild(tip);
      userZoomed = false;
      onResize();
      const refit = setTimeout(() => fitWhenSettled(500), 260);
      timers.push(refit);
    }
    function enterFull() {
      let done = false;
      // The fallback cannot simply hang off the request's `catch`. A host that
      // swallows the request — an embedded webview, an iframe whose parent never
      // grants it — returns a promise that never settles at all and fires no
      // `fullscreenerror` either, which would leave the pill looking dead. So a
      // rejection engages the overlay at once, and a request that has not
      // actually put the stage full screen 600 ms later does too.
      const fallback = () => {
        if (done || isFull()) return;
        done = true;
        stage.classList.add('net-full');
        document.body.classList.add('net-full-body');
        afterSizeChange();
      };
      const req = stage.requestFullscreen ? stage.requestFullscreen() : Promise.reject();
      Promise.resolve(req).then(() => { done = true; }, fallback);
      const guard = setTimeout(fallback, 600);
      timers.push(guard);
    }
    // The one state the two paths must never share. Dropping the overlay is
    // always safe here: either native owns the stage, in which case the overlay
    // is redundant, or nothing does, in which case it has to go anyway.
    function dropOverlay() {
      stage.classList.remove('net-full');
      document.body.classList.remove('net-full-body');
    }
    function exitFull() {
      // A real session is left through the API, and the `fullscreenchange`
      // listener below does the re-measuring for both exits. The overlay goes
      // here too: a native session that landed after the 600 ms guard had
      // already fired leaves both engaged at once, and clearing only native
      // would leave the pill still reading "Exit full screen".
      if (document.fullscreenElement === stage && document.exitFullscreen) {
        dropOverlay();
        Promise.resolve(document.exitFullscreen()).catch(() => {});
        return;
      }
      dropOverlay();
      afterSizeChange();
    }
    expandBtn.addEventListener('click', () => (isFull() ? exitFull() : enterFull()));
    document.addEventListener('fullscreenchange', () => {
      if (orphaned()) return;
      // Native ownership supersedes the fallback, so a late-arriving session
      // retires the overlay rather than stacking on top of it.
      if (document.fullscreenElement === stage) dropOverlay();
      afterSizeChange();
    }, { signal: listeners.signal });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && stage.classList.contains('net-full')) exitFull();
    }, { signal: listeners.signal });

    // ---- graph state ----------------------------------------------------------
    let nodes = [];
    let links = [];
    let adj = new Map();
    let nodeSel = null;
    let linkSel = null;
    let hitSel = null;
    let labelSel = null;
    let markSel = null;
    let flowSel = null;
    let glowSel = null;
    let hoverNode = null;
    let hoverLink = null;
    let dragging = false;
    // Satellite names the label pass could not fit anywhere clear of a subject's
    // name. They stay off at rest and come back on hover or on zoom.
    const suppressed = new Set();

    const sim = d3.forceSimulation([])
      .force('link', d3.forceLink([]).id(d => d.id)
        .distance(l => (LINK_DISTANCE[l.kind] || 80) * DISTANCE_SCALE).strength(0.6))
      .force('charge', d3.forceManyBody().strength(d => (d.subject ? -360 : -120))
        .theta(0.9).distanceMax(600))
      .force('collide', d3.forceCollide(d => (d.subject ? SUBJECT_COLLIDE : radius(d) + 7)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .alphaDecay(0.028)
      .on('tick', ticked);
    live.sim = sim;

    function savePositions() {
      for (const n of nodes) {
        if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
          state.positions.set(n.id, { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 });
        }
      }
    }
    live.savePositions = savePositions;

    // Tick accessors are hoisted so the loop allocates nothing beyond the
    // transform strings the DOM itself needs and one point per tie.
    const nodeTransform = d => 'translate(' + d.x + ',' + d.y + ')';

    // Ties run dead straight and stop 3 px outside the target's rim, so the
    // arrowhead sits on the ring. One pass of four setAttribute calls per line
    // beats four d3 `.attr` passes over the same selection.
    function placeLines(sel) {
      sel.each(function (l) {
        const s = l.source, g = l.target;
        if (!s || !g || !Number.isFinite(s.x) || !Number.isFinite(g.x)) return;
        const e = trimmedEnd(s.x, s.y, g.x, g.y, radius(g) + 2);
        this.setAttribute('x1', s.x);
        this.setAttribute('y1', s.y);
        this.setAttribute('x2', e.x);
        this.setAttribute('y2', e.y);
      });
    }

    let tickCount = 0;
    function ticked() {
      if (!nodeSel) return;
      if (!hasTicked) {
        hasTicked = true;
        // Both timed frames can land before the first tick where animation frames are throttled
        // (a background pane, a headless capture). If neither framed anything, frame once the
        // layout actually starts moving.
        const firstMove = setTimeout(() => {
          if (stage.isConnected && !fitsApplied && !userZoomed) frame(600);
        }, 700);
        timers.push(firstMove);
      }
      placeLines(linkSel);
      placeLines(hitSel);
      nodeSel.attr('transform', nodeTransform);
      // Only the hot ties carry a glow and flow dots, so these are a handful of
      // lines at most.
      if (glowSel && !glowSel.empty()) placeLines(glowSel);
      if (flowSel && !flowSel.empty()) placeLines(flowSel);
      // A hull is a convex hull and a spline over a few dozen points: every
      // third tick is plenty to keep it under its members.
      if (colourMode === 'cluster' && ++tickCount % 3 === 0) drawHulls();
    }

    // ---- cluster hulls ------------------------------------------------------------
    // A soft tinted region round each subject and the nodes only it reaches.
    const HULL_PAD = 18;
    const hullLine = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
    function drawHulls() {
      if (colourMode !== 'cluster' || !nodes.length) {
        gHulls.selectAll('path').remove();
        return;
      }
      const groups = new Map();
      for (const n of nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        const own = owners.get(n.id) || [];
        if (own.length !== 1) continue;
        if (!groups.has(own[0])) groups.set(own[0], []);
        groups.get(own[0]).push(n);
      }
      const data = [];
      for (const [sid, members] of groups) {
        if (!hues.has(sid)) continue;
        if (members.filter(m => m.id !== sid).length < 2) continue;
        const pts = [];
        for (const m of members) {
          for (let k = 0; k < 4; k++) {
            const a = Math.PI / 4 + k * Math.PI / 2;
            pts.push([m.x + Math.cos(a) * HULL_PAD, m.y + Math.sin(a) * HULL_PAD]);
          }
        }
        const hull = d3.polygonHull(pts);
        if (hull) data.push({ id: sid, hull });
      }
      gHulls.selectAll('path').data(data, h => h.id).join('path')
        .attr('d', h => hullLine(h.hull))
        .attr('fill', h => hues.get(h.id)).attr('fill-opacity', 0.07)
        .attr('stroke', h => hues.get(h.id)).attr('stroke-opacity', 0.16)
        .attr('stroke-width', 1);
    }

    // ---- link presentation ------------------------------------------------------
    function strokeOf(l) {
      if (lensTie(l)) return t.red;
      if (colourMode === 'cluster') {
        const o = clusterOwnerOf(l);
        return o ? hues.get(o) : NEUTRAL_TIE;
      }
      return lc[l.kind] || t.mut2;
    }
    function arrowOf(l) {
      if (lensTie(l)) return 'url(#net-arrow-issue)';
      if (colourMode === 'cluster') {
        const o = clusterOwnerOf(l);
        return o && hueIndex.has(o) ? 'url(#net-arrow-h' + hueIndex.get(o) + ')' : 'url(#net-arrow-n)';
      }
      return 'url(#net-arrow-' + (lc[l.kind] ? l.kind : 'other') + ')';
    }
    const touches = (l, id) => endId(l.source) === id || endId(l.target) === id;
    const restNodeOpacity = d => (lensHops && !lensHops.has(d.id) ? LENS_FADE : 1);
    const restLinkOpacity = l => (lensTie(l) || (lensHops ? 0.05 : REST_LINK_OPACITY));
    const restLinkWidth = l => (lensTie(l) ? widthOf(l) + 0.3 : widthOf(l));

    // A subject keeps its own bloom and an issue its red one whatever the
    // pointer is doing; every other mark is unfiltered until it is hovered.
    // Out of the plain Type colours, a subject's bloom follows its disc.
    const restFilter = d => (d.subject
      ? (colourMode === 'type' && !lensHops ? subjectGlow(d.kind) : paintOf(colourOf(d)).subjectGlow)
      : d.type === 'issue' ? 'url(#net-glow-issue)' : null);
    const hotFilter = d => paintOf(colourOf(d)).glow || restFilter(d);

    // The glow and the dots only exist while something is hovered, so they are
    // joined here rather than kept as parallel selections of every tie on the
    // stage. Both are emptied by `showFlow([])`.
    //
    // The glow is geometry, not a filter. An SVG filter region is measured in
    // objectBoundingBox units by default, and a straight horizontal line's
    // bounding box is zero pixels tall — `-60%`/`220%` of nothing is still
    // nothing — so the blur-and-merge this used to run clipped a horizontal tie
    // away entirely and left a near-axis one as a thin band. A wide, soft
    // companion stroke behind the tie says the same thing and cannot degenerate.
    function showFlow(hot) {
      glowSel = gGlow.selectAll('line').data(hot, l => l.id).join('line')
        .attr('class', 'net-glow-line')
        .attr('stroke', strokeOf)
        .attr('stroke-width', l => widthOf(l) + 4)
        .attr('stroke-opacity', 0.28)
        .attr('stroke-linecap', 'round');
      flowSel = gFlow.selectAll('line').data(hot, l => l.id).join('line')
        .attr('class', 'net-flow')
        .attr('stroke', l => lighten(strokeOf(l)))
        .attr('stroke-width', 1.8)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '1 9');
      if (!glowSel.empty()) placeLines(glowSel);
      if (!flowSel.empty()) placeLines(flowSel);
    }

    // ---- hover focus / labels --------------------------------------------------
    function applyFocus(nodeId, linkId) {
      hoverNode = nodeId;
      hoverLink = linkId;
      if (!nodeSel) return;
      if (!nodeId && !linkId) {
        // Rest is the lens state when a lens is on: lit marks at full strength,
        // the rest of the web faded back.
        nodeSel.interrupt().attr('opacity', restNodeOpacity).classed('hovered', false);
        linkSel.attr('opacity', restLinkOpacity).attr('stroke-width', restLinkWidth);
        if (markSel) markSel.attr('filter', restFilter);
        showFlow([]);
      } else if (nodeId) {
        const near = adj.get(nodeId);
        const lit = d => d.id === nodeId || (near && near.has(d.id));
        nodeSel.interrupt()
          .attr('opacity', d => (lit(d) ? 1 : DIM_OPACITY))
          .classed('hovered', d => d.id === nodeId);
        linkSel
          .attr('opacity', l => (touches(l, nodeId) ? 0.95 : DIM_OPACITY))
          .attr('stroke-width', l => (touches(l, nodeId) ? widthOf(l) + 1 : widthOf(l)));
        if (markSel) markSel.attr('filter', d => (lit(d) ? hotFilter(d) : restFilter(d)));
        showFlow(links.filter(l => touches(l, nodeId)));
      } else {
        const hot = links.find(l => l.id === linkId);
        const a = hot ? endId(hot.source) : '';
        const b = hot ? endId(hot.target) : '';
        nodeSel.interrupt()
          .attr('opacity', d => (d.id === a || d.id === b) ? 1 : DIM_OPACITY)
          .classed('hovered', false);
        linkSel
          .attr('opacity', l => (l.id === linkId ? 1 : DIM_OPACITY))
          .attr('stroke-width', l => (l.id === linkId ? widthOf(l) + 1 : widthOf(l)));
        if (markSel) {
          markSel.attr('filter', d =>
            (d.id === a || d.id === b) ? hotFilter(d) : restFilter(d));
        }
        showFlow(hot ? [hot] : []);
      }
      applyLabels();
    }

    // At rest only the subjects and the issues are named; a satellite's name
    // waits for a hover, a zoom past LABEL_ZOOM, or the labels chip. (Shared
    // satellites used to be named at rest too, and the Everything web read as
    // a wall of small type.)
    // An issue is exempt from the "two neighbours" rule but NOT from the
    // de-overlap's suppression: a red issue name printed across a subject's name
    // costs both of them, and the issue is the one that can wait for a hover.
    function labelVisible(d) {
      if (d.subject) return true;
      // The issue under the lens is always named.
      if (lensHops && lensHops.get(d.id) === 0) return true;
      if (state.labelsAll) return true;
      if (scale >= LABEL_ZOOM) return true;
      if (hoverNode) {
        if (d.id === hoverNode) return true;
        const near = adj.get(hoverNode);
        if (near && near.has(d.id)) return true;
      }
      if (hoverLink) {
        const hot = links.find(l => l.id === hoverLink);
        if (hot && (endId(hot.source) === d.id || endId(hot.target) === d.id)) return true;
      }
      if (suppressed.has(d.id)) return false;
      // With a lens on, the first ring is named at rest; the second ring and
      // everything past it wait for a hover or a zoom.
      if (lensHops) return lensHops.get(d.id) === 1;
      if (d.type === 'issue') return true;
      // A small web (a focus at depth 1, a filtered Everything) has room for
      // every name; the point-cloud rule only kicks in once the names would
      // outnumber the space.
      return nodes.length <= 40;
    }

    function applyLabels() {
      if (!labelSel) return;
      labelSel.attr('opacity', d => (labelVisible(d) ? 1 : 0));
    }

    // ---- zoom helpers ----------------------------------------------------------
    function fit(duration = 700) {
      if (!nodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        const r = radius(n) + 8;
        if (n.x - r < minX) minX = n.x - r;
        if (n.y - r < minY) minY = n.y - r;
        if (n.x + r > maxX) maxX = n.x + r;
        if (n.y + r > maxY) maxY = n.y + r;
      }
      if (!Number.isFinite(minX)) return;
      // Before the first tick d3 has every node in a phyllotaxis spiral a couple of hundred
      // pixels across, whatever the web really measures; framing THAT magnifies the spiral to the
      // 1.6 ceiling and leaves the real layout hanging off the stage.
      if (!hasTicked) return;
      // 44 px of air all round, plus room for the floating toolbar above and the
      // legend/zoom pills below — both sit over the stage, not beside it.
      const pad = 44;
      const padT = pad + (head ? head.offsetHeight : 0);
      // The legend and the zoom pill only occupy the two bottom corners, so the
      // bottom needs far less clearance than the full-width toolbar at the top.
      const padB = pad + 20;
      const dx = Math.max(maxX - minX, 1);
      const dy = Math.max(maxY - minY, 1);
      // Never magnify past 1.6: a seven-node focus web would otherwise fill the
      // panel at the 4x ceiling and pile its labels on top of each other.
      const k = Math.max(0.25, Math.min(1.6,
        Math.min((width - pad * 2) / dx, (height - padT - padB) / dy)));
      const tx = width / 2 - k * (minX + maxX) / 2;
      const ty = (padT + height - padB) / 2 - k * (minY + maxY) / 2;
      const target = d3.zoomIdentity.translate(tx, ty).scale(k);
      fitsApplied++;
      svg.transition().duration(duration).ease(d3.easeCubicOut)
        .call(zoom.transform, target);
      // Same bargain as the entrance wave: the glide is decoration on the frame
      // clock, and this timer on the task clock is what guarantees the web
      // actually ends up framed. Skipped if the reader grabbed the zoom while it
      // was in flight — their gesture wins.
      // A later fit always wins: an early frame's landing used to fire after the settled one
      // and put the half-spread layout back on screen.
      const seq = userZoomSeq;
      const mine = ++fitSeq;
      const land = setTimeout(() => {
        if (!stage.isConnected || userZoomSeq !== seq || fitSeq !== mine) return;
        svg.interrupt();
        zoom.transform(svg, target);
      }, duration + 80);
      timers.push(land);
    }

    // Names that settle close together print over each other. Nothing is
    // re-simulated: once the web is still, the visible labels are walked in
    // priority order — subjects first, going round the ring, then the busiest
    // satellites — and any that would land on one already placed is flipped
    // above its node instead of below. Labels are the only thing that moves,
    // and only by a `y` attribute.
    const overlap = (a, b) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    // `getBBox` measures the glyphs only; 3 px covers the label's dark halo and
    // keeps two names from quite touching. Widening it past that backfires —
    // every slot starts registering a clash and the placer ends up choosing
    // between equally bad options.
    const SLACK = 3;
    function labelBox(d, text, shift) {
      const bb = text.getBBox();
      return {
        x: d.x + bb.x - SLACK, y: d.y + bb.y + shift - SLACK,
        w: bb.width + SLACK * 2, h: bb.height + SLACK * 2,
      };
    }

    function deoverlapLabels() {
      if (!nodeSel) return;
      // Start from a clean slate: last pass's suppressions are re-decided here.
      suppressed.clear();
      applyLabels();
      const cx = width / 2, cy = height / 2;
      const subjects = [];
      const others = [];
      nodeSel.each(function (d) {
        if (!Number.isFinite(d.x)) return;
        const text = this.querySelector('.net-label');
        if (!text) return;
        if (d.subject) subjects.push({ d, text, key: Math.atan2(d.y - cy, d.x - cx) });
        else if (text.getAttribute('opacity') === '1') others.push({ d, text, key: -d.degree });
      });
      subjects.sort((a, b) => a.key - b.key);
      others.sort((a, b) => a.key - b.key);
      const items = subjects.concat(others);
      if (items.length < 2) return;
      // The marks themselves are obstacles too — a name printed across a company
      // square reads no better than one printed across another name. Their boxes
      // are arithmetic, so this costs nothing.
      const placed = [];
      for (const n of nodes) {
        if (!Number.isFinite(n.x)) continue;
        const r = radius(n);
        placed.push({ id: n.id, x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 });
      }
      // Landing on a name already placed costs more than landing on a mark, and
      // landing on a subject's name costs more than anything: when the placer
      // has to choose the least bad slot, that ordering is what it obeys.
      const clashes = (box, own) => {
        let n = 0;
        for (const p of placed) {
          if (p.id === own || !overlap(p, box)) continue;
          n += p.subjectLabel ? 100 : p.label ? 10 : 1;
        }
        return n;
      };
      for (const it of items) {
        const r = radius(it.d);
        const below = r + 12;
        // Tried in order of preference: under the node, over it, then a line
        // further out on each side. The first clear slot wins; if every slot is
        // contested the least bad one does, so a name never disappears.
        const slots = [below, -(r + 7), below + 13, -(r + 20)];
        let best = null;
        try {
          for (const y of slots) {
            it.text.setAttribute('y', y);
            const box = labelBox(it.d, it.text, 0);
            const hit = clashes(box, it.d.id);
            if (!best || hit < best.hit) best = { y, box, hit };
            if (!hit) break;
          }
          it.text.setAttribute('y', best.y);
        } catch { return; }
        // A subject's name is never the one that gets printed over: a satellite
        // that cannot get out of its way stands down until the reader hovers it.
        if (!it.d.subject && it.d.id !== state.lens && best.hit &&
            placed.some(p => p.subjectLabel && overlap(p, best.box))) {
          suppressed.add(it.d.id);
          continue;
        }
        best.box.id = it.d.id;
        best.box.label = true;
        best.box.subjectLabel = !!it.d.subject;
        // A subject's name claims a slightly wider berth than the glyph box
        // `getBBox` reports: its 4 px halo is not in that measurement, and a
        // satellite name tucked right against it still reads as a collision.
        if (best.box.subjectLabel) {
          best.box.x -= 4; best.box.y -= 4; best.box.w += 8; best.box.h += 8;
        }
        placed.push(best.box);
      }
      applyLabels();
    }

    // Every automatic fit goes through here. Framing a web that is still flying
    // apart just frames the wrong thing, so it waits for the simulation to calm
    // down (and gives up after ~3 s rather than chasing a graph that never
    // settles, e.g. while the tab is hidden and rAF is throttled to a stop).
    function fitWhenSettled(duration = 700, waited = 0) {
      if (!stage.isConnected) return;
      if (sim.alpha() >= 0.3 && waited < 3000) {
        const again = setTimeout(() => fitWhenSettled(duration, waited + 150), 150);
        timers.push(again);
        return;
      }
      frame(duration);
    }

    // Lay the names out, then frame. Both are idempotent: the de-overlap resets
    // every subject label to its default side before it decides again.
    function frame(duration) {
      deoverlapLabels();
      fit(duration);
    }

    function pulse(n) {
      root.append('circle')
        .attr('cx', n.x).attr('cy', n.y).attr('r', radius(n) + 3)
        .attr('fill', 'none').attr('stroke', t.teal).attr('stroke-width', 3)
        .attr('opacity', 0.95)
        .transition().duration(900).ease(d3.easeCubicOut)
        .attr('r', radius(n) + 44).attr('opacity', 0).remove();
    }

    function centreOn(id) {
      const n = nodes.find(x => x.id === id);
      if (!n || !Number.isFinite(n.x)) return;
      svg.transition().duration(600)
        .call(zoom.transform,
          d3.zoomIdentity.translate(width / 2, height / 2).scale(1.6).translate(-n.x, -n.y))
        .on('end', () => pulse(n));
    }

    // ---- drag -------------------------------------------------------------------
    const drag = d3.drag()
      .on('start', (ev, d) => {
        dragging = false;
        if (!ev.active) sim.alphaTarget(0.28).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (ev, d) => { dragging = true; d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        if (!(mode === 'focus' && d.id === focusId)) { d.fx = null; d.fy = null; }
        const clear = setTimeout(() => { dragging = false; }, 0);
        timers.push(clear);
      });

    // ---- node marks --------------------------------------------------------------
    // Every mark is a circle. A wide, faint stroke just outside the rim stands in
    // for a glow: an SVG filter on every node at rest would cost a few hundred
    // filtered elements and make dragging stutter, so the real bloom is kept for
    // the handful of marks under the pointer.
    // The halo sits this far outside the mark, and the inner core is this fraction
    // of it. Both the enter branch (which draws the glyph) and the update branch
    // (which has to resize it after a double-click flips `d.hub`) read them here,
    // so a hub's +3px cannot move one and leave the other behind.
    const haloGap = d => (d.subject || d.type === 'issue' ? 3 : d.type === 'person' ? 1.8 : 2.2);
    const coreRadius = (d, r) => (d.type === 'issue' ? r * 0.62 : d.type === 'property' ? r * 0.45 : 1.2);

    function halo(sel, r, color, width, opacity) {
      sel.append('circle').attr('class', 'net-halo')
        .attr('r', r).attr('fill', 'none')
        .attr('stroke', color).attr('stroke-width', width).attr('stroke-opacity', opacity);
    }

    // A satellite is either a solid bright dot (a person) or a hollow ring — a
    // 1.6 px rim in its own colour on near-black glass, with a centre dot for a
    // company, a filled pupil for a property and a second ring for an issue.
    // The red badge: a small dot on the shoulder of any mark that is tied to an
    // issue — the entity named on it, the member who voted on it, the officer
    // of that entity — so the issue's footprint reads across the whole web.
    function badge(sel, d, r) {
      if (!d.issueTied || d.type === 'issue') return;
      sel.append('circle').attr('class', 'net-badge')
        .attr('cx', r * 0.75).attr('cy', -r * 0.75).attr('r', d.type === 'person' ? 1.8 : 2.2)
        .attr('fill', t.red).attr('stroke', '#070b11').attr('stroke-width', 0.8)
        .attr('pointer-events', 'none');
    }

    function drawSatellite(sel, d, r) {
      const c = colourOf(d);
      const isIssue = d.type === 'issue';
      if (!isIssue) {
        sel.append('circle').attr('class', 'net-bloom').attr('pointer-events', 'none')
          .attr('r', bloomRadius(d, r)).attr('fill', bloomOf(d));
      }
      if (d.type === 'person') {
        halo(sel, r + haloGap(d), c, 2.2, 0.24);
        sel.append('circle').attr('class', 'mark').attr('r', r).attr('fill', c);
        badge(sel, d, r);
        return;
      }
      halo(sel, r + haloGap(d), c, isIssue ? 4 : 3.5, 0.2);
      sel.append('circle').attr('class', 'mark').attr('r', r)
        .attr('fill', RING_FILL)
        .attr('stroke', c).attr('stroke-width', 1.3)
        .attr('filter', isIssue ? 'url(#net-glow-issue)' : null);
      const core = sel.append('circle').attr('class', 'core').attr('pointer-events', 'none')
        .attr('r', coreRadius(d, r));
      if (isIssue) {
        core.attr('fill', 'none')
          .attr('stroke', c).attr('stroke-width', 1.2).attr('stroke-opacity', 0.9);
      } else {
        core.attr('fill', c).attr('fill-opacity', 0.9);
      }
      badge(sel, d, r);
    }

    // A subject is an avatar: a halo, a bloom, a bright ring, a gradient disc,
    // its initials, and a ring that breathes out of it every 3.2 s.
    function drawSubject(sel, d, r) {
      const c = colourOf(d);
      halo(sel, r + haloGap(d), c, 4.5, 0.16);
      sel.append('circle').attr('class', 'net-breathe')
        .attr('r', r).attr('fill', 'none')
        .attr('stroke', c).attr('stroke-width', 1.2);
      sel.append('circle').attr('class', 'mark')
        .attr('r', r)
        .attr('fill', fillOf(d))
        .attr('stroke', c).attr('stroke-opacity', 0.9).attr('stroke-width', 1.6)
        .attr('filter', restFilter(d));
      sel.append('text').attr('class', 'net-initials')
        .attr('text-anchor', 'middle').attr('dy', '0.36em')
        .attr('font-size', 9).attr('font-weight', 800).attr('fill', '#04121d')
        .text(initials(d.label));
      badge(sel, d, r);
    }

    // Recolour a drawn mark in place for the current colour mode and lens, so a
    // switch never rebuilds the web or moves a node. Also redraws the two
    // mode-only extras: the owner ring round a shared node and the lens pulse.
    const ownerArc = d3.arc();
    function paintNode(sel, d) {
      const c = colourOf(d);
      const r = radius(d);
      const scaleG = sel.select('.net-scale');
      sel.select('.net-bloom').attr('fill', bloomOf(d));
      sel.select('.net-halo').attr('stroke', c);
      if (d.subject) {
        sel.select('.net-breathe').attr('stroke', c);
        sel.select('.mark').attr('fill', fillOf(d)).attr('stroke', c);
      } else if (d.type === 'person') {
        sel.select('.mark').attr('fill', c);
      } else {
        sel.select('.mark').attr('stroke', c);
        const core = sel.select('.core');
        if (d.type === 'issue') core.attr('stroke', c); else core.attr('fill', c);
      }

      scaleG.selectAll('.net-owners').remove();
      const own = owners.get(d.id) || [];
      if (colourMode === 'cluster' && !d.subject && own.length > 1) {
        const ringR = r + haloGap(d) + 1.5;
        const segs = own.slice(0, 6);
        const step = (Math.PI * 2) / segs.length;
        const gap = segs.length > 1 ? Math.min(0.35, step * 0.18) : 0;
        const g = scaleG.append('g').attr('class', 'net-owners');
        segs.forEach((o, i) => {
          g.append('path')
            .attr('d', ownerArc({
              innerRadius: ringR - 0.45, outerRadius: ringR + 0.45,
              startAngle: i * step + gap / 2, endAngle: (i + 1) * step - gap / 2,
            }))
            .attr('fill', hues.get(o) || t.mut2);
        });
      }

      scaleG.selectAll('.net-lens-pulse').remove();
      if (lensHops && lensHops.get(d.id) === 0) {
        scaleG.insert('circle', ':first-child').attr('class', 'net-lens-pulse')
          .attr('r', r + 3).attr('fill', 'none')
          .attr('stroke', t.red).attr('stroke-width', 1.6);
      }
    }

    function paintLinks() {
      if (!linkSel) return;
      linkSel.attr('stroke', strokeOf).attr('marker-end', arrowOf);
    }

    // Cluster legend rows are the subjects in this web, in hue order.
    function updateLegend() {
      const box = legend.querySelector('.net-legend-nodes');
      if (!box) return;
      if (colourMode !== 'cluster') { box.innerHTML = typeLegendRows(t); return; }
      const byId = new Map(nodes.map(n => [n.id, n]));
      box.innerHTML = clusterLegendRows([...hues].map(([id, hue]) =>
        ({ label: byId.has(id) ? byId.get(id).label : id, hue })));
    }

    // Owners, hues and the per-hue arrowheads for the current web.
    function computeCluster() {
      const subjectIds = nodes.filter(n => n.subject).map(n => n.id);
      hues = subjectHues(subjectIds);
      owners = clusterOwners(nodes.map(n => n.id), links, subjectIds);
      const key = [...hues.keys()].join('|');
      if (key !== markerKey) {
        markerKey = key;
        defs.selectAll('marker.net-arrow-cl').remove();
        hueIndex.clear();
        [...hues].forEach(([id, hue], i) => {
          hueIndex.set(id, i);
          arrowMarker('net-arrow-h' + i, hue, 'net-arrow-cl');
        });
        arrowMarker('net-arrow-n', NEUTRAL_TIE, 'net-arrow-cl');
      }
    }

    // The lens only lights a web the issue is actually in.
    function computeLens() {
      lensHops = state.lens && nodes.some(n => n.id === state.lens)
        ? hopsFrom(state.lens, links, 2) : null;
      if (!lensSelect) return;
      const inWeb = new Set(nodes.filter(n => n.type === 'issue').map(n => n.id));
      lensSelect.querySelectorAll('option').forEach(o => {
        if (!o.value) return;
        o.textContent = (o.dataset.title || o.value) + (inWeb.has(o.value) ? '' : ' (not in this web)');
      });
    }

    function updateCounts() {
      const counts = { person: 0, entity: 0, property: 0, issue: 0 };
      for (const n of nodes) if (counts[n.type] != null) counts[n.type]++;
      const stat = (v, label) => `<span class="net-stat"><b>${v}</b> ${label}</span>`;
      let lensPill = '';
      if (lensHops) {
        let one = 0, two = 0;
        for (const h of lensHops.values()) {
          if (h === 1) one++;
          if (h >= 1 && h <= 2) two++;
        }
        lensPill = `<span class="net-stat lens"><b>${one}</b> within 1 hop · <b>${two}</b> within 2</span>`;
      } else if (state.lens) {
        lensPill = '<span class="net-stat lens">Issue lens: not in this web</span>';
      }
      countsEl.innerHTML = lensPill +
        stat(counts.person, 'people') + stat(counts.entity, 'companies') +
        stat(counts.property, 'properties') + stat(counts.issue, 'issues') +
        stat(links.length, 'ties');
    }

    // A colour-mode or lens switch: recolour everything in place.
    function repaint() {
      if (!nodeSel) return;
      nodeSel.each(function (d) { paintNode(d3.select(this), d); });
      paintLinks();
      drawHulls();
      updateLegend();
      updateCounts();
      applyFocus(hoverNode, hoverLink);
      deoverlapLabels();
    }

    // ---- build / rebuild ---------------------------------------------------------
    function build(keepPositions) {
      if (keepPositions) savePositions();

      const kinds = state.kinds.size === ALL_KINDS.length ? null : new Set(state.kinds);
      const graph = buildGraph(PT, {
        focus: focusId || null,
        depth: state.depth,
        expanded: [...state.expanded],
        kinds,
      });
      nodes = graph.nodes;
      links = graph.links;

      adj = new Map();
      for (const l of links) {
        const a = endId(l.source), b = endId(l.target);
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
      }

      // Who carries the red badge: everything one hop from an issue, plus the
      // people one hop from those entities (the officers and owners behind a
      // company named on the issue). Recomputed every build, so a tie filter
      // that hides the issue's ties also hides the badges it justified.
      const byIdTied = new Map(nodes.map(n => [n.id, n]));
      for (const n of nodes) n.issueTied = false;
      for (const n of nodes) {
        if (n.type !== 'issue') continue;
        for (const a of (adj.get(n.id) || [])) {
          const first = byIdTied.get(a);
          if (first) first.issueTied = true;
          // Only a company or a parcel carries the badge onward: a member's own
          // vote does not badge their treasurer or their relatives.
          if (!first || first.type === 'person') continue;
          for (const b of (adj.get(a) || [])) {
            const second = byIdTied.get(b);
            // The second hop is people only: a company two hops from an issue
            // is just another company the officer sits on.
            if (second && second.type === 'person') second.issueTied = true;
          }
        }
      }

      // Reuse the settled coordinates by id so a filter change or an expansion
      // keeps the layout exactly where the reader left it.
      const cx = width / 2, cy = height / 2;
      for (const n of nodes) {
        const p = state.positions.get(n.id);
        if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy; }
      }
      if (mode === 'focus') {
        const f = nodes.find(n => n.id === focusId);
        if (f) { f.x = cx; f.y = cy; f.fx = cx; f.fy = cy; }
      }
      // On a rebuild, newly arrived nodes start beside a neighbour that already
      // has a place (d3 would otherwise spiral them out from the SVG's origin,
      // i.e. the top-left corner, and they would swing across the whole web).
      if (keepPositions) {
        const placed = new Map();
        for (const n of nodes) if (Number.isFinite(n.x)) placed.set(n.id, n);
        for (const n of nodes) {
          if (Number.isFinite(n.x)) continue;
          let host = null;
          for (const nb of (adj.get(n.id) || [])) {
            if (placed.has(nb)) { host = placed.get(nb); break; }
          }
          const angle = Math.random() * Math.PI * 2;
          const away = 30 + Math.random() * 40;
          n.x = (host ? host.x : cx) + Math.cos(angle) * away;
          n.y = (host ? host.y : cy) + Math.sin(angle) * away;
          n.vx = 0; n.vy = 0;
        }
      }

      computeCluster();
      computeLens();
      updateCounts();
      updateLegend();

      const sparse = nodes.length < 2;
      emptyBox.hidden = !sparse;
      svg.attr('opacity', sparse ? 0 : 1);
      legend.hidden = sparse;

      // A tie that changed kind or ends keeps its flow line stale, and the flow
      // group is hover-only anyway, so it is emptied on every rebuild.
      showFlow([]);

      // Everything that is new this build is collected so the entrance wave can
      // be run as one staggered d3 transition below.
      const freshNodes = [];
      const freshLinks = [];

      linkSel = gLinks.selectAll('line').data(links, d => d.id).join(
        enter => enter.append('line').attr('class', 'net-link')
          .attr('fill', 'none').attr('opacity', 0)
          .each(function () { freshLinks.push(this); }),
        update => update,
        exit => exit.remove(),
      )
        .attr('stroke', strokeOf)
        .attr('stroke-width', restLinkWidth)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', l => DASH[l.confidence] || null)
        .attr('marker-end', arrowOf);

      // An invisible fat stroke under each tie so thin links are still hoverable.
      hitSel = gHits.selectAll('line').data(links, d => d.id).join('line')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 10)
        .style('cursor', 'help')
        .on('pointerenter', (ev, l) => {
          if (dragging) return;
          applyFocus(null, l.id);
          showTip(linkTipHtml(l, ix), ev, true, strokeOf(l));
        })
        .on('pointermove', ev => { if (!tip.hidden) positionTip(ev); })
        .on('pointerleave', hideTipSoon);

      nodeSel = gNodes.selectAll('g.net-node').data(nodes, d => d.id).join(
        enter => {
          const g = enter.append('g').attr('class', 'net-node').attr('opacity', 0);
          g.each(function (d, i) {
            freshNodes.push(this);
            const sel = d3.select(this);
            const r = radius(d);
            const delay = Math.min(ENTER_STAGGER_CAP, i * ENTER_STAGGER) + 'ms';
            sel.style('transition-delay', delay);
            // The scale wrapper carries both the entrance pop and the hover
            // lift; the group's own transform belongs to the simulation.
            const inner = sel.append('g').attr('class', 'net-scale')
              .style('transform', 'scale(.55)')
              .style('transition-delay', delay);
            if (d.subject) drawSubject(inner, d, r); else drawSatellite(inner, d, r);
            const named = d.subject || d.type === 'issue';
            sel.append('text').attr('class', 'net-label')
              .attr('text-anchor', 'middle')
              .attr('y', r + 12)
              .attr('font-size', d.subject ? 11.5 : d.type === 'issue' ? 10.5 : 9)
              .attr('font-weight', d.subject ? 700 : d.type === 'issue' ? 700 : 600)
              .attr('letter-spacing', d.subject ? '.1px' : null)
              .attr('stroke-width', d.subject ? 4 : 3)
              .attr('fill', d.type === 'issue' ? '#ffb4b4' : d.subject ? t.ink : '#b9c7d8')
              // Satellite names sit a step behind the subject names in the
              // reading order, so they are dimmed rather than merely smaller.
              .attr('fill-opacity', named ? null : 0.85)
              .attr('opacity', 0)
              .text(truncate(d.label));
          });
          return g;
        },
        // A double-click on a hub puts it in `state.expanded`, which clears `d.hub`
        // and takes 3px off `radius(d)` — the radius `ticked` trims the ties to
        // and the label placer measures. The circles were sized once at enter, so
        // without this they stay 3px out of step with it for the rest of the
        // session.
        update => update.each(function (d) {
          const sel = d3.select(this);
          const r = radius(d);
          sel.select('.mark').attr('r', r);
          sel.select('.net-halo').attr('r', r + haloGap(d));
          sel.select('.net-breathe').attr('r', r);
          const core = sel.select('.core');
          if (!core.empty()) core.attr('r', coreRadius(d, r));
          sel.select('.net-bloom').attr('r', bloomRadius(d, r));
          sel.select('.net-badge').remove();
          badge(sel.select('.net-scale'), d, r);
          sel.select('.net-label').attr('y', r + 12);
        }),
        exit => exit.remove(),
      );

      nodeSel
        .call(drag)
        .on('pointerenter', (ev, d) => {
          if (dragging) return;
          applyFocus(d.id, null);
          showTip(nodeTipHtml(d, ix), ev, false, colourOf(d));
        })
        .on('pointermove', ev => { if (!tip.hidden) positionTip(ev); })
        .on('pointerleave', hideTipSoon)
        .on('click', (ev, d) => {
          ev.stopPropagation();
          if (dragging) return;
          clearTimeout(clickTimer);
          // Held briefly so a double-click expands instead of pivoting.
          clickTimer = setTimeout(() => ctx.select(d.id), 220);
          timers.push(clickTimer);
        })
        .on('dblclick', (ev, d) => {
          ev.preventDefault();
          ev.stopPropagation();
          clearTimeout(clickTimer);
          if (state.expanded.has(d.id)) state.expanded.delete(d.id);
          else state.expanded.add(d.id);
          build(true);
        });

      labelSel = nodeSel.select('.net-label');
      markSel = nodeSel.select('.mark');
      // Owners can change with any rebuild (a filter, an expansion), so every
      // mark is repainted, not only the new ones.
      nodeSel.each(function (d) { paintNode(d3.select(this), d); });
      drawHulls();

      sim.nodes(nodes);
      sim.force('link').links(links);
      if (mode === 'web') {
        const ring = Math.min(width, height) * RING_FRACTION;
        sim.force('radial', d3.forceRadial(d => (d.subject ? ring : 0), cx, cy)
          .strength(d => (d.subject ? 0.8 : d.type === 'issue' ? 0.15 : 0)));
      } else {
        sim.force('radial', null);
      }
      sim.alpha(keepPositions ? 0.35 : 1).restart();

      applyFocus(null, null);

      // Nodes come up from 55 % and transparent, staggered 6 ms apart. The wave
      // is a d3 transition rather than a CSS one so that it runs off the same
      // clock as the simulation and the fits — a CSS transition is driven by the
      // compositor's own timeline, which drifts away from the script's under
      // anything that virtualises time (a throttled background tab, or a
      // headless capture) and leaves the tail of the wave permanently invisible.
      // `.net-in` switches the hover transitions off for the duration so the two
      // do not fight; it is removed when the entrance ends OR is interrupted.
      if (freshNodes.length || freshLinks.length) {
        const delay = (d, i) => Math.min(ENTER_STAGGER_CAP, i * ENTER_STAGGER);
        const unmark = function () { this.classList.remove('net-in'); };
        const nSel = d3.selectAll(freshNodes).classed('net-in', true).attr('opacity', 0);
        const sSel = nSel.select('.net-scale').style('transform', 'scale(.55)');
        const lSel = d3.selectAll(freshLinks).classed('net-in', true).attr('opacity', 0);
        nSel.transition().delay(delay).duration(ENTER_MS)
          .attr('opacity', restNodeOpacity).on('end interrupt', unmark);
        sSel.transition().delay(delay).duration(ENTER_MS)
          .style('transform', 'scale(1)')
          .on('end interrupt', function () { this.style.transform = ''; });
        lSel.transition().delay(delay).duration(ENTER_MS)
          .attr('opacity', restLinkOpacity).on('end interrupt', unmark);
        // A timer, not the animation, is what decides the web is fully on
        // screen. The wave is decoration and rides the frame clock; this rides
        // the task clock, so anywhere the two come apart — a throttled tab, a
        // headless capture with a virtual clock — the graph still ends up
        // complete instead of frozen part-way through arriving.
        const arrive = setTimeout(() => {
          if (!stage.isConnected) return;
          nSel.interrupt();
          sSel.interrupt().style('transform', '');
          lSel.interrupt();
          // Commit the rest state with `.net-in` back on so the CSS transitions
          // are off, force a style flush, then switch them back on: the values
          // are already final, so re-enabling them animates nothing.
          nSel.classed('net-in', true);
          lSel.classed('net-in', true);
          applyFocus(hoverNode, hoverLink);
          svg.node().getBoundingClientRect();
          nSel.classed('net-in', false);
          lSel.classed('net-in', false);
        }, ENTER_STAGGER_CAP + ENTER_MS);
        timers.push(arrive);
      }

      if (!drop.hidden) renderDrop(input.value);
    }

    // ---- header wiring ------------------------------------------------------------
    head.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      const [act, arg] = btn.dataset.act.split(':');
      if (act === 'mode') {
        if (arg === 'web') { if (mode !== 'web') ctx.navigate('#/web'); return; }
        const target = focusId || lastFocusId;
        if (target && mode !== 'focus') ctx.select(target);
        return;
      }
      if (act === 'depth') {
        state.depth = Number(arg);
        wrap.querySelectorAll('[data-act^="depth:"]').forEach(b =>
          b.classList.toggle('on', b.dataset.act === 'depth:' + state.depth));
        build(true);
        // A depth change can multiply the web several times over, so re-frame it
        // once the new ring has had a moment to spread.
        const reframe = setTimeout(() => fitWhenSettled(700), 1100);
        timers.push(reframe);
        return;
      }
      if (act === 'kind') {
        if (state.kinds.has(arg)) state.kinds.delete(arg); else state.kinds.add(arg);
        btn.classList.toggle('on', state.kinds.has(arg));
        build(true);
        return;
      }
      // All / None: every tie kind on or off at once. None strips the web back
      // to the subjects themselves (a seed is always drawn), so a reader can
      // add one kind of tie at a time and watch what it brings in.
      if (act === 'kinds') {
        state.kinds = new Set(arg === 'all' ? ALL_KINDS : []);
        wrap.querySelectorAll('[data-act^="kind:"]').forEach(b =>
          b.classList.toggle('on', state.kinds.has(b.dataset.act.slice(5))));
        build(true);
        const reframe = setTimeout(() => fitWhenSettled(700), 900);
        timers.push(reframe);
        return;
      }
      // Reset: depth 1, every tie on, labels off, no expansions, and a fresh
      // layout — the same web a first visit to this route draws.
      if (act === 'reset') {
        resetState(state);
        networkTab.render(container, ctx);
        return;
      }
      // Type / Cluster: a view preference, recoloured in place.
      if (act === 'colour') {
        colourMode = arg === 'cluster' ? 'cluster' : 'type';
        wrap.querySelectorAll('[data-act^="colour:"]').forEach(b =>
          b.classList.toggle('on', b.dataset.act === 'colour:' + colourMode));
        repaint();
        return;
      }
      if (act === 'labels') {
        state.labelsAll = !state.labelsAll;
        btn.classList.toggle('on', state.labelsAll);
        applyLabels();
        return;
      }
      if (act === 'fit') fit();
    });

    if (lensSelect) {
      lensSelect.addEventListener('change', () => {
        state.lens = lensSelect.value;
        lensSelect.classList.toggle('on', !!state.lens);
        computeLens();
        repaint();
      });
    }

    // ---- search --------------------------------------------------------------------
    function matches(q) {
      const needle = q.trim().toLowerCase();
      if (!needle) return [];
      return nodes
        .filter(n => String(n.label || '').toLowerCase().includes(needle))
        .sort((a, b) => (b.subject ? 1 : 0) - (a.subject ? 1 : 0) || b.degree - a.degree)
        .slice(0, 10);
    }
    function renderDrop(q) {
      const hits = matches(q);
      if (!hits.length) { drop.hidden = true; drop.innerHTML = ''; return; }
      drop.innerHTML = hits.map(n =>
        `<div class="net-hit" data-id="${escapeHtml(n.id)}"><span>${escapeHtml(truncate(n.label))}</span>` +
        `<span class="t">${escapeHtml(n.subject ? 'subject' : n.type)}</span></div>`).join('');
      drop.hidden = false;
    }
    input.addEventListener('input', () => renderDrop(input.value));
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      const first = matches(input.value)[0];
      if (!first) return;
      centreOn(first.id);
      drop.hidden = true;
    });
    input.addEventListener('blur', () => {
      const timer = setTimeout(() => { drop.hidden = true; }, 160);
      timers.push(timer);
    });
    input.addEventListener('focus', () => renderDrop(input.value));
    drop.addEventListener('mousedown', ev => {
      const hit = ev.target.closest('[data-id]');
      if (!hit) return;
      ev.preventDefault();
      centreOn(hit.dataset.id);
      drop.hidden = true;
    });

    // ---- window listeners -------------------------------------------------------------
    // The shell never tells a tab it is being replaced, so both listeners check
    // that the stage is still on the document and retire themselves if it is
    // not (belt and braces: `teardown()` aborts the same signal on the next
    // render).
    function orphaned() {
      if (stage.isConnected) return false;
      listeners.abort();
      sim.stop();
      releaseFullScreen(stage);
      return true;
    }

    let resizeTimer = 0;
    const onResize = () => {
      if (orphaned()) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        sizeStage();
        width = stage.clientWidth || width;
        height = stage.clientHeight || height;
        svg.attr('viewBox', `0 0 ${width} ${height}`);
        sim.force('center', d3.forceCenter(width / 2, height / 2));
        if (mode === 'web') {
          const ring = Math.min(width, height) * RING_FRACTION;
          sim.force('radial', d3.forceRadial(d => (d.subject ? ring : 0), width / 2, height / 2)
            .strength(d => (d.subject ? 0.8 : d.type === 'issue' ? 0.15 : 0)));
        } else {
          const f = nodes.find(n => n.id === focusId);
          if (f) { f.fx = width / 2; f.fy = height / 2; }
        }
        sim.alpha(0.3).restart();
      }, 180);
      timers.push(resizeTimer);
    };
    window.addEventListener('resize', onResize, { signal: listeners.signal });

    // A hidden tab gets no animation frames, so the simulation is frozen and any
    // fit that fired while it was away framed a half-finished layout. Re-frame
    // when the reader comes back.
    const onVisible = () => {
      if (orphaned()) return;
      if (document.visibilityState !== 'visible') return;
      if (userZoomed) return; // respect a reader's deliberate zoom, same as the settle re-fit
      const back = setTimeout(() => fitWhenSettled(600), 120);
      timers.push(back);
    };
    document.addEventListener('visibilitychange', onVisible, { signal: listeners.signal });

    // ---- go ---------------------------------------------------------------------------
    let firstSettle = true;
    build(false);
    // Fit once at 1.2 s so the web is framed while it is still spreading out,
    // then once more when the layout first settles — unless the reader has
    // already taken hold of the zoom.
    sim.on('end', () => {
      savePositions();
      drawHulls();
      if (firstSettle && !userZoomed) { firstSettle = false; fitWhenSettled(600); return; }
      // Later settles (a depth change, a filter, an expansion) do not re-frame —
      // that would yank the view out from under the reader — but the names do
      // have to be laid out again against where the nodes actually stopped.
      deoverlapLabels();
    });
    // These two are deliberately NOT gated on the alpha. A twelve-subject web
    // takes several seconds to finish spreading, and a graph that is still
    // growing will walk straight out of a frame taken early — so the camera
    // follows it out at 1.2 s and again at 2.8 s, and `sim.on('end')` above
    // takes the final, settled frame.
    for (const at of [1200, 2800]) {
      const t0 = setTimeout(() => { if (stage.isConnected) frame(700); }, at);
      timers.push(t0);
    }
  },
};

export default networkTab;
