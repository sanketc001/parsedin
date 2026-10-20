import type {
  AdSegment,
  Conversation,
  Database,
  EngagementItem,
  Message,
  Person,
} from '../types';
import {
  clean,
  companyKey,
  normalizeKey,
  parseDate,
  parseTimestamp,
  stableId,
  uniq,
  urlKey as toUrlKey,
} from '../normalize';
import { pick, readMatrix, readTable, type Row } from './csv';
import { addSkill, upsertPerson, type Ctx } from './merge';

// ---------------------------------------------------------------------------
// The activity half of the LinkedIn export.
//
// Everything here describes the account owner's *behaviour* rather than
// anyone's profile: messages exchanged, invitations, endorsements, follows,
// job applications, feed engagement, learning, logins, and the advertising
// profile LinkedIn built. These files are what make the export more than a
// contact list — they say who you actually talk to and when you stopped.
//
// Two rules run through all of it:
//
//  1. Records get deterministic ids derived from their natural key, because
//     every export is a full snapshot. Re-importing must update, not double.
//  2. Companies and people are *linked* to, never invented. A company you
//     follow or applied to does not belong in a registry that means "places
//     people in my network work", so it links only if it is already there.
//     Message counterparties are the exception: a recruiter who wrote to you
//     is a real person in your network history, and gets a record.
// ---------------------------------------------------------------------------

type Handler = (text: string, ctx: Ctx) => void;

/** Names LinkedIn substitutes for profiles it will not identify. */
const ANONYMOUS = new Set(['linkedin member', 'linkedin user', '']);

function isAnonymous(name: string | null): boolean {
  return ANONYMOUS.has(normalizeKey(name));
}

/**
 * Flatten an HTML fragment to readable text. Block-level tags become line
 * breaks so a multi-paragraph InMail does not collapse into one run-on line.
 */
function stripMarkup(value: string): string {
  if (!/<[a-z/][^>]*>/i.test(value)) return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Merge a record into a keyed list, preserving batch provenance. */
function upsert<T extends { id: string; sourceBatchIds: string[] }>(
  list: T[],
  record: T,
  ctx: Ctx,
): boolean {
  const at = list.findIndex((r) => r.id === record.id);
  if (at === -1) {
    record.sourceBatchIds = [ctx.batchId];
    list.push(record);
    return true;
  }
  const previous = list[at];
  list[at] = { ...record, sourceBatchIds: uniq([...previous.sourceBatchIds, ctx.batchId]) };
  return false;
}

/**
 * A company id only if this company is already in the graph.
 *
 * Deliberately conservative: it is far more useful to know that you applied to
 * a company where you know six people than to add an empty company record for
 * every job you ever clicked save on.
 */
function existingCompanyId(db: Database, name: string | null): string | null {
  const key = companyKey(name);
  if (!key) return null;
  const rule = db.resolution?.aliases.find((a) => a.fromKey === key);
  if (rule) return rule.canonicalId;
  return db.companies.find((c) => c.nameKey === key)?.id ?? null;
}

/** An existing person, by URL first and then by an unambiguous name. */
function findPerson(db: Database, name: string | null, url: string | null): Person | null {
  const uk = toUrlKey(url);
  if (uk) {
    const byUrl = db.people.find((p) => p.urlKey === uk);
    if (byUrl) return byUrl;
    if (db.self?.urlKey === uk) return db.self;
  }
  const nk = normalizeKey(name);
  if (!nk || isAnonymous(name)) return null;
  const matches = db.people.filter((p) => p.nameKey === nk);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Is this row's author the account owner?
 *
 * Profile.csv does not include your own profile URL, so identity is bootstrapped
 * from Invitations.csv (whose OUTGOING rows name you as the inviter) and falls
 * back to your own name — unambiguous enough inside your own inbox.
 */
function isSelf(ctx: Ctx, name: string | null, url: string | null): boolean {
  const uk = toUrlKey(url);
  const selfUrl = ctx.db.self?.urlKey ?? null;
  if (uk && selfUrl) return uk === selfUrl;
  const nk = normalizeKey(name);
  return !!nk && !!ctx.db.self && nk === ctx.db.self.nameKey;
}

// --- invitations -------------------------------------------------------------

/**
 * Invitations, and the first place we learn the owner's own profile URL.
 *
 * Runs before messages precisely for that: with the owner's URL known, every
 * later file can tell inbound from outbound by identity rather than by name.
 */
const handleInvitations: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['From', 'To', 'Sent At', 'Direction']);

  // The owner appears on the sending side of every OUTGOING row.
  const ownUrls = new Map<string, number>();
  for (const row of rows) {
    const outgoing = (pick(row, 'Direction') ?? '').toUpperCase() === 'OUTGOING';
    const mine = outgoing
      ? pick(row, 'inviterProfileUrl', 'Inviter Profile Url')
      : pick(row, 'inviteeProfileUrl', 'Invitee Profile Url');
    const key = toUrlKey(mine);
    if (key) ownUrls.set(key, (ownUrls.get(key) ?? 0) + 1);
  }
  const best = [...ownUrls.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && ctx.db.self && !ctx.db.self.urlKey) {
    ctx.db.self.linkedinUrl = `https://www.${best[0]}`;
    ctx.db.self.urlKey = best[0];
    ctx.db.self.fieldSources.linkedinUrl = {
      batchId: ctx.batchId,
      importedAt: ctx.importedAt,
      sourceLabel: ctx.sourceLabel,
    };
  }

  for (const row of rows) {
    const outgoing = (pick(row, 'Direction') ?? '').toUpperCase() === 'OUTGOING';
    const name = outgoing ? pick(row, 'To') : pick(row, 'From');
    if (!name) continue;
    const url = outgoing
      ? pick(row, 'inviteeProfileUrl', 'Invitee Profile Url')
      : pick(row, 'inviterProfileUrl', 'Inviter Profile Url');
    const sentAt = parseTimestamp(pick(row, 'Sent At'));

    // An invitation proves at least a 2nd-degree relationship, but the same
    // person may already be a confirmed connection — never downgrade them.
    const person = isAnonymous(name)
      ? null
      : upsertPerson(ctx, { fullName: name, linkedinUrl: url, connectionDegreeIfUnknown: 2 });

    const created = upsert(
      ctx.db.activity.invitations,
      {
        id: stableId('inv', toUrlKey(url) ?? normalizeKey(name), sentAt, outgoing ? 'o' : 'i'),
        personId: person?.id ?? null,
        name,
        profileUrl: clean(url),
        direction: outgoing ? 'outgoing' : 'incoming',
        sentAt,
        message: clean(pick(row, 'Message')),
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.invitations += 1;
  }
};

// --- messages ----------------------------------------------------------------

/**
 * The message archive: 1:1 and group threads, oldest export first.
 *
 * This is the single richest file in the export and the only one that records
 * a two-way relationship. Threads are kept whole — the body text is what makes
 * the inbox searchable years later — and each thread links to the people it
 * could resolve.
 */
const handleMessages: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['CONVERSATION ID', 'FROM', 'DATE', 'CONTENT']);
  const threads = new Map<string, Row[]>();
  for (const row of rows) {
    const id = pick(row, 'CONVERSATION ID');
    if (!id) {
      ctx.stats.rowsSkipped += 1;
      continue;
    }
    const list = threads.get(id);
    if (list) list.push(row);
    else threads.set(id, [row]);
  }

  for (const [conversationId, thread] of threads) {
    const messages: Message[] = [];
    // Counterparty identity, accumulated across the thread: a 1:1 conversation
    // names the other party on whichever side of each row is not us.
    const others = new Map<string, { name: string; url: string | null }>();
    let folder: string | null = null;
    let title: string | null = null;

    for (const row of thread) {
      const from = pick(row, 'FROM') ?? '';
      const senderUrl = pick(row, 'SENDER PROFILE URL');
      const to = pick(row, 'TO') ?? '';
      const recipientUrls = (pick(row, 'RECIPIENT PROFILE URLS') ?? '')
        .split(/[\s,;]+/)
        .map((u) => u.trim())
        .filter(Boolean);
      const at = parseTimestamp(pick(row, 'DATE'));
      if (!at) {
        ctx.stats.rowsSkipped += 1;
        continue;
      }
      const outbound = isSelf(ctx, from, senderUrl);

      if (outbound) {
        // Recipient names are not separably delimited when there are several,
        // so a group thread keeps the joined string and one entry per URL.
        if (recipientUrls.length <= 1) {
          const url = recipientUrls[0] ?? null;
          const key = toUrlKey(url) ?? normalizeKey(to);
          if (key && !isAnonymous(to)) others.set(key, { name: to, url });
        } else {
          for (const url of recipientUrls) {
            const key = toUrlKey(url);
            if (key && !others.has(key)) others.set(key, { name: to, url });
          }
        }
      } else if (!isAnonymous(from)) {
        const key = toUrlKey(senderUrl) ?? normalizeKey(from);
        if (key) others.set(key, { name: from, url: senderUrl });
      }

      folder = folder ?? clean(pick(row, 'FOLDER'));
      title = title ?? clean(pick(row, 'CONVERSATION TITLE'));

      // Sponsored InMails arrive as rich-text fragments from LinkedIn's own
      // editor. Nothing renders HTML here, so tags would show up as literal
      // markup in the thread; strip them and keep the words.
      const body = stripMarkup(pick(row, 'CONTENT') ?? '');
      messages.push({
        id: stableId('msg', conversationId, at, from, body.slice(0, 80)),
        at,
        outbound,
        from: from || 'LinkedIn Member',
        subject: clean(pick(row, 'SUBJECT')),
        body,
        hasAttachment: !!clean(pick(row, 'ATTACHMENTS')),
      });
    }

    if (messages.length === 0) continue;
    messages.sort((a, b) => a.at.localeCompare(b.at));

    // Only create a person when the export identified them. A name with no URL
    // that matches nobody is left as a bare participant name rather than a new
    // record we could never merge confidently later.
    const personIds: string[] = [];
    for (const { name, url } of others.values()) {
      const existing = findPerson(ctx.db, name, url);
      if (existing) {
        if (existing.id !== ctx.db.self?.id) personIds.push(existing.id);
        continue;
      }
      if (!toUrlKey(url)) continue;
      const person = upsertPerson(ctx, {
        fullName: name,
        linkedinUrl: url,
        connectionDegreeIfUnknown: 2,
      });
      if (person) personIds.push(person.id);
    }

    const sent = messages.filter((m) => m.outbound).length;

    // Two independent tells for an advert. LinkedIn labels most of them
    // outright; the rest give themselves away by arriving from a sender it
    // will not identify, carrying a campaign subject line, and never being
    // answered. Requiring all three keeps a genuinely anonymized contact —
    // someone who deleted their account — out of the bucket.
    const inbound = messages.filter((m) => !m.outbound);
    const sponsored =
      /sponsor/i.test(title ?? '') ||
      (sent === 0 &&
        inbound.length > 0 &&
        others.size === 0 &&
        inbound.some((m) => !!m.subject || /%[A-Z]+%/.test(m.body)));

    const conversation: Conversation = {
      id: conversationId,
      title,
      personIds: uniq(personIds),
      participantNames: uniq([...others.values()].map((o) => o.name).filter(Boolean)),
      participantUrls: uniq(
        [...others.values()].map((o) => clean(o.url)).filter((u): u is string => !!u),
      ),
      folder,
      messages,
      firstAt: messages[0].at,
      lastAt: messages[messages.length - 1].at,
      sent,
      received: messages.length - sent,
      lastInbound: !messages[messages.length - 1].outbound,
      sponsored,
      sourceBatchIds: [],
    };

    const created = upsert(ctx.db.activity.conversations, conversation, ctx);
    if (created) ctx.stats.conversations += 1;
    ctx.stats.messages += messages.length;
  }
};

// --- endorsements ------------------------------------------------------------

function readEndorsements(direction: 'received' | 'given'): Handler {
  const who = direction === 'received' ? 'Endorser' : 'Endorsee';
  return (text, ctx) => {
    const { rows } = readTable(text, ['Endorsement Date', 'Skill Name']);
    for (const row of rows) {
      const skill = pick(row, 'Skill Name', 'Skill');
      if (!skill) continue;
      const first = pick(row, `${who} First Name`);
      const last = pick(row, `${who} Last Name`);
      const name = [first, last].filter(Boolean).join(' ');
      const url = pick(row, `${who} Public Url`, `${who} Public URL`, `${who} Profile Url`);
      const at = parseTimestamp(pick(row, 'Endorsement Date'));
      const status = pick(row, 'Endorsement Status');

      const person = !name || isAnonymous(name)
        ? null
        : upsertPerson(ctx, {
            fullName: name,
            firstName: first,
            lastName: last,
            linkedinUrl: url,
            connectionDegreeIfUnknown: 1,
          });

      // An endorsement you gave is a fact about the other person's skills —
      // the only per-connection skill data the export contains anywhere.
      if (direction === 'given' && person) addSkill(ctx, person, skill);
      if (direction === 'received' && ctx.db.self) addSkill(ctx, ctx.db.self, skill);

      const created = upsert(
        ctx.db.activity.endorsements,
        {
          id: stableId('end', direction, toUrlKey(url) ?? normalizeKey(name), skill, at),
          personId: person?.id ?? null,
          name: name || 'LinkedIn Member',
          profileUrl: clean(url),
          skill,
          direction,
          at,
          status,
          sourceBatchIds: [],
        },
        ctx,
      );
      if (created) ctx.stats.endorsements += 1;
    }
  };
}

// --- follows -----------------------------------------------------------------

const handleCompanyFollows: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Organization', 'Followed On']);
  for (const row of rows) {
    const name = pick(row, 'Organization', 'Company', 'Organisation');
    if (!name) continue;
    const created = upsert(
      ctx.db.activity.companyFollows,
      {
        id: stableId('cfo', companyKey(name)),
        name,
        companyId: existingCompanyId(ctx.db, name),
        at: parseTimestamp(pick(row, 'Followed On', 'Date')),
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.follows += 1;
  }
};

const handleMemberFollows: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['FullName', 'Status', 'Date']);
  for (const row of rows) {
    const name = pick(row, 'FullName', 'Full Name', 'Name');
    if (!name || isAnonymous(name)) continue;
    // Followed people carry no profile URL, so link only to someone already in
    // the graph — creating name-only records would poison entity resolution.
    const person = findPerson(ctx.db, name, null);
    const created = upsert(
      ctx.db.activity.memberFollows,
      {
        id: stableId('mfo', normalizeKey(name)),
        name,
        personId: person && person.id !== ctx.db.self?.id ? person.id : null,
        at: parseTimestamp(pick(row, 'Date', 'Followed On')),
        status: pick(row, 'Status'),
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.follows += 1;
  }
};

// --- job search --------------------------------------------------------------

const handleJobApplications: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Application Date', 'Company Name', 'Job Title']);
  for (const row of rows) {
    const company = pick(row, 'Company Name', 'Company');
    const title = pick(row, 'Job Title', 'Title');
    if (!company && !title) continue;
    const at = parseTimestamp(pick(row, 'Application Date', 'Date'));
    const created = upsert(
      ctx.db.activity.jobApplications,
      {
        id: stableId('app', companyKey(company), normalizeKey(title), at),
        at,
        company,
        companyId: existingCompanyId(ctx.db, company),
        title,
        url: pick(row, 'Job Url', 'Job URL'),
        resume: pick(row, 'Resume Name'),
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.jobRecords += 1;
  }
};

const handleSavedJobs: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Saved Date', 'Job Title', 'Company Name']);
  for (const row of rows) {
    const company = pick(row, 'Company Name', 'Company');
    const title = pick(row, 'Job Title', 'Title');
    if (!company && !title) continue;
    const at = parseTimestamp(pick(row, 'Saved Date', 'Date'));
    const created = upsert(
      ctx.db.activity.savedJobs,
      {
        id: stableId('sj', companyKey(company), normalizeKey(title), at),
        at,
        company,
        companyId: existingCompanyId(ctx.db, company),
        title,
        url: pick(row, 'Job Url', 'Job URL'),
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.jobRecords += 1;
  }
};

/** Split LinkedIn's pipe-delimited multi-value preference cells. */
function splitPipes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

const handleJobPreferences: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Locations', 'Job Titles', 'Preferred Job Types']);
  const row = rows[0];
  if (!row) return;
  const yesNo = (v: string | null): boolean | null =>
    v === null ? null : /^(yes|true)$/i.test(v);
  ctx.db.activity.jobPreferences = {
    locations: splitPipes(pick(row, 'Locations')),
    jobTitles: splitPipes(pick(row, 'Job Titles')),
    jobTypes: splitPipes(pick(row, 'Preferred Job Types')),
    industries: splitPipes(pick(row, 'Industries')),
    dreamCompanies: splitPipes(pick(row, 'Dream Companies')),
    openToRecruiters: yesNo(pick(row, 'Open To Recruiters')),
    urgency: pick(row, 'Job Seeking Urgency Level'),
    visibility: pick(row, 'Open Candidate Visibility'),
    introduction: pick(row, 'Introduction Statement'),
  };
};

const handleJobAlerts: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['QUERY_CONTEXT', 'SAVED_SEARCH_ID']);
  for (const row of rows) {
    // The context column is a Java map dump, not JSON: {keywords=X, ...}.
    const context = pick(row, 'QUERY_CONTEXT') ?? '';
    const field = (name: string): string | null => {
      const m = context.match(new RegExp(`${name}=([^,}\\]]+)`, 'i'));
      return m ? clean(m[1]) : null;
    };
    const keywords = field('keywords');
    const location = field('locationName') ?? field('geoUrn') ?? field('location');
    if (!keywords && !location) continue;
    const created = upsert(
      ctx.db.activity.jobAlerts,
      {
        id: stableId('jal', pick(row, 'SAVED_SEARCH_ID') ?? `${keywords}${location}`),
        keywords,
        location,
        sourceBatchIds: [],
      },
      ctx,
    );
    if (created) ctx.stats.jobRecords += 1;
  }
};

// --- feed engagement ---------------------------------------------------------

function addEngagement(ctx: Ctx, item: Omit<EngagementItem, 'sourceBatchIds'>): void {
  const created = upsert(ctx.db.activity.engagement, { ...item, sourceBatchIds: [] }, ctx);
  if (created) ctx.stats.engagement += 1;
}

const handleShares: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['ShareLink', 'ShareCommentary', 'Date']);
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Date'));
    if (!at) continue;
    const url = pick(row, 'ShareLink', 'Share Link');
    addEngagement(ctx, {
      id: stableId('eng', 'post', at, url),
      kind: 'post',
      at,
      url,
      text: pick(row, 'ShareCommentary', 'Share Commentary') ?? pick(row, 'SharedUrl'),
      reactionType: null,
      visibility: pick(row, 'Visibility'),
    });
  }
};

const handleComments: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Date', 'Link', 'Message']);
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Date'));
    if (!at) continue;
    addEngagement(ctx, {
      id: stableId('eng', 'comment', at, pick(row, 'Link')),
      kind: 'comment',
      at,
      url: pick(row, 'Link'),
      text: pick(row, 'Message', 'Comment'),
      reactionType: null,
      visibility: null,
    });
  }
};

const handleReactions: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Date', 'Type', 'Link']);
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Date'));
    if (!at) continue;
    addEngagement(ctx, {
      id: stableId('eng', 'reaction', at, pick(row, 'Link')),
      kind: 'reaction',
      at,
      url: pick(row, 'Link'),
      text: null,
      reactionType: pick(row, 'Type'),
      visibility: null,
    });
  }
};

const handleVotes: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Date', 'Link', 'OptionText']);
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Date'));
    if (!at) continue;
    addEngagement(ctx, {
      id: stableId('eng', 'vote', at, pick(row, 'Link')),
      kind: 'vote',
      at,
      url: pick(row, 'Link'),
      text: pick(row, 'OptionText', 'Option'),
      reactionType: null,
      visibility: null,
    });
  }
};

// --- learning, events, verifications -----------------------------------------

const handleLearning: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Content Title', 'Content Type']);
  for (const row of rows) {
    const title = pick(row, 'Content Title', 'Title');
    if (!title) continue;
    upsert(
      ctx.db.activity.learning,
      {
        id: stableId('lrn', normalizeKey(title)),
        title,
        // Descriptions arrive as HTML fragments; the markup is never useful.
        description: clean((pick(row, 'Content Description') ?? '').replace(/<[^>]*>/g, ' ')),
        contentType: pick(row, 'Content Type'),
        lastWatchedAt: parseTimestamp(pick(row, 'Content Last Watched Date (if viewed)')),
        completedAt: parseTimestamp(pick(row, 'Content Completed At (if completed)')),
        saved: /^(true|yes)$/i.test(pick(row, 'Content Saved') ?? ''),
        sourceBatchIds: [],
      },
      ctx,
    );
  }
};

const handleEvents: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Event Name', 'Event Time']);
  for (const row of rows) {
    const name = pick(row, 'Event Name', 'Name');
    if (!name) continue;
    upsert(
      ctx.db.activity.events,
      {
        id: stableId('evt', normalizeKey(name)),
        name,
        time: pick(row, 'Event Time', 'Time'),
        status: pick(row, 'Status'),
        url: pick(row, 'External Url', 'External URL', 'Url'),
        sourceBatchIds: [],
      },
      ctx,
    );
  }
};

const handleVerifications: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Verification type', 'Organization name']);
  for (const row of rows) {
    const type = pick(row, 'Verification type', 'Verification Type');
    if (!type) continue;
    const org = pick(row, 'Organization name', 'Organization Name');
    const record = {
      id: stableId('ver', normalizeKey(type), companyKey(org)),
      type,
      organization: org,
      email: pick(row, 'Email address', 'Email Address'),
      verifiedAt: parseDate(pick(row, 'Verified date', 'Verified Date')),
      expiresAt: parseDate(pick(row, 'Expiry date', 'Expiry Date')),
    };
    const at = ctx.db.activity.verifications.findIndex((v) => v.id === record.id);
    if (at === -1) ctx.db.activity.verifications.push(record);
    else ctx.db.activity.verifications[at] = record;
  }
};

// --- the advertising profile -------------------------------------------------

function ensureAdProfile(ctx: Ctx) {
  if (!ctx.db.activity.adProfile) {
    ctx.db.activity.adProfile = {
      segments: [],
      inferences: [],
      adsClicked: 0,
      adsClickedFirstAt: null,
      adsClickedLastAt: null,
      offsiteActions: [],
      offsiteApps: [],
    };
  }
  return ctx.db.activity.adProfile;
}

/**
 * The targeting segments LinkedIn sells access to.
 *
 * One row, ~35 columns, several column names repeated with different values —
 * so this reads the raw matrix and merges duplicates by header rather than
 * folding rows into an object.
 */
const handleAdTargeting: Handler = (text, ctx) => {
  const matrix = readMatrix(text);
  if (matrix.length < 2) return;
  const headers = matrix[0];
  const values = matrix[1];
  const merged = new Map<string, string[]>();
  headers.forEach((header, i) => {
    const label = clean(header);
    const cell = clean(values[i]);
    if (!label || !cell) return;
    const parts = cell
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    const existing = merged.get(label);
    if (existing) merged.set(label, uniq([...existing, ...parts]));
    else merged.set(label, uniq(parts));
  });
  const segments: AdSegment[] = [...merged.entries()]
    .map(([category, vals]) => ({ category, values: vals }))
    .sort((a, b) => b.values.length - a.values.length || a.category.localeCompare(b.category));
  ensureAdProfile(ctx).segments = segments;
};

const handleInferences: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Category', 'Type of inference', 'Inference']);
  const profile = ensureAdProfile(ctx);
  profile.inferences = rows
    .map((row) => ({
      category: pick(row, 'Category') ?? 'Other',
      type: pick(row, 'Type of inference', 'Type') ?? '',
      description: pick(row, 'Description'),
      value: pick(row, 'Inference') ?? '',
    }))
    .filter((i) => i.type);
};

const handleAdsClicked: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Ad clicked Date', 'Ad Title/Id']);
  const times = rows
    .map((row) => parseTimestamp(pick(row, 'Ad clicked Date', 'Date')))
    .filter((t): t is string => !!t)
    .sort();
  const profile = ensureAdProfile(ctx);
  profile.adsClicked = rows.length;
  profile.adsClickedFirstAt = times[0] ?? null;
  profile.adsClickedLastAt = times[times.length - 1] ?? null;
};

const handleAdEngagement: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Action', 'Ad Title/Id', 'Page/App']);
  const actions = new Map<string, number>();
  const apps = new Map<string, number>();
  for (const row of rows) {
    const action = pick(row, 'Action');
    if (action) actions.set(action, (actions.get(action) ?? 0) + 1);
    const app = pick(row, 'Page/App', 'Page', 'App');
    if (app) apps.set(app, (apps.get(app) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, count]) => [k, count] as const);
  const profile = ensureAdProfile(ctx);
  profile.offsiteActions = rank(actions).map(([action, count]) => ({ action, count }));
  profile.offsiteApps = rank(apps)
    .slice(0, 25)
    .map(([app, count]) => ({ app, count }));
};

// --- account security --------------------------------------------------------

const handleLogins: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Login Date', 'IP Address', 'Login Type']);
  const seen = new Map(ctx.db.activity.logins.map((l) => [l.id, l]));
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Login Date', 'Date'));
    if (!at) continue;
    const ip = pick(row, 'IP Address', 'IP');
    const id = stableId('lgn', at, ip);
    seen.set(id, {
      id,
      at,
      ip,
      userAgent: pick(row, 'User Agent'),
      type: pick(row, 'Login Type', 'Type'),
    });
  }
  ctx.db.activity.logins = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at));
};

const handleChallenges: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Challenge Date', 'Challenge Type', 'Country']);
  const seen = new Map(ctx.db.activity.challenges.map((c) => [c.id, c]));
  for (const row of rows) {
    const at = parseTimestamp(pick(row, 'Challenge Date', 'Date'));
    if (!at) continue;
    const ip = pick(row, 'IP Address', 'IP');
    const id = stableId('chl', at, ip);
    seen.set(id, {
      id,
      at,
      ip,
      country: pick(row, 'Country'),
      userAgent: pick(row, 'User Agent'),
      type: pick(row, 'Challenge Type', 'Type'),
    });
  }
  ctx.db.activity.challenges = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at));
};

// --- LinkedIn's own connection notes -----------------------------------------

/**
 * Notes you wrote against a connection inside LinkedIn.
 *
 * These are the one imported thing that lands in the private notes store, and
 * the only import allowed to do so — they are your own words, not a fact about
 * someone scraped from a profile. Ids are content-derived so a re-import
 * updates the same note instead of writing a second copy.
 */
const handleLinkedInNotes: Handler = (text, ctx) => {
  const { rows } = readTable(text, ['Connection First Name', 'Note']);
  for (const row of rows) {
    const body = pick(row, 'Note');
    if (!body) continue;
    const name = [pick(row, 'Connection First Name'), pick(row, 'Connection Last Name')]
      .filter(Boolean)
      .join(' ');
    const person = findPerson(ctx.db, name, pick(row, 'Connection Profile URL'));
    if (!person) continue;
    const createdAt = parseTimestamp(pick(row, 'Created On')) ?? ctx.importedAt;
    const id = stableId('note', person.id, body.slice(0, 120));
    const existing = ctx.db.notes.find((n) => n.id === id);
    if (existing) {
      existing.body = body;
      existing.updatedAt = parseTimestamp(pick(row, 'Edited On')) ?? existing.updatedAt;
      continue;
    }
    ctx.db.notes.push({
      id,
      personId: person.id,
      body,
      createdAt,
      updatedAt: parseTimestamp(pick(row, 'Edited On')) ?? createdAt,
    });
  }
};

// --- registry ----------------------------------------------------------------

export interface ActivitySpec {
  match: RegExp;
  handler: Handler;
  label: string;
}

/**
 * Matched against the folded basename (lowercased, separators removed). Several
 * files carry the member id in their name — Shares_885394707.csv — so those
 * patterns allow a numeric suffix.
 */
export const ACTIVITY_FILES: ActivitySpec[] = [
  { match: /^invitations\.csv$/, handler: handleInvitations, label: 'Invitations' },
  { match: /^messages\.csv$/, handler: handleMessages, label: 'Messages' },
  {
    match: /^endorsementreceivedinfo\.csv$/,
    handler: readEndorsements('received'),
    label: 'Endorsements received',
  },
  {
    match: /^endorsementgiveninfo\.csv$/,
    handler: readEndorsements('given'),
    label: 'Endorsements given',
  },
  { match: /^companyfollows\.csv$/, handler: handleCompanyFollows, label: 'Company follows' },
  { match: /^memberfollows\d*\.csv$/, handler: handleMemberFollows, label: 'Member follows' },
  { match: /^jobapplications\.csv$/, handler: handleJobApplications, label: 'Job applications' },
  { match: /^savedjobs\.csv$/, handler: handleSavedJobs, label: 'Saved jobs' },
  {
    match: /^jobseekerpreferences\.csv$/,
    handler: handleJobPreferences,
    label: 'Job seeker preferences',
  },
  { match: /^savedjobalerts\.csv$/, handler: handleJobAlerts, label: 'Saved job alerts' },
  { match: /^shares\d*\.csv$/, handler: handleShares, label: 'Posts' },
  { match: /^comments\d*\.csv$/, handler: handleComments, label: 'Comments' },
  { match: /^reactions\d*\.csv$/, handler: handleReactions, label: 'Reactions' },
  { match: /^votes\d*\.csv$/, handler: handleVotes, label: 'Poll votes' },
  { match: /^learning\.csv$/, handler: handleLearning, label: 'Learning' },
  { match: /^events\.csv$/, handler: handleEvents, label: 'Events' },
  { match: /^verifications\.csv$/, handler: handleVerifications, label: 'Verifications' },
  { match: /^adtargeting\.csv$/, handler: handleAdTargeting, label: 'Ad targeting' },
  { match: /^inferencesaboutyou\.csv$/, handler: handleInferences, label: 'Inferences' },
  { match: /^adsclicked\.csv$/, handler: handleAdsClicked, label: 'Ads clicked' },
  { match: /^lanadsengagement\.csv$/, handler: handleAdEngagement, label: 'Off-site ads' },
  { match: /^logins\.csv$/, handler: handleLogins, label: 'Logins' },
  { match: /^securitychallenges\.csv$/, handler: handleChallenges, label: 'Security challenges' },
  { match: /^notes\.csv$/, handler: handleLinkedInNotes, label: 'Connection notes' },
];

/**
 * Recompute conversation-derived counters and re-link anything that could not
 * be resolved when its file was read. Import order cannot guarantee that a
 * follow's subject existed yet, so linking gets one more pass at the end.
 */
export function relinkActivity(db: Database): void {
  for (const follow of db.activity.companyFollows) {
    follow.companyId = existingCompanyId(db, follow.name);
  }
  for (const application of db.activity.jobApplications) {
    application.companyId = existingCompanyId(db, application.company);
  }
  for (const job of db.activity.savedJobs) {
    job.companyId = existingCompanyId(db, job.company);
  }
  for (const follow of db.activity.memberFollows) {
    if (follow.personId && db.people.some((p) => p.id === follow.personId)) continue;
    const person = findPerson(db, follow.name, null);
    follow.personId = person && person.id !== db.self?.id ? person.id : null;
  }
  db.activity.conversations.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  db.activity.engagement.sort((a, b) => b.at.localeCompare(a.at));
  db.activity.invitations.sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  db.activity.endorsements.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  db.activity.jobApplications.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  db.activity.savedJobs.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
