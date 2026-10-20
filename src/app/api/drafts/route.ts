import { NextResponse } from 'next/server';
import { loadDb, saveDb } from '@/lib/db';
import { newId } from '@/lib/normalize';
import type { Draft } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Reply drafts. Private and local, like notes — nothing here is ever sent
 * anywhere, because no route exists to send it (see `lib/linkedin.ts`).
 *
 * At most one draft per key is open at a time; marking one sent closes it and
 * leaves the next save to start a fresh one, so the sent ones accumulate into
 * a record of when you actually replied.
 */

function openDraftFor(drafts: Draft[], key: string): Draft | undefined {
  return drafts.find((d) => d.key === key && !d.sentAt);
}

/** Create or update the open draft for a conversation or person. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { conversationId?: string | null; personId?: string | null; body?: string }
    | null;

  const text = body?.body ?? '';
  const conversationId = body?.conversationId ?? null;
  const personId = body?.personId ?? null;
  const key = conversationId ?? personId;
  if (!key) {
    return NextResponse.json(
      { error: 'A conversationId or personId is required.' },
      { status: 400 },
    );
  }

  const db = loadDb();
  if (personId && !db.people.some((p) => p.id === personId) && db.self?.id !== personId) {
    return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  }
  if (conversationId && !db.activity.conversations.some((c) => c.id === conversationId)) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const existing = openDraftFor(db.drafts, key);

  // An emptied draft is a discarded one — keeping a blank around would leave a
  // "drafted" marker on Reconnect with nothing behind it.
  if (!text.trim()) {
    if (existing) {
      db.drafts = db.drafts.filter((d) => d.id !== existing.id);
      saveDb(db);
    }
    return NextResponse.json({ draft: null });
  }

  if (existing) {
    existing.body = text;
    existing.updatedAt = now;
    // A draft opened from a thread later reached from the person page (or the
    // reverse) should keep both links rather than lose one.
    existing.conversationId = existing.conversationId ?? conversationId;
    existing.personId = existing.personId ?? personId;
    saveDb(db);
    return NextResponse.json({ draft: existing });
  }

  const draft: Draft = {
    id: newId('dr'),
    key,
    conversationId,
    personId,
    body: text,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
  };
  db.drafts.unshift(draft);
  saveDb(db);
  return NextResponse.json({ draft });
}

/** Mark a draft sent, reopen it, or delete it. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { draftId?: string; sent?: boolean; delete?: boolean }
    | null;
  if (!body?.draftId) {
    return NextResponse.json({ error: 'draftId is required.' }, { status: 400 });
  }

  const db = loadDb();
  const index = db.drafts.findIndex((d) => d.id === body.draftId);
  if (index === -1) {
    return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  }

  if (body.delete) {
    db.drafts.splice(index, 1);
    saveDb(db);
    return NextResponse.json({ deleted: true });
  }

  const now = new Date().toISOString();
  db.drafts[index].sentAt = body.sent === false ? null : now;
  db.drafts[index].updatedAt = now;
  saveDb(db);
  return NextResponse.json({ draft: db.drafts[index] });
}
