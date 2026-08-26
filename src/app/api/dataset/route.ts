import { gzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { loadDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The whole database in one response. This is a private single-user app over a
 * personal network, so the client holds everything in memory and does all
 * filtering, graphing and question answering locally — no round trip per
 * keystroke.
 *
 * The payload is JSON-heavy and highly repetitive (provenance timestamps and
 * batch ids recur on every record), so it compresses roughly 15:1 — 1.8 MB
 * becomes ~120 KB. Compressing here rather than relying on the server's own
 * gzip means it applies in development too, where `next dev` does not compress.
 */
export async function GET(request: Request) {
  const db = loadDb();
  const body = JSON.stringify(db);

  const accepts = (request.headers.get('accept-encoding') ?? '').toLowerCase();
  if (accepts.includes('gzip')) {
    const compressed = gzipSync(body);
    return new Response(compressed, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Content-Length': String(compressed.byteLength),
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
      },
    });
  }

  return NextResponse.json(db, { headers: { 'Cache-Control': 'no-store' } });
}
