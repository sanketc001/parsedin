import type { Person } from '../types';
import { clean, parseDate } from '../normalize';
import { isOngoing, pick, readTable, type Row } from './csv';
import {
  addCertification,
  addEducation,
  addHonor,
  addLanguage,
  addPosition,
  addProject,
  addSkill,
  addVolunteering,
  applyPersonSeed,
  blankPerson,
  upsertPerson,
  type Ctx,
} from './merge';

// ---------------------------------------------------------------------------
// LinkedIn "Get a copy of your data" archive.
//
// Worth being explicit about a limitation of the source, because it shapes the
// whole product: LinkedIn's export contains *rich* history (positions,
// education, skills, certifications, volunteering, ...) only for the account
// owner. For connections it hands over just name, profile URL, email, current
// company, current title and the date you connected.
//
// So this importer fills out the owner's profile in full and creates one
// lightweight person per connection. Deeper per-connection history arrives via
// the enriched-JSON importer, which merges onto the same people.
// ---------------------------------------------------------------------------

/** Return the account owner's person record, creating it on first use. */
function ensureSelf(ctx: Ctx, name?: string | null): Person {
  if (!ctx.db.self) {
    ctx.db.self = blankPerson(clean(name) ?? 'You', {}, ctx.importedAt);
    ctx.db.self.connectionDegree = 0;
  }
  return ctx.db.self;
}

type Handler = (text: string, ctx: Ctx) => void;

// --- the owner's own profile -------------------------------------------------

const handleProfile: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['First Name', 'Last Name', 'Headline']);
  const row = rows[0];
  if (!row) return;
  const first = pick(row, 'First Name');
  const last = pick(row, 'Last Name');
  const self = ensureSelf(ctx, [first, last].filter(Boolean).join(' '));
  applyPersonSeed(ctx, self, {
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(' ') || null,
    headline: pick(row, 'Headline'),
    summary: pick(row, 'Summary'),
    industry: pick(row, 'Industry'),
    location: pick(row, 'Geo Location', 'Location', 'Address'),
    connectionDegree: 0,
  });
  ctx.stats.selfProfileUpdated = true;
};

const handleSelfEmail: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Email Address']);
  // Prefer the address LinkedIn marks primary, else the first one present.
  const primary =
    rows.find((r) => /yes|true/i.test(pick(r, 'Primary') ?? '')) ?? rows[0];
  if (!primary) return;
  const email = pick(primary, 'Email Address');
  if (!email) return;
  applyPersonSeed(ctx, ensureSelf(ctx), { email });
};

const handleSelfPositions: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Company Name', 'Title', 'Started On']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    const finished = pick(row, 'Finished On', 'End Date');
    addPosition(ctx, self, {
      title: pick(row, 'Title', 'Position'),
      companyName: pick(row, 'Company Name', 'Company'),
      startDate: parseDate(pick(row, 'Started On', 'Start Date')),
      endDate: parseDate(finished),
      isCurrent: isOngoing(finished),
      location: pick(row, 'Location'),
      description: pick(row, 'Description'),
    });
  }
};

const handleSelfEducation: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['School Name', 'Degree Name']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addEducation(ctx, self, {
      schoolName: pick(row, 'School Name', 'School'),
      degree: pick(row, 'Degree Name', 'Degree'),
      fieldOfStudy: pick(row, 'Field Of Study', 'Field of Study', 'Major'),
      startDate: parseDate(pick(row, 'Start Date', 'Started On')),
      endDate: parseDate(pick(row, 'End Date', 'Finished On')),
      activities: pick(row, 'Activities'),
      notes: pick(row, 'Notes'),
    });
  }
};

const handleSelfSkills: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Name', 'Skill']);
  const self = ensureSelf(ctx);
  for (const row of rows) addSkill(ctx, self, pick(row, 'Name', 'Skill'));
};

const handleSelfCertifications: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Name', 'Authority']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addCertification(ctx, self, {
      name: pick(row, 'Name', 'Certification Name'),
      authority: pick(row, 'Authority', 'Issuing Organization'),
      licenseNumber: pick(row, 'License Number'),
      url: pick(row, 'Url', 'URL'),
      startDate: parseDate(pick(row, 'Started On', 'Start Date', 'Issued On')),
      endDate: parseDate(pick(row, 'Finished On', 'End Date', 'Expires On')),
    });
  }
};

const handleSelfVolunteering: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Company Name', 'Role', 'Cause']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addVolunteering(ctx, self, {
      organization: pick(row, 'Company Name', 'Organization', 'Organisation'),
      role: pick(row, 'Role', 'Title'),
      cause: pick(row, 'Cause'),
      startDate: parseDate(pick(row, 'Started On', 'Start Date')),
      endDate: parseDate(pick(row, 'Finished On', 'End Date')),
      description: pick(row, 'Description'),
    });
  }
};

const handleSelfLanguages: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Name', 'Proficiency']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addLanguage(ctx, self, pick(row, 'Name', 'Language'), pick(row, 'Proficiency'));
  }
};

const handleSelfProjects: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Title', 'Description']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addProject(ctx, self, {
      name: pick(row, 'Title', 'Name', 'Project Name'),
      description: pick(row, 'Description'),
      url: pick(row, 'Url', 'URL'),
      startDate: parseDate(pick(row, 'Started On', 'Start Date')),
      endDate: parseDate(pick(row, 'Finished On', 'End Date')),
    });
  }
};

const handleSelfHonors: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Title', 'Issued On', 'Honor Title']);
  const self = ensureSelf(ctx);
  for (const row of rows) {
    addHonor(ctx, self, {
      title: pick(row, 'Title', 'Honor Title', 'Name'),
      issuer: pick(row, 'Issuer', 'Issued By'),
      date: parseDate(pick(row, 'Issued On', 'Date')),
      description: pick(row, 'Description'),
    });
  }
};

// --- connections -------------------------------------------------------------

const handleConnections: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['First Name', 'Last Name', 'URL', 'Connected On']);
  for (const row of rows) {
    const first = pick(row, 'First Name');
    const last = pick(row, 'Last Name');
    const full = [first, last].filter(Boolean).join(' ');
    if (!full) {
      ctx.stats.rowsSkipped += 1;
      continue;
    }
    const person = upsertPerson(ctx, {
      firstName: first,
      lastName: last,
      fullName: full,
      linkedinUrl: pick(row, 'URL', 'Profile Url', 'Profile URL'),
      email: pick(row, 'Email Address', 'Email'),
      currentCompany: pick(row, 'Company'),
      currentTitle: pick(row, 'Position', 'Title'),
      connectedOn: parseDate(pick(row, 'Connected On')),
      // Everything in Connections.csv is a direct connection by definition.
      connectionDegree: 1,
    });
    if (!person) continue;

    // Record the current role as a position too, so career history and the
    // company explorer see it without special-casing the denormalized fields.
    const company = pick(row, 'Company');
    const title = pick(row, 'Position', 'Title');
    if (company || title) {
      addPosition(ctx, person, {
        title,
        companyName: company,
        startDate: null,
        endDate: null,
        isCurrent: true,
      });
    }
  }
};

/**
 * Pending and past invitations. Useful signal but not a connection — imported
 * only as a person stub when we have never seen the name before.
 */
const handleInvitations: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['From', 'To', 'Sent At', 'Direction']);
  for (const row of rows) {
    const direction = (pick(row, 'Direction') ?? '').toUpperCase();
    // OUTGOING rows name us in "From"; the other party is in "To".
    const other =
      direction === 'OUTGOING' ? pick(row, 'To') : pick(row, 'From');
    if (!other) continue;
    upsertPerson(ctx, { fullName: other, connectionDegree: 2 });
  }
};

// --- file registry -----------------------------------------------------------

interface FileSpec {
  /** Matched against the lowercased basename with spaces/underscores folded. */
  match: RegExp;
  handler: Handler;
  label: string;
}

const FILES: FileSpec[] = [
  { match: /^connections\.csv$/, handler: handleConnections, label: 'Connections' },
  { match: /^profile\.csv$/, handler: handleProfile, label: 'Profile' },
  { match: /^emailaddresses\.csv$/, handler: handleSelfEmail, label: 'Email Addresses' },
  { match: /^positions\.csv$/, handler: handleSelfPositions, label: 'Positions' },
  { match: /^education\.csv$/, handler: handleSelfEducation, label: 'Education' },
  { match: /^skills\.csv$/, handler: handleSelfSkills, label: 'Skills' },
  { match: /^certifications\.csv$/, handler: handleSelfCertifications, label: 'Certifications' },
  {
    match: /^(volunteering|volunteerexperience|volunteeringexperiences)\.csv$/,
    handler: handleSelfVolunteering,
    label: 'Volunteering',
  },
  { match: /^languages\.csv$/, handler: handleSelfLanguages, label: 'Languages' },
  { match: /^projects\.csv$/, handler: handleSelfProjects, label: 'Projects' },
  {
    match: /^(honors|honorsandawards|honorsawards)\.csv$/,
    handler: handleSelfHonors,
    label: 'Honors',
  },
  { match: /^invitations\.csv$/, handler: handleInvitations, label: 'Invitations' },
];

/** Fold a path into a comparable basename: "CSV/Email Addresses.csv" -> "emailaddresses.csv". */
export function foldName(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  return base.toLowerCase().replace(/[\s_-]+/g, '');
}

export function findHandler(pathOrName: string): FileSpec | null {
  const folded = foldName(pathOrName);
  return FILES.find((f) => f.match.test(folded)) ?? null;
}

export type { Row };
