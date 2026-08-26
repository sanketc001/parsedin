'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';
import { runAggregation } from '@/lib/query/aggregate';

export default function OverviewPage() {
  const { db, idx, loading } = useData();

  const stats = useMemo(() => {
    const withHistory = db.people.filter((p) => p.positions.length > 1).length;
    const withEducation = db.people.filter((p) => p.education.length > 0).length;
    const direct = db.people.filter((p) => p.connectionDegree === 1).length;
    const rated = db.relationships.length;
    const noted = new Set(db.notes.map((n) => n.personId)).size;
    return { withHistory, withEducation, direct, rated, noted };
  }, [db]);

  const topCompanies = useMemo(
    () => runAggregation(db.people, { kind: 'companies', scope: 'current', limit: 8 }, idx),
    [db.people, idx],
  );
  const topSchools = useMemo(
    () => runAggregation(db.people, { kind: 'schools', scope: 'any', limit: 8 }, idx),
    [db.people, idx],
  );
  const topLocations = useMemo(
    () => runAggregation(db.people, { kind: 'locations', scope: 'any', limit: 8 }, idx),
    [db.people, idx],
  );

  const recentlyUpdated = useMemo(
    () => [...db.people].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)).slice(0, 8),
    [db.people],
  );

  const empty = !loading && db.people.length === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          db.self
            ? `Network of ${db.self.fullName}`
            : 'Your professional network as a knowledge graph'
        }
        actions={
          <Link href="/import" className="btn btn-primary">
            Import data
          </Link>
        }
      />

      <div className="space-y-4 p-6">
        {empty ? (
          <div className="card p-8 text-center">
            <h2 className="text-base font-semibold text-slate-100">Nothing imported yet</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
              Import your LinkedIn data export to build the graph, or load a synthetic
              sample network to see how everything works first.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link href="/import" className="btn btn-primary">
                Go to Import
              </Link>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="People" value={db.people.length} href="/people" />
          <Stat
            label="Direct"
            value={stats.direct}
            hint="1st-degree connections"
            href="/people?degrees=1"
          />
          <Stat label="Companies" value={db.companies.length} href="/companies" />
          <Stat label="Schools" value={db.schools.length} href="/schools" />
          <Stat
            label="Deep profiles"
            value={stats.withHistory}
            hint="more than one role on record"
          />
          <Stat label="Rated / noted" value={`${stats.rated} / ${stats.noted}`} hint="private" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Top companies" count={topCompanies.length}>
            {topCompanies.length === 0 ? (
              <Empty>No companies yet.</Empty>
            ) : (
              <RankList rows={topCompanies} />
            )}
          </Section>

          <Section title="Top schools" count={topSchools.length}>
            {topSchools.length === 0 ? (
              <Empty>No schools yet — LinkedIn&apos;s export omits education for connections.</Empty>
            ) : (
              <RankList rows={topSchools} />
            )}
          </Section>

          <Section title="Top locations" count={topLocations.length}>
            {topLocations.length === 0 ? (
              <Empty>No locations yet.</Empty>
            ) : (
              <RankList rows={topLocations} />
            )}
          </Section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Recently updated people"
            aside={
              <Link href="/people" className="text-xs text-slate-500 hover:text-slate-300">
                all people →
              </Link>
            }
          >
            {recentlyUpdated.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="divide-y divide-ink-800">
                {recentlyUpdated.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/people/${encodeURIComponent(p.id)}`}
                      className="flex items-center justify-between gap-3 px-1 py-2 hover:bg-ink-850"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-200">{p.fullName}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {[p.currentTitle, p.currentCompany].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-600">
                        {new Date(p.lastUpdatedAt).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Imports"
            count={db.batches.length}
            aside={
              <Link href="/sources" className="text-xs text-slate-500 hover:text-slate-300">
                provenance →
              </Link>
            }
          >
            {db.batches.length === 0 ? (
              <Empty>No imports recorded.</Empty>
            ) : (
              <ul className="divide-y divide-ink-800">
                {db.batches.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-1 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-200">{b.label}</span>
                      <span className="block truncate font-mono text-[10px] text-slate-500">
                        {b.kind} · +{b.stats.peopleCreated} new · {b.files.length} files
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      {new Date(b.importedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function RankList({
  rows,
}: {
  rows: { key: string; label: string; count: number; href: string | null }[];
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const inner = (
          <div className="relative flex items-center justify-between gap-2 rounded px-2 py-1">
            {/* Count rendered as a bar so relative scale is readable at a glance. */}
            <div
              className="absolute inset-y-0 left-0 rounded bg-accent/10"
              style={{ width: `${(row.count / max) * 100}%` }}
              aria-hidden
            />
            <span className="relative truncate text-sm text-slate-300">{row.label}</span>
            <span className="relative shrink-0 font-mono text-xs text-slate-400">{row.count}</span>
          </div>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className="block hover:brightness-125">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
