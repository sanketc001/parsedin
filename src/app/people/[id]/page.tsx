'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useData } from '@/components/DataProvider';
import {
  Avatar,
  DegreeBadge,
  Empty,
  PageHeader,
  Section,
  SourceTag,
  StrengthDots,
} from '@/components/ui';
import { NotesPanel } from '@/components/NotesPanel';
import { ReplyComposer } from '@/components/ReplyComposer';
import type { Person, Provenanced } from '@/lib/types';
import { formatRange, formatTenure, monthsBetween, relativeDays } from '@/lib/normalize';
import { completeness, totalExperienceMonths } from '@/lib/derive';
import { statsFor } from '@/lib/contact';
import { personLink } from '@/lib/linkedin';

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
            No record with id <code className="font-mono text-fg-muted">{id}</code>.{' '}
            <Link href="/people" className="link">
              Back to people
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  const rel = relationshipFor(person.id);
  const link = personLink(person);
  const experience = totalExperienceMonths(person);
  const depth = Math.round(completeness(person) * 100);

  // Everything the activity layer knows about this specific person.
  const contact = statsFor(idx.contactByPerson, person.id);
  const conversations = idx.conversationsByPerson.get(person.id) ?? [];
  const endorsements = db.activity.endorsements.filter((e) => e.personId === person.id);
  const invitations = db.activity.invitations.filter((i) => i.personId === person.id);

  return (
    <>
      {/* LinkedIn's profile header: a cover strip, the avatar breaking across
          its lower edge, then name, headline and actions. */}
      <div className="p-6 pb-0">
        <div className="card overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-brand/25 via-brand/10 to-surface-sunken" />
          <div className="px-6 pb-5">
            <div className="-mt-10 mb-3">
              <span className="inline-block rounded-full ring-4 ring-surface">
                <Avatar person={person} size={80} />
              </span>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-fg">
                  {person.fullName}
                  <DegreeBadge degree={person.connectionDegree} />
                </h1>
                {person.headline ? (
                  <p className="mt-0.5 text-sm text-fg-muted">{person.headline}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {[person.location, person.industry].filter(Boolean).join(' · ')}
                </p>
              </div>
              {/* Everyone gets a destination: their profile when the export gave
                  us one, a name search when it did not. */}
              {link ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn btn-primary"
                >
                  {link.kind === 'profile' ? 'View on LinkedIn ↗' : 'Find on LinkedIn ↗'}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

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
              <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-sm text-fg-muted">
                {person.summary}
                <SourceTag source={person.fieldSources.summary} />
              </p>
            ) : null}
          </Section>

          {contact.messages > 0 || endorsements.length > 0 || invitations.length > 0 ? (
            <Section
              title="Contact history"
              aside={
                contact.awaitingYourReply ? (
                  <span className="chip border-warn/30 bg-warn/10 text-warn">
                    they wrote last
                  </span>
                ) : null
              }
            >
              {/* Only worth a stats grid when there is a conversation. An
                  invitation-only relationship would render four em-dashes,
                  which reads as broken rather than as empty. */}
              {contact.messages > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <Field label="Messages" value={String(contact.messages)} />
                  <Field
                    label="Sent / received"
                    value={`${contact.sent} / ${contact.received}`}
                  />
                  <Field
                    label="First contact"
                    value={contact.firstAt ? new Date(contact.firstAt).toLocaleDateString() : null}
                  />
                  <Field
                    label="Last contact"
                    value={contact.lastAt ? new Date(contact.lastAt).toLocaleDateString() : null}
                  />
                </dl>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {contact.messages > 0 ? (
                  <span className="chip">
                    {contact.theyInitiated ? 'they reached out first' : 'you reached out first'}
                  </span>
                ) : null}
                {contact.reciprocal ? <span className="chip">two-way conversation</span> : null}
                {invitations.map((i) => (
                  <span key={i.id} className="chip">
                    {i.direction === 'incoming' ? 'they invited you' : 'you invited them'}
                    {i.sentAt ? (
                      <span className="text-fg-subtle">
                        {new Date(i.sentAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>

              {invitations.some((i) => i.message) ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="label mb-1">Invitation note</div>
                  {invitations
                    .filter((i) => i.message)
                    .map((i) => (
                      <p key={i.id} className="text-sm text-fg-muted">
                        &ldquo;{i.message}&rdquo;
                      </p>
                    ))}
                </div>
              ) : null}

              {endorsements.length > 0 ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="label mb-1">Endorsements</div>
                  <div className="flex flex-wrap gap-1">
                    {endorsements.map((e) => (
                      <span
                        key={e.id}
                        className="chip"
                        title={e.at ? new Date(e.at).toLocaleDateString() : undefined}
                      >
                        {e.direction === 'received' ? '← ' : '→ '}
                        {e.skill}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-fg-subtle">
                    ← they endorsed you · → you endorsed them
                  </div>
                </div>
              ) : null}

              {conversations.length > 0 ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="label">Recent messages</span>
                    <Link href="/inbox" className="text-xs text-fg-subtle hover:text-fg-muted">
                      all threads →
                    </Link>
                  </div>
                  <ul className="space-y-2">
                    {/* Newest first, and only a handful — the Inbox is where you
                        read a whole thread. */}
                    {conversations
                      .flatMap((c) => c.messages)
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .slice(0, 6)
                      .map((m) => (
                        <li key={m.id} className="text-sm">
                          <span
                            className={
                              m.outbound
                                ? 'text-[10px] text-brand-dark'
                                : 'text-[10px] text-fg-subtle'
                            }
                          >
                            {m.outbound ? 'you' : person.firstName ?? m.from} ·{' '}
                            {new Date(m.at).toLocaleDateString()}
                          </span>
                          <p className="line-clamp-3 whitespace-pre-line text-fg-muted">
                            {m.body || '(no text)'}
                          </p>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section title="Career" count={person.positions.length}>
            {person.positions.length === 0 ? (
              <Empty>No positions on record.</Empty>
            ) : (
              <ol className="space-y-3">
                {person.positions.map((pos) => {
                  const months = monthsBetween(pos.startDate, pos.isCurrent ? null : pos.endDate);
                  return (
                    <li key={pos.id} className="border-l-2 border-line pl-3">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-fg">
                          {pos.title ?? 'Unknown role'}
                        </span>
                        {pos.isCurrent ? (
                          <span className="chip border-brand/40 bg-brand/10 text-brand-dark">
                            current
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-fg-muted">
                        {pos.companyId ? (
                          <Link href={`/companies/${encodeURIComponent(pos.companyId)}`} className="link">
                            {pos.companyName}
                          </Link>
                        ) : (
                          pos.companyName
                        )}
                        {pos.location ? (
                          <span className="text-fg-subtle"> · {pos.location}</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-fg-subtle">
                        {formatRange(pos.startDate, pos.endDate, pos.isCurrent) || 'dates unknown'}
                        {months !== null ? ` · ${formatTenure(months)}` : ''}
                      </div>
                      {pos.description ? (
                        <p className="mt-1 whitespace-pre-line text-xs text-fg-muted">
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
                  <li key={edu.id} className="border-l-2 border-line pl-3">
                    <div className="text-sm font-medium text-fg">
                      {edu.schoolId ? (
                        <Link href={`/schools/${encodeURIComponent(edu.schoolId)}`} className="link">
                          {edu.schoolName}
                        </Link>
                      ) : (
                        edu.schoolName
                      )}
                    </div>
                    <div className="text-sm text-fg-muted">
                      {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div className="text-[11px] text-fg-subtle">
                      {formatRange(edu.startDate, edu.endDate) || 'dates unknown'}
                    </div>
                    {edu.activities ? (
                      <p className="mt-1 text-xs text-fg-muted">{edu.activities}</p>
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
                    <span className="text-fg">{c.name}</span>
                    {c.authority ? <span className="text-fg-subtle"> · {c.authority}</span> : null}
                    <div className="text-[11px] text-fg-subtle">
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
                    <span className="text-fg">{v.role ?? 'Volunteer'}</span>
                    {v.organization ? (
                      <span className="text-fg-muted"> · {v.organization}</span>
                    ) : null}
                    <div className="text-[11px] text-fg-subtle">
                      {[v.cause, formatRange(v.startDate, v.endDate)].filter(Boolean).join(' · ')}
                    </div>
                    {v.description ? (
                      <p className="mt-1 text-xs text-fg-muted">{v.description}</p>
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
                    <span className="text-fg">{p.name}</span>
                    <div className="text-[11px] text-fg-subtle">
                      {formatRange(p.startDate, p.endDate)}
                    </div>
                    {p.description ? (
                      <p className="mt-1 text-xs text-fg-muted">{p.description}</p>
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
                    <span className="text-fg">{h.title}</span>
                    {h.issuer ? <span className="text-fg-subtle"> · {h.issuer}</span> : null}
                    <div className="text-[11px] text-fg-subtle">{h.date ?? ''}</div>
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
              {/* Two readings side by side: what you think, and what the
                  archive can actually prove. They disagree more than you would
                  expect, which is the useful part. */}
              <div>
                <span className="label mb-1 block">Contact signal (measured)</span>
                <div className="flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <span
                      className="block h-full rounded-full bg-brand/70"
                      style={{ width: `${Math.max(contact.signal, 2)}%` }}
                    />
                  </span>
                  <span className="text-xs text-fg-muted">{contact.signal}</span>
                </div>
                <div className="mt-1 text-[11px] text-fg-subtle">
                  {contact.messages > 0
                    ? `${contact.messages} messages across ${contact.threads} thread${
                        contact.threads === 1 ? '' : 's'
                      }${
                        contact.daysSinceLast !== null
                          ? `, last ${relativeDays(contact.daysSinceLast)}`
                          : ''
                      }`
                    : 'no recorded exchange'}
                </div>
              </div>
              <div className="border-t border-line pt-3">
                <span className="label mb-1 block">Strength (private)</span>
                <StrengthDots
                  size="md"
                  value={rel?.strength ?? 0}
                  onChange={(next) => void setStrength(person.id, next)}
                />
                <div className="mt-1 text-[11px] text-fg-subtle">
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

          {/* Replying to yourself is not a feature. */}
          {person.id === db.self?.id ? null : (
            <ReplyComposer
              person={person}
              conversation={conversations[0] ?? null}
            />
          )}

          <NotesPanel personId={person.id} />

          {person.skills.length > 0 ? (
            <Section title="Skills" count={person.skills.length}>
              <div className="flex flex-wrap gap-1">
                {person.skills.map((s) => (
                  <Link
                    key={s.id}
                    href={`/people?skill=${encodeURIComponent(s.name)}`}
                    className="chip hover:border-brand/50 hover:text-brand-dark"
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
                    <span className="text-fg-muted">{l.name}</span>
                    <span className="text-xs text-fg-subtle">{l.proficiency ?? ''}</span>
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
                      <li key={id} className="text-fg-muted">
                        {batch?.label ?? id}
                        {batch ? (
                          <span className="text-[10px] text-fg-faint">
                            {' '}
                            · {new Date(batch.importedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                  {person.sourceBatchIds.length === 0 ? (
                    <li className="text-fg-faint">none recorded</li>
                  ) : null}
                </ul>
              </div>
              <div className="border-t border-line pt-2 text-[10px] text-fg-subtle">
                <div>first seen {new Date(person.firstSeenAt).toLocaleString()}</div>
                <div>last updated {new Date(person.lastUpdatedAt).toLocaleString()}</div>
                <div className="mt-1 text-fg-faint">id {person.id}</div>
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
      <dd className="truncate text-fg" title={value ?? undefined}>
        {value ? (
          href ? (
            <Link href={href} className="link">
              {value}
            </Link>
          ) : (
            value
          )
        ) : (
          <span className="text-fg-faint">—</span>
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
    <div className="mt-1 text-[10px] text-fg-faint">
      {label(record.sourceBatchId)} · {new Date(record.importedAt).toLocaleDateString()}
      {changed ? ` · confirmed ${new Date(record.updatedAt).toLocaleDateString()}` : ''}
    </div>
  );
}
