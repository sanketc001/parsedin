import { NextResponse } from 'next/server';
import { strToU8 } from 'fflate';
import { runImport } from '@/lib/ingest';
import { invalidate } from '@/lib/db';
import { buildSampleProfiles } from '@/lib/sample';

export const dynamic = 'force-dynamic';

/**
 * Load the synthetic demo network. Goes through the normal import path so the
 * resulting batch shows up in Sources like any other import — and is just as
 * removable.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { count?: number } | null;
  const profiles = buildSampleProfiles({ count: body?.count ?? 60 });

  try {
    const { batch } = runImport(
      [{ name: 'sample-network.json', bytes: strToU8(JSON.stringify(profiles)) }],
      { label: 'Sample network (synthetic)', kind: 'enriched-json' },
    );
    return NextResponse.json({ batch });
  } catch (err) {
    console.error('[parsedin] sample load failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    invalidate();
  }
}
