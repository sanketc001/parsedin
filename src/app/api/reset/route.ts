import { NextResponse } from 'next/server';
import { invalidate, loadDb, saveDb } from '@/lib/db';
import { emptyDatabase } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Wipe the database. Destructive, so it requires an explicit confirmation
 * string in the body. `keepPrivate` preserves notes and relationship ratings,
 * which are the only things here that cannot be re-imported.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { confirm?: string; keepPrivate?: boolean }
    | null;

  if (body?.confirm !== 'DELETE') {
    return NextResponse.json(
      { error: 'Send { "confirm": "DELETE" } to clear the database.' },
      { status: 400 },
    );
  }

  const previous = loadDb();
  const fresh = emptyDatabase();
  if (body.keepPrivate) {
    fresh.notes = previous.notes;
    fresh.relationships = previous.relationships;
  }
  saveDb(fresh);
  invalidate();
  return NextResponse.json({
    cleared: true,
    keptNotes: fresh.notes.length,
    keptRatings: fresh.relationships.length,
  });
}
