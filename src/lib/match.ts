import { normalizeKey } from './normalize';

// ---------------------------------------------------------------------------
// Text matching primitives.
//
// Naive substring matching is actively wrong on short queries: "AI" appears
// inside "Bain", "IT" inside "Institute", "HR" inside "Bahrain". Everything
// here anchors to word starts instead, which keeps prefix search useful
// ("mckin" still finds McKinsey) without the false positives.
// ---------------------------------------------------------------------------

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shortest token length allowed to match as a prefix. Below this, a token must
 * equal a whole word: "ai" must not match "airtel", nor "it" "italy", but
 * "mckin" should still reach "mckinsey".
 */
const MIN_PREFIX_LENGTH = 4;

/**
 * True when every token of `needle` matches a word in `haystack` — as a prefix
 * for tokens of at least MIN_PREFIX_LENGTH characters, and exactly for shorter
 * ones. Both arguments must already be normalized keys.
 *
 *   wordPrefixMatch('mckinsey company', 'mckinsey') -> true
 *   wordPrefixMatch('machine learning', 'learn')    -> true
 *   wordPrefixMatch('bain company', 'ai')           -> false
 *   wordPrefixMatch('airtel', 'ai')                 -> false
 *   wordPrefixMatch('nexthop ai', 'ai')             -> true
 */
export function wordPrefixMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  const tokens = needle.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const words = haystack.split(' ').filter(Boolean);
  return tokens.every((token) =>
    token.length < MIN_PREFIX_LENGTH
      ? words.some((word) => word === token)
      : words.some((word) => word.startsWith(token)),
  );
}

/**
 * Match a search term against free-form text, anchored to word starts.
 * Long terms match as prefixes so "goog" finds Google; short ones must be
 * whole words, so "AI" finds "Applied AI" but not "airtel".
 * Terms with no alphanumerics fall back to substring so "c++" still works.
 */
export function termMatches(text: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return true;
  if (!/[a-z0-9]/.test(t)) return text.includes(t);
  const anchor = t.length < MIN_PREFIX_LENGTH ? `\\b${escapeRegExp(t)}\\b` : `\\b${escapeRegExp(t)}`;
  return new RegExp(anchor).test(text);
}

/**
 * Initialism of a normalized key: "indian institute technology bombay" -> "iitb".
 * Lets "IIT" find every IIT and "BITS" find BITS Pilani.
 */
export function acronymOf(key: string): string {
  return key
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('');
}

/**
 * Whether a query is plausibly an acronym worth expanding. Deliberately
 * narrow — this only ever runs as a fallback after direct matching fails.
 */
export function looksLikeAcronym(key: string): boolean {
  if (key.includes(' ')) return false;
  return key.length >= 2 && key.length <= 6 && /^[a-z]+$/.test(key);
}

/**
 * Resolve a typed name against a list of named entities, in tiers:
 *   1. exact normalized match
 *   2. word-prefix match ("mckinsey" -> "McKinsey & Company")
 *   3. acronym prefix match ("iit" -> every "Indian Institute of Technology …")
 * Returns every hit from the first tier that produces one.
 */
export function resolveByName<T>(
  entities: T[],
  keyOf: (entity: T) => string,
  query: string,
  keyFn: (value: string) => string = normalizeKey,
): T[] {
  const key = keyFn(query);
  if (!key) return [];

  const exact = entities.filter((e) => keyOf(e) === key);
  if (exact.length > 0) return exact;

  const prefix = entities.filter((e) => wordPrefixMatch(keyOf(e), key));
  if (prefix.length > 0) return prefix;

  if (looksLikeAcronym(key)) {
    const acronym = entities.filter((e) => acronymOf(keyOf(e)).startsWith(key));
    if (acronym.length > 0) return acronym;
  }

  // Spacing variants: "DY Patil" vs "D Y Patil", "SBI" vs "S B I". Comparing
  // with all spaces removed catches these. Guarded by length so short strings
  // cannot match half the database.
  const compactKey = key.replace(/ /g, '');
  if (compactKey.length >= MIN_PREFIX_LENGTH) {
    const compact = entities.filter((e) => keyOf(e).replace(/ /g, '').includes(compactKey));
    if (compact.length > 0) return compact;
  }

  return [];
}
