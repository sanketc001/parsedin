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
 * True when every token of `needle` starts a word in `haystack`.
 * Both arguments must already be normalized keys.
 *
 *   wordPrefixMatch('mckinsey company', 'mckinsey') -> true
 *   wordPrefixMatch('bain company', 'ai')           -> false
 *   wordPrefixMatch('machine learning', 'learn')    -> true
 */
export function wordPrefixMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  const tokens = needle.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const words = haystack.split(' ').filter(Boolean);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

/**
 * Match a search term against free-form text, anchored to word starts.
 * Text should be lowercased already; terms with no alphanumerics fall back to
 * a plain substring test so queries like "c++" still work.
 */
export function termMatches(text: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return true;
  if (!/[a-z0-9]/.test(t)) return text.includes(t);
  return new RegExp(`\\b${escapeRegExp(t)}`).test(text);
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

  return [];
}
