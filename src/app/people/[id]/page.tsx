'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import {
  DegreeBadge,
  Empty,
  PageHeader,
  Section,
  SourceTag,
  StrengthDots,
} from '@/components/ui';
import { NotesPanel } from '@/components/NotesPanel';
import type { Person, Provenanced } from '@/lib/types';
import { formatRange, formatTenure, monthsBetween } from '@/lib/normalize';
import { completeness, totalExperienceMonths } from '@/lib/derive';

export default function PersonPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { db, idx, loading, relationshipFor, setStrength } = useData();

  const person = useMemo<Person | null>(() => {
    if (db.self?.id === id) return db.self;
    return idx.personById.get(id) ?? null;
  }, [db.self, id, idx]);

  const batchLabel = useCallback(
    (batchId: string) => db.batches.find((b) => b.id === batchId)?.label ?? 'unknown source',
    [db.batches],
  );

  if (loading) {
    return <PageHeader title="Loading…" />;
  }
  if (!person) {
    return (
      <>
        <PageHeader title="Person not found" />
        <div className="p-6">
          <Empty>
            No record with id <code className="font-mono text-slate-400">{id}</code>.{' '}
            <Link href="/people" className="link">
              Back to people
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  const rel = relationshipFor(person.id);
  const experience = totalExperienceMonths(person);
  const depth = Math.round(completeness(person) * 100);

  return (
    <>
      <PageHeader
        title={person.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <DegreeBadge degree={person.connectionDegree} />
            {person.headline ? <span>{person.headline}</span> : null}
            {person.location ? <span className="text-slate-500">· {person.location}</span> : null}
          </span>
        }
        actions={
          person.linkedinUrl ? (
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn"
            >
              LinkedIn ↗
            </a>
          ) : null
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="At a glance">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Current title" value={person.currentTitle} person={person} field="currentTitle" />
              <Field
                label="Current company"
                value={person.currentCompany}
                person={person}
                field="currentCompany"
                href={person.currentCompanyId ? `/companies/${encodeURIComponent(person.currentCompanyId)}` : undefined}
              />
              <Field label="Location" value={person.location} person={person} field="location" />
              <Field label="Industry" value={person.industry} person={person} field="industry" />
              <Field label="Email" value={person.email} person={person} field="email" />
              <Field
                label="Connected on"
                value={person.connectedOn}
                person={person}
                field="connectedOn"
              />
              <Field
                label="Experience"
                value={experience !== null ? formatTenure(experience) : null}
              />
              <Field label="Profile depth" value={`${depth}%`} />
              <Field
                label="First imported"
                value={new Date(person.firstSeenAt).toLocaleDateString()}
              />
            </dl>
            {person.summary ? (
              <p className="mt-3 whitespace-pre-line border-t border-ink-800 pt-3 text-sm text-slate-300">
                {person.summary}
                <SourceTag source={person.fieldSources.summary} />
              </p>
            ) : null}
          </Section>

          <Section title="Career" count={person.positions.length}>
            {person.positions.length === 0 ? (
              <Empty>No positions on record.</Empty>
            ) : (
              <ol className="space-y-3">
                {person.positions.map((pos) => {
                  const months = monthsBetween(pos.startDate, pos.isCurrent ? null : pos.endDate);
                  return (
                    <li key={pos.id} className="border-l-2 border-ink-700 pl-3">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-slate-100">
                          {pos.title ?? 'Unknown role'}
                        </span>
                        {pos.isCurrent ? (
                          <span className="chip border-accent/40 bg-accent/10 text-accent-soft">
                            current
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-slate-400">
                        {pos.companyId ? (
                          <Link href={`/companies/${encodeURIComponent(pos.companyId)}`} className="link">
                            {pos.companyName}
                          </Link>
                        ) : (
                          pos.companyName
                        )}
                        {pos.location ? (
                          <span className="text-slate-500"> · {pos.location}</span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {formatRange(pos.startDate, pos.endDate, pos.isCurrent) || 'dates unknown'}
                        {months !== null ? ` · ${formatTenure(months)}` : ''}
                      </div>
                      {pos.description ? (
                        <p className="mt-1 whitespace-pre-line text-xs text-slate-400">
                          {pos.description}
                        </p>
                      ) : null}
                      <Prov record={pos} label={batchLabel} />
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title="Education" count={person.education.length}>
            {person.education.length === 0 ? (
              <Empty>
                No education on record. LinkedIn&apos;s export does not include education for
                connections — add it via an enriched import.
              </Empty>
            ) : (
              <ol className="space-y-3">
                {person.education.map((edu) => (
                  <li key={edu.id} className="border-l-2 border-ink-700 pl-3">
                    <div className="text-sm font-medium text-slate-100">
                      {edu.schoolId ? (
                        <Link href={`/schools/${encodeURIComponent(edu.schoolId)}`} className="link">
                          {edu.schoolName}
                        </Link>
                      ) : (
                        edu.schoolName
                      )}
                    </div>
                    <div className="text-sm text-slate-400">
                      {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {formatRange(edu.startDate, edu.endDate) || 'dates unknown'}
                    </div>
                    {edu.activities ? (
                      <p className="mt-1 text-xs text-slate-400">{edu.activities}</p>
                    ) : null}
                    <Prov record={edu} label={batchLabel} />
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {person.certifications.length > 0 ? (
            <Section title="Certifications" count={person.certifications.length}>
              <ul className="space-y-2">
                {person.certifications.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className="text-slate-100">{c.name}</span>
                    {c.authority ? <span className="text-slate-500"> · {c.authority}</span> : null}
                    <div className="font-mono text-[11px] text-slate-500">
                      {formatRange(c.startDate, c.endDate) || ''}
                      {c.licenseNumber ? ` · ${c.licenseNumber}` : ''}
                    </div>
                    <Prov record={c} label={batchLabel} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {person.volunteering.length > 0 ? (
            <Section title="Volunteering" count={person.volunteering.length}>
              <ul className="space-y-2">
                {person.volunteering.map((v) => (
                  <li key={v.id} className="text-sm">
                    <span className="text-slate-100">{v.role ?? 'Volunteer'}</span>
                    {v.organization ? (
                      <span className="text-slate-400"> · {v.organization}</span>
                    ) : null}
                    <div className="font-mono text-[11px] text-slate-500">
                      {[v.cause, formatRange(v.startDate, v.endDate)].filter(Boolean).join(' · ')}
                    </div>
                    {v.description ? (
                      <p className="mt-1 text-xs text-slate-400">{v.description}</p>
                    ) : null}
                    <Prov record={v} label={batchLabel} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {person.projects.length > 0 ? (
            <Section title="Projects" count={person.projects.length}>
              <ul className="space-y-2">
                {person.projects.map((p) => (
                  <li key={p.id} className="text-sm">
                    <span className="text-slate-100">{p.name}</span>
                    <div className="font-mono text-[11px] text-slate-500">
                      {formatRange(p.startDate, p.endDate)}
                    </div>
                    {p.description ? (
                      <p className="mt-1 text-xs text-slate-400">{p.description}</p>
                    ) : null}
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer noopener" className="link text-xs">
                        {p.url}
                      </a>
                    ) : null}
                    <Prov record={p} label={batchLabel} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {person.honors.length > 0 ? (
            <Section title="Honors & awards" count={person.honors.length}>
              <ul className="space-y-2">
                {person.honors.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="text-slate-100">{h.title}</span>
                    {h.issuer ? <span className="text-slate-500"> · {h.issuer}</span> : null}
                    <div className="font-mono text-[11px] text-slate-500">{h.date ?? ''}</div>
                    <Prov record={h} label={batchLabel} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title="Relationship">
            <div className="space-y-3">
              <div>
                <span className="label mb-1 block">Strength (private)</span>
                <StrengthDots
                  size="md"
                  value={rel?.strength ?? 0}
                  onChange={(next) => void setStrength(person.id, next)}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  {rel
                    ? `set ${new Date(rel.updatedAt).toLocaleDateString()}`
                    : 'not rated — click a dot'}
                </div>
              </div>
              {rel && rel.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {rel.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>

          <NotesPanel personId={person.id} />

          {person.skills.length > 0 ? (
            <Section title="Skills" count={person.skills.length}>
              <div className="flex flex-wrap gap-1">
                {person.skills.map((s) => (
                  <Link
                    key={s.id}
                    href={`/people?skill=${encodeURIComponent(s.name)}`}
                    className="chip hover:border-accent/50 hover:text-accent-soft"
                    title={`${batchLabel(s.sourceBatchId)} · ${new Date(s.importedAt).toLocaleDateString()}`}
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          {person.languages.length > 0 ? (
            <Section title="Languages" count={person.languages.length}>
              <ul className="space-y-1 text-sm">
                {person.languages.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span className="text-slate-300">{l.name}</span>
                    <span className="text-xs text-slate-500">{l.proficiency ?? ''}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Provenance">
            <div className="space-y-2 text-xs">
              <div>
                <span className="label block">Contributing imports</span>
                <ul className="mt-1 space-y-1">
                  {person.sourceBatchIds.map((id) => {
                    const batch = db.batches.find((b) => b.id === id);
                    return (
                      <li key={id} className="text-slate-400">
                        {batch?.label ?? id}
                        {batch ? (
                          <span className="font-mono text-[10px] text-slate-600">
                            {' '}
                            · {new Date(batch.importedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                  {person.sourceBatchIds.length === 0 ? (
                    <li className="text-slate-600">none recorded</li>
                  ) : null}
                </ul>
              </div>
              <div className="border-t border-ink-800 pt-2 font-mono text-[10px] text-slate-500">
                <div>first seen {new Date(person.firstSeenAt).toLocaleString()}</div>
                <div>last updated {new Date(person.lastUpdatedAt).toLocaleString()}</div>
                <div className="mt-1 text-slate-600">id {person.id}</div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  person,
  field,
  href,
}: {
  label: string;
  value: string | null;
  person?: Person;
  field?: string;
  href?: string;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="truncate text-slate-200" title={value ?? undefined}>
        {value ? (
          href ? (
            <Link href={href} className="link">
              {value}
            </Link>
          ) : (
            value
          )
        ) : (
          <span className="text-slate-600">—</span>
        )}
        {person && field ? <SourceTag source={person.fieldSources[field]} /> : null}
      </dd>
    </div>
  );
}

/** Per-record provenance footer: which import produced this row, and when. */
function Prov({
  record,
  label,
}: {
  record: Provenanced;
  label: (batchId: string) => string;
}) {
  const changed = record.updatedAt !== record.importedAt;
  return (
    <div className="mt-1 font-mono text-[10px] text-slate-600">
      {label(record.sourceBatchId)} · {new Date(record.importedAt).toLocaleDateString()}
      {changed ? ` · confirmed ${new Date(record.updatedAt).toLocaleDateString()}` : ''}
    </div>
  );
}
