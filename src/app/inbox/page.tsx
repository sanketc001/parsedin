'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, LinkedInLink, PageHeader, Section } from '@/components/ui';
import { ReplyComposer } from '@/components/ReplyComposer';
import { absoluteUrl } from '@/lib/linkedin';
import { conversationCorpus, conversationLabel } from '@/lib/contact';
import { daysBetween, relativeDays } from '@/lib/normalize';
import type { Conversation, Person } from '@/lib/types';

// ---------------------------------------------------------------------------
// The message archive, made searchable.
//
// LinkedIn keeps every message you have ever sent but offers almost no way to
// look through them. This is a full-text search over the entire history, held
// in memory, with the thread reader beside it.
// ---------------------------------------------------------------------------

type Bucket = 'all' | 'awaiting' | 'sent' | 'unlinked' | 'sponsored';

const BUCKETS: { key: Bucket; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Every thread except sponsored InMail' },
  {
    key: 'awaiting',
    label: 'Needs reply',
    hint: 'A real person wrote last and you never answered',
  },
  { key: 'sent', label: 'You wrote last', hint: 'Waiting on them' },
  { key: 'unlinked', label: 'Not in graph', hint: 'No matching person record' },
  { key: 'sponsored', label: 'Sponsored', hint: 'Adverts LinkedIn filed as messages' },
];

export default function InboxPage() {
  const { db, idx, loading } = useData();
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const conversations = db.activity.conversations;

  // Building the searchable text for 600 messages is cheap, but not per
  // keystroke — so it is memoized against the data rather than the query.
  const corpora = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) map.set(c.id, conversationCorpus(c, idx.personById));
    return map;
  }, [conversations, idx.personById]);

  /**
   * Threads answered from the composer since the archive was downloaded. The
   * export cannot know about these, so without them a thread you have already
   * replied to would sit in "needs reply" forever.
   */
  const answered = useMemo(() => {
    const out = new Set<string>();
    for (const draft of db.drafts) {
      if (!draft.sentAt) continue;
      for (const c of conversations) {
        const matches =
          draft.conversationId === c.id ||
          (!!draft.personId && c.personIds.includes(draft.personId));
        if (matches && draft.sentAt > (c.lastAt ?? '')) out.add(c.id);
      }
    }
    return out;
  }, [db.drafts, conversations]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return conversations.filter((c) => {
      // Adverts are opt-in everywhere: they never dilute a real bucket.
      if (bucket === 'sponsored' ? !c.sponsored : c.sponsored) return false;
      if (bucket === 'awaiting' && !(c.lastInbound && c.personIds.length > 0)) return false;
      if (bucket === 'awaiting' && answered.has(c.id)) return false;
      if (bucket === 'sent' && c.lastInbound) return false;
      if (bucket === 'unlinked' && c.personIds.length > 0) return false;
      if (terms.length === 0) return true;
      const corpus = corpora.get(c.id) ?? '';
      return terms.every((t) => corpus.includes(t));
    });
  }, [conversations, bucket, query, corpora, answered]);

  const active = useMemo(
    () => filtered.find((c) => c.id === selected) ?? filtered[0] ?? null,
    [filtered, selected],
  );

  const activePeople = useMemo(
    () =>
      (active?.personIds ?? [])
        .map((id) => idx.personById.get(id))
        .filter((p): p is Person => !!p),
    [active, idx.personById],
  );

  const totals = useMemo(() => {
    let messages = 0;
    let sent = 0;
    let awaiting = 0;
    let sponsored = 0;
    for (const c of conversations) {
      if (c.sponsored) {
        sponsored += 1;
        continue;
      }
      messages += c.messages.length;
      sent += c.sent;
      if (c.lastInbound && c.personIds.length > 0 && !answered.has(c.id)) awaiting += 1;
    }
    return { messages, sent, received: messages - sent, awaiting, sponsored };
  }, [conversations, answered]);

  if (!loading && conversations.length === 0) {
    return (
      <>
        <PageHeader title="Inbox" subtitle="Your LinkedIn message archive" />
        <div className="p-6">
          <Empty>
            No messages imported. They live in <code>messages.csv</code>,
            which is only in the <strong>Complete</strong> LinkedIn export — the Basic one
            omits it.{' '}
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
        title="Inbox"
        subtitle={
          <span className="text-xs">
            {conversations.length - totals.sponsored} threads · {totals.messages} messages ·{' '}
            {totals.sent} sent / {totals.received} received ·{' '}
            <span className="text-warn">{totals.awaiting} awaiting your reply</span>
            {totals.sponsored > 0 ? (
              <span className="text-fg-faint"> · {totals.sponsored} sponsored</span>
            ) : null}
          </span>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Search every message you have ever sent or received…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
          />
          <div className="flex flex-wrap gap-1">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                title={b.hint}
                onClick={() => {
                  setBucket(b.key);
                  setSelected(null);
                }}
                className={`chip transition-colors ${
                  bucket === b.key
                    ? 'border-brand/50 bg-brand/15 text-brand-dark'
                    : 'hover:border-line-strong'
                }`}
              >
                {b.label}
              </button>
            ))}
            <span className="ml-auto self-center text-[11px] text-fg-subtle">
              {filtered.length} shown
            </span>
          </div>

          <div className="card max-h-[calc(100vh-16rem)] overflow-y-auto">
            {filtered.length === 0 ? (
              <Empty>No threads match.</Empty>
            ) : (
              <ul>
                {filtered.map((c) => (
                  <ThreadRow
                    key={c.id}
                    conversation={c}
                    label={conversationLabel(c, idx.personById)}
                    person={
                      c.personIds.map((id) => idx.personById.get(id)).find((p) => !!p) ?? null
                    }
                    active={active?.id === c.id}
                    onSelect={() => setSelected(c.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {active ? (
            <>
              <Thread
                conversation={active}
                label={conversationLabel(active, idx.personById)}
                people={activePeople}
              />
              {/* Sponsored InMail has no one to answer, so no composer for it. */}
              {active.sponsored ? null : (
                <ReplyComposer conversation={active} person={activePeople[0] ?? null} />
              )}
            </>
          ) : (
            <Section title="Thread">
              <Empty>Select a conversation.</Empty>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function ThreadRow({
  conversation,
  label,
  person,
  active,
  onSelect,
}: {
  conversation: Conversation;
  label: string;
  /** Resolved counterparty, when the thread has one. */
  person: Person | null;
  active: boolean;
  onSelect: () => void;
}) {
  const last = conversation.messages[conversation.messages.length - 1];
  const days = daysBetween(conversation.lastAt, new Date().toISOString());
  return (
    <li
      className={`flex items-start border-b border-line transition-colors last:border-0 ${
        active ? 'bg-brand/10' : 'hover:bg-surface-sunken'
      }`}
    >
      {/* The outbound link sits beside the selector rather than inside it —
          an anchor nested in a button is invalid and swallows the click. */}
      <button
        type="button"
        onClick={onSelect}
        className="block min-w-0 flex-1 py-2 pl-3 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
          {conversation.lastInbound ? (
            <span
              className="shrink-0 text-[10px] text-warn"
              title="Their message is the last one in this thread"
            >
              ↩ reply
            </span>
          ) : null}
          <span className="shrink-0 text-[10px] text-fg-subtle">
            {relativeDays(days)}
          </span>
        </div>
        <div className="truncate text-xs text-fg-subtle">
          {last?.outbound ? <span className="text-fg-faint">you: </span> : null}
          {last?.body || '(no text)'}
        </div>
        <div className="mt-0.5 text-[10px] text-fg-faint">
          {conversation.messages.length} msg · {conversation.sent}↑ {conversation.received}↓
          {conversation.folder ? ` · ${conversation.folder.toLowerCase()}` : ''}
        </div>
      </button>
      {person ? <LinkedInLink person={person} className="mr-2 mt-2" /> : null}
    </li>
  );
}

function Thread({
  conversation,
  label,
  people,
}: {
  conversation: Conversation;
  label: string;
  /** Resolved participants, for the internal and outbound links. */
  people: Person[];
}) {
  // A thread whose counterparty never matched a person record still carries the
  // URL the export shipped — normalized, because some sources omit the scheme.
  const rawUrl = absoluteUrl(conversation.participantUrls[0]);
  return (
    <Section
      title={label}
      count={conversation.messages.length}
      aside={
        <span className="flex items-center gap-2">
          {people.map((person) => (
            <span key={person.id} className="flex items-center gap-1">
              <Link
                href={`/people/${encodeURIComponent(person.id)}`}
                className="text-xs text-fg-subtle hover:text-fg-muted"
              >
                profile →
              </Link>
              <LinkedInLink person={person} />
            </span>
          ))}
          {people.length === 0 && rawUrl ? (
            <a
              href={rawUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-fg-subtle hover:text-brand-dark"
            >
              LinkedIn ↗
            </a>
          ) : null}
        </span>
      }
    >
      <div className="max-h-[calc(100vh-18rem)] space-y-3 overflow-y-auto pr-1">
        {conversation.messages.map((m) => (
          <div key={m.id} className={m.outbound ? 'pl-8 text-right' : 'pr-8'}>
            <div
              className={`inline-block max-w-full rounded-lg border px-3 py-2 text-left text-sm ${
                m.outbound
                  ? 'border-brand/30 bg-brand/10 text-fg'
                  : 'border-line bg-surface-sunken text-fg-muted'
              }`}
            >
              {m.subject ? (
                <div className="mb-1 text-xs font-semibold text-fg-muted">{m.subject}</div>
              ) : null}
              <div className="whitespace-pre-line break-words">{m.body || '(no text)'}</div>
              {m.hasAttachment ? (
                <div className="mt-1 text-[10px] text-fg-subtle">📎 attachment</div>
              ) : null}
            </div>
            <div className="mt-0.5 text-[10px] text-fg-faint">
              {m.outbound ? 'you' : m.from} · {new Date(m.at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
