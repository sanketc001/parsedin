import { NextResponse } from 'next/server';
import { loadDb, saveDb } from '@/lib/db';
import { newId } from '@/lib/normalize';
import type { Note } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Add a private note to a person. Notes are local-only and never exported. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { body?: string } | null;
  const text = body?.body?.trim();
  if (!text) {
    return NextResponse.json({ error: 'Note body is required.' }, { status: 400 });
  }

  const db = loadDb();
  const person = db.people.find((p) => p.id === id) ?? (db.self?.id === id ? db.self : null);
  if (!person) {
    return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const note: Note = {
    id: newId('n'),
    personId: id,
    body: text,
    createdAt: now,
    updatedAt: now,
  };
  db.notes.unshift(note);
  saveDb(db);
  return NextResponse.json({ note });
}

/** Edit or delete a note. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { noteId?: string; body?: string; delete?: boolean }
    | null;
  if (!body?.noteId) {
    return NextResponse.json({ error: 'noteId is required.' }, { status: 400 });
  }

  const db = loadDb();
  const index = db.notes.findIndex((n) => n.id === body.noteId && n.personId === id);
  if (index === -1) {
    return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
  }

  if (body.delete) {
    db.notes.splice(index, 1);
    saveDb(db);
    return NextResponse.json({ deleted: true });
  }

  const text = body.body?.trim();
  if (!text) {
    return NextResponse.json({ error: 'Note body is required.' }, { status: 400 });
  }
  db.notes[index].body = text;
  db.notes[index].updatedAt = new Date().toISOString();
  saveDb(db);
  return NextResponse.json({ note: db.notes[index] });
}
