import type { Conversation, Database, Person } from './types';
import { daysBetween } from './normalize';

// ---------------------------------------------------------------------------
// Contact intelligence.
//
// The profile half of the export says who someone is. The activity half says
// whether you actually know them — and that is the question the rest of the
// app could never answer before. Everything here is derived from messages,
// invitations and endorsements; nothing is stored.
//
// The distinction that drives the whole module: a *connection* is an accepted
// click, while a *contact* is someone you exchanged words with. Most networks
// are 90% the former, and separating them is what makes the list actionable.
// ---------------------------------------------------------------------------

export interface ContactStats {
  personId: string;
  /** Threads this person appears in. */
  threads: number;
  sent: number;
  received: number;
  messages: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Days since the last message either way. Null when never messaged. */
  daysSinceLast: number | null;
  /** They sent the first message in the earliest thread. */
  theyInitiated: boolean;
  /**
   * The last word in at least one thread was theirs and you never answered it.
   * The most actionable signal in the whole dataset.
   */
  awaitingYourReply: boolean;
  /** You wrote last and got nothing back. */
  awaitingTheirReply: boolean;
  /** A real exchange: both sides sent something. */
  reciprocal: boolean;
  /**
   * When you last marked a reply sent from this app. The export cannot know
   * about it — it was written after the archive was downloaded — so this is
   * the one contact fact that comes from you rather than from LinkedIn.
   */
  repliedAt: string | null;
  endorsementsReceived: number;
  endorsementsGiven: number;
  invitedByThem: boolean;
  invitedByYou: boolean;
  /** 0..100 evidence-based relationship signal. See `signalStrength`. */
  signal: number;
}

function blank(personId: string): ContactStats {
  return {
    personId,
    threads: 0,
    sent: 0,
    received: 0,
    messages: 0,
    firstAt: null,
    lastAt: null,
    daysSinceLast: null,
    theyInitiated: false,
    awaitingYourReply: false,
    awaitingTheirReply: false,
    reciprocal: false,
    repliedAt: null,
    endorsementsReceived: 0,
    endorsementsGiven: 0,
    invitedByThem: false,
    invitedByYou: false,
    signal: 0,
  };
}

/**
 * How strong the *evidence* for a relationship is, 0..100.
 *
 * Deliberately not a guess at how close you are — it measures what the archive
 * can prove. Volume is logarithmic because the tenth message says far less than
 * the second; reciprocity is weighted heavily because a one-sided thread is
 * usually a recruiter pitch; and everything decays with silence, since a
 * conversation from 2021 is history rather than a relationship.
 */
function signalStrength(stats: ContactStats): number {
  if (stats.messages === 0) {
    // No conversation at all: an endorsement or an invite they sent is still
    // weak evidence of a real acquaintance.
    const gestures = stats.endorsementsReceived + stats.endorsementsGiven;
    return Math.min(20, gestures * 6 + (stats.invitedByThem ? 4 : 0));
  }

  const volume = Math.min(40, Math.log2(stats.messages + 1) * 12);
  const reciprocity = stats.reciprocal
    ? // Balance matters as much as depth: 10 messages each beats 19 and 1.
      20 + 15 * (Math.min(stats.sent, stats.received) / Math.max(stats.sent, stats.received))
    : 0;
  const endorsement = Math.min(15, (stats.endorsementsReceived + stats.endorsementsGiven) * 5);

  // Half-life of roughly a year, floored so an old real exchange never reads
  // as though it never happened.
  const days = stats.daysSinceLast ?? 3650;
  const recency = Math.max(0.35, Math.pow(0.5, days / 365));

  return Math.round(Math.min(100, (volume + reciprocity + endorsement) * recency));
}

/**
 * Contact stats for everyone the activity layer mentions. People with no
 * recorded interaction are absent — callers use `statsFor` for a zeroed record.
 */
export function buildContactStats(db: Database): Map<string, ContactStats> {
  const out = new Map<string, ContactStats>();
  const get = (id: string): ContactStats => {
    let s = out.get(id);
    if (!s) {
      s = blank(id);
      out.set(id, s);
    }
    return s;
  };

  const now = new Date().toISOString();

  for (const conversation of db.activity.conversations) {
    // Adverts are not contact, however many of them went unanswered.
    if (conversation.sponsored) continue;
    // A group thread is weaker evidence per participant than a 1:1, but it is
    // still contact — counted once for each person named in it.
    for (const personId of conversation.personIds) {
      const s = get(personId);
      s.threads += 1;
      s.sent += conversation.sent;
      s.received += conversation.received;
      s.messages += conversation.messages.length;
      if (!s.firstAt || (conversation.firstAt && conversation.firstAt < s.firstAt)) {
        s.firstAt = conversation.firstAt;
        s.theyInitiated = !conversation.messages[0]?.outbound;
      }
      if (!s.lastAt || (conversation.lastAt && conversation.lastAt > s.lastAt)) {
        s.lastAt = conversation.lastAt;
      }
      if (conversation.lastInbound) s.awaitingYourReply = true;
      else if (conversation.received > 0 || conversation.sent > 0) s.awaitingTheirReply = true;
    }
  }

  for (const endorsement of db.activity.endorsements) {
    if (!endorsement.personId) continue;
    const s = get(endorsement.personId);
    if (endorsement.direction === 'received') s.endorsementsReceived += 1;
    else s.endorsementsGiven += 1;
  }

  for (const invitation of db.activity.invitations) {
    if (!invitation.personId) continue;
    const s = get(invitation.personId);
    if (invitation.direction === 'incoming') s.invitedByThem = true;
    else s.invitedByYou = true;
  }

  // A reply sent from this app happened after the archive was downloaded, so
  // it is newer than anything in it. Fold it in before the derived fields are
  // computed: it answers an inbound message, it counts as an outbound one, and
  // it resets the clock.
  for (const draft of db.drafts) {
    if (!draft.sentAt || !draft.personId) continue;
    const s = get(draft.personId);
    if (!s.repliedAt || draft.sentAt > s.repliedAt) s.repliedAt = draft.sentAt;
  }

  for (const s of out.values()) {
    if (s.repliedAt && (!s.lastAt || s.repliedAt > s.lastAt)) {
      s.lastAt = s.repliedAt;
      s.sent += 1;
      s.messages += 1;
      s.awaitingYourReply = false;
      s.awaitingTheirReply = s.received > 0;
    }
    s.reciprocal = s.sent > 0 && s.received > 0;
    // "Awaiting their reply" only holds when nothing anywhere is waiting on you.
    if (s.awaitingYourReply) s.awaitingTheirReply = false;
    s.daysSinceLast = daysBetween(s.lastAt, now);
    s.signal = signalStrength(s);
  }

  return out;
}

export function statsFor(
  map: Map<string, ContactStats>,
  personId: string,
): ContactStats {
  return map.get(personId) ?? blank(personId);
}

// --- relationship health -----------------------------------------------------

export type ReconnectReason =
  | 'awaiting-your-reply'
  | 'going-cold'
  | 'no-reply-from-them'
  | 'never-spoken';

export interface ReconnectItem {
  person: Person;
  stats: ContactStats;
  reason: ReconnectReason;
  /** Higher means it deserves attention sooner. */
  priority: number;
  detail: string;
}

/** Below this, a contact is dormant rather than merely quiet. */
const DORMANT_DAYS = 120;

/**
 * Rank the network by what actually needs doing.
 *
 * Four buckets, in descending order of how much the archive says you owe
 * someone: a message you left unanswered, a real relationship gone quiet, an
 * outbound message that got nothing back, and finally the large silent mass of
 * connections you have never exchanged a word with.
 */
export function buildReconnectList(
  db: Database,
  contacts: Map<string, ContactStats>,
  personById: Map<string, Person>,
): ReconnectItem[] {
  const items: ReconnectItem[] = [];

  for (const stats of contacts.values()) {
    const person = personById.get(stats.personId);
    if (!person) continue;
    const days = stats.daysSinceLast;

    if (stats.awaitingYourReply) {
      items.push({
        person,
        stats,
        reason: 'awaiting-your-reply',
        // Recent unanswered messages first — an unread pitch from 2021 is not
        // a debt, but one from last week is.
        priority: 1000 - Math.min(900, days ?? 900),
        detail:
          days === null
            ? 'they wrote last'
            : `they wrote last, ${days} day${days === 1 ? '' : 's'} ago`,
      });
      continue;
    }

    if (stats.reciprocal && days !== null && days >= DORMANT_DAYS) {
      items.push({
        person,
        stats,
        reason: 'going-cold',
        // Depth of the past relationship, scaled by how long it has been.
        priority: 500 + stats.signal + Math.min(200, days / 5),
        detail: `${stats.messages} messages, silent ${Math.round(days / 30)} months`,
      });
      continue;
    }

    if (stats.sent > 0 && stats.received === 0 && days !== null && days >= 30) {
      items.push({
        person,
        stats,
        reason: 'no-reply-from-them',
        priority: 200 - Math.min(150, days / 10),
        detail: `you sent ${stats.sent}, no reply in ${Math.round(days / 30)} months`,
      });
    }
  }

  // The silent majority: accepted connections with no recorded exchange at all.
  // Having an entry in `contacts` is not enough to exclude someone — an
  // invitation or an endorsement creates one, and neither is a conversation.
  for (const person of personById.values()) {
    if ((contacts.get(person.id)?.messages ?? 0) > 0) continue;
    if (person.connectionDegree !== 1) continue;
    items.push({
      person,
      stats: blank(person.id),
      reason: 'never-spoken',
      // Newest connections first — they are the ones still worth a first note.
      priority: person.connectedOn ? 100 : 50,
      detail: person.connectedOn ? `connected ${person.connectedOn}` : 'never messaged',
    });
  }

  return items.sort(
    (a, b) =>
      b.priority - a.priority ||
      (b.person.connectedOn ?? '').localeCompare(a.person.connectedOn ?? '') ||
      a.person.fullName.localeCompare(b.person.fullName),
  );
}

export const RECONNECT_LABELS: Record<ReconnectReason, string> = {
  'awaiting-your-reply': 'Awaiting your reply',
  'going-cold': 'Going cold',
  'no-reply-from-them': 'No reply from them',
  'never-spoken': 'Never spoken',
};

// --- conversation helpers ----------------------------------------------------

/** Display label for a thread: resolved people first, raw names as a fallback. */
export function conversationLabel(
  conversation: Conversation,
  personById: Map<string, Person>,
): string {
  const named = conversation.personIds
    .map((id) => personById.get(id)?.fullName)
    .filter((n): n is string => !!n);
  if (named.length > 0) return named.join(', ');
  if (conversation.participantNames.length > 0) return conversation.participantNames.join(', ');
  return conversation.title ?? 'Unknown thread';
}

/** Lowercased haystack for searching a thread by content, subject or person. */
export function conversationCorpus(
  conversation: Conversation,
  personById: Map<string, Person>,
): string {
  const parts = [
    conversationLabel(conversation, personById),
    conversation.title ?? '',
    ...conversation.messages.map((m) => `${m.subject ?? ''} ${m.body}`),
  ];
  return parts.join('  ').toLowerCase();
}
