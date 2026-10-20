import { unzipSync, strFromU8 } from 'fflate';
import {
  type Database,
  type ImportBatch,
  type ImportKind,
  emptyStats,
} from '../types';
import { loadDb, saveDb } from '../db';
import { newId } from '../normalize';
import { refreshDerived, type Ctx } from './merge';
import { findHandler, foldName } from './linkedin';
import { relinkActivity } from './activity';
import { extractProfiles, importProfiles } from './enriched';

// ---------------------------------------------------------------------------
// Import orchestration: turn uploaded files into one auditable batch.
// ---------------------------------------------------------------------------

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

export interface ImportResult {
  batch: ImportBatch;
}

function isZip(file: UploadedFile): boolean {
  if (/\.zip$/i.test(file.name)) return true;
  // PK\x03\x04 magic
  const b = file.bytes;
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** Flatten a zip into its member files, ignoring directories and junk. */
function expandZip(file: UploadedFile): UploadedFile[] {
  const entries = unzipSync(file.bytes);
  const out: UploadedFile[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    if (/(^|\/)__MACOSX\//i.test(name) || /(^|\/)\._/.test(name)) continue;
    if (bytes.length === 0) continue;
    out.push({ name, bytes });
  }
  return out;
}

/**
 * Run an import. All files land in a single batch so provenance stays
 * meaningful — "this came from the archive I uploaded on the 4th".
 */
export function runImport(
  files: UploadedFile[],
  opts: { label?: string; kind?: ImportKind } = {},
): ImportResult {
  const db: Database = loadDb();
  const importedAt = new Date().toISOString();
  const batchId = newId('b');
  const stats = emptyStats();

  // Expand any archives up front so the file registry sees flat names.
  const expanded: UploadedFile[] = [];
  const notes: string[] = [];
  let sawZip = false;
  for (const file of files) {
    if (isZip(file)) {
      sawZip = true;
      try {
        const members = expandZip(file);
        expanded.push(...members);
        notes.push(`Expanded ${file.name} into ${members.length} files.`);
      } catch (err) {
        notes.push(`Could not read ${file.name} as a zip archive: ${String(err)}`);
      }
    } else {
      expanded.push(file);
    }
  }

  const handled: string[] = [];
  const skipped: string[] = [];

  const ctx: Ctx = {
    db,
    batchId,
    importedAt,
    sourceLabel: 'import',
    stats,
  };

  // Order matters: Profile.csv before the owner's history files so the self
  // record exists with a name, and Connections.csv before enrichment JSON so
  // enrichment merges onto existing people rather than creating new ones.
  const ordered = [...expanded].sort((a, b) => rank(a.name) - rank(b.name));

  for (const file of ordered) {
    const folded = foldName(file.name);

    if (/\.json$/i.test(folded)) {
      try {
        const parsed = JSON.parse(strFromU8(file.bytes));
        const profiles = extractProfiles(parsed);
        if (profiles.length === 0) {
          skipped.push(file.name);
          notes.push(`${file.name}: no profiles found (expected an array or a "profiles" key).`);
          continue;
        }
        ctx.sourceLabel = file.name.split(/[\\/]/).pop() ?? file.name;
        importProfiles(ctx, profiles);
        handled.push(file.name);
      } catch (err) {
        skipped.push(file.name);
        notes.push(`${file.name}: invalid JSON (${String(err)}).`);
      }
      continue;
    }

    const spec = findHandler(file.name);
    if (!spec) {
      skipped.push(file.name);
      continue;
    }
    try {
      ctx.sourceLabel = file.name.split(/[\\/]/).pop() ?? file.name;
      spec.handler(strFromU8(file.bytes), ctx);
      handled.push(file.name);
    } catch (err) {
      skipped.push(file.name);
      notes.push(`${file.name}: failed to parse (${String(err)}).`);
    }
  }

  if (handled.length === 0) {
    notes.push(
      'Nothing recognizable was imported. Expected a LinkedIn export (Connections.csv, Profile.csv, ...) or an enriched-profile JSON file.',
    );
  }

  // Settle derived fields and history ordering once, at the end.
  for (const person of db.people) refreshDerived(person);
  if (db.self) refreshDerived(db.self);
  // Activity rows link to companies and people that a later file may have
  // introduced, so resolve those references after every file has been read.
  relinkActivity(db);

  stats.companies = db.companies.length;
  stats.schools = db.schools.length;

  const kind: ImportKind =
    opts.kind ??
    (sawZip
      ? 'linkedin-archive'
      : handled.some((n) => /\.json$/i.test(n))
        ? 'enriched-json'
        : 'linkedin-csv');

  const batch: ImportBatch = {
    id: batchId,
    label: opts.label || defaultLabel(files, kind),
    kind,
    filename: files.length === 1 ? files[0].name : null,
    importedAt,
    files: handled,
    skippedFiles: skipped,
    stats,
    notes,
  };
  db.batches.unshift(batch);
  saveDb(db);
  return { batch };
}

/**
 * Sort key controlling handler order within a batch.
 *
 * The chain that matters: Profile.csv names the account owner, Invitations.csv
 * is where the owner's own profile URL is recovered (Profile.csv omits it), and
 * messages.csv needs that URL to tell an outbound message from an inbound one.
 * Connections.csv runs before all of them so activity links to real people.
 */
function rank(name: string): number {
  const folded = foldName(name);
  if (folded === 'profile.csv') return 0;
  if (folded === 'emailaddresses.csv') return 1;
  if (folded === 'connections.csv') return 2;
  if (folded === 'invitations.csv') return 3;
  if (folded === 'messages.csv') return 4;
  if (/\.json$/.test(folded)) return 9;
  return 5;
}

function defaultLabel(files: UploadedFile[], kind: ImportKind): string {
  if (files.length === 1) return files[0].name;
  const kindLabel =
    kind === 'linkedin-archive'
      ? 'LinkedIn archive'
      : kind === 'enriched-json'
        ? 'Enriched profiles'
        : 'LinkedIn CSVs';
  return `${kindLabel} (${files.length} files)`;
}
