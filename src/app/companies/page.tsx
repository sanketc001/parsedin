'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader } from '@/components/ui';
import { companyKey } from '@/lib/normalize';

type Sort = 'people' | 'name' | 'current';

export default function CompaniesPage() {
  const { db, idx, loading } = useData();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('people');

  const rows = useMemo(() => {
    const needle = companyKey(q);
    return db.companies
      .map((company) => {
        const current = idx.currentByCompany.get(company.id)?.length ?? 0;
        const past = idx.pastByCompany.get(company.id)?.length ?? 0;
        return { company, current, past, total: current + past };
      })
      .filter((r) => r.total > 0)
      .filter((r) => (needle ? r.company.nameKey.includes(needle) : true))
      .sort((a, b) => {
        if (sort === 'name') return a.company.name.localeCompare(b.company.name);
        if (sort === 'current') return b.current - a.current || b.total - a.total;
        return b.total - a.total || a.company.name.localeCompare(b.company.name);
      });
  }, [db.companies, idx, q, sort]);

  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={loading ? 'loading…' : `${rows.length.toLocaleString()} companies in your network`}
        actions={
          <>
            <input
              className="input w-56"
              placeholder="Find a company…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="rounded-md border border-ink-600 bg-ink-850 px-2 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="people">Most people</option>
              <option value="current">Most current</option>
              <option value="name">Name</option>
            </select>
          </>
        }
      />

      <div className="p-6">
        {rows.length === 0 ? (
          <Empty>
            No companies yet.{' '}
            <Link href="/import" className="link">
              Import data
            </Link>
            .
          </Empty>
        ) : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_5rem_5rem_8rem] items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">
              <span>Company</span>
              <span className="text-right">Current</span>
              <span className="text-right">Past</span>
              <span className="text-right">Total</span>
            </div>
            {rows.map(({ company, current, past, total }) => (
              <Link
                key={company.id}
                href={`/companies/${encodeURIComponent(company.id)}`}
                className="relative grid grid-cols-[1fr_5rem_5rem_8rem] items-center gap-2 border-b border-ink-800 px-3 py-2 last:border-0 hover:bg-ink-850"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-accent/5"
                  style={{ width: `${(total / max) * 100}%` }}
                  aria-hidden
                />
                <span className="relative truncate text-sm text-slate-200">{company.name}</span>
                <span className="relative text-right font-mono text-xs text-slate-300">{current}</span>
                <span className="relative text-right font-mono text-xs text-slate-500">{past}</span>
                <span className="relative text-right font-mono text-xs text-slate-400">{total}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
