// Profile tab: person / entity / issue detail views, plus the subject-cards
// grid shown when nothing is selected.
import { escapeHtml, dateText, money, relLabel } from '../lib/format.mjs';

function srcLink(ix, sourceId) {
  const src = ix.sourceOf(sourceId);
  if (!src) return '';
  const label = src.title || src.source_id;
  return `<a class="src" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

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

function wireNav(container, ctx) {
  container.querySelectorAll('[data-nav]').forEach(node => {
    node.addEventListener('click', e => {
      e.preventDefault();
      ctx.select(node.dataset.nav);
    });
  });
}

// ---- ties (shared by person / entity / limited-person views) ---------------
function groupTies(ties) {
  const order = [];
  const map = new Map();
  for (const t of ties) {
    if (!map.has(t.rel_type)) { map.set(t.rel_type, []); order.push(t.rel_type); }
    map.get(t.rel_type).push(t);
  }
  return order.map(rt => [rt, map.get(rt)]);
}

function tieOtherEnd(tie, selfId) {
  return tie.from_id === selfId ? { id: tie.to_id } : { id: tie.from_id };
}

function tieDatesText(t) {
  const parts = [];
  if (t.start_date) parts.push(dateText(t.start_date) || t.start_date);
  if (t.end_date) parts.push(dateText(t.end_date) || t.end_date);
  return parts.join(' – ');
}

function tiesSection(ties, selfId, ix) {
  if (!ties.length) return '<p class="empty">No ties on file.</p>';
  const groups = groupTies(ties);
  return groups.map(([relType, rows]) => {
    const rowsHtml = rows.map(t => {
      const other = tieOtherEnd(t, selfId);
      const label = escapeHtml(ix.labelOf(other.id));
      const otherLink = `<a href="#" data-nav="${escapeHtml(other.id)}">${label}</a>`;
      const amount = t.amount ? money(t.amount) : '';
      const dates = tieDatesText(t);
      return `<div class="tie-row conf-${escapeHtml(t.confidence || 'inferred')}">
        <div class="tr-main">${otherLink}${t.detail ? ` <span class="tr-detail">— ${escapeHtml(t.detail)}</span>` : ''}${amount ? ` <span class="tr-detail">${escapeHtml(amount)}</span>` : ''}${dates ? ` <span class="tr-detail">${escapeHtml(dates)}</span>` : ''}</div>
        ${srcLink(ix, t.source_id)}
      </div>`;
    }).join('');
    return `<div class="tie-group"><div class="tg-label">${escapeHtml(relLabel(relType))}</div>${rowsHtml}</div>`;
  }).join('');
}

// ---- person profile ----------------------------------------------------------
// A sitting member who is running again is both an official and a candidate. Which they are is
// the ballot's business, not a field on their row: a candidacy in an election still ahead.
export function ballotOffice(PT, personId) {
  const upcoming = new Set((PT.tables.elections || [])
    .filter(e => e.date && e.date >= (PT.meta ? PT.meta.builtDate : ''))
    .map(e => e.election_id));
  const c = (PT.tables.candidacies || []).find(x => x.person_id === personId && upcoming.has(x.election_id));
  // Unopposed at qualifying is elected, not on the ballot.
  if (!c || c.outcome === 'unopposed') return '';
  return c.office || 'the ballot';
}
function termsTable(terms, seatsById, ix) {
  if (!terms.length) return '<p class="empty">No terms on file.</p>';
  const rows = terms.map(t => {
    const seat = seatsById.get(t.seat_id);
    return `<tr><td>${escapeHtml(seat ? seat.label : t.seat_id)}</td><td>${escapeHtml(t.start_date)}</td><td>${escapeHtml(t.end_date)}</td><td>${escapeHtml(t.how)}</td><td>${srcLink(ix, t.source_id)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Seat</th><th>Start</th><th>End</th><th>How</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function candidacyCards(candidacies, ix) {
  return candidacies.map(c => {
    let treasurerHtml = '';
    if (c.treasurer_person_id) {
      const tPerson = ix.people.get(c.treasurer_person_id);
      const name = tPerson ? tPerson.full_name : c.treasurer_person_id;
      treasurerHtml = ix.profileOf(c.treasurer_person_id)
        ? `<a href="#" data-nav="${escapeHtml(c.treasurer_person_id)}">${escapeHtml(name)}</a>`
        : `${escapeHtml(name)} (limited)`;
    }
    return `<div class="card" style="margin-bottom:10px;">
      <div class="row"><b>Office</b>${escapeHtml(c.office)}</div>
      ${treasurerHtml ? `<div class="row"><b>Treasurer</b>${treasurerHtml}</div>` : ''}
      ${c.packet_source_id ? `<div class="row"><b>Packet</b>${srcLink(ix, c.packet_source_id)}</div>` : ''}
    </div>`;
  }).join('');
}

function employmentTable(employment, ix) {
  if (!employment.length) return '<p class="empty">No employment on file.</p>';
  const rows = employment.map(e => {
    const employer = ix.entities.get(e.employer_entity_id);
    const employerName = employer ? employer.name : e.employer_entity_id;
    return `<tr><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.department)}</td><td><a href="#" data-nav="${escapeHtml(e.employer_entity_id)}">${escapeHtml(employerName)}</a></td><td>${srcLink(ix, e.source_id)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Title</th><th>Department</th><th>Employer</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function contributionsTable(contributions, ix) {
  if (!contributions.length) return '<p class="empty">No contributions on file.</p>';
  const rows = contributions.map(c => `<tr><td>${escapeHtml(c.name_as_reported)}</td><td>${escapeHtml(dateText(c.date))}</td><td>${escapeHtml(money(c.amount))}</td><td>${escapeHtml(c.kind)}</td><td>${srcLink(ix, c.source_id)}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Contributor</th><th>Date</th><th>Amount</th><th>Kind</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function votesTable(votes, ix) {
  if (!votes.length) return '<p class="empty">No votes on file.</p>';
  const rows = votes.map(({ cast, vote }) => {
    const issue = ix.issues.get(vote.issue_id);
    const title = issue ? issue.title : vote.item;
    // A vote on no tracked issue (most council items) has nothing to navigate to.
    const label = issue ? `<a href="#" data-nav="${escapeHtml(vote.issue_id)}">${escapeHtml(title)}</a>` : escapeHtml(title);
    return `<tr><td>${label}</td><td>${escapeHtml(dateText(vote.date))}</td><td>${escapeHtml(cast)}</td><td>${escapeHtml(vote.tally)}</td><td>${srcLink(ix, vote.source_id)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Issue</th><th>Date</th><th>Cast</th><th>Tally</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function latestDisclosureSection(disclosures, ix) {
  const years = Object.keys(disclosures || {});
  if (!years.length) return '<p class="empty">No disclosures on file.</p>';
  const maxYear = years.sort((a, b) => Number(a) - Number(b)).slice(-1)[0];
  const sections = disclosures[maxYear];
  const cards = Object.keys(sections).map(section => {
    const rows = sections[section].map(r => `<div class="di-row"><b>${escapeHtml(r.item)}</b>${r.detail ? ` — ${escapeHtml(r.detail)}` : ''} ${srcLink(ix, r.source_id)}</div>`).join('');
    return `<div class="tile"><h5>${escapeHtml(section)}</h5>${rows}</div>`;
  }).join('');
  return `<p class="profile-meta">Form year ${escapeHtml(maxYear)}</p><div class="disclosure-grid">${cards}</div>`;
}

function renderPerson(container, ctx) {
  const { ix, PT } = ctx;
  const id = ctx.route.id;
  const profile = ix.profileOf(id);
  if (!profile) { renderLimitedPerson(container, ctx, ix.people.get(id)); return; }

  const { person, terms, candidacies, employment, ties, contributions, votes, disclosures } = profile;
  const seatsById = new Map((PT.tables.seats || []).map(s => [s.seat_id, s]));
  const residenceAddr = ix.residenceOf(person.person_id);
  const residenceText = residenceAddr ? ix.personPlace(person.person_id, residenceAddr.address_id) : '';
  const runningOffice = ballotOffice(PT, person.person_id);

  container.innerHTML = `
    <div class="profile-header">
      <h2>${escapeHtml(person.full_name)}</h2>
      ${personPillHtml(person)}
      ${runningOffice && person.kind !== 'candidate' ? '<span class="pill running">running</span>' : ''}
    </div>
    <p class="profile-meta">
      ${runningOffice ? `<span>On the ballot for ${escapeHtml(runningOffice)}</span>` : ''}
      ${person.status ? `<span>${escapeHtml(person.status)}</span>` : ''}
      ${person.occupation ? `<span>${escapeHtml(person.occupation)}</span>` : ''}
      ${residenceText ? `<span>${escapeHtml(residenceText)}</span>` : ''}
      ${person.email ? `<span>${escapeHtml(person.email)}</span>` : ''}
      ${person.phone ? `<span>${escapeHtml(person.phone)}</span>` : ''}
    </p>

    <div class="profile-section"><h3>Terms</h3>${termsTable(terms, seatsById, ix)}</div>
    ${candidacies.length ? `<div class="profile-section"><h3>Candidacy</h3>${candidacyCards(candidacies, ix)}</div>` : ''}
    <div class="profile-section"><h3>Employment</h3>${employmentTable(employment, ix)}</div>
    <div class="profile-section"><h3>Ties</h3>${tiesSection(ties, person.person_id, ix)}</div>
    <div class="profile-section"><h3>Contributions received</h3>${contributionsTable(contributions, ix)}</div>
    <div class="profile-section"><h3>Votes</h3>${votesTable(votes, ix)}</div>
    <div class="profile-section"><h3>Latest disclosure</h3>${latestDisclosureSection(disclosures, ix)}</div>
  `;
  wireNav(container, ctx);
}

function renderLimitedPerson(container, ctx, person) {
  if (!person) { container.innerHTML = '<p class="empty">Not found.</p>'; return; }
  const { PT, ix } = ctx;
  const relRows = PT.tables.relationships.filter(r => r.from_id === person.person_id || r.to_id === person.person_id);
  container.innerHTML = `
    <div class="profile-header">
      <h2>${escapeHtml(person.full_name)}</h2>
      ${personPillHtml(person)}
    </div>
    <p class="profile-meta"><span>Limited profile — appears only through public records that name them.</span></p>
    <div class="profile-section"><h3>Ties</h3>${tiesSection(relRows, person.person_id, ix)}</div>
  `;
  wireNav(container, ctx);
}

// ---- entity profile ----------------------------------------------------------
function renderEntity(container, ctx) {
  const { ix, PT } = ctx;
  const id = ctx.route.id;
  const e = ix.entities.get(id);
  if (!e) { container.innerHTML = '<p class="empty">Not found.</p>'; return; }

  const principalAddr = e.principal_address_id ? ix.addressText(e.principal_address_id) : '';
  let agentHtml = '';
  if (e.registered_agent_person_id) {
    const p = ix.people.get(e.registered_agent_person_id);
    const name = p ? p.full_name : e.registered_agent_person_id;
    agentHtml = ix.profileOf(e.registered_agent_person_id)
      ? `<a href="#" data-nav="${escapeHtml(e.registered_agent_person_id)}">${escapeHtml(name)}</a>`
      : `${escapeHtml(name)} (limited)`;
  } else if (e.registered_agent_entity_id) {
    const ae = ix.entities.get(e.registered_agent_entity_id);
    agentHtml = `<a href="#" data-nav="${escapeHtml(e.registered_agent_entity_id)}">${escapeHtml(ae ? ae.name : e.registered_agent_entity_id)}</a>`;
  }

  const incoming = PT.tables.relationships.filter(r => r.to_id === id);
  const outgoing = PT.tables.relationships.filter(r => r.from_id === id);

  container.innerHTML = `
    <div class="profile-header">
      <h2>${escapeHtml(e.name)}</h2>
      ${e.type ? `<span class="pill type">${escapeHtml(e.type)}</span>` : ''}
    </div>
    <p class="profile-meta">
      ${e.sunbiz_status ? `<span>${escapeHtml(e.sunbiz_status)}</span>` : ''}
      ${e.sunbiz_doc_number ? `<span>${escapeHtml(e.sunbiz_doc_number)}</span>` : ''}
      ${principalAddr ? `<span>${escapeHtml(principalAddr)}</span>` : ''}
    </p>
    <div class="profile-section">
      ${e.sunbiz_url ? `<div class="row"><b>Sunbiz</b><a href="${escapeHtml(e.sunbiz_url)}" target="_blank" rel="noopener">View filing →</a></div>` : ''}
      ${agentHtml ? `<div class="row"><b>Registered agent</b>${agentHtml}</div>` : ''}
      ${e.source_id ? `<div class="row"><b>Source</b>${srcLink(ix, e.source_id)}</div>` : ''}
    </div>
    <div class="profile-section rel-groups">
      <div>
        <h3>Who is tied to it</h3>
        ${tiesSection(incoming, id, ix)}
      </div>
      <div>
        <h3>What it is tied to</h3>
        ${tiesSection(outgoing, id, ix)}
      </div>
    </div>
  `;
  wireNav(container, ctx);
}

// ---- issue profile ------------------------------------------------------------
function issueTiedSubjects(issue, ctx) {
  const { ix, PT } = ctx;
  const relatedEntities = new Set(String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean));
  const personIds = new Set();
  for (const r of PT.tables.relationships) {
    if (relatedEntities.has(r.to_id) && r.from_type === 'person') personIds.add(r.from_id);
    if (relatedEntities.has(r.from_id) && r.to_type === 'person') personIds.add(r.to_id);
  }
  for (const v of ix.votes.values()) {
    if (v.issue_id !== issue.issue_id) continue;
    for (const vc of PT.tables.vote_casts || []) {
      if (vc.vote_id === v.vote_id) personIds.add(vc.person_id);
    }
  }
  return [...personIds];
}

function renderIssue(container, ctx) {
  const { ix, PT } = ctx;
  const id = ctx.route.id;
  const issue = ix.issues.get(id);
  if (!issue) { container.innerHTML = '<p class="empty">Not found.</p>'; return; }

  const relatedEntities = String(issue.related_entity_ids || '').split(';').map(s => s.trim()).filter(Boolean);
  const votes = [...ix.votes.values()].filter(v => v.issue_id === id);
  const tiedSubjectIds = issueTiedSubjects(issue, ctx);

  const relatedEntitiesHtml = relatedEntities.length
    ? relatedEntities.map(eid => {
        const e = ix.entities.get(eid);
        return `<a href="#" class="chip" data-nav="${escapeHtml(eid)}">${escapeHtml(e ? e.name : eid)}</a>`;
      }).join(' ')
    : '<p class="empty">No related entities.</p>';

  const votesHtml = votes.length ? votes.map(v => {
    const casts = (PT.tables.vote_casts || []).filter(vc => vc.vote_id === v.vote_id);
    const castsHtml = casts.length ? casts.map(vc => {
      const p = ix.people.get(vc.person_id);
      const name = p ? p.full_name : vc.person_id;
      return `<div class="row">${escapeHtml(name)} — ${escapeHtml(vc.cast)} ${srcLink(ix, vc.source_id)}</div>`;
    }).join('') : '<p class="empty">No recorded casts.</p>';
    return `<div class="card" style="margin-bottom:12px;">
      <div class="row"><b>${escapeHtml(v.item)}</b></div>
      <div class="row"><b>Date</b>${escapeHtml(dateText(v.date))} <b>Outcome</b>${escapeHtml(v.outcome)} <b>Tally</b>${escapeHtml(v.tally)} ${srcLink(ix, v.source_id)}</div>
      ${castsHtml}
    </div>`;
  }).join('') : '<p class="empty">No votes on file.</p>';

  const subjectsHtml = tiedSubjectIds.length
    ? tiedSubjectIds.map(pid => {
        const p = ix.people.get(pid);
        return `<div class="row"><a href="#" data-nav="${escapeHtml(pid)}">${escapeHtml(p ? p.full_name : pid)}</a> ${personPillHtml(p)}</div>`;
      }).join('')
    : '<p class="empty">No subjects tied.</p>';

  container.innerHTML = `
    <div class="profile-header">
      <h2>${escapeHtml(issue.title)}</h2>
      ${issue.status ? `<span class="pill type">${escapeHtml(issue.status)}</span>` : ''}
    </div>
    <p class="profile-meta">
      ${issue.first_date ? `<span>First: ${escapeHtml(dateText(issue.first_date))}</span>` : ''}
      ${issue.next_date ? `<span>Next: ${escapeHtml(dateText(issue.next_date))}</span>` : ''}
    </p>
    ${issue.summary ? `<p class="profile-meta">${escapeHtml(issue.summary)}</p>` : ''}
    <div class="profile-section"><h3>Related entities</h3>${relatedEntitiesHtml}</div>
    <div class="profile-section"><h3>Votes</h3>${votesHtml}</div>
    <div class="profile-section"><h3>Subjects tied</h3>${subjectsHtml}</div>
    ${issue.source_id ? `<div class="profile-section"><h3>Source</h3>${srcLink(ix, issue.source_id)}</div>` : ''}
  `;
  wireNav(container, ctx);
}

// ---- subject cards (nothing selected) -----------------------------------------
function renderSubjectList(container, ctx) {
  const { ix, PT } = ctx;
  const cards = ix.subjects.map(p => {
    const profile = ix.profileOf(p.person_id);
    let office = '';
    if (profile && profile.candidacies.length) office = profile.candidacies[0].office;
    else if (profile && profile.terms.length) {
      const seat = (PT.tables.seats || []).find(s => s.seat_id === profile.terms[0].seat_id);
      office = seat ? seat.label : '';
    }
    const tieCount = PT.tables.relationships.filter(r => r.from_id === p.person_id || r.to_id === p.person_id).length;
    return `<div class="card subject-card" data-nav="${escapeHtml(p.person_id)}">
      <h4>${escapeHtml(p.full_name)}</h4>
      <div class="sc-row">${personPillHtml(p)}</div>
      ${office ? `<div class="sc-row">${escapeHtml(office)}</div>` : ''}
      <div class="sc-row">${tieCount} tie${tieCount === 1 ? '' : 's'}</div>
      <div class="sc-open">Open →</div>
    </div>`;
  }).join('');
  container.innerHTML = `<div class="subject-cards">${cards}</div>`;
  wireNav(container, ctx);
}

export default {
  id: 'profile',
  label: 'Profile',
  render(container, ctx) {
    const { ix, route } = ctx;
    if (!route.id) { renderSubjectList(container, ctx); return; }
    const kind0 = ix.typeOf(route.id);
    const kind = kind0 === 'property' ? 'entity' : kind0;
    if (kind === 'person') renderPerson(container, ctx);
    else if (kind === 'entity') renderEntity(container, ctx);
    else if (kind === 'issue') renderIssue(container, ctx);
    else container.innerHTML = '<p class="empty">Nothing selected.</p>';
  },
};
