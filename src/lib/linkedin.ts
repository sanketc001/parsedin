import type { Conversation, Person } from './types';

// ---------------------------------------------------------------------------
// Links back into LinkedIn.
//
// Why this is a link and not an API call, stated once so nobody has to
// rediscover it:
//
//  - LinkedIn publishes no messaging API for personal accounts. The Messages
//    API is partner-only and covers company pages.
//  - Being signed in to LinkedIn in the same browser does not help. Cookies are
//    scoped to their origin and LinkedIn sends no CORS headers for localhost,
//    so a `fetch()` from this app is refused before it is ever authenticated.
//  - The remaining routes — copying the `li_at` session cookie into the app, or
//    driving a headless browser — impersonate the account against an
//    undocumented endpoint. LinkedIn detects both and restricts accounts for
//    it, which is a bad trade for saving one paste.
//
// So the app owns everything up to the send: composing with full context,
// keeping the draft, and remembering that you replied. The final step is a
// deep link straight into the right thread with the text already on the
// clipboard.
// ---------------------------------------------------------------------------

/**
 * The conversation ids in `messages.csv` are the same ids LinkedIn's messaging
 * URLs use, so a thread link lands on the exact conversation rather than the
 * inbox. They end in `==`, which must be encoded to survive the path.
 */
export function threadUrl(conversation: Conversation | null | undefined): string | null {
  if (!conversation?.id) return null;
  return `https://www.linkedin.com/messaging/thread/${encodeURIComponent(conversation.id)}/`;
}

/**
 * Force a stored URL to be absolute.
 *
 * Not cosmetic: several sources write the host without a scheme — the
 * endorsement files use `www.linkedin.com/in/…` — and a bare host in an `href`
 * is a *relative path*, so the browser would navigate to
 * `localhost:3000/www.linkedin.com/in/…` and 404. Every outbound link goes
 * through here.
 */
export function absoluteUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  // Only promote things that actually look like a host, never a stray word.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** Where to send someone with no thread yet: their profile, which has a Message button. */
export function profileUrl(person: Person | null | undefined): string | null {
  return absoluteUrl(person?.linkedinUrl);
}

/**
 * LinkedIn's people search, scoped to a name. The fallback for the handful of
 * records that arrived without a profile URL — a search that lands on them is
 * far better than a dead row.
 */
export function peopleSearchUrl(person: Person | null | undefined): string | null {
  const name = person?.fullName?.trim();
  if (!name) return null;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}`;
}

/**
 * The best outbound destination for a person, and which kind it is so the UI
 * can say so. Every person in the graph gets one or the other.
 */
export function personLink(
  person: Person | null | undefined,
): { href: string; kind: 'profile' | 'search' } | null {
  const profile = profileUrl(person);
  if (profile) return { href: profile, kind: 'profile' };
  const search = peopleSearchUrl(person);
  return search ? { href: search, kind: 'search' } : null;
}

/**
 * Best available destination for replying to someone. Prefers the exact thread,
 * falls back to the profile, and finally to the messaging inbox so the button
 * is never dead.
 */
export function replyUrl(
  conversation: Conversation | null | undefined,
  person: Person | null | undefined,
): string {
  return (
    threadUrl(conversation) ??
    profileUrl(person) ??
    'https://www.linkedin.com/messaging/'
  );
}

/** What the reply button is about to open, for the hint under it. */
export function replyTarget(
  conversation: Conversation | null | undefined,
  person: Person | null | undefined,
): 'thread' | 'profile' | 'inbox' {
  if (threadUrl(conversation)) return 'thread';
  if (profileUrl(person)) return 'profile';
  return 'inbox';
}
