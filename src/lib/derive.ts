import type { Company, Database, Person, School } from './types';
import { companyKey, monthsBetween, schoolKey, uniq } from './normalize';
import { resolveByName } from './match';

// ---------------------------------------------------------------------------
// Read-side projections over a Person. Filters, facets, the graph and the
// question parser all go through these so "works at Google" means exactly the
// same thing everywhere.
// ---------------------------------------------------------------------------

/** Company ids where the person holds a role right now. */
export function currentCompanyIds(person: Person): string[] {
  const ids = person.positions.filter((p) => p.isCurrent && p.companyId).map((p) => p.companyId!);
  if (person.currentCompanyId) ids.push(person.currentCompanyId);
  return uniq(ids);
}

/** Company ids the person has left. Excludes anywhere they currently work. */
export function pastCompanyIds(person: Person): string[] {
  const current = new Set(currentCompanyIds(person));
  return uniq(
    person.positions
      .filter((p) => !p.isCurrent && p.companyId)
      .map((p) => p.companyId!)
      .filter((id) => !current.has(id)),
  );
}

export function allCompanyIds(person: Person): string[] {
  return uniq([...currentCompanyIds(person), ...pastCompanyIds(person)]);
}

export function schoolIds(person: Person): string[] {
  return uniq(person.education.filter((e) => e.schoolId).map((e) => e.schoolId!));
}

/** Every title the person has held, current first. */
export function allTitles(person: Person): string[] {
  const titles = person.positions.map((p) => p.title).filter((t): t is string => !!t);
  if (person.currentTitle) titles.unshift(person.currentTitle);
  return uniq(titles);
}

export function skillNames(person: Person): string[] {
  return person.skills.map((s) => s.name);
}

export function certificationNames(person: Person): string[] {
  return person.certifications.map((c) => c.name);
}

export function volunteerOrgs(person: Person): string[] {
  return uniq(person.volunteering.map((v) => v.organization).filter((o): o is string => !!o));
}

export function fieldsOfStudy(person: Person): string[] {
  return uniq(person.education.map((e) => e.fieldOfStudy).filter((f): f is string => !!f));
}

export function degrees(person: Person): string[] {
  return uniq(person.education.map((e) => e.degree).filter((d): d is string => !!d));
}

/**
 * Every string worth matching a free-text query against. Kept generous on
 * purpose — a search for "McKinsey" should find someone whose only mention of
 * it is a past position description.
 */
export function searchCorpus(person: Person): string {
  const parts: (string | null)[] = [
    person.fullName,
    person.headline,
    person.currentTitle,
    person.currentCompany,
    person.location,
    person.industry,
    person.summary,
    person.email,
  ];
  for (const p of person.positions) {
    parts.push(p.title, p.companyName, p.location, p.description);
  }
  for (const e of person.education) {
    parts.push(e.schoolName, e.degree, e.fieldOfStudy, e.activities, e.notes);
  }
  for (const s of person.skills) parts.push(s.name);
  for (const c of person.certifications) parts.push(c.name, c.authority);
  for (const v of person.volunteering) parts.push(v.organization, v.role, v.cause, v.description);
  for (const l of person.languages) parts.push(l.name);
  for (const pr of person.projects) parts.push(pr.name, pr.description);
  for (const h of person.honors) parts.push(h.title, h.issuer, h.description);
  return parts.filter(Boolean).join('  ').toLowerCase();
}

/** Total months of recorded work experience, ignoring overlaps. */
export function totalExperienceMonths(person: Person): number | null {
  if (person.positions.length === 0) return null;
  let total = 0;
  let any = false;
  for (const p of person.positions) {
    const m = monthsBetween(p.startDate, p.isCurrent ? null : p.endDate);
    if (m !== null) {
      total += m;
      any = true;
    }
  }
  return any ? total : null;
}

/** How much profile detail we actually hold, 0..1. Drives a "depth" hint. */
export function completeness(person: Person): number {
  const checks = [
    !!person.headline,
    !!person.location,
    !!person.currentCompany,
    !!person.currentTitle,
    person.positions.length > 1,
    person.education.length > 0,
    person.skills.length > 0,
    person.certifications.length > 0 || person.volunteering.length > 0,
  ];
  return checks.filter(Boolean).length / checks.length;
}

// --- lookup indexes ---------------------------------------------------------

export interface Indexes {
  companyById: Map<string, Company>;
  schoolById: Map<string, School>;
  personById: Map<string, Person>;
  /** Company id -> people currently there. */
  currentByCompany: Map<string, Person[]>;
  /** Company id -> people formerly there. */
  pastByCompany: Map<string, Person[]>;
  /** School id -> alumni in the network. */
  bySchool: Map<string, Person[]>;
  noteCountByPerson: Map<string, number>;
  strengthByPerson: Map<string, number>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndexes(db: Database): Indexes {
  const idx: Indexes = {
    companyById: new Map(db.companies.map((c) => [c.id, c])),
    schoolById: new Map(db.schools.map((s) => [s.id, s])),
    personById: new Map(db.people.map((p) => [p.id, p])),
    currentByCompany: new Map(),
    pastByCompany: new Map(),
    bySchool: new Map(),
    noteCountByPerson: new Map(),
    strengthByPerson: new Map(),
  };

  for (const person of db.people) {
    for (const id of currentCompanyIds(person)) push(idx.currentByCompany, id, person);
    for (const id of pastCompanyIds(person)) push(idx.pastByCompany, id, person);
    for (const id of schoolIds(person)) push(idx.bySchool, id, person);
  }
  for (const note of db.notes) {
    idx.noteCountByPerson.set(note.personId, (idx.noteCountByPerson.get(note.personId) ?? 0) + 1);
  }
  for (const rel of db.relationships) {
    idx.strengthByPerson.set(rel.personId, rel.strength);
  }
  return idx;
}

/**
 * All companies a typed name could mean. Exact match wins, then word-prefix
 * ("McKinsey" -> "McKinsey & Company"), then acronym ("TCS", "BCG").
 */
export function resolveCompanies(db: Database, text: string): Company[] {
  return resolveByName(db.companies, (c) => c.nameKey, text, companyKey);
}

/** All schools a typed name could mean — "IIT" matches every IIT. */
export function resolveSchools(db: Database, text: string): School[] {
  return resolveByName(db.schools, (s) => s.nameKey, text, schoolKey);
}

/** Single best company for a typed name, preferring the closest in length. */
export function resolveCompany(db: Database, text: string): Company | null {
  const hits = resolveCompanies(db, text);
  if (hits.length === 0) return null;
  const key = companyKey(text);
  return [...hits].sort(
    (a, b) =>
      Math.abs(a.nameKey.length - key.length) - Math.abs(b.nameKey.length - key.length),
  )[0];
}

export function resolveSchool(db: Database, text: string): School | null {
  const hits = resolveSchools(db, text);
  if (hits.length === 0) return null;
  const key = schoolKey(text);
  return [...hits].sort(
    (a, b) =>
      Math.abs(a.nameKey.length - key.length) - Math.abs(b.nameKey.length - key.length),
  )[0];
}
