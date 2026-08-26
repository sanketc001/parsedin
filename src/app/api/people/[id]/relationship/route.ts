import { NextResponse } from 'next/server';
import { loadDb, saveDb } from '@/lib/db';
import type { Relationship } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Set the private relationship-strength rating (1..5) and tags for a person. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { strength?: number | null; tags?: string[] }
    | null;

  const db = loadDb();
  const exists =
    db.people.some((p) => p.id === id) || db.self?.id === id;
  if (!exists) {
    return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  }

  const index = db.relationships.findIndex((r) => r.personId === id);

  // A null strength clears the rating entirely.
  if (body?.strength === null || body?.strength === 0) {
    if (index !== -1) db.relationships.splice(index, 1);
    saveDb(db);
    return NextResponse.json({ relationship: null });
  }

  const strength = Number(body?.strength);
  if (!Number.isFinite(strength) || strength < 1 || strength > 5) {
    return NextResponse.json(
      { error: 'strength must be between 1 and 5, or null to clear.' },
      { status: 400 },
    );
  }

  const tags = Array.isArray(body?.tags)
    ? body!.tags.map((t) => String(t).trim()).filter(Boolean)
    : index !== -1
      ? db.relationships[index].tags
      : [];

  const record: Relationship = {
    personId: id,
    strength: Math.round(strength),
    tags,
    updatedAt: new Date().toISOString(),
  };
  if (index === -1) db.relationships.push(record);
  else db.relationships[index] = record;

  saveDb(db);
  return NextResponse.json({ relationship: record });
}
