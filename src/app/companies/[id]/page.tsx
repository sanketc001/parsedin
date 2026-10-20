'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, PersonLine, Section, Stat } from '@/components/ui';
import { schoolIds } from '@/lib/derive';
import { ancestorIds, childIds, descendantIds, rootId } from '@/lib/resolution';

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { db, idx, loading } = useData();

  const company = idx.companyById.get(id) ?? null;
  const current = useMemo(
    () =>
      [...(idx.currentByCompany.get(id) ?? [])].sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      ),
    [idx, id],
  );
  const past = useMemo(
    () =>
      [...(idx.pastByCompany.get(id) ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [idx, id],
  );

  // Corporate context: the chain above, the entities below, and how many
  // people the whole group accounts for.
  const hierarchy = useMemo(() => {
    const ancestors = ancestorIds(db, id)
      .map((cid) => idx.companyById.get(cid))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const children = childIds(db, id)
      .map((cid) => idx.companyById.get(cid))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const groupIds = descendantIds(db, rootId(db, id));
    const groupTotal = groupIds.reduce(
      (sum, cid) =>
        sum +
        (idx.currentByCompany.get(cid)?.length ?? 0) +
        (idx.pastByCompany.get(cid)?.length ?? 0),
      0,
    );
    const root = idx.companyById.get(rootId(db, id));
    return { ancestors, children, groupIds, groupTotal, root };
  }, [db, id, idx]);

  // Where else do these people study/work? Useful adjacency signal.
  const topSchools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of [...current, ...past]) {
      for (const sid of schoolIds(person)) counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([sid, count]) => ({ school: idx.schoolById.get(sid), count, sid }))
      .filter((r) => r.school)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [current, past, idx]);

  if (loading) return <PageHeader title="Loading…" />;
  if (!company) {
    return (
      <>
        <PageHeader title="Company not found" />
        <div className="p-6">
          <Empty>
            No company with id <code>{id}</code>.{' '}
            <Link href="/companies" className="link">
              Back to companies
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={
          company.aliases.length > 1
            ? `also seen as ${company.aliases.filter((a) => a !== company.name).join(', ')}`
            : 'Company in your network'
        }
        actions={
          <Link href={`/people?company=${encodeURIComponent(company.id)}`} className="btn">
            Filter people →
          </Link>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Work here now" value={current.length} />
          <Stat label="Worked here" value={past.length} />
          <Stat label="Total known" value={current.length + past.length} />
          {hierarchy.groupIds.length > 1 ? (
            <Stat
              label="Whole group"
              value={hierarchy.groupTotal}
              hint={`${hierarchy.root?.name} · ${hierarchy.groupIds.length} entities`}
              href={hierarchy.root ? `/companies/${encodeURIComponent(hierarchy.root.id)}` : undefined}
            />
          ) : (
            <Stat label="First seen" value={new Date(company.firstSeenAt).toLocaleDateString()} />
          )}
        </div>

        {hierarchy.ancestors.length > 0 || hierarchy.children.length > 0 ? (
          <Section title="Corporate structure">
            <div className="space-y-2 text-sm">
              {hierarchy.ancestors.length > 0 ? (
                <div>
                  <span className="label mb-1 block">Sits under</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[...hierarchy.ancestors].reverse().map((a, i) => (
                      <span key={a.id} className="flex items-center gap-1.5">
                        {i > 0 ? <span className="text-fg-faint">›</span> : null}
                        <Link
                          href={`/companies/${encodeURIComponent(a.id)}`}
                          className="chip hover:border-brand/50 hover:text-brand-dark"
                        >
                          {a.name}
                        </Link>
                      </span>
                    ))}
                    <span className="text-fg-faint">›</span>
                    <span className="chip border-brand/40 bg-brand/10 text-brand-dark">
                      {company.name}
                    </span>
                  </div>
                  {company.relationToParent ? (
                    <div className="mt-1 text-[10px] text-fg-faint">
                      relation: {company.relationToParent}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {hierarchy.children.length > 0 ? (
                <div className={hierarchy.ancestors.length > 0 ? 'border-t border-line pt-2' : ''}>
                  <span className="label mb-1 block">Contains ({hierarchy.children.length})</span>
                  <ul className="flex flex-wrap gap-1.5">
                    {hierarchy.children.map((c) => {
                      const n =
                        (idx.currentByCompany.get(c.id)?.length ?? 0) +
                        (idx.pastByCompany.get(c.id)?.length ?? 0);
                      return (
                        <li key={c.id}>
                          <Link
                            href={`/companies/${encodeURIComponent(c.id)}`}
                            className="chip hover:border-brand/50 hover:text-brand-dark"
                          >
                            {c.name}
                            {n > 0 ? (
                              <span className="text-[10px] text-fg-subtle">{n}</span>
                            ) : null}
                            {c.relationToParent ? (
                              <span className="text-[10px] text-fg-faint">
                                {c.relationToParent}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="border-t border-line pt-2">
                <Link href="/companies/resolve" className="text-xs text-fg-subtle hover:text-fg-muted">
                  review or revert these relationships →
                </Link>
              </div>
            </div>
          </Section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Currently here" count={current.length}>
            {current.length === 0 ? (
              <Empty>Nobody in your network works here now.</Empty>
            ) : (
              <div className="-mx-4 -mb-4">
                {current.map((p) => (
                  <PersonLine
                    key={p.id}
                    person={p}
                    strength={idx.strengthByPerson.get(p.id)}
                    noteCount={idx.noteCountByPerson.get(p.id)}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Previously here" count={past.length}>
            {past.length === 0 ? (
              <Empty>No alumni on record.</Empty>
            ) : (
              <div className="-mx-4 -mb-4">
                {past.map((p) => (
                  <PersonLine
                    key={p.id}
                    person={p}
                    strength={idx.strengthByPerson.get(p.id)}
                    noteCount={idx.noteCountByPerson.get(p.id)}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>

        {topSchools.length > 0 ? (
          <Section title="Where these people studied" count={topSchools.length}>
            <ul className="flex flex-wrap gap-2">
              {topSchools.map((r) => (
                <li key={r.sid}>
                  <Link href={`/schools/${encodeURIComponent(r.sid)}`} className="chip hover:border-brand/50">
                    {r.school!.name}
                    <span className="text-[10px] text-fg-subtle">{r.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Provenance">
          <ul className="space-y-1 text-xs text-fg-muted">
            {company.sourceBatchIds.map((bid) => {
              const batch = db.batches.find((b) => b.id === bid);
              return (
                <li key={bid}>
                  {batch?.label ?? bid}
                  {batch ? (
                    <span className="text-[10px] text-fg-faint">
                      {' '}
                      · {new Date(batch.importedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 text-[10px] text-fg-faint">
            first seen {new Date(company.firstSeenAt).toLocaleString()} · last updated{' '}
            {new Date(company.lastUpdatedAt).toLocaleString()}
          </div>
        </Section>
      </div>
    </>
  );
}
