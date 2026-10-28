// The island map: a Leaflet map over Esri's dark-gray canvas tiles with five toggleable
// layers (candidates, ties, issues, money, districts). No DOM outside `el`;
// no globals besides the `L` and `PT_GEO` the page/Leaflet script provide.
import { escapeHtml, money, dateText, relLabel, linkKind } from './lib/format.mjs';

const CENTER = [25.6915, -80.1625];

const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

// Resolve the actual colours behind the pt.css tokens once, so the map's
// canvas/SVG paints (which cannot read CSS variables the way DOM styles can)
// stay in lockstep with the page's palette.
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    teal: v('--teal', '#2dd4bf'),
    blue: v('--blue', '#46a6ff'),
    green: v('--green', '#59d39a'),
    red: v('--red', '#ef6b6b'),
    amber: v('--amber', '#f5b342'),
    violet: v('--violet', '#8b7cff'),
    mut2: v('--mut2', '#6c7c90'),
  };
}

const KIND_COLOR_KEY = { candidate: 'teal', official: 'blue', staff: 'green' };
const LINK_COLOR_KEY = {
  money: 'amber', business: 'violet', property: 'green', lobbying: 'blue',
  staff: 'teal', vote: 'mut2', issue: 'red', family: 'mut2', other: 'mut2',
};

// A small deterministic hash of a string id, used to jitter money-layer dots
// so two contributions reported at the same address don't sit on top of
// each other. Not cryptographic — just stable across renders.
function hashOf(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function jitterFor(id) {
  const h = hashOf(id);
  const a = Math.abs(h) % 1000;
  const b = Math.abs((h >> 5) ^ (h << 3)) % 1000;
  return {
    dLat: ((a / 999) * 2 - 1) * 0.00036, // ~ +/- 40 m
    dLon: ((b / 999) * 2 - 1) * 0.0004,
  };
}

function num(x) {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

function hasFix(addr) {
  return !!addr && num(addr.lat) != null && num(addr.lon) != null;
}

function dotIconHtml(color) {
  return `<span style="display:block;width:12px;height:12px;border-radius:50%;background:${color};border:1px solid rgba(255,255,255,.7);"></span>`;
}
function squareIconHtml(color, diamond) {
  const rotate = diamond ? 'transform:rotate(45deg);' : '';
  const size = diamond ? 9 : 12;
  return `<span style="display:block;width:${size}px;height:${size}px;background:${color};border:1px solid rgba(255,255,255,.7);${rotate}"></span>`;
}
function hexIconHtml(color) {
  return `<span style="display:block;width:16px;height:16px;background:${color};border:1px solid rgba(255,255,255,.7);clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);"></span>`;
}

export default function createIslandMap(el, PT, ix, { onSelect } = {}) {
  const L = window.L;
  const C = readPalette();
  const tables = PT.tables || {};

  const map = L.map(el, {
    zoomControl: false,
    scrollWheelZoom: false,
    minZoom: 12,
    maxZoom: 18,
  }).setView(CENTER, 14);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // The basemap is Esri's dark-gray canvas: a base layer plus a labels
  // layer on top, neither of which needs an API key. Esri's URL template
  // puts y before x.
  const ESRI_TILE_OPTS = {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS',
    maxNativeZoom: 16,
    maxZoom: 18,
  };
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', ESRI_TILE_OPTS).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', ESRI_TILE_OPTS).addTo(map);

  // Scroll-wheel zoom stays off (so the page can still scroll over the map)
  // until the visitor deliberately clicks into the map.
  map.once('click', () => map.scrollWheelZoom.enable());

  // A finger is the same problem as the wheel: on a phone the map is most of the
  // screen, and one-finger drag swallowed the page's scroll. Touch screens start
  // with drag and pinch off; a button turns them on, and back off when done.
  const touchy = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    (navigator.maxTouchPoints > 0 && el.clientWidth < 780);
  if (touchy) {
    const Lock = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const btn = L.DomUtil.create('button', 'map-lock');
        btn.type = 'button';
        L.DomEvent.disableClickPropagation(btn);
        const set = on => {
          for (const h of [map.dragging, map.touchZoom]) on ? h.enable() : h.disable();
          btn.classList.toggle('on', on);
          btn.textContent = on ? '✓ Done moving' : '☝ Tap to move the map';
        };
        let moving = false;
        set(moving);
        L.DomEvent.on(btn, 'click', () => set(moving = !moving));
        return btn;
      },
    });
    new Lock().addTo(map);
  }

  const layers = {
    candidates: L.layerGroup(),
    ties: L.layerGroup(),
    issues: L.layerGroup(),
    money: L.layerGroup(),
    districts: L.layerGroup(),
  };
  layers.candidates.addTo(map); // candidates on by default

  const candidateMarkers = new Map(); // person_id -> circleMarker (the main dot, not the glow)

  function officeOf(personId) {
    const cand = (tables.candidacies || []).find(c => c.person_id === personId);
    if (cand && cand.office) return cand.office;
    const terms = (tables.terms || []).filter(t => t.person_id === personId)
      .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
    const latest = terms[terms.length - 1];
    if (latest) {
      const seat = (tables.seats || []).find(s => s.seat_id === latest.seat_id);
      if (seat && seat.label) return seat.label;
    }
    return '';
  }

  // ---- Candidates layer -------------------------------------------------
  function buildCandidates() {
    for (const p of ix.subjects) {
      const addr = ix.residenceOf(p.person_id);
      if (!hasFix(addr)) continue;
      const lat = num(addr.lat), lon = num(addr.lon);
      const colorKey = KIND_COLOR_KEY[p.kind] || 'mut2';
      const color = C[colorKey];

      const glow = L.circleMarker([lat, lon], {
        radius: 15, stroke: false, fillColor: color, fillOpacity: 0.15,
      }).addTo(layers.candidates);
      const marker = L.circleMarker([lat, lon], {
        radius: 9, color: '#ffffff', weight: 2, opacity: 0.6,
        fillColor: color, fillOpacity: 0.9,
      }).addTo(layers.candidates);
      candidateMarkers.set(p.person_id, marker);
      void glow;

      const office = officeOf(p.person_id);
      marker.bindTooltip(`${escapeHtml(p.full_name)}${office ? ' — ' + escapeHtml(office) : ''}`);

      const profileHref = `app.html#/person/${encodeURIComponent(p.person_id)}`;
      const popup = `
        <div class="popup-person">
          <strong>${escapeHtml(p.full_name)}</strong>
          <span class="pill ${escapeHtml(p.kind)}">${escapeHtml(p.kind)}</span>
          ${office ? `<div>${escapeHtml(office)}</div>` : ''}
          <div>${escapeHtml(ix.addressText(addr.address_id))}</div>
          <div><a href="${profileHref}" target="_blank" rel="noopener">Open profile</a></div>
          <button type="button" class="chip show-ties">Show ties</button>
        </div>`;
      marker.bindPopup(popup);
      marker.on('popupopen', e => {
        const root = e.popup.getElement();
        const btn = root && root.querySelector('.show-ties');
        if (btn) btn.addEventListener('click', () => { if (onSelect) onSelect(p.person_id); });
      });
    }
  }

  // ---- Ties layer (built fresh for whichever person is selected) --------
  function showTies(personId) {
    layers.ties.clearLayers();
    const profile = ix.profileOf(personId);
    if (!profile) return;
    const residence = ix.residenceOf(personId);
    const ties = profile.ties || [];

    for (const tie of ties) {
      let entityId = null;
      if (tie.from_type === 'person' && tie.from_id === personId && tie.to_type === 'entity') entityId = tie.to_id;
      else if (tie.to_type === 'person' && tie.to_id === personId && tie.from_type === 'entity') entityId = tie.from_id;
      if (!entityId) continue;

      const entity = ix.entities.get(entityId);
      if (!entity || !entity.principal_address_id) continue;
      const addr = ix.addresses.get(entity.principal_address_id);
      if (!addr || !addr.line1 || !hasFix(addr)) continue;

      const lat = num(addr.lat), lon = num(addr.lon);
      let color = C.violet, diamond = false;
      if (entity.type === 'property') { color = C.green; diamond = true; }
      if (tie.issue_id) color = C.red;

      const icon = L.divIcon({
        className: '', html: squareIconHtml(color, diamond), iconSize: [12, 12], iconAnchor: [6, 6],
      });
      const marker = L.marker([lat, lon], { icon }).addTo(layers.ties);
      const src = ix.sourceOf(tie.source_id);
      const srcLink = src ? `<a class="src" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.title)}</a>` : '';
      marker.bindPopup(`
        <div class="popup-tie">
          <strong>${escapeHtml(entity.name)}</strong>
          <div>${escapeHtml(relLabel(tie.rel_type))}</div>
          ${srcLink}
        </div>`);

      if (residence && hasFix(residence)) {
        const confidence = tie.confidence;
        const dashArray = confidence === 'reported' ? '6 6' : confidence === 'inferred' ? '2 6' : null;
        const lineColor = C[LINK_COLOR_KEY[linkKind(tie.rel_type)] || 'mut2'];
        L.polyline([[num(residence.lat), num(residence.lon)], [lat, lon]], {
          color: lineColor, weight: 2, opacity: 0.85,
          ...(dashArray ? { dashArray } : {}),
        }).addTo(layers.ties);
      }
    }
  }

  // ---- Issues layer -------------------------------------------------------
  function subjectsForIssue(issue) {
    const relatedIds = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
    const personIds = new Set();
    if (relatedIds.length) {
      for (const rel of tables.relationships || []) {
        if (rel.from_type === 'person' && relatedIds.includes(rel.to_id)) personIds.add(rel.from_id);
        if (rel.to_type === 'person' && relatedIds.includes(rel.from_id)) personIds.add(rel.to_id);
      }
    }
    const voteIds = new Set((tables.votes || []).filter(v => v.issue_id === issue.issue_id).map(v => v.vote_id));
    if (voteIds.size) {
      for (const vc of tables.vote_casts || []) {
        if (voteIds.has(vc.vote_id)) personIds.add(vc.person_id);
      }
    }
    return [...personIds];
  }

  function highlightPersons(ids) {
    for (const [pid, marker] of candidateMarkers) {
      marker.setStyle({ weight: ids.includes(pid) ? 4 : 2 });
    }
  }

  function highlightIssue(issueId) {
    const issue = ix.issues.get(issueId);
    if (!issue) return;
    highlightPersons(subjectsForIssue(issue));
  }

  function buildIssues() {
    for (const issue of tables.issues || []) {
      if (!issue.address_id) continue;
      const addr = ix.addresses.get(issue.address_id);
      if (!hasFix(addr)) continue;
      const lat = num(addr.lat), lon = num(addr.lon);
      const icon = L.divIcon({ className: '', html: hexIconHtml(C.red), iconSize: [16, 16], iconAnchor: [8, 8] });
      const marker = L.marker([lat, lon], { icon }).addTo(layers.issues);

      const subjectIds = subjectsForIssue(issue);
      const subjectLinks = subjectIds
        .map(pid => `<a href="app.html#/person/${encodeURIComponent(pid)}" target="_blank" rel="noopener">${escapeHtml(ix.labelOf(pid))}</a>`)
        .join(', ');
      const src = ix.sourceOf(issue.source_id);
      const srcLink = src ? `<a class="src" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.title)}</a>` : '';
      const nextDate = dateText(issue.next_date);
      marker.bindPopup(`
        <div class="popup-issue">
          <strong>${escapeHtml(issue.title)}</strong>
          <div>${escapeHtml(issue.status)}</div>
          ${nextDate ? `<div>Next: ${escapeHtml(nextDate)}</div>` : ''}
          ${subjectLinks ? `<div>${subjectLinks}</div>` : ''}
          ${srcLink}
        </div>`);
      marker.on('click', () => highlightPersons(subjectIds));
    }
  }

  // ---- Money layer --------------------------------------------------------
  function recipientLabel(cn) {
    if (cn.recipient_type === 'candidacy') {
      const pid = ix.personOfCandidacy(cn.recipient_id);
      const name = pid ? ix.labelOf(pid) : '';
      return name ? `${name} campaign` : ix.labelOf(cn.recipient_id);
    }
    return ix.labelOf(cn.recipient_id);
  }

  // A `limited` contributor's own address row is masked to three decimals by the build, but the
  // row they gave on the report can be public for a different reason - a PAC's office, a shared
  // campaign address - and then the full-precision fix would pin them to their doorstep after
  // all. So the masking is re-applied here, on the way to the map, before the jitter.
  const notFullPeople = new Set((tables.people || []).filter(p => p.display_level !== 'full').map(p => p.person_id));

  function buildMoney() {
    for (const cn of tables.contributions || []) {
      const addr = ix.addresses.get(cn.address_id);
      if (!hasFix(addr) || addr.on_island !== 'yes') continue;
      const { dLat, dLon } = jitterFor(cn.contribution_id);
      const blur = cn.contributor_person_id && notFullPeople.has(cn.contributor_person_id);
      const fix = v => (blur ? Number(num(v).toFixed(3)) : num(v));
      const lat = fix(addr.lat) + dLat, lon = fix(addr.lon) + dLon;
      const amount = Number(cn.amount) || 0;
      const radius = 4 + 2 * Math.log10(Math.max(amount, 1));
      const marker = L.circleMarker([lat, lon], {
        radius, stroke: false, fillColor: C.amber, fillOpacity: 0.55,
      }).addTo(layers.money);
      const src = ix.sourceOf(cn.source_id);
      const srcLink = src ? `<a class="src" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.title)}</a>` : '';
      marker.bindPopup(`
        <div class="popup-money">
          <strong>${escapeHtml(cn.name_as_reported)}</strong>
          ${cn.occupation_as_reported ? `<div>${escapeHtml(cn.occupation_as_reported)}</div>` : ''}
          <div>${escapeHtml(titleCase(addr.city))}</div>
          <div>${escapeHtml(money(amount))} · ${escapeHtml(dateText(cn.date))}</div>
          <div>${escapeHtml(recipientLabel(cn))}</div>
          ${srcLink}
        </div>`);
    }
  }

  // ---- Districts layer (Task 11 supplies window.PT_GEO) -------------------
  function buildDistricts() {
    const geo = window.PT_GEO;
    if (!geo) return;
    const defs = [
      ['county_commission', C.blue],
      ['fl_house', C.teal],
      ['fl_senate', C.green],
      ['congress', C.violet],
    ];
    for (const [key, color] of defs) {
      const fc = geo[key];
      if (!fc) continue;
      L.geoJSON(fc, {
        style: { color, weight: 1.5, dashArray: '4 4', fillOpacity: 0 },
        onEachFeature: (feature, lyr) => {
          const label = feature && feature.properties && feature.properties.pt && feature.properties.pt.label;
          if (label) lyr.bindTooltip(escapeHtml(label));
        },
      }).addTo(layers.districts);
    }
  }

  buildCandidates();
  buildIssues();
  buildMoney();
  buildDistricts();

  function setLayer(name, on) {
    const layer = layers[name];
    if (!layer) return;
    if (on) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else if (map.hasLayer(layer)) map.removeLayer(layer);
  }

  return { map, setLayer, showTies, highlightIssue };
}
