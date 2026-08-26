'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, PersonLine, Section, Stat } from '@/components/ui';
import { currentCompanyIds } from '@/lib/derive';

export default function SchoolPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { idx, loading } = useData();

  const school = idx.schoolById.get(id) ?? null;
  const alumni = useMemo(
    () =>
      [...(idx.bySchool.get(id) ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [idx, id],
  );

  /** Where alumni ended up — the useful question to ask of a school. */
  const employers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of alumni) {
      for (const cid of currentCompanyIds(person)) {
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([cid, count]) => ({ cid, company: idx.companyById.get(cid), count }))
      .filter((r) => r.company)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [alumni, idx]);

  const degrees = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of alumni) {
      for (const edu of person.education) {
        if (edu.schoolId !== id) continue;
        const label = [edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ');
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [alumni, id]);

  if (loading) return <PageHeader title="Loading…" />;
  if (!school) {
    return (
      <>
        <PageHeader title="School not found" />
        <div className="p-6">
          <Empty>
            No school with id <code className="font-mono">{id}</code>.{' '}
            <Link href="/schools" className="link">
              Back to schools
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={school.name}
        subtitle={`${alumni.length} ${alumni.length === 1 ? 'person' : 'people'} in your network`}
        actions={
          <Link href={`/people?school=${encodeURIComponent(school.id)}`} className="btn">
            Filter people →
          </Link>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Alumni known" value={alumni.length} />
          <Stat label="Distinct employers" value={employers.length} />
          <Stat label="Degrees seen" value={degrees.length} />
          <Stat label="First seen" value={new Date(school.firstSeenAt).toLocaleDateString()} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Alumni in your network" count={alumni.length}>
            {alumni.length === 0 ? (
              <Empty>Nobody on record.</Empty>
            ) : (
              <div className="-mx-4 -mb-4">
                {alumni.map((p) => (
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

          <div className="space-y-4">
            <Section title="Where alumni work now" count={employers.length}>
              {employers.length === 0 ? (
                <Empty>No current employers on record.</Empty>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {employers.map((r) => (
                    <li key={r.cid}>
                      <Link
                        href={`/companies/${encodeURIComponent(r.cid)}`}
                        className="chip hover:border-accent/50"
                      >
                        {r.company!.name}
                        <span className="font-mono text-[10px] text-slate-500">{r.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Degrees & fields" count={degrees.length}>
              {degrees.length === 0 ? (
                <Empty>No degree detail on record.</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {degrees.map(([label, count]) => (
                    <li key={label} className="flex justify-between gap-2">
                      <span className="truncate text-slate-300">{label}</span>
                      <span className="font-mono text-xs text-slate-500">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
