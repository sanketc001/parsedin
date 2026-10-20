// ---------------------------------------------------------------------------
// Normalization helpers. Entity resolution across imports lives or dies on
// these, so they are deliberately conservative: strip noise, never guess.
// ---------------------------------------------------------------------------

export function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // LinkedIn exports use these as empty markers in some locales.
  if (s === '-' || s === '--' || s.toLowerCase() === 'n/a') return null;
  return s;
}

/** Unicode combining marks, stripped after NFKD to fold accents. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeKey(value: unknown): string {
  const s = clean(value);
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPANY_NOISE = [
  'incorporated', 'inc', 'llc', 'llp', 'lllp', 'ltd', 'limited', 'plc',
  'corporation', 'corp', 'company', 'co', 'gmbh', 'ag', 'sa', 'sas', 'bv',
  'nv', 'ab', 'oy', 'as', 'pty', 'pte', 'pvt', 'private', 'holdings',
  'holding', 'group', 'the', 'and', 'technologies', 'technology',
];

/**
 * Strip trailing parenthetical asides before normalizing. Organizations are
 * routinely written with their own acronym appended — "Jio Platforms Limited
 * (JPL)" is the same employer as "Jio Platforms", and without this they
 * normalize to different keys and split into two entities.
 */
function dropParentheticals(value: unknown): string {
  const s = clean(value);
  if (!s) return '';
  const stripped = s.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ').trim();
  // Never strip everything away: "(Ex-Google)" as an entire name keeps its text.
  return stripped || s;
}

/**
 * Company identity key. Drops parentheticals, legal suffixes and filler words
 * so "Google", "Google Inc.", and "Google LLC" all collapse together.
 * Falls back to the plain key when stripping would leave nothing.
 */
export function companyKey(value: unknown): string {
  const base = normalizeKey(dropParentheticals(value));
  if (!base) return '';
  const parts = base.split(' ').filter((p) => !COMPANY_NOISE.includes(p));
  const stripped = parts.join(' ').trim();
  return stripped || base;
}

const SCHOOL_NOISE = ['the', 'of', 'at', 'and'];

export function schoolKey(value: unknown): string {
  const base = normalizeKey(dropParentheticals(value));
  if (!base) return '';
  const parts = base.split(' ').filter((p) => !SCHOOL_NOISE.includes(p));
  const stripped = parts.join(' ').trim();
  return stripped || base;
}

/**
 * Canonical display form of a profile URL: always absolute.
 *
 * Sources disagree — Connections.csv writes `https://www.linkedin.com/in/x`,
 * the endorsement files write `www.linkedin.com/in/x`. Stored unchanged, the
 * second form is a *relative* href and links to it break. Identity still comes
 * from `urlKey`; this only fixes what gets rendered.
 */
export function canonicalUrl(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return `https:${s}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(s)) return `https://${s}`;
  return s;
}

/** Normalize a LinkedIn profile URL down to its stable identity portion. */
export function urlKey(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;
  let out = s.toLowerCase().trim();
  out = out.replace(/^https?:\/\//, '').replace(/^www\./, '');
  out = out.split('?')[0].split('#')[0];
  out = out.replace(/\/+$/, '');
  // Collapse locale subdomains: in.linkedin.com -> linkedin.com
  out = out.replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com');
  if (!out) return null;
  return out;
}

const MONTHS: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

/**
 * Parse the assorted date shapes LinkedIn exports emit into a sortable
 * partial-ISO string: "YYYY", "YYYY-MM", or "YYYY-MM-DD".
 * Returns null rather than inventing precision we do not have.
 */
export function parseDate(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;
  if (/^(present|current|ongoing)$/i.test(s)) return null;

  // Already ISO-ish
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    return m[3] ? `${y}-${mo}-${m[3].padStart(2, '0')}` : `${y}-${mo}`;
  }

  // "Mar 15, 2024" / "15 Mar 2024" / "Mar 2024"
  const monthNames = Object.keys(MONTHS).join('|');
  m = s.match(new RegExp(`^(${monthNames})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i'));
  if (m) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;

  m = s.match(new RegExp(`^(\\d{1,2})\\s+(${monthNames})\\.?\\s+(\\d{4})$`, 'i'));
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;

  m = s.match(new RegExp(`^(${monthNames})\\.?\\s+(\\d{4})$`, 'i'));
  if (m) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}`;

  // Bare year
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];

  // "2024/03" or "03/2024"
  m = s.match(/^(\d{4})[/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;

  // Last resort: let Date try, but only trust it if a 4-digit year is present.
  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${day}`;
    }
  }
  return null;
}

/**
 * Parse the wall-clock timestamps the activity files use into a full ISO
 * string. Unlike `parseDate` these carry a time of day, and the export mixes
 * at least four shapes across files:
 *
 *   2026-08-23 11:01:04 UTC      messages, reactions, comments
 *   2026/08/21 11:04:13 UTC      ads, endorsements
 *   Sun Jul 19 17:08:09 UTC 2026 company follows, logins
 *   8/25/26, 12:30 PM            invitations, job applications (local, US order)
 *
 * Everything but the last is explicitly UTC and is treated as such. The
 * ambiguous one is read as local time, which is what LinkedIn wrote it in.
 */
export function parseTimestamp(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;

  // "2026-08-23 11:01:04 UTC" / "2026/08/21 11:04:13 UTC" (and without UTC)
  let m = s.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|Z))?$/i,
  );
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}.000Z`;
  }

  // "Sun Jul 19 17:08:09 UTC 2026"
  const monthNames = Object.keys(MONTHS).join('|');
  m = s.match(
    new RegExp(
      `^[a-z]{3},?\\s+(${monthNames})\\s+(\\d{1,2})\\s+(\\d{2}):(\\d{2}):(\\d{2})\\s+(?:UTC|GMT)\\s+(\\d{4})$`,
      'i',
    ),
  );
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return `${m[6]}-${mo}-${m[2].padStart(2, '0')}T${m[3]}:${m[4]}:${m[5]}.000Z`;
  }

  // "8/25/26, 12:30 PM" — month first, two- or four-digit year, local time.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    let hour = Number(m[4]);
    const ampm = m[7]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const d = new Date(
      year,
      Number(m[1]) - 1,
      Number(m[2]),
      hour,
      Number(m[5]),
      Number(m[6] ?? 0),
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Date-only values still deserve an answer; midnight UTC is honest enough.
  const partial = parseDate(s);
  if (partial) {
    const [y, mo = '01', d = '01'] = partial.split('-');
    return `${y}-${mo}-${d}T00:00:00.000Z`;
  }
  return null;
}

/** Numeric sort key for a partial-ISO date. Missing dates sort last. */
export function dateSortKey(value: string | null | undefined): number {
  if (!value) return 0;
  const m = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 0;
  const d = m[3] ? Number(m[3]) : 0;
  return y * 10000 + mo * 100 + d;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Render a partial-ISO date for display: "2020-03" -> "Mar 2020". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return value;
  const y = m[1];
  if (!m[2]) return y;
  const label = MONTH_LABELS[Number(m[2]) - 1] ?? m[2];
  if (!m[3]) return `${label} ${y}`;
  return `${label} ${Number(m[3])}, ${y}`;
}

export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
  isCurrent?: boolean,
): string {
  const a = formatDate(start);
  const b = formatDate(end);
  if (!a && !b) return isCurrent ? 'Present' : '';
  if (a && !b) return isCurrent ? `${a} – Present` : `${a} – ?`;
  if (!a && b) return `? – ${b}`;
  return `${a} – ${b}`;
}

/** Approximate months between two partial dates, for tenure display. */
export function monthsBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start) return null;
  const sm = start.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!sm) return null;
  const sy = Number(sm[1]);
  const smo = sm[2] ? Number(sm[2]) : 1;

  let ey: number;
  let emo: number;
  if (end) {
    const em = end.match(/^(\d{4})(?:-(\d{2}))?/);
    if (!em) return null;
    ey = Number(em[1]);
    emo = em[2] ? Number(em[2]) : 12;
  } else {
    const now = new Date();
    ey = now.getFullYear();
    emo = now.getMonth() + 1;
  }
  const months = (ey - sy) * 12 + (emo - smo);
  return months >= 0 ? months : null;
}

export function formatTenure(months: number | null): string {
  if (months === null) return '';
  if (months < 1) return '< 1 mo';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const s = clean(full);
  if (!s) return { first: null, last: null };
  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** Deterministic slug id so companies/schools keep stable ids across imports. */
export function slugId(prefix: string, key: string): string {
  const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${prefix}_${slug || 'unknown'}`;
}

/**
 * Deterministic id from a record's natural key.
 *
 * Activity rows have no identifier of their own, and each export is a full
 * snapshot rather than a delta — so re-importing an overlapping archive must
 * land on the same id or every message duplicates. FNV-1a is not a security
 * hash; it only needs to avoid collisions within one person's export.
 */
export function stableId(prefix: string, ...parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, spelled out because JS has no uint32 math.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // A second pass over the reversed input widens the space enough that a few
  // thousand rows collide with negligible probability.
  let g = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    g ^= input.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return `${prefix}_${h.toString(36)}${g.toString(36)}`;
}

/** Whole days between two ISO timestamps. Null when either is missing. */
export function daysBetween(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/** "3 days ago" / "5 months ago". Coarse on purpose. */
export function relativeDays(days: number | null): string {
  if (days === null) return '—';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months}mo ago`;
  return `${Math.round(days / 365.25)}y ago`;
}

/** "2026-08" bucket for a full ISO timestamp, used by the cadence charts. */
export function monthBucket(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Case-insensitive "does haystack contain needle" over possibly-null fields. */
export function contains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
