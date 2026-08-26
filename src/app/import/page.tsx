'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { PageHeader, Section } from '@/components/ui';
import type { ImportBatch } from '@/lib/types';
import { ENRICHED_TEMPLATE, SUPPORTED_FILES } from '@/lib/ingest/spec';

export default function ImportPage() {
  const { refresh, db } = useData();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [dragging, setDragging] = useState(false);

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      if (label.trim()) form.append('label', label.trim());

      const res = await fetch('/api/import', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `import failed (${res.status})`);
      setResult(json.batch as ImportBatch);
      setFiles([]);
      setLabel('');
      if (inputRef.current) inputRef.current.value = '';
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 60 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'sample load failed');
      setResult(json.batch as ImportBatch);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const ok = window.confirm(
      'Delete all imported people, companies and schools?\n\nYour private notes and relationship ratings will be kept.',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE', keepPrivate: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'reset failed');
      setResult(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(ENRICHED_TEMPLATE, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parsedin-enriched-template.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Everything stays on this machine — nothing is uploaded anywhere"
        actions={
          db.people.length > 0 ? (
            <button type="button" className="btn btn-danger" onClick={() => void reset()} disabled={busy}>
              Clear imported data
            </button>
          ) : null
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Upload">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                setFiles(Array.from(e.dataTransfer.files));
              }}
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? 'border-accent bg-accent/5' : 'border-ink-600'
              }`}
            >
              <p className="text-sm text-slate-300">
                Drop your LinkedIn export <span className="font-mono text-xs">.zip</span>, loose{' '}
                <span className="font-mono text-xs">.csv</span> files, or an enriched{' '}
                <span className="font-mono text-xs">.json</span> here
              </p>
              <p className="mt-1 text-xs text-slate-500">or</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".zip,.csv,.json"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="mx-auto mt-2 block text-xs text-slate-400 file:mr-2 file:rounded file:border file:border-ink-600 file:bg-ink-800 file:px-2 file:py-1 file:text-xs file:text-slate-200"
              />
            </div>

            {files.length > 0 ? (
              <div className="mt-3">
                <div className="label mb-1">Selected ({files.length})</div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-slate-400">
                  {files.map((f) => (
                    <li key={f.name} className="flex justify-between gap-2">
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-slate-600">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="input flex-1"
                placeholder="Label for this import (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || files.length === 0}
                onClick={() => void submit()}
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            {result ? <ImportSummary batch={result} /> : null}
          </Section>

          <Section title="Enriched profile JSON">
            <div className="space-y-2 text-sm text-slate-400">
              <p>
                LinkedIn&apos;s own export gives full career and education history{' '}
                <em>only for your own profile</em>. For connections it provides just name, profile
                URL, email, current company, current title and the date you connected.
              </p>
              <p>
                To get career history, education, skills, certifications and volunteering for the
                people in your network, import an enriched JSON file. Records merge onto existing
                people by LinkedIn URL first, then by name — so enrichment deepens what you already
                have instead of duplicating it.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className="btn" onClick={downloadTemplate}>
                  Download template JSON
                </button>
              </div>
              <pre className="mt-2 max-h-64 overflow-auto rounded border border-ink-700 bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
                {JSON.stringify(ENRICHED_TEMPLATE, null, 2)}
              </pre>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Try it without your data">
            <p className="text-sm text-slate-400">
              Load a synthetic network of 60 fictional people across real company and school names,
              so search, the graph and the question parser have something to chew on.
            </p>
            <button
              type="button"
              className="btn mt-3 w-full"
              onClick={() => void loadSample()}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Load sample network'}
            </button>
            <p className="mt-2 text-[11px] text-slate-600">
              It records as a normal import, so you can clear it like any other.
            </p>
          </Section>

          <Section title="How to get your LinkedIn export">
            <ol className="list-inside list-decimal space-y-1 text-sm text-slate-400">
              <li>LinkedIn → Settings &amp; Privacy</li>
              <li>Data Privacy → Get a copy of your data</li>
              <li>
                Pick <em>Want something in particular?</em> and select Connections, Positions,
                Education, Skills, Certifications, Volunteering
              </li>
              <li>Request the archive and wait for the email</li>
              <li>Drop the .zip here — no need to unpack it</li>
            </ol>
          </Section>

          <Section title="Files understood" count={SUPPORTED_FILES.length}>
            <ul className="space-y-0.5 font-mono text-[11px] text-slate-500">
              {SUPPORTED_FILES.map((f) => (
                <li key={f}>{f}</li>
              ))}
              <li className="text-slate-600">*.json (enriched profiles)</li>
            </ul>
            <p className="mt-2 text-[11px] text-slate-600">
              Anything else in the archive is listed as skipped rather than silently ignored.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}

function ImportSummary({ batch }: { batch: ImportBatch }) {
  const s = batch.stats;
  const rows: [string, number | string][] = [
    ['People created', s.peopleCreated],
    ['People updated', s.peopleUpdated],
    ['Positions', s.positions],
    ['Education', s.education],
    ['Skills', s.skills],
    ['Certifications', s.certifications],
    ['Volunteering', s.volunteering],
    ['Languages', s.languages],
    ['Projects', s.projects],
    ['Honors', s.honors],
    ['Companies total', s.companies],
    ['Schools total', s.schools],
    ['Rows skipped', s.rowsSkipped],
  ];

  return (
    <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/20 p-3">
      <div className="text-sm font-medium text-emerald-300">Imported: {batch.label}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-xs">
              <span className="text-slate-500">{k}</span>
              <span className="font-mono text-slate-300">{v}</span>
            </div>
          ))}
      </div>

      {batch.files.length > 0 ? (
        <div className="mt-2 text-[11px] text-slate-500">
          <span className="text-slate-400">Read:</span> {batch.files.join(', ')}
        </div>
      ) : null}
      {batch.skippedFiles.length > 0 ? (
        <div className="mt-1 text-[11px] text-amber-500/80">
          <span>Skipped:</span> {batch.skippedFiles.slice(0, 12).join(', ')}
          {batch.skippedFiles.length > 12 ? ` +${batch.skippedFiles.length - 12} more` : ''}
        </div>
      ) : null}
      {batch.notes.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
          {batch.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex gap-2">
        <Link href="/people" className="btn px-2 py-1 text-xs">
          Browse people →
        </Link>
        <Link href="/graph" className="btn px-2 py-1 text-xs">
          See the graph →
        </Link>
      </div>
    </div>
  );
}
