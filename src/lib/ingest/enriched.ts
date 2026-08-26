import { clean, parseDate } from '../normalize';
import {
  addCertification,
  addEducation,
  addHonor,
  addLanguage,
  addPosition,
  addProject,
  addSkill,
  addVolunteering,
  upsertPerson,
  type Ctx,
} from './merge';

// ---------------------------------------------------------------------------
// Enriched profile JSON.
//
// LinkedIn's own export is thin on connections (see linkedin.ts), so this is
// the path for layering full career/education history onto people you already
// have. It merges by LinkedIn URL first, name second — so importing enrichment
// for someone already in the graph deepens that record rather than duplicating.
//
// The reader is permissive about shape: it accepts a bare array, or an object
// keyed `profiles` / `connections` / `people`, and tolerates common key
// spellings for each field.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function firstOf(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function str(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function asBool(value: any): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    if (/^(true|yes|y|1|current|present)$/i.test(value)) return true;
    if (/^(false|no|n|0)$/i.test(value)) return false;
  }
  return null;
}

function asDegree(value: any): number | null {
  const s = str(value);
  if (!s) return null;
  const m = s.match(/[0-9]/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 0 && n <= 3 ? n : null;
}

/** Pull the profile list out of whatever envelope the file uses. */
export function extractProfiles(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  const list =
    firstOf(parsed, 'profiles', 'connections', 'people', 'contacts', 'data') ?? null;
  if (Array.isArray(list)) return list;
  // A single profile object.
  if (parsed && typeof parsed === 'object' && (parsed.fullName || parsed.name)) {
    return [parsed];
  }
  return [];
}

export function importProfiles(ctx: Ctx, profiles: any[]): void {
  for (const raw of profiles) {
    if (!raw || typeof raw !== 'object') {
      ctx.stats.rowsSkipped += 1;
      continue;
    }

    const fullName = str(firstOf(raw, 'fullName', 'name', 'full_name', 'displayName'));
    const firstName = str(firstOf(raw, 'firstName', 'first_name', 'givenName'));
    const lastName = str(firstOf(raw, 'lastName', 'last_name', 'familyName', 'surname'));

    const person = upsertPerson(ctx, {
      fullName,
      firstName,
      lastName,
      linkedinUrl: str(
        firstOf(raw, 'linkedinUrl', 'url', 'profileUrl', 'profile_url', 'linkedin'),
      ),
      email: str(firstOf(raw, 'email', 'emailAddress', 'email_address')),
      headline: str(firstOf(raw, 'headline', 'tagline')),
      currentTitle: str(firstOf(raw, 'currentTitle', 'title', 'position', 'jobTitle')),
      currentCompany: str(
        firstOf(raw, 'currentCompany', 'company', 'companyName', 'employer'),
      ),
      location: str(firstOf(raw, 'location', 'geoLocation', 'city', 'region')),
      industry: str(firstOf(raw, 'industry', 'sector')),
      summary: str(firstOf(raw, 'summary', 'about', 'bio')),
      connectedOn: parseDate(firstOf(raw, 'connectedOn', 'connected_on', 'connectionDate')),
      connectionDegree: asDegree(
        firstOf(raw, 'connectionDegree', 'degree', 'connection_degree'),
      ),
    });
    if (!person) continue;

    // --- positions ---
    for (const p of asArray(firstOf(raw, 'positions', 'experience', 'experiences', 'jobs'))) {
      if (!p || typeof p !== 'object') continue;
      const endDate = parseDate(firstOf(p, 'endDate', 'end_date', 'finishedOn', 'to'));
      const explicit = asBool(firstOf(p, 'isCurrent', 'current', 'is_current'));
      addPosition(ctx, person, {
        title: str(firstOf(p, 'title', 'position', 'role', 'jobTitle')),
        companyName: str(firstOf(p, 'company', 'companyName', 'company_name', 'organization')),
        startDate: parseDate(firstOf(p, 'startDate', 'start_date', 'startedOn', 'from')),
        endDate,
        isCurrent: explicit !== null ? explicit : !endDate,
        location: str(firstOf(p, 'location', 'city')),
        description: str(firstOf(p, 'description', 'summary')),
      });
    }

    // --- education ---
    for (const e of asArray(firstOf(raw, 'education', 'educations', 'schools'))) {
      if (!e || typeof e !== 'object') {
        // Allow a bare string: "IIT Bombay"
        const name = str(e);
        if (name) addEducation(ctx, person, { schoolName: name });
        continue;
      }
      addEducation(ctx, person, {
        schoolName: str(firstOf(e, 'school', 'schoolName', 'school_name', 'institution', 'name')),
        degree: str(firstOf(e, 'degree', 'degreeName', 'degree_name', 'qualification')),
        fieldOfStudy: str(firstOf(e, 'fieldOfStudy', 'field_of_study', 'field', 'major')),
        startDate: parseDate(firstOf(e, 'startDate', 'start_date', 'from', 'startYear')),
        endDate: parseDate(firstOf(e, 'endDate', 'end_date', 'to', 'endYear', 'graduationYear')),
        activities: str(firstOf(e, 'activities')),
        notes: str(firstOf(e, 'notes', 'description')),
      });
    }

    // --- skills (strings or {name}) ---
    for (const s of asArray(firstOf(raw, 'skills', 'skill'))) {
      addSkill(ctx, person, typeof s === 'string' ? s : str(firstOf(s, 'name', 'skill', 'title')));
    }

    // --- certifications ---
    for (const c of asArray(firstOf(raw, 'certifications', 'certificates', 'licenses'))) {
      if (typeof c === 'string') {
        addCertification(ctx, person, { name: c });
        continue;
      }
      addCertification(ctx, person, {
        name: str(firstOf(c, 'name', 'title', 'certification')),
        authority: str(firstOf(c, 'authority', 'issuer', 'organization', 'issuingOrganization')),
        licenseNumber: str(firstOf(c, 'licenseNumber', 'license_number', 'credentialId')),
        url: str(firstOf(c, 'url', 'link', 'credentialUrl')),
        startDate: parseDate(firstOf(c, 'startDate', 'issuedOn', 'issueDate', 'from')),
        endDate: parseDate(firstOf(c, 'endDate', 'expiresOn', 'expirationDate', 'to')),
      });
    }

    // --- volunteering ---
    for (const v of asArray(firstOf(raw, 'volunteering', 'volunteerExperience', 'volunteer'))) {
      if (typeof v === 'string') {
        addVolunteering(ctx, person, { organization: v });
        continue;
      }
      addVolunteering(ctx, person, {
        organization: str(firstOf(v, 'organization', 'organisation', 'company', 'companyName')),
        role: str(firstOf(v, 'role', 'title', 'position')),
        cause: str(firstOf(v, 'cause')),
        startDate: parseDate(firstOf(v, 'startDate', 'startedOn', 'from')),
        endDate: parseDate(firstOf(v, 'endDate', 'finishedOn', 'to')),
        description: str(firstOf(v, 'description')),
      });
    }

    // --- languages ---
    for (const l of asArray(firstOf(raw, 'languages', 'language'))) {
      if (typeof l === 'string') {
        addLanguage(ctx, person, l, null);
        continue;
      }
      addLanguage(
        ctx,
        person,
        str(firstOf(l, 'name', 'language')),
        str(firstOf(l, 'proficiency', 'level')),
      );
    }

    // --- projects ---
    for (const p of asArray(firstOf(raw, 'projects', 'project'))) {
      if (typeof p === 'string') {
        addProject(ctx, person, { name: p });
        continue;
      }
      addProject(ctx, person, {
        name: str(firstOf(p, 'name', 'title')),
        description: str(firstOf(p, 'description', 'summary')),
        url: str(firstOf(p, 'url', 'link')),
        startDate: parseDate(firstOf(p, 'startDate', 'startedOn', 'from')),
        endDate: parseDate(firstOf(p, 'endDate', 'finishedOn', 'to')),
      });
    }

    // --- honors ---
    for (const h of asArray(firstOf(raw, 'honors', 'awards', 'honorsAndAwards'))) {
      if (typeof h === 'string') {
        addHonor(ctx, person, { title: h });
        continue;
      }
      addHonor(ctx, person, {
        title: str(firstOf(h, 'title', 'name', 'honor')),
        issuer: str(firstOf(h, 'issuer', 'issuedBy', 'organization')),
        date: parseDate(firstOf(h, 'date', 'issuedOn', 'issueDate')),
        description: str(firstOf(h, 'description')),
      });
    }
  }
}
