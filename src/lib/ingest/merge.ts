import {
  type Database,
  type Person,
  type Position,
  type Education,
  type SkillEntry,
  type CertificationEntry,
  type VolunteeringEntry,
  type LanguageEntry,
  type ProjectEntry,
  type HonorEntry,
  type ImportStats,
  type Provenanced,
} from '../types';
import { upsertCompany, upsertSchool } from '../entities';
import {
  canonicalUrl,
  clean,
  companyKey,
  dateSortKey,
  newId,
  normalizeKey,
  schoolKey,
  splitName,
  uniq,
  urlKey as toUrlKey,
} from '../normalize';

// ---------------------------------------------------------------------------
// Entity resolution and merging.
//
// Imports are additive and idempotent: re-importing the same archive updates
// provenance timestamps but does not duplicate people or history rows.
// ---------------------------------------------------------------------------

export interface Ctx {
  db: Database;
  batchId: string;
  importedAt: string;
  /** File the current rows came from, e.g. "Connections.csv". */
  sourceLabel: string;
  stats: ImportStats;
}

function prov(ctx: Ctx): Provenanced {
  return {
    sourceBatchId: ctx.batchId,
    lastSeenBatchId: ctx.batchId,
    importedAt: ctx.importedAt,
    updatedAt: ctx.importedAt,
  };
}

function touch<T extends Provenanced>(record: T, ctx: Ctx): T {
  record.lastSeenBatchId = ctx.batchId;
  record.updatedAt = ctx.importedAt;
  return record;
}

/**
 * Write a scalar person field, recording where it came from.
 * Non-empty incoming values win; empty ones never erase what we already know.
 */
function setField(
  person: Person,
  field: keyof Person,
  value: string | number | null,
  ctx: Ctx,
): void {
  if (value === null || value === undefined || value === '') return;
  const current = person[field];
  if (current === value) {
    // Same value re-confirmed — refresh provenance so "last seen" is honest.
    person.fieldSources[field as string] = {
      batchId: ctx.batchId,
      importedAt: ctx.importedAt,
      sourceLabel: ctx.sourceLabel,
    };
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (person as any)[field] = value;
  person.fieldSources[field as string] = {
    batchId: ctx.batchId,
    importedAt: ctx.importedAt,
    sourceLabel: ctx.sourceLabel,
  };
  person.lastUpdatedAt = ctx.importedAt;
}

export interface PersonSeed {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  location?: string | null;
  industry?: string | null;
  summary?: string | null;
  connectedOn?: string | null;
  connectionDegree?: number | null;
  /**
   * Degree to apply only when none is already known. For sources that imply a
   * weak relationship without proving it — an invitation says "at least 2nd",
   * but the same person may already be a confirmed 1st-degree connection, and
   * which file is read first must not decide the answer.
   */
  connectionDegreeIfUnknown?: number | null;
}

function displayName(seed: PersonSeed): string | null {
  const full = clean(seed.fullName);
  if (full) return full;
  const parts = [clean(seed.firstName), clean(seed.lastName)].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/**
 * Locate an existing person for this seed.
 *
 * Matching is intentionally strict, in priority order:
 *   1. normalized LinkedIn URL — a true identifier
 *   2. normalized full name, but only when nothing contradicts it
 * A name-only match is rejected when both records have URLs and they differ.
 */
function findPerson(ctx: Ctx, seed: PersonSeed): Person | null {
  const uk = toUrlKey(seed.linkedinUrl);
  if (uk) {
    const byUrl = ctx.db.people.find((p) => p.urlKey === uk);
    if (byUrl) return byUrl;
  }
  const name = displayName(seed);
  const nk = normalizeKey(name);
  if (!nk) return null;

  const candidates = ctx.db.people.filter((p) => p.nameKey === nk);
  if (candidates.length === 0) return null;

  // Prefer a candidate with no URL (nothing to contradict), else one whose URL
  // matches. If several people share a name and we cannot tell them apart,
  // refuse to guess and create a new record.
  const compatible = candidates.filter((p) => !p.urlKey || !uk || p.urlKey === uk);
  if (compatible.length === 1) return compatible[0];
  if (compatible.length > 1) {
    // Disambiguate on current company when we can.
    const ck = companyKey(seed.currentCompany);
    if (ck) {
      const byCompany = compatible.filter((p) => companyKey(p.currentCompany) === ck);
      if (byCompany.length === 1) return byCompany[0];
    }
  }
  return null;
}

export function blankPerson(name: string, seed: PersonSeed, now: string): Person {
  const { first, last } = splitName(name);
  return {
    id: newId('p'),
    fullName: name,
    firstName: clean(seed.firstName) ?? first,
    lastName: clean(seed.lastName) ?? last,
    nameKey: normalizeKey(name),
    headline: null,
    currentTitle: null,
    currentCompany: null,
    currentCompanyId: null,
    location: null,
    industry: null,
    summary: null,
    linkedinUrl: null,
    urlKey: null,
    email: null,
    connectedOn: null,
    connectionDegree: null,
    positions: [],
    education: [],
    skills: [],
    certifications: [],
    volunteering: [],
    languages: [],
    projects: [],
    honors: [],
    fieldSources: {},
    sourceBatchIds: [],
    firstSeenAt: now,
    lastUpdatedAt: now,
  };
}

/**
 * Apply a seed's scalar fields onto an existing person, recording provenance.
 * Shared by connection upserts and the account owner's own profile.
 */
export function applyPersonSeed(ctx: Ctx, person: Person, seed: PersonSeed): void {
  const name = displayName(seed);
  if (name) setField(person, 'fullName', name, ctx);
  person.nameKey = normalizeKey(person.fullName);
  setField(person, 'firstName', clean(seed.firstName), ctx);
  setField(person, 'lastName', clean(seed.lastName), ctx);
  setField(person, 'headline', clean(seed.headline), ctx);
  setField(person, 'location', clean(seed.location), ctx);
  setField(person, 'industry', clean(seed.industry), ctx);
  setField(person, 'summary', clean(seed.summary), ctx);
  setField(person, 'email', clean(seed.email), ctx);
  setField(person, 'connectedOn', clean(seed.connectedOn), ctx);
  if (typeof seed.connectionDegree === 'number') {
    setField(person, 'connectionDegree', seed.connectionDegree, ctx);
  } else if (
    typeof seed.connectionDegreeIfUnknown === 'number' &&
    person.connectionDegree === null
  ) {
    setField(person, 'connectionDegree', seed.connectionDegreeIfUnknown, ctx);
  }

  // Stored absolute so the value is directly usable as an href; identity still
  // comes from urlKey, which ignores scheme and host prefix either way.
  const url = canonicalUrl(seed.linkedinUrl);
  if (url) {
    setField(person, 'linkedinUrl', url, ctx);
    person.urlKey = toUrlKey(url);
  }

  const title = clean(seed.currentTitle);
  const company = clean(seed.currentCompany);
  if (title) setField(person, 'currentTitle', title, ctx);
  if (company) {
    setField(person, 'currentCompany', company, ctx);
    const co = upsertCompany(ctx.db, company, ctx.batchId, ctx.importedAt);
    if (co) person.currentCompanyId = co.id;
  }

  person.sourceBatchIds = uniq([...person.sourceBatchIds, ctx.batchId]);
}

export function upsertPerson(ctx: Ctx, seed: PersonSeed): Person | null {
  const name = displayName(seed);
  if (!name) {
    ctx.stats.rowsSkipped += 1;
    return null;
  }

  let person = findPerson(ctx, seed);
  if (!person) {
    person = blankPerson(name, seed, ctx.importedAt);
    ctx.db.people.push(person);
    ctx.stats.peopleCreated += 1;
  } else {
    ctx.stats.peopleUpdated += 1;
    person.lastUpdatedAt = ctx.importedAt;
  }

  applyPersonSeed(ctx, person, seed);
  return person;
}

// --- history rows -----------------------------------------------------------

export interface PositionSeed {
  title?: string | null;
  companyName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean | null;
  location?: string | null;
  description?: string | null;
}

export function addPosition(ctx: Ctx, person: Person, seed: PositionSeed): void {
  const title = clean(seed.title);
  const companyName = clean(seed.companyName);
  if (!title && !companyName) return;

  // Same company + same title identifies a role. The start date only
  // distinguishes genuinely separate stints, and one side is frequently
  // dateless: Connections.csv gives a current role with no dates at all, so
  // that stub must be absorbed by the dated version rather than duplicated.
  const roleKey = `${companyKey(companyName)}|${normalizeKey(title)}`;
  const sameRole = person.positions.filter(
    (p) => `${companyKey(p.companyName)}|${normalizeKey(p.title)}` === roleKey,
  );
  const existing =
    sameRole.find((p) => (p.startDate ?? '') === (seed.startDate ?? '')) ??
    sameRole.find((p) => !p.startDate || !seed.startDate) ??
    null;

  const co = upsertCompany(ctx.db, companyName, ctx.batchId, ctx.importedAt);
  // A position with no end date is treated as current unless told otherwise.
  const isCurrent =
    seed.isCurrent !== null && seed.isCurrent !== undefined
      ? seed.isCurrent
      : !seed.endDate;

  if (existing) {
    existing.title = title ?? existing.title;
    existing.companyName = companyName ?? existing.companyName;
    existing.companyId = co?.id ?? existing.companyId;
    // Dates fill in but never blank out — this is how a dateless stub gets
    // upgraded once a richer source supplies the real range.
    existing.startDate = seed.startDate ?? existing.startDate;
    existing.endDate = seed.endDate ?? existing.endDate;
    existing.location = clean(seed.location) ?? existing.location;
    existing.description = clean(seed.description) ?? existing.description;
    existing.isCurrent = isCurrent;
    touch(existing, ctx);
    return;
  }

  const record: Position = {
    id: newId('pos'),
    title,
    companyName,
    companyId: co?.id ?? null,
    startDate: seed.startDate ?? null,
    endDate: seed.endDate ?? null,
    isCurrent,
    location: clean(seed.location),
    description: clean(seed.description),
    ...prov(ctx),
  };
  person.positions.push(record);
  ctx.stats.positions += 1;
}

export interface EducationSeed {
  schoolName?: string | null;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  activities?: string | null;
  notes?: string | null;
}

export function addEducation(ctx: Ctx, person: Person, seed: EducationSeed): void {
  const schoolName = clean(seed.schoolName);
  if (!schoolName) return;

  const sig = `${schoolKey(schoolName)}|${normalizeKey(seed.degree)}|${normalizeKey(seed.fieldOfStudy)}`;
  const existing = person.education.find(
    (e) =>
      `${schoolKey(e.schoolName)}|${normalizeKey(e.degree)}|${normalizeKey(e.fieldOfStudy)}` === sig,
  );

  const sc = upsertSchool(ctx.db, schoolName, ctx.batchId, ctx.importedAt);

  if (existing) {
    existing.schoolId = sc?.id ?? existing.schoolId;
    existing.startDate = seed.startDate ?? existing.startDate;
    existing.endDate = seed.endDate ?? existing.endDate;
    existing.activities = clean(seed.activities) ?? existing.activities;
    existing.notes = clean(seed.notes) ?? existing.notes;
    touch(existing, ctx);
    return;
  }

  const record: Education = {
    id: newId('edu'),
    schoolName,
    schoolId: sc?.id ?? null,
    degree: clean(seed.degree),
    fieldOfStudy: clean(seed.fieldOfStudy),
    startDate: seed.startDate ?? null,
    endDate: seed.endDate ?? null,
    activities: clean(seed.activities),
    notes: clean(seed.notes),
    ...prov(ctx),
  };
  person.education.push(record);
  ctx.stats.education += 1;
}

export function addSkill(ctx: Ctx, person: Person, name: string | null): void {
  const n = clean(name);
  if (!n) return;
  const key = normalizeKey(n);
  const existing = person.skills.find((s) => normalizeKey(s.name) === key);
  if (existing) {
    touch(existing, ctx);
    return;
  }
  const record: SkillEntry = { id: newId('sk'), name: n, ...prov(ctx) };
  person.skills.push(record);
  ctx.stats.skills += 1;
}

export interface CertificationSeed {
  name?: string | null;
  authority?: string | null;
  licenseNumber?: string | null;
  url?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function addCertification(ctx: Ctx, person: Person, seed: CertificationSeed): void {
  const name = clean(seed.name);
  if (!name) return;
  const sig = `${normalizeKey(name)}|${normalizeKey(seed.authority)}`;
  const existing = person.certifications.find(
    (c) => `${normalizeKey(c.name)}|${normalizeKey(c.authority)}` === sig,
  );
  if (existing) {
    existing.url = clean(seed.url) ?? existing.url;
    existing.licenseNumber = clean(seed.licenseNumber) ?? existing.licenseNumber;
    existing.startDate = seed.startDate ?? existing.startDate;
    existing.endDate = seed.endDate ?? existing.endDate;
    touch(existing, ctx);
    return;
  }
  const record: CertificationEntry = {
    id: newId('cert'),
    name,
    authority: clean(seed.authority),
    licenseNumber: clean(seed.licenseNumber),
    url: clean(seed.url),
    startDate: seed.startDate ?? null,
    endDate: seed.endDate ?? null,
    ...prov(ctx),
  };
  person.certifications.push(record);
  ctx.stats.certifications += 1;
}

export interface VolunteeringSeed {
  organization?: string | null;
  role?: string | null;
  cause?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

export function addVolunteering(ctx: Ctx, person: Person, seed: VolunteeringSeed): void {
  const org = clean(seed.organization);
  const role = clean(seed.role);
  if (!org && !role) return;
  const sig = `${companyKey(org)}|${normalizeKey(role)}`;
  const existing = person.volunteering.find(
    (v) => `${companyKey(v.organization)}|${normalizeKey(v.role)}` === sig,
  );
  if (existing) {
    existing.cause = clean(seed.cause) ?? existing.cause;
    existing.startDate = seed.startDate ?? existing.startDate;
    existing.endDate = seed.endDate ?? existing.endDate;
    existing.description = clean(seed.description) ?? existing.description;
    touch(existing, ctx);
    return;
  }
  const record: VolunteeringEntry = {
    id: newId('vol'),
    organization: org,
    role,
    cause: clean(seed.cause),
    startDate: seed.startDate ?? null,
    endDate: seed.endDate ?? null,
    description: clean(seed.description),
    ...prov(ctx),
  };
  person.volunteering.push(record);
  ctx.stats.volunteering += 1;
}

export function addLanguage(
  ctx: Ctx,
  person: Person,
  name: string | null,
  proficiency: string | null,
): void {
  const n = clean(name);
  if (!n) return;
  const key = normalizeKey(n);
  const existing = person.languages.find((l) => normalizeKey(l.name) === key);
  if (existing) {
    existing.proficiency = clean(proficiency) ?? existing.proficiency;
    touch(existing, ctx);
    return;
  }
  const record: LanguageEntry = {
    id: newId('lang'),
    name: n,
    proficiency: clean(proficiency),
    ...prov(ctx),
  };
  person.languages.push(record);
  ctx.stats.languages += 1;
}

export interface ProjectSeed {
  name?: string | null;
  description?: string | null;
  url?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function addProject(ctx: Ctx, person: Person, seed: ProjectSeed): void {
  const name = clean(seed.name);
  if (!name) return;
  const key = normalizeKey(name);
  const existing = person.projects.find((p) => normalizeKey(p.name) === key);
  if (existing) {
    existing.description = clean(seed.description) ?? existing.description;
    existing.url = clean(seed.url) ?? existing.url;
    existing.startDate = seed.startDate ?? existing.startDate;
    existing.endDate = seed.endDate ?? existing.endDate;
    touch(existing, ctx);
    return;
  }
  const record: ProjectEntry = {
    id: newId('proj'),
    name,
    description: clean(seed.description),
    url: clean(seed.url),
    startDate: seed.startDate ?? null,
    endDate: seed.endDate ?? null,
    ...prov(ctx),
  };
  person.projects.push(record);
  ctx.stats.projects += 1;
}

export interface HonorSeed {
  title?: string | null;
  issuer?: string | null;
  date?: string | null;
  description?: string | null;
}

export function addHonor(ctx: Ctx, person: Person, seed: HonorSeed): void {
  const title = clean(seed.title);
  if (!title) return;
  const sig = `${normalizeKey(title)}|${normalizeKey(seed.issuer)}`;
  const existing = person.honors.find(
    (h) => `${normalizeKey(h.title)}|${normalizeKey(h.issuer)}` === sig,
  );
  if (existing) {
    existing.date = seed.date ?? existing.date;
    existing.description = clean(seed.description) ?? existing.description;
    touch(existing, ctx);
    return;
  }
  const record: HonorEntry = {
    id: newId('hon'),
    title,
    issuer: clean(seed.issuer),
    date: seed.date ?? null,
    description: clean(seed.description),
    ...prov(ctx),
  };
  person.honors.push(record);
  ctx.stats.honors += 1;
}

/**
 * Recompute the denormalized "current role" fields from position history and
 * sort history newest-first. Called once per person after an import settles.
 */
export function refreshDerived(person: Person): void {
  person.positions.sort((a, b) => dateSortKey(b.startDate) - dateSortKey(a.startDate));
  person.education.sort((a, b) => dateSortKey(b.endDate) - dateSortKey(a.endDate));
  person.certifications.sort((a, b) => dateSortKey(b.startDate) - dateSortKey(a.startDate));
  person.volunteering.sort((a, b) => dateSortKey(b.startDate) - dateSortKey(a.startDate));
  person.projects.sort((a, b) => dateSortKey(b.startDate) - dateSortKey(a.startDate));
  person.honors.sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));

  // Detailed position history is stronger evidence than a Connections.csv row,
  // so let an explicitly-current position define the present role.
  const current = person.positions.find((p) => p.isCurrent);
  if (current) {
    if (current.title) person.currentTitle = current.title;
    if (current.companyName) {
      person.currentCompany = current.companyName;
      person.currentCompanyId = current.companyId;
    }
  } else if (!person.currentCompanyId && person.currentCompany) {
    // Keep the id in step with the name when only the name was imported.
    const key = companyKey(person.currentCompany);
    person.currentCompanyId = key ? `co_${key.replace(/[^a-z0-9]+/g, '-')}` : null;
  }
}
