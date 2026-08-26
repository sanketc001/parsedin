import type { Company, Database, School } from './types';
import { companyKey, schoolKey, slugId, uniq } from './normalize';

// ---------------------------------------------------------------------------
// Company and school registries.
//
// Kept separate from db.ts (which touches the filesystem) so the whole ingest
// and query layer stays free of Node built-ins and can be imported from client
// components without dragging `node:fs` into the browser bundle.
// ---------------------------------------------------------------------------

/**
 * Find-or-create a company by normalized name. Returns the canonical record
 * and records the surface form as an alias when it is new.
 */
export function upsertCompany(
  db: Database,
  name: string | null,
  batchId: string,
  now: string,
): Company | null {
  const key = companyKey(name);
  if (!key || !name) return null;

  let company = db.companies.find((c) => c.nameKey === key);
  if (!company) {
    company = {
      id: slugId('co', key),
      name,
      nameKey: key,
      aliases: [name],
      industry: null,
      website: null,
      sourceBatchIds: [batchId],
      firstSeenAt: now,
      lastUpdatedAt: now,
    };
    db.companies.push(company);
    return company;
  }

  if (!company.aliases.includes(name)) company.aliases.push(name);
  // Prefer the shortest surface form for display. Variants that share a
  // normalized key differ only by stripped noise, so the shortest is the clean
  // brand name: "Google" over "Google LLC", "Stripe" over "Stripe, Inc.".
  // Genuinely different entities ("IBM" vs "IBM India") get different keys.
  if (name.length < company.name.length) company.name = name;
  company.sourceBatchIds = uniq([...company.sourceBatchIds, batchId]);
  company.lastUpdatedAt = now;
  return company;
}

export function upsertSchool(
  db: Database,
  name: string | null,
  batchId: string,
  now: string,
): School | null {
  const key = schoolKey(name);
  if (!key || !name) return null;

  let school = db.schools.find((s) => s.nameKey === key);
  if (!school) {
    school = {
      id: slugId('sc', key),
      name,
      nameKey: key,
      aliases: [name],
      sourceBatchIds: [batchId],
      firstSeenAt: now,
      lastUpdatedAt: now,
    };
    db.schools.push(school);
    return school;
  }

  if (!school.aliases.includes(name)) school.aliases.push(name);
  if (name.length < school.name.length) school.name = name;
  school.sourceBatchIds = uniq([...school.sourceBatchIds, batchId]);
  school.lastUpdatedAt = now;
  return school;
}
