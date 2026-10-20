import { NextResponse } from 'next/server';
import { strToU8 } from 'fflate';
import { runImport, type UploadedFile } from '@/lib/ingest';
import { invalidate, loadDb } from '@/lib/db';
import { buildSampleActivity, buildSampleProfiles } from '@/lib/sample';

export const dynamic = 'force-dynamic';

/**
 * Load the synthetic demo network. Goes through the normal import path so the
 * resulting batch shows up in Sources like any other import — and is just as
 * removable.
 *
 * The batch carries an activity archive too (messages, invitations, job
 * applications, feed activity) so the Inbox, Reconnect and Jobs pages have
 * something to show. Those files are written *from* whoever the account owner
 * already is; when there is no owner yet, a fictional one is supplied. What is
 * never done is overwriting a real Profile.csv-derived owner with a demo one.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { count?: number } | null;
  const sample = buildSampleProfiles({ count: body?.count ?? 60 });

  const existing = loadDb().self;
  const owner = {
    fullName: existing?.fullName ?? 'Sample Owner',
    linkedinUrl: existing?.linkedinUrl ?? 'https://www.linkedin.com/in/sample-owner/',
  };

  const files: UploadedFile[] = [
    { name: 'sample-network.json', bytes: strToU8(JSON.stringify(sample)) },
  ];

  // Only introduce an owner profile when the database has none; otherwise the
  // demo would rewrite the real one's headline and summary.
  if (!existing) {
    files.push({
      name: 'Profile.csv',
      bytes: strToU8(
        'First Name,Last Name,Headline,Summary,Industry,Geo Location\n' +
          '"Sample","Owner","Demo account for the synthetic network","",' +
          '"Software Development","Bengaluru, India"\n',
      ),
    });
  }

  for (const file of buildSampleActivity(sample.profiles, owner, {})) {
    files.push({ name: file.name, bytes: strToU8(file.content) });
  }

  try {
    const { batch } = runImport(files, {
      label: 'Sample network (synthetic)',
      kind: 'enriched-json',
    });
    return NextResponse.json({ batch });
  } catch (err) {
    console.error('[parsedin] sample load failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    invalidate();
  }
}
