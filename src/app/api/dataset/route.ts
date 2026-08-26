import { NextResponse } from 'next/server';
import { loadDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The whole database in one response. This is a private single-user app over a
 * personal network, so the client holds everything in memory and does all
 * filtering, graphing and question answering locally — no round trip per
 * keystroke.
 */
export async function GET() {
  const db = loadDb();
  return NextResponse.json(db, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
