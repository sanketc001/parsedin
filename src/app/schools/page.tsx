'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { PageHeader } from '@/components/ui';
import { schoolKey } from '@/lib/normalize';

export default function SchoolsPage() {
  const { db, idx, loading } = useData();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'people' | 'name'>('people');

  const rows = useMemo(() => {
    const needle = schoolKey(q);
    return db.schools
      .map((school) => ({ school, count: idx.bySchool.get(school.id)?.length ?? 0 }))
      .filter((r) => r.count > 0)
      .filter((r) => (needle ? r.school.nameKey.includes(needle) : true))
      .sort((a, b) =>
        sort === 'name'
          ? a.school.name.localeCompare(b.school.name)
          : b.count - a.count || a.school.name.localeCompare(b.school.name),
      );
  }, [db.schools, idx, q, sort]);

  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <>
      <PageHeader
        title="Schools"
        subtitle={
          loading
            ? 'loading…'
            : rows.length === 0
              ? 'no education data yet'
              : `${rows.length.toLocaleString()} schools in your network`
        }
        actions={
          <>
            <input
              className="input w-56"
              placeholder="Find a school…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="rounded-md border border-ink-600 bg-ink-850 px-2 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as 'people' | 'name')}
            >
              <option value="people">Most people</option>
              <option value="name">Name</option>
            </select>
          </>
        }
      />

      <div className="p-6">
        {rows.length === 0 ? (
          <div className="card p-6 text-sm text-slate-400">
            <p className="font-medium text-slate-200">No education data yet</p>
            <p className="mt-2">
              LinkedIn&apos;s data export includes education only for your own profile — not for
              your connections. To populate this view, add profile detail through an{' '}
              <Link href="/import" className="link">
                enriched JSON import
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_6rem] items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">
              <span>School</span>
              <span className="text-right">People</span>
            </div>
            {rows.map(({ school, count }) => (
              <Link
                key={school.id}
                href={`/schools/${encodeURIComponent(school.id)}`}
                className="relative grid grid-cols-[1fr_6rem] items-center gap-2 border-b border-ink-800 px-3 py-2 last:border-0 hover:bg-ink-850"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-emerald-500/5"
                  style={{ width: `${(count / max) * 100}%` }}
                  aria-hidden
                />
                <span className="relative truncate text-sm text-slate-200">{school.name}</span>
                <span className="relative text-right font-mono text-xs text-slate-400">{count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
