import { NextResponse } from 'next/server';
import { runImport, type UploadedFile } from '@/lib/ingest';
import { invalidate } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Large archives take a moment to expand and parse.
export const maxDuration = 300;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read upload: ${String(err)}` },
      { status: 400 },
    );
  }

  const entries = form.getAll('files');
  const label = form.get('label');

  const files: UploadedFile[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') continue;
    const buf = new Uint8Array(await entry.arrayBuffer());
    files.push({ name: entry.name, bytes: buf });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files were uploaded.' }, { status: 400 });
  }

  try {
    const { batch } = runImport(files, {
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
    });
    return NextResponse.json({ batch });
  } catch (err) {
    console.error('[parsedin] import failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    invalidate();
  }
}
