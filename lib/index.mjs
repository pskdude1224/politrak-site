// Pure lookup index over a built PT payload. No imports, no DOM.

const KIND_ORDER = { official: 0, candidate: 1, staff: 2 };

const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

export function indexData(PT) {
  const tables = PT.tables || {};
  const people = new Map((tables.people || []).map(p => [p.person_id, p]));
  const entities = new Map((tables.entities || []).map(e => [e.entity_id, e]));
  const addresses = new Map((tables.addresses || []).map(a => [a.address_id, a]));
  const sources = new Map((tables.sources || []).map(s => [s.source_id, s]));
  const issues = new Map((tables.issues || []).map(i => [i.issue_id, i]));
  const votes = new Map((tables.votes || []).map(v => [v.vote_id, v]));
  const candidacies = new Map((tables.candidacies || []).map(c => [c.candidacy_id, c]));
  const profiles = (PT.derived && PT.derived.profiles) || [];

  const subjects = (tables.people || [])
    .filter(p => p.display_level === 'full')
    .sort((a, b) => {
      const ra = KIND_ORDER[a.kind] ?? 99, rb = KIND_ORDER[b.kind] ?? 99;
      if (ra !== rb) return ra - rb;
      return String(a.sort_name || '').localeCompare(String(b.sort_name || ''));
    });

  function labelOf(id) {
    if (people.has(id)) return people.get(id).full_name;
    if (entities.has(id)) return entities.get(id).name;
    if (issues.has(id)) return issues.get(id).title;
    if (votes.has(id)) return votes.get(id).item;
    if (candidacies.has(id)) return candidacies.get(id).office;
    return id;
  }

  function typeOf(id) {
    if (people.has(id)) return 'person';
    if (entities.has(id)) return entities.get(id).type === 'property' ? 'property' : 'entity';
    if (issues.has(id)) return 'issue';
    if (votes.has(id)) return 'vote';
    if (candidacies.has(id)) return 'candidacy';
    if (addresses.has(id)) return 'address';
    return 'unknown';
  }

  function residenceOf(personId) {
    const person = people.get(personId);
    let addressId = person && person.residence_address_id;
    if (!addressId) {
      const cand = [...candidacies.values()].find(c => c.person_id === personId && c.residence_address_id);
      addressId = cand && cand.residence_address_id;
    }
    if (!addressId) return null;
    const addr = addresses.get(addressId);
    if (!addr || !addr.line1) return null; // masked (or missing) rows are not usable residences
    return addr;
  }

  function addressText(addressId) {
    const addr = addresses.get(addressId);
    if (!addr) return '';
    if (addr.line1) {
      let street = titleCase(addr.line1);
      if (addr.unit) street += ` #${addr.unit}`;
      return `${street}, ${titleCase(addr.city || '')}`;
    }
    return `${titleCase(addr.city || '')}, ${addr.state || ''}`;
  }

  // Like addressText, but masks the result to "City, ST" whenever the given
  // id names a person who isn't a full subject — even if that address row
  // itself is public (e.g. it's also an entity's principal address). Never
  // reads line1/raw for such a person. Ids that aren't a person at all (an
  // entity id, say) aren't masked: they fall through to the full addressText.
  function personPlace(personId, addressId) {
    const person = people.get(personId);
    if (!person || person.display_level === 'full') return addressText(addressId);
    const addr = addresses.get(addressId);
    if (!addr) return '';
    return `${titleCase(addr.city || '')}, ${String(addr.state || '').toUpperCase()}`;
  }

  function sourceOf(sourceId) {
    return sources.get(sourceId) || null;
  }

  function personOfCandidacy(candidacyId) {
    const c = candidacies.get(candidacyId);
    return (c && c.person_id) || '';
  }

  function profileOf(personId) {
    return profiles.find(p => p.person && p.person.person_id === personId) || null;
  }

  return {
    people, entities, addresses, sources, issues, votes, candidacies,
    subjects, labelOf, typeOf, residenceOf, addressText, personPlace, sourceOf, personOfCandidacy, profileOf,
  };
}
