'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';

/**
 * Provenance view: every import, what it contributed, and which files it read
 * or skipped. The point is that no fact in this database is anonymous.
 */
export default function SourcesPage() {
  const { db, loading } = useData();

  const contribution = useMemo(() => {
    // How many people currently carry a given batch as a contributing source.
    const counts = new Map<string, number>();
    for (const person of db.people) {
      for (const id of person.sourceBatchIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [db.people]);

  const fieldOrigins = useMemo(() => {
    // Which source file each scalar fact came from, across the whole database.
    const counts = new Map<string, number>();
    for (const person of db.people) {
      for (const src of Object.values(person.fieldSources)) {
        counts.set(src.sourceLabel, (counts.get(src.sourceLabel) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [db.people]);

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Where every piece of information came from, and when"
        actions={
          <Link href="/import" className="btn btn-primary">
            New import
          </Link>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Imports" value={db.batches.length} />
          <Stat label="People" value={db.people.length} />
          <Stat label="Private notes" value={db.notes.length} />
          <Stat label="Ratings" value={db.relationships.length} />
        </div>

        <Section title="Import history" count={db.batches.length}>
          {db.batches.length === 0 ? (
            <Empty>
              {loading ? 'loading…' : 'No imports yet.'}{' '}
              <Link href="/import" className="link">
                Import something
              </Link>
              .
            </Empty>
          ) : (
            <ul className="space-y-3">
              {db.batches.map((batch) => (
                <li key={batch.id} className="rounded border border-ink-800 bg-ink-850 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100">{batch.label}</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {new Date(batch.importedAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="chip font-mono">{batch.kind}</span>
                    <span className="text-slate-500">
                      +{batch.stats.peopleCreated} created · {batch.stats.peopleUpdated} updated ·{' '}
                      {contribution.get(batch.id) ?? 0} people reference this import
                    </span>
                  </div>

                  <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
                    <div>
                      <span className="label block">Files read ({batch.files.length})</span>
                      <ul className="mt-0.5 space-y-0.5 font-mono text-slate-500">
                        {batch.files.length === 0 ? (
                          <li className="text-slate-600">none</li>
                        ) : (
                          batch.files.map((f) => <li key={f}>{f}</li>)
                        )}
                      </ul>
                    </div>
                    {batch.skippedFiles.length > 0 ? (
                      <div>
                        <span className="label block">
                          Skipped ({batch.skippedFiles.length})
                        </span>
                        <ul className="mt-0.5 max-h-28 space-y-0.5 overflow-y-auto font-mono text-slate-600">
                          {batch.skippedFiles.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  {batch.notes.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 border-t border-ink-800 pt-2 text-[11px] text-slate-500">
                      {batch.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-2 font-mono text-[10px] text-slate-600">id {batch.id}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Facts by originating file" count={fieldOrigins.length}>
            {fieldOrigins.length === 0 ? (
              <Empty>Nothing recorded.</Empty>
            ) : (
              <ul className="space-y-1">
                {fieldOrigins.map(([label, count]) => {
                  const max = fieldOrigins[0][1] || 1;
                  return (
                    <li key={label} className="relative flex items-center justify-between gap-2 rounded px-2 py-1">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-accent/10"
                        style={{ width: `${(count / max) * 100}%` }}
                        aria-hidden
                      />
                      <span className="relative truncate font-mono text-xs text-slate-300">
                        {label}
                      </span>
                      <span className="relative shrink-0 font-mono text-xs text-slate-500">
                        {count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="What is private">
            <div className="space-y-2 text-sm text-slate-400">
              <p>
                Notes and relationship-strength ratings are yours — they are never produced by an
                import and are never included in one. Clearing imported data from the Import page
                keeps them.
              </p>
              <p>
                Everything else carries the import batch that introduced it plus a timestamp. On a
                person&apos;s profile, the small{' '}
                <span className="font-mono text-slate-500">ⓘ</span> next to a field reveals the
                exact file and import time behind that value.
              </p>
              <p className="font-mono text-[11px] text-slate-600">
                stored at data/parsedin.json
              </p>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
