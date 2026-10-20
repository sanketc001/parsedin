'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { FilterPanel } from '@/components/FilterPanel';
import { Empty, PageHeader, PersonLine } from '@/components/ui';
import {
  computeFacets,
  emptyFilters,
  filterPeople,
  sortPeople,
  type Filters,
  type SortKey,
  type ContactFilter,
  CONTACT_FILTERS,
} from '@/lib/query/filters';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'recently-connected', label: 'Recently connected' },
  { value: 'recently-updated', label: 'Recently updated' },
  { value: 'strength', label: 'Relationship strength' },
  { value: 'contact', label: 'Contact signal' },
  { value: 'last-contact', label: 'Last contact' },
  { value: 'detail', label: 'Profile depth' },
];

const PAGE_SIZE = 100;

export default function PeoplePage() {
  return (
    <Suspense fallback={<PageHeader title="People" />}>
      <PeopleBrowser />
    </Suspense>
  );
}

function PeopleBrowser() {
  const { db, idx, loading } = useData();
  const params = useSearchParams();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<SortKey>('name');
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Seed filters from the URL once, so links from other pages can prefilter.
  useEffect(() => {
    const next = emptyFilters();
    let touched = false;
    const q = params.get('q');
    if (q) {
      next.q = q;
      touched = true;
    }
    const title = params.get('title');
    if (title) {
      next.title = title;
      touched = true;
    }
    for (const [param, key] of [
      ['company', 'currentCompanyIds'],
      ['past', 'pastCompanyIds'],
      ['anyCompany', 'anyCompanyIds'],
      ['school', 'schoolIds'],
      ['location', 'locations'],
      ['skill', 'skills'],
      ['industry', 'industries'],
    ] as const) {
      const values = params.getAll(param);
      if (values.length > 0) {
        (next[key] as string[]).push(...values);
        touched = true;
      }
    }
    const degrees = params.getAll('degrees');
    if (degrees.length > 0) {
      next.degrees = degrees.map(Number).filter((n) => !Number.isNaN(n));
      touched = true;
    }
    const contact = params.get('contact');
    if (contact && CONTACT_FILTERS.some((c) => c.value === contact)) {
      next.contact = contact as ContactFilter;
      touched = true;
    }
    if (touched) setFilters(next);
  }, [params]);

  // Facets are computed over everything, so counts show what a filter *would*
  // yield rather than only what the current result set already contains.
  const facets = useMemo(() => computeFacets(db.people, idx), [db.people, idx]);

  const results = useMemo(() => {
    const matched = filterPeople(db, filters, idx);
    return sortPeople(matched, sort, idx);
  }, [db, filters, idx, sort]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [filters, sort]);

  const visible = results.slice(0, limit);

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          loading
            ? 'loading…'
            : `${results.length.toLocaleString()} of ${db.people.length.toLocaleString()} people`
        }
        actions={
          <>
            <input
              className="input w-64"
              placeholder="Search everything…"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
            <select
              className="rounded-md border border-line-strong bg-surface-sunken px-2 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        }
      />

      <div className="flex items-start">
        <div className="sticky top-[var(--chrome-h)] max-h-[calc(100vh-var(--chrome-h))]">
          <FilterPanel
            filters={filters}
            facets={facets}
            onChange={setFilters}
            onReset={() => setFilters(emptyFilters())}
          />
        </div>

        <div className="min-w-0 flex-1 p-4">
          {db.people.length === 0 && !loading ? (
            <Empty>
              No people yet.{' '}
              <Link href="/import" className="link">
                Import your data
              </Link>{' '}
              to get started.
            </Empty>
          ) : results.length === 0 ? (
            <Empty>
              Nothing matches these filters. Values inside a group are OR&apos;d; separate
              groups are AND&apos;d together.
            </Empty>
          ) : (
            <div className="card overflow-hidden">
              {visible.map((person) => (
                <PersonLine
                  key={person.id}
                  person={person}
                  strength={idx.strengthByPerson.get(person.id)}
                  noteCount={idx.noteCountByPerson.get(person.id)}
                />
              ))}
            </div>
          )}

          {results.length > visible.length ? (
            <div className="mt-3 text-center">
              <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, results.length - visible.length)} more
                <span className="text-xs text-fg-subtle">
                  {visible.length}/{results.length}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
