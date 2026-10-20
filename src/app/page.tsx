'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';
import { runAggregation } from '@/lib/query/aggregate';
import { buildReconnectList } from '@/lib/contact';

export default function OverviewPage() {
  const { db, idx, loading } = useData();

  const stats = useMemo(() => {
    const direct = db.people.filter((p) => p.connectionDegree === 1).length;
    let messages = 0;
    let threads = 0;
    for (const c of db.activity.conversations) {
      // Sponsored InMail is advertising; counting it as correspondence would
      // flatter the numbers on every page that shows them.
      if (c.sponsored) continue;
      messages += c.messages.length;
      threads += 1;
    }
    return { direct, messages, threads };
  }, [db]);

  /**
   * The headline finding: how much of the network you have ever spoken to.
   * Almost every LinkedIn graph is mostly strangers, and saying so up front is
   * more honest than a connection count.
   */
  const reach = useMemo(() => {
    // Messages only. An invitation or an endorsement is contact of a sort, and
    // the contact index counts both — but neither is having spoken to someone.
    const spoken = [...idx.contactByPerson.values()].filter((s) => s.messages > 0).length;
    const direct = db.people.filter((p) => p.connectionDegree === 1).length;
    return {
      spoken,
      share: direct > 0 ? Math.round((spoken / direct) * 100) : 0,
    };
  }, [db.people, idx.contactByPerson]);

  const needsReply = useMemo(
    () =>
      buildReconnectList(db, idx.contactByPerson, idx.personById).filter(
        (i) => i.reason === 'awaiting-your-reply',
      ),
    [db, idx],
  );

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
            <h2 className="text-base font-semibold text-fg">Nothing imported yet</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-fg-muted">
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
            label="Ever spoken to"
            value={reach.spoken}
            hint={`${reach.share}% of your connections`}
            href="/reconnect"
          />
          <Stat
            label="Messages"
            value={stats.messages}
            hint={`${stats.threads} threads`}
            href="/inbox"
          />
        </div>

        {needsReply.length > 0 ? (
          <Section
            title="Waiting on you"
            count={needsReply.length}
            aside={
              <Link href="/reconnect" className="text-xs text-fg-subtle hover:text-fg-muted">
                all of them →
              </Link>
            }
          >
            <p className="mb-2 text-xs text-fg-subtle">
              The last message in these threads is theirs.
            </p>
            <ul className="divide-y divide-line">
              {needsReply.slice(0, 5).map((item) => (
                <li key={item.person.id}>
                  <Link
                    href={`/people/${encodeURIComponent(item.person.id)}`}
                    className="flex items-center justify-between gap-3 px-1 py-2 hover:bg-surface-sunken"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">
                        {item.person.fullName}
                      </span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {[item.person.currentTitle, item.person.currentCompany]
                          .filter(Boolean)
                          .join(' · ') || item.person.headline}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-warn">
                      {item.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

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
              <Link href="/people" className="text-xs text-fg-subtle hover:text-fg-muted">
                all people →
              </Link>
            }
          >
            {recentlyUpdated.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {recentlyUpdated.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/people/${encodeURIComponent(p.id)}`}
                      className="flex items-center justify-between gap-3 px-1 py-2 hover:bg-surface-sunken"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">{p.fullName}</span>
                        <span className="block truncate text-xs text-fg-subtle">
                          {[p.currentTitle, p.currentCompany].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-fg-faint">
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
              <Link href="/sources" className="text-xs text-fg-subtle hover:text-fg-muted">
                provenance →
              </Link>
            }
          >
            {db.batches.length === 0 ? (
              <Empty>No imports recorded.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {db.batches.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-1 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{b.label}</span>
                      <span className="block truncate text-[10px] text-fg-subtle">
                        {b.kind} · +{b.stats.peopleCreated} new · {b.files.length} files
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-fg-faint">
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
              className="absolute inset-y-0 left-0 rounded bg-brand/10"
              style={{ width: `${(row.count / max) * 100}%` }}
              aria-hidden
            />
            <span className="relative truncate text-sm text-fg-muted">{row.label}</span>
            <span className="relative shrink-0 text-xs text-fg-muted">{row.count}</span>
          </div>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className="block hover:bg-surface-hover">
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
