'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, MonthHistogram, PageHeader, Section, Stat } from '@/components/ui';
import { monthBucket } from '@/lib/normalize';

// ---------------------------------------------------------------------------
// Your own footprint.
//
// Posts, comments, reactions, poll votes, follows, learning and events — the
// record of what you did on LinkedIn rather than who you know. Presented as one
// chronological stream with a cadence chart, because the interesting question
// is usually "when did I stop?" rather than "what did I say".
// ---------------------------------------------------------------------------

type Kind = 'all' | 'post' | 'comment' | 'reaction' | 'vote';

const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'post', label: 'Posts' },
  { key: 'comment', label: 'Comments' },
  { key: 'reaction', label: 'Reactions' },
  { key: 'vote', label: 'Poll votes' },
];

export default function ActivityPage() {
  const { db, idx, loading } = useData();
  const [kind, setKind] = useState<Kind>('all');
  const [limit, setLimit] = useState(60);
  const activity = db.activity;

  const counts = useMemo(() => {
    const map = new Map<Kind, number>();
    for (const item of activity.engagement) {
      map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    }
    return map;
  }, [activity.engagement]);

  const items = useMemo(
    () =>
      kind === 'all'
        ? activity.engagement
        : activity.engagement.filter((i) => i.kind === kind),
    [activity.engagement, kind],
  );

  /** Engagement cadence — one bar per month, over whatever the export covers. */
  const cadence = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const bucket = monthBucket(item.at);
      if (bucket) map.set(bucket, (map.get(bucket) ?? 0) + 1);
    }
    return map;
  }, [items]);

  /** Messages per month, side by side with engagement: talking vs broadcasting. */
  const messageCadence = useMemo(() => {
    const map = new Map<string, number>();
    for (const conversation of activity.conversations) {
      if (conversation.sponsored) continue;
      for (const message of conversation.messages) {
        const bucket = monthBucket(message.at);
        if (bucket) map.set(bucket, (map.get(bucket) ?? 0) + 1);
      }
    }
    return map;
  }, [activity.conversations]);

  const reactionMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of activity.engagement) {
      if (item.kind !== 'reaction' || !item.reactionType) continue;
      map.set(item.reactionType, (map.get(item.reactionType) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [activity.engagement]);

  if (!loading && activity.engagement.length === 0 && activity.companyFollows.length === 0) {
    return (
      <>
        <PageHeader title="Activity" subtitle="Your own LinkedIn footprint" />
        <div className="p-6">
          <Empty>
            Nothing imported yet.{' '}
            <Link href="/import" className="link">
              Import your export
            </Link>
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Activity" subtitle="What you did, not who you know" />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Posts" value={counts.get('post') ?? 0} />
          <Stat label="Comments" value={counts.get('comment') ?? 0} />
          <Stat label="Reactions" value={counts.get('reaction') ?? 0} />
          <Stat label="Poll votes" value={counts.get('vote') ?? 0} />
          <Stat
            label="Following"
            value={activity.companyFollows.length + activity.memberFollows.length}
            hint="companies + people"
          />
          <Stat label="Courses" value={activity.learning.length} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Engagement per month">
            <MonthHistogram counts={cadence} height={72} />
          </Section>
          <Section title="Messages per month">
            {messageCadence.size === 0 ? (
              <Empty>No messages imported.</Empty>
            ) : (
              <MonthHistogram counts={messageCadence} height={72} />
            )}
          </Section>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Section
              title="Timeline"
              count={items.length}
              aside={
                <div className="flex flex-wrap gap-1">
                  {KINDS.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => {
                        setKind(k.key);
                        setLimit(60);
                      }}
                      className={`chip transition-colors ${
                        kind === k.key
                          ? 'border-brand/50 bg-brand/15 text-brand-dark'
                          : 'hover:border-line-strong'
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              }
            >
              {items.length === 0 ? (
                <Empty>Nothing of this kind.</Empty>
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {items.slice(0, limit).map((item) => (
                      <li key={item.id} className="flex gap-3 py-2">
                        <span className="w-20 shrink-0 text-[11px] text-fg-subtle">
                          {new Date(item.at).toLocaleDateString()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="mb-0.5 flex items-center gap-2">
                            <span className="chip py-0 text-[10px] uppercase tracking-wider">
                              {item.kind}
                            </span>
                            {item.reactionType ? (
                              <span className="text-[10px] text-fg-subtle">
                                {item.reactionType.toLowerCase()}
                              </span>
                            ) : null}
                            {item.visibility ? (
                              <span className="text-[10px] text-fg-faint">
                                {item.visibility.replace(/_/g, ' ').toLowerCase()}
                              </span>
                            ) : null}
                          </span>
                          {item.text ? (
                            <span className="block whitespace-pre-line text-sm text-fg-muted">
                              {item.text.length > 400
                                ? `${item.text.slice(0, 400)}…`
                                : item.text}
                            </span>
                          ) : (
                            <span className="block text-sm text-fg-faint">
                              {item.kind === 'reaction' ? 'reacted to a post' : '—'}
                            </span>
                          )}
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-[10px] text-fg-faint hover:text-fg-muted"
                            >
                              open on LinkedIn ↗
                            </a>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {items.length > limit ? (
                    <div className="pt-3 text-center">
                      <button type="button" className="btn" onClick={() => setLimit(limit + 100)}>
                        Show more ({items.length - limit} left)
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            {reactionMix.length > 0 ? (
              <Section title="How you react">
                <ul className="space-y-1">
                  {reactionMix.map(([type, count]) => (
                    <li key={type} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-fg-muted">{type.toLowerCase()}</span>
                      <span className="text-xs text-fg-subtle">{count}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section title="Companies you follow" count={activity.companyFollows.length}>
              {activity.companyFollows.length === 0 ? (
                <Empty>None recorded.</Empty>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                  {activity.companyFollows.map((f) => {
                    const known = f.companyId
                      ? (idx.currentByCompany.get(f.companyId)?.length ?? 0)
                      : 0;
                    return (
                      <li key={f.id} className="flex items-baseline justify-between gap-2">
                        {f.companyId ? (
                          <Link
                            href={`/companies/${encodeURIComponent(f.companyId)}`}
                            className="truncate text-fg-muted hover:text-fg"
                          >
                            {f.name}
                          </Link>
                        ) : (
                          <span className="truncate text-fg-muted">{f.name}</span>
                        )}
                        {known > 0 ? (
                          <span
                            className="shrink-0 text-[10px] text-brand-dark"
                            title="people you know who work there"
                          >
                            {known} known
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="People you follow" count={activity.memberFollows.length}>
              {activity.memberFollows.length === 0 ? (
                <Empty>None recorded.</Empty>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                  {activity.memberFollows.map((f) => (
                    <li key={f.id} className="truncate">
                      {f.personId ? (
                        <Link
                          href={`/people/${encodeURIComponent(f.personId)}`}
                          className="text-fg-muted hover:text-fg"
                        >
                          {f.name}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">{f.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {activity.learning.length > 0 ? (
              <Section title="Learning" count={activity.learning.length}>
                <ul className="space-y-2 text-sm">
                  {activity.learning.map((l) => (
                    <li key={l.id}>
                      <span className="text-fg">{l.title}</span>
                      <div className="text-[10px] text-fg-subtle">
                        {[
                          l.contentType,
                          l.completedAt
                            ? `completed ${new Date(l.completedAt).toLocaleDateString()}`
                            : l.lastWatchedAt
                              ? `watched ${new Date(l.lastWatchedAt).toLocaleDateString()}`
                              : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {activity.events.length > 0 ? (
              <Section title="Events" count={activity.events.length}>
                <ul className="space-y-2 text-sm">
                  {activity.events.map((e) => (
                    <li key={e.id}>
                      {e.url ? (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="link"
                        >
                          {e.name}
                        </a>
                      ) : (
                        <span className="text-fg">{e.name}</span>
                      )}
                      <div className="text-[10px] text-fg-subtle">
                        {[e.time, e.status?.toLowerCase()].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
