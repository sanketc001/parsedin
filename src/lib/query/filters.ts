import type { Database, Person } from '../types';
import {
  allCompanyIds,
  certificationNames,
  currentCompanyIds,
  pastCompanyIds,
  schoolIds,
  searchCorpus,
  skillNames,
  volunteerOrgs,
  type Indexes,
} from '../derive';
import { normalizeKey } from '../normalize';
import { termMatches, wordPrefixMatch } from '../match';

// ---------------------------------------------------------------------------
// The filter model. Values inside one facet are OR'd; facets are AND'd.
// Everything is a plain serializable object so it round-trips through the URL
// and can be produced by the question parser.
// ---------------------------------------------------------------------------

export interface Filters {
  /** Free text across the whole profile. */
  q: string;
  /** Free text restricted to job titles. */
  title: string;
  currentCompanyIds: string[];
  pastCompanyIds: string[];
  anyCompanyIds: string[];
  schoolIds: string[];
  locations: string[];
  industries: string[];
  skills: string[];
  certifications: string[];
  volunteering: string[];
  degrees: number[];
  /** Minimum private relationship strength, 1..5. */
  minStrength: number | null;
  hasNotes: boolean;
}

export function emptyFilters(): Filters {
  return {
    q: '',
    title: '',
    currentCompanyIds: [],
    pastCompanyIds: [],
    anyCompanyIds: [],
    schoolIds: [],
    locations: [],
    industries: [],
    skills: [],
    certifications: [],
    volunteering: [],
    degrees: [],
    minStrength: null,
    hasNotes: false,
  };
}

export function isEmptyFilters(f: Filters): boolean {
  return (
    !f.q.trim() &&
    !f.title.trim() &&
    f.currentCompanyIds.length === 0 &&
    f.pastCompanyIds.length === 0 &&
    f.anyCompanyIds.length === 0 &&
    f.schoolIds.length === 0 &&
    f.locations.length === 0 &&
    f.industries.length === 0 &&
    f.skills.length === 0 &&
    f.certifications.length === 0 &&
    f.volunteering.length === 0 &&
    f.degrees.length === 0 &&
    f.minStrength === null &&
    !f.hasNotes
  );
}

export function countActiveFilters(f: Filters): number {
  let n = 0;
  if (f.q.trim()) n += 1;
  if (f.title.trim()) n += 1;
  n += f.currentCompanyIds.length;
  n += f.pastCompanyIds.length;
  n += f.anyCompanyIds.length;
  n += f.schoolIds.length;
  n += f.locations.length;
  n += f.industries.length;
  n += f.skills.length;
  n += f.certifications.length;
  n += f.volunteering.length;
  n += f.degrees.length;
  if (f.minStrength !== null) n += 1;
  if (f.hasNotes) n += 1;
  return n;
}

function overlaps(have: string[], want: string[]): boolean {
  if (want.length === 0) return true;
  return want.some((w) => have.includes(w));
}

/** OR over a list of values, matching each on word starts rather than substrings. */
function matchesAny(have: string[], want: string[]): boolean {
  if (want.length === 0) return true;
  const keys = have.map(normalizeKey);
  return want.some((w) => {
    const k = normalizeKey(w);
    return keys.some((h) => wordPrefixMatch(h, k));
  });
}

export function matchPerson(person: Person, f: Filters, idx: Indexes): boolean {
  if (f.q.trim()) {
    // Every whitespace-separated term must start a word somewhere in the
    // profile. Anchoring to word starts keeps short terms honest: "AI" should
    // not match "Bain", but "mckin" should still find McKinsey.
    const corpus = searchCorpus(person);
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((t) => termMatches(corpus, t))) return false;
  }

  if (f.title.trim()) {
    const needle = normalizeKey(f.title);
    const titles = [
      person.currentTitle,
      person.headline,
      ...person.positions.map((p) => p.title),
    ]
      .filter((t): t is string => !!t)
      .map(normalizeKey);
    if (!titles.some((t) => wordPrefixMatch(t, needle))) return false;
  }

  if (!overlaps(currentCompanyIds(person), f.currentCompanyIds)) return false;
  if (!overlaps(pastCompanyIds(person), f.pastCompanyIds)) return false;
  if (!overlaps(allCompanyIds(person), f.anyCompanyIds)) return false;
  if (!overlaps(schoolIds(person), f.schoolIds)) return false;

  if (f.locations.length > 0) {
    if (!matchesAny([person.location ?? ''], f.locations)) return false;
  }
  if (f.industries.length > 0) {
    if (!matchesAny([person.industry ?? ''], f.industries)) return false;
  }
  if (!matchesAny(skillNames(person), f.skills)) return false;
  if (!matchesAny(certificationNames(person), f.certifications)) return false;
  if (!matchesAny(volunteerOrgs(person), f.volunteering)) return false;

  if (f.degrees.length > 0) {
    if (person.connectionDegree === null) return false;
    if (!f.degrees.includes(person.connectionDegree)) return false;
  }

  if (f.minStrength !== null) {
    const s = idx.strengthByPerson.get(person.id) ?? 0;
    if (s < f.minStrength) return false;
  }

  if (f.hasNotes && !(idx.noteCountByPerson.get(person.id) ?? 0)) return false;

  return true;
}

export function filterPeople(db: Database, f: Filters, idx: Indexes): Person[] {
  return db.people.filter((p) => matchPerson(p, f, idx));
}

// --- facets -----------------------------------------------------------------

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface Facets {
  currentCompanies: FacetOption[];
  pastCompanies: FacetOption[];
  schools: FacetOption[];
  locations: FacetOption[];
  industries: FacetOption[];
  skills: FacetOption[];
  certifications: FacetOption[];
  volunteering: FacetOption[];
  degrees: FacetOption[];
}

function tally(entries: Iterable<[string, string]>): FacetOption[] {
  // key -> [label, count]
  const map = new Map<string, { label: string; count: number }>();
  for (const [value, label] of entries) {
    if (!value) continue;
    const hit = map.get(value);
    if (hit) hit.count += 1;
    else map.set(value, { label, count: 1 });
  }
  return Array.from(map.entries())
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Build facet options with counts. Computed over the people passed in, so the
 * People page can show counts for the current result set.
 */
export function computeFacets(people: Person[], idx: Indexes): Facets {
  const current: [string, string][] = [];
  const past: [string, string][] = [];
  const schools: [string, string][] = [];
  const locations: [string, string][] = [];
  const industries: [string, string][] = [];
  const skills: [string, string][] = [];
  const certs: [string, string][] = [];
  const vols: [string, string][] = [];
  const degrees: [string, string][] = [];

  for (const person of people) {
    for (const id of currentCompanyIds(person)) {
      current.push([id, idx.companyById.get(id)?.name ?? id]);
    }
    for (const id of pastCompanyIds(person)) {
      past.push([id, idx.companyById.get(id)?.name ?? id]);
    }
    for (const id of schoolIds(person)) {
      schools.push([id, idx.schoolById.get(id)?.name ?? id]);
    }
    if (person.location) locations.push([person.location, person.location]);
    if (person.industry) industries.push([person.industry, person.industry]);
    for (const s of skillNames(person)) skills.push([s, s]);
    for (const c of certificationNames(person)) certs.push([c, c]);
    for (const v of volunteerOrgs(person)) vols.push([v, v]);
    if (person.connectionDegree !== null) {
      const d = String(person.connectionDegree);
      degrees.push([d, d === '1' ? '1st' : d === '2' ? '2nd' : d === '3' ? '3rd' : d]);
    }
  }

  return {
    currentCompanies: tally(current),
    pastCompanies: tally(past),
    schools: tally(schools),
    locations: tally(locations),
    industries: tally(industries),
    skills: tally(skills),
    certifications: tally(certs),
    volunteering: tally(vols),
    degrees: tally(degrees).sort((a, b) => a.value.localeCompare(b.value)),
  };
}

// --- sorting ----------------------------------------------------------------

export type SortKey =
  | 'name'
  | 'company'
  | 'recently-connected'
  | 'recently-updated'
  | 'strength'
  | 'detail';

export function sortPeople(people: Person[], key: SortKey, idx: Indexes): Person[] {
  const out = [...people];
  switch (key) {
    case 'company':
      out.sort(
        (a, b) =>
          (a.currentCompany ?? '~').localeCompare(b.currentCompany ?? '~') ||
          a.fullName.localeCompare(b.fullName),
      );
      break;
    case 'recently-connected':
      out.sort((a, b) => (b.connectedOn ?? '').localeCompare(a.connectedOn ?? ''));
      break;
    case 'recently-updated':
      out.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
      break;
    case 'strength':
      out.sort(
        (a, b) =>
          (idx.strengthByPerson.get(b.id) ?? 0) - (idx.strengthByPerson.get(a.id) ?? 0) ||
          a.fullName.localeCompare(b.fullName),
      );
      break;
    case 'detail':
      out.sort(
        (a, b) =>
          b.positions.length + b.education.length - (a.positions.length + a.education.length) ||
          a.fullName.localeCompare(b.fullName),
      );
      break;
    case 'name':
    default:
      out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  return out;
}
