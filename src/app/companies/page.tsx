'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader } from '@/components/ui';
import { companyKey } from '@/lib/normalize';
import { descendantIds, rootId } from '@/lib/resolution';

type Sort = 'people' | 'name' | 'current';
type View = 'flat' | 'grouped';

export default function CompaniesPage() {
  const { db, idx, loading } = useData();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('people');
  const [view, setView] = useState<View>('flat');

  const countsFor = (id: string) => ({
    current: idx.currentByCompany.get(id)?.length ?? 0,
    past: idx.pastByCompany.get(id)?.length ?? 0,
  });

  const rows = useMemo(() => {
    const needle = companyKey(q);
    return db.companies
      .map((company) => {
        const { current, past } = countsFor(company.id);
        return { company, current, past, total: current + past };
      })
      .filter((r) => r.total > 0)
      .filter((r) => (needle ? r.company.nameKey.includes(needle) : true))
      .sort((a, b) => {
        if (sort === 'name') return a.company.name.localeCompare(b.company.name);
        if (sort === 'current') return b.current - a.current || b.total - a.total;
        return b.total - a.total || a.company.name.localeCompare(b.company.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.companies, idx, q, sort]);

  /**
   * Grouped view rolls each corporate family up under its top-level parent,
   * so a group that is split across many legal entities reads as one number.
   */
  const groups = useMemo(() => {
    const needle = companyKey(q);
    const byRoot = new Map<string, string[]>();
    for (const company of db.companies) {
      const root = rootId(db, company.id);
      const list = byRoot.get(root);
      if (list) list.push(company.id);
      else byRoot.set(root, [company.id]);
    }

    return [...byRoot.entries()]
      // Only families are interesting here; standalone companies stay in the flat list.
      .filter(([, members]) => members.length > 1)
      .map(([root, members]) => {
        const total = members.reduce((sum, id) => {
          const { current, past } = countsFor(id);
          return sum + current + past;
        }, 0);
        const rootCompany = idx.companyById.get(root);
        return {
          root,
          rootName: rootCompany?.name ?? root,
          members: members
            .map((id) => ({ company: idx.companyById.get(id)!, ...countsFor(id) }))
            .filter((m) => m.company)
            .sort((a, b) => b.current + b.past - (a.current + a.past)),
          total,
        };
      })
      .filter((g) =>
        needle
          ? g.rootName.toLowerCase().includes(q.toLowerCase()) ||
            g.members.some((m) => m.company.nameKey.includes(needle))
          : true,
      )
      .sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, idx, q]);

  const max = Math.max(...rows.map((r) => r.total), 1);
  const groupMax = Math.max(...groups.map((g) => g.total), 1);

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={
          loading
            ? 'loading…'
            : view === 'grouped'
              ? `${groups.length} corporate groups`
              : `${rows.length.toLocaleString()} companies in your network`
        }
        actions={
          <>
            <div className="flex overflow-hidden rounded-md border border-line-strong">
              {(['flat', 'grouped'] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-2 py-1.5 text-xs ${
                    view === v ? 'bg-brand/15 text-brand-dark' : 'text-fg-muted hover:bg-surface-sunken'
                  }`}
                >
                  {v === 'flat' ? 'All' : 'Groups'}
                </button>
              ))}
            </div>
            <input
              className="input w-48"
              placeholder="Find a company…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {view === 'flat' ? (
              <select
                className="rounded-md border border-line-strong bg-surface-sunken px-2 py-1.5 text-sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="people">Most people</option>
                <option value="current">Most current</option>
                <option value="name">Name</option>
              </select>
            ) : null}
            <Link href="/companies/resolve" className="btn">
              Resolve
              {db.resolution.proposals.filter((p) => p.status === 'pending').length > 0 ? (
                <span className="text-[10px] text-warn">
                  {db.resolution.proposals.filter((p) => p.status === 'pending').length}
                </span>
              ) : null}
            </Link>
          </>
        }
      />

      <div className="p-6">
        {view === 'grouped' ? (
          groups.length === 0 ? (
            <Empty>
              No corporate groups recorded yet.{' '}
              <Link href="/companies/resolve" className="link">
                Run resolution
              </Link>{' '}
              to find parents and subsidiaries.
            </Empty>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.root} className="card overflow-hidden">
                  <div className="relative flex items-center justify-between gap-2 border-b border-line bg-surface-sunken px-3 py-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-brand/5"
                      style={{ width: `${(g.total / groupMax) * 100}%` }}
                      aria-hidden
                    />
                    <Link
                      href={`/companies/${encodeURIComponent(g.root)}`}
                      className="relative truncate text-sm font-medium text-fg hover:text-brand-dark"
                    >
                      {g.rootName}
                    </Link>
                    <span className="relative shrink-0 text-xs text-fg-muted">
                      {g.total} across {g.members.length}
                    </span>
                  </div>
                  {g.members.map((m) => (
                    <Link
                      key={m.company.id}
                      href={`/companies/${encodeURIComponent(m.company.id)}`}
                      className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 pl-6 last:border-0 hover:bg-surface-sunken"
                    >
                      <span className="min-w-0 truncate text-sm text-fg-muted">
                        {m.company.id === g.root ? '(itself)' : m.company.name}
                        {m.company.relationToParent ? (
                          <span className="ml-2 text-[10px] text-fg-faint">
                            {m.company.relationToParent}
                          </span>
                        ) : null}
                        {m.company.synthetic ? (
                          <span className="ml-2 text-[10px] text-fg-faint">
                            holding
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {m.current + m.past}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )
        ) : rows.length === 0 ? (
          <Empty>
            No companies yet.{' '}
            <Link href="/import" className="link">
              Import data
            </Link>
            .
          </Empty>
        ) : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_5rem_5rem_8rem] items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2 text-[11px] uppercase tracking-wider text-fg-subtle">
              <span>Company</span>
              <span className="text-right">Current</span>
              <span className="text-right">Past</span>
              <span className="text-right">Total</span>
            </div>
            {rows.map(({ company, current, past, total }) => {
              const group = descendantIds(db, rootId(db, company.id));
              const inGroup = group.length > 1;
              return (
                <Link
                  key={company.id}
                  href={`/companies/${encodeURIComponent(company.id)}`}
                  className="relative grid grid-cols-[1fr_5rem_5rem_8rem] items-center gap-2 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-sunken"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-brand/5"
                    style={{ width: `${(total / max) * 100}%` }}
                    aria-hidden
                  />
                  <span className="relative min-w-0 truncate text-sm text-fg">
                    {company.name}
                    {inGroup ? (
                      <span
                        className="ml-2 text-[10px] text-fg-faint"
                        title={`part of the ${idx.companyById.get(rootId(db, company.id))?.name} group`}
                      >
                        ⤴ {idx.companyById.get(rootId(db, company.id))?.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="relative text-right text-xs text-fg-muted">
                    {current}
                  </span>
                  <span className="relative text-right text-xs text-fg-subtle">
                    {past}
                  </span>
                  <span className="relative text-right text-xs text-fg-muted">
                    {total}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
