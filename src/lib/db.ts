import fs from 'node:fs';
import path from 'node:path';
import { type Database, emptyDatabase } from './types';

// ---------------------------------------------------------------------------
// Storage. A single JSON document on disk, read into memory and written back
// atomically. Deliberately dumb: this is a private, single-user app.
//
// Server-only — this is the one module that touches the filesystem, so
// swapping in SQLite later means rewriting only this file. Entity registries
// live in entities.ts precisely so the rest of the app can avoid importing it.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'parsedin.json');

let cache: Database | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadDb(): Database {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    cache = emptyDatabase();
    return cache;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Database;
    // Tolerate documents written by earlier shapes of the model.
    cache = { ...emptyDatabase(), ...parsed };
    return cache;
  } catch (err) {
    console.error('[parsedin] could not read database, starting empty:', err);
    cache = emptyDatabase();
    return cache;
  }
}

/** Block the current thread briefly — used only between write retries. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Persist the database.
 *
 * Writes to a temp file and renames, so a crash mid-write cannot truncate the
 * real file. On Windows a rename over an existing file fails with EPERM/EBUSY
 * whenever anything else holds a handle on it for an instant — a virus
 * scanner or the search indexer is enough — so the rename is retried, and a
 * direct overwrite is the last resort. Losing an entire import to a transient
 * file lock is far worse than a momentarily non-atomic write.
 */
export function saveDb(db: Database): void {
  ensureDir();
  const payload = JSON.stringify(db, null, 2);
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');

  const RETRY_DELAYS = [0, 25, 75, 150, 300];
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
    if (RETRY_DELAYS[attempt] > 0) sleepSync(RETRY_DELAYS[attempt]);
    try {
      fs.renameSync(tmp, DB_PATH);
      cache = db;
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
        // Not a locking problem — do not mask it behind retries.
        cache = null;
        throw err;
      }
    }
  }

  // Rename kept failing. Write in place so the data survives.
  try {
    fs.writeFileSync(DB_PATH, payload, 'utf8');
    cache = db;
    try {
      fs.unlinkSync(tmp);
    } catch {
      // A leftover temp file is harmless.
    }
  } catch (err) {
    // Nothing landed on disk; drop the cache so callers cannot read state
    // that was never persisted.
    cache = null;
    throw err;
  }
}

/** Drop the in-memory copy so the next read hits disk. */
export function invalidate(): void {
  cache = null;
}

export function dbPath(): string {
  return DB_PATH;
}
