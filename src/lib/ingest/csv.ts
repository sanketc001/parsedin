import { parse } from 'csv-parse/sync';
import { normalizeKey } from '../normalize';

// ---------------------------------------------------------------------------
// CSV reading tuned for LinkedIn's data export, which is not plain CSV:
//  - several files open with a "Notes:" preamble before the real header row
//  - column names drift between export versions and locales
//  - trailing blank lines and stray BOMs are common
// ---------------------------------------------------------------------------

export type Row = Record<string, string>;

export interface Table {
  headers: string[];
  rows: Row[];
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a CSV, locating the real header row by looking for one of the
 * expected column names. Rows above the header (LinkedIn's preamble) are
 * discarded.
 */
export function readTable(text: string, expected: string[]): Table {
  const raw = stripBom(text);
  if (!raw.trim()) return { headers: [], rows: [] };

  let matrix: string[][];
  try {
    matrix = parse(raw, {
      relaxColumnCount: true,
      relaxQuotes: true,
      skipEmptyLines: true,
      bom: true,
    }) as string[][];
  } catch {
    return { headers: [], rows: [] };
  }
  if (matrix.length === 0) return { headers: [], rows: [] };

  const wanted = new Set(expected.map(normalizeKey));
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 12); i += 1) {
    const cells = matrix[i].map(normalizeKey);
    if (cells.some((c) => c && wanted.has(c))) {
      headerIdx = i;
      break;
    }
  }
  // No recognizable header: assume the first row with more than one column.
  if (headerIdx === -1) {
    headerIdx = matrix.findIndex((r) => r.length > 1);
    if (headerIdx === -1) return { headers: [], rows: [] };
  }

  const headers = matrix[headerIdx].map((h) => h.trim());
  const rows: Row[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const cells = matrix[i];
    if (cells.every((c) => !c || !c.trim())) continue;
    const row: Row = {};
    headers.forEach((h, j) => {
      row[normalizeKey(h)] = (cells[j] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

/** First non-empty value among the given column aliases. */
export function pick(row: Row, ...aliases: string[]): string | null {
  for (const alias of aliases) {
    const v = row[normalizeKey(alias)];
    if (v !== undefined && v !== null && v.trim() !== '') return v.trim();
  }
  return null;
}

/**
 * LinkedIn marks ongoing roles with an empty or "Present"-like end date.
 * Returns true when the value means "still there".
 */
export function isOngoing(value: string | null): boolean {
  if (!value) return true;
  return /^(present|current|ongoing|till date|to date)$/i.test(value.trim());
}
