'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import {
  Avatar,
  DegreeBadge,
  Empty,
  LinkedInLink,
  PageHeader,
  Section,
  Stat,
} from '@/components/ui';
import {
  buildReconnectList,
  RECONNECT_LABELS,
  type ReconnectItem,
  type ReconnectReason,
} from '@/lib/contact';
import { relativeDays } from '@/lib/normalize';
import { ReplyComposer } from '@/components/ReplyComposer';
import type { Draft } from '@/lib/types';

// ---------------------------------------------------------------------------
// Relationship health.
//
// A connection list sorted alphabetically is a phone book. This sorts the same
// people by what the archive says you owe them: messages you never answered,
// real relationships that have gone quiet, and the large silent remainder you
// have never spoken to at all.
// ---------------------------------------------------------------------------

const ORDER: ReconnectReason[] = [
  'awaiting-your-reply',
  'going-cold',
  'no-reply-from-them',
  'never-spoken',
];

const DESCRIPTIONS: Record<ReconnectReason, string> = {
  'awaiting-your-reply':
    'The last message in the thread is theirs. Newest first — these are the ones still worth answering.',
  'going-cold':
    'You and this person genuinely talked, and then stopped. Ranked by how much was said and how long ago.',
  'no-reply-from-them': 'You wrote and nothing came back. Worth one nudge, or letting go.',
  'never-spoken':
    'Accepted connections with no exchange on record. Newest connections first — the introduction is still warm.',
};

const TONES: Record<ReconnectReason, string> = {
  'awaiting-your-reply': 'border-warn/30 bg-warn/10 text-warn',
  'going-cold': 'border-brand/30 bg-brand/10 text-brand',
  'no-reply-from-them': 'border-line-strong bg-surface-sunken text-fg-muted',
  'never-spoken': 'border-line-strong bg-surface-sunken text-fg-subtle',
};

export default function ReconnectPage() {
  const { db, idx, loading } = useData();
  const [reason, setReason] = useState<ReconnectReason>('awaiting-your-reply');
  const [limit, setLimit] = useState(50);

  const items = useMemo(
    () => buildReconnectList(db, idx.contactByPerson, idx.personById),
    [db, idx],
  );

  const byReason = useMemo(() => {
    const map = new Map<ReconnectReason, ReconnectItem[]>();
    for (const r of ORDER) map.set(r, []);
    for (const item of items) map.get(item.reason)?.push(item);
    return map;
  }, [items]);

  const shown = byReason.get(reason) ?? [];

  // Drafts split into what still needs sending and what already went out.
  const { openDrafts, recentlySent } = useMemo(() => {
    const decorate = (draft: Draft) => ({
      draft,
      person: draft.personId ? (idx.personById.get(draft.personId) ?? null) : null,
    });
    return {
      openDrafts: db.drafts
        .filter((d) => !d.sentAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(decorate),
      recentlySent: db.drafts
        .filter((d) => d.sentAt)
        .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
        .map(decorate),
    };
  }, [db.drafts, idx.personById]);

  // "Contacted" means messages were exchanged. The contact index also carries
  // invitation- and endorsement-only entries, which are not conversations.
  const { spoken, reciprocal } = useMemo(() => {
    const all = [...idx.contactByPerson.values()];
    return {
      spoken: all.filter((s) => s.messages > 0).length,
      reciprocal: all.filter((s) => s.reciprocal).length,
    };
  }, [idx.contactByPerson]);

  if (!loading && db.activity.conversations.length === 0) {
    return (
      <>
        <PageHeader title="Reconnect" subtitle="Relationship health across your network" />
        <div className="p-6">
          <Empty>
            This page is built from your message history. Import the{' '}
            <strong>Complete</strong> LinkedIn export — the Basic one has no{' '}
            <code>messages.csv</code>.{' '}
            <Link href="/import" className="link">
              Import
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reconnect"
        subtitle="Who you actually know, and who is slipping away"
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Connections"
            value={db.people.filter((p) => p.connectionDegree === 1).length}
            href="/people?degrees=1"
          />
          <Stat label="Ever messaged" value={spoken} hint="an actual exchange" />
          <Stat
            label="Two-way"
            value={reciprocal}
            hint="both sides sent something"
          />
          <Stat
            label="Needs a reply"
            value={(byReason.get('awaiting-your-reply') ?? []).length}
            hint="they wrote last"
          />
          <Stat
            label="Going cold"
            value={(byReason.get('going-cold') ?? []).length}
            hint="quiet 4+ months"
          />
        </div>

        {openDrafts.length > 0 || recentlySent.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {openDrafts.length > 0 ? (
              <Section title="Unsent drafts" count={openDrafts.length}>
                <ul className="divide-y divide-line">
                  {openDrafts.map(({ draft, person }) => (
                    <li key={draft.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        {person ? (
                          <Link
                            href={`/people/${encodeURIComponent(person.id)}`}
                            className="truncate text-sm text-fg hover:text-brand hover:underline"
                          >
                            {person.fullName}
                          </Link>
                        ) : (
                          <span className="truncate text-sm text-fg-muted">a thread</span>
                        )}
                        <span className="shrink-0 text-[10px] text-fg-faint">
                          {new Date(draft.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="truncate text-xs text-fg-subtle">{draft.body}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
            {recentlySent.length > 0 ? (
              <Section title="Replied from here" count={recentlySent.length}>
                <p className="mb-2 text-xs text-fg-subtle">
                  Sent after the archive was downloaded, so LinkedIn&apos;s export will never
                  show it. These threads stop being flagged.
                </p>
                <ul className="divide-y divide-line">
                  {recentlySent.slice(0, 6).map(({ draft, person }) => (
                    <li key={draft.id} className="flex items-baseline justify-between gap-2 py-2">
                      {person ? (
                        <Link
                          href={`/people/${encodeURIComponent(person.id)}`}
                          className="truncate text-sm text-fg hover:text-brand hover:underline"
                        >
                          {person.fullName}
                        </Link>
                      ) : (
                        <span className="truncate text-sm text-fg-muted">a thread</span>
                      )}
                      <span className="shrink-0 text-[10px] text-fg-faint">
                        {new Date(draft.sentAt!).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1">
          {ORDER.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setReason(r);
                setLimit(50);
              }}
              className={`chip transition-colors ${
                reason === r ? TONES[r] : 'hover:border-line-strong'
              }`}
            >
              {RECONNECT_LABELS[r]}
              <span className="text-[10px] opacity-70">
                {(byReason.get(r) ?? []).length}
              </span>
            </button>
          ))}
        </div>

        <Section title={RECONNECT_LABELS[reason]} count={shown.length}>
          <p className="mb-3 text-xs text-fg-subtle">{DESCRIPTIONS[reason]}</p>
          {shown.length === 0 ? (
            <Empty>Nothing here — which is the good outcome.</Empty>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {shown.slice(0, limit).map((item) => (
                  <Row key={item.person.id} item={item} />
                ))}
              </ul>
              {shown.length > limit ? (
                <div className="pt-3 text-center">
                  <button type="button" className="btn" onClick={() => setLimit(limit + 100)}>
                    Show more ({shown.length - limit} left)
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Section>
      </div>
    </>
  );
}

function Row({ item }: { item: ReconnectItem }) {
  const { person, stats } = item;
  const { idx, draftFor } = useData();
  const [open, setOpen] = useState(false);

  // The thread to reply into, when there is one. Drafts key on the thread, so
  // this has to be the same conversation the Inbox would have picked.
  const conversation = (idx.conversationsByPerson.get(person.id) ?? [])[0] ?? null;
  const draft = draftFor(conversation?.id ?? person.id);

  return (
    <li>
      <div className="flex items-center gap-3 px-1 py-2 hover:bg-surface-sunken">
        <Link
          href={`/people/${encodeURIComponent(person.id)}`}
          className="group flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar person={person} size={40} />
          <span className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg group-hover:text-brand group-hover:underline">
              {person.fullName}
            </span>
            <DegreeBadge degree={person.connectionDegree} />
            {draft ? (
              <span
                className="chip border-brand/30 bg-brand/10 py-0 text-[10px] text-brand"
                title="You have an unsent draft for this person"
              >
                draft
              </span>
            ) : null}
          </div>
          {[person.currentTitle, person.currentCompany].filter(Boolean).join(' · ') ||
          person.headline ? (
            <div className="truncate text-xs text-fg-subtle">
              {[person.currentTitle, person.currentCompany].filter(Boolean).join(' · ') ||
                person.headline}
            </div>
          ) : null}
          </span>
        </Link>
        <div className="hidden shrink-0 text-right text-xs text-fg-subtle sm:block">
          {item.detail}
        </div>
        <SignalBar value={stats.signal} />
        <span className="w-16 shrink-0 text-right text-[10px] text-fg-faint">
          {stats.lastAt ? relativeDays(stats.daysSinceLast) : '—'}
        </span>
        <LinkedInLink person={person} />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`chip shrink-0 transition-colors ${
            open ? 'border-brand/50 bg-brand/15 text-brand-dark' : 'hover:border-line-strong'
          }`}
        >
          {open ? 'close' : draft ? 'resume' : 'reply'}
        </button>
      </div>
      {/* Replying without leaving the list is the whole point of this page. */}
      {open ? (
        <div className="border-t border-line bg-canvas/40 px-1 py-3">
          <ReplyComposer person={person} conversation={conversation} compact />
        </div>
      ) : null}
    </li>
  );
}

/** The evidence score as a compact meter — comparable at a glance down a list. */
function SignalBar({ value }: { value: number }) {
  return (
    <span
      className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken md:block"
      title={`signal ${value}/100 — how much contact evidence the archive holds`}
    >
      <span
        className="block h-full rounded-full bg-brand/70"
        style={{ width: `${Math.max(value, 2)}%` }}
      />
    </span>
  );
}
