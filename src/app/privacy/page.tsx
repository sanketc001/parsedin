'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';

// ---------------------------------------------------------------------------
// What LinkedIn thinks it knows about you.
//
// The export contains the advertising profile — the segments advertisers can
// buy you in, the characteristics LinkedIn inferred, and every ad you clicked —
// alongside the login and security-challenge log. None of it is about your
// network, and all of it is the part people are most surprised by, so it gets
// its own page rather than being buried.
// ---------------------------------------------------------------------------

/** Segment groups that say something about you personally, shown first. */
const PERSONAL_FIRST = [
  'Member Age',
  'Member Gender',
  'Member Traits',
  'Member Interests',
  'Member Skills',
  'High Value Audience Segments',
  'Standard Audience Segments',
  'Job Seniorities',
  'Job Titles',
  'Years of Experience',
  'Profile Locations',
];

export default function PrivacyPage() {
  const { db, loading } = useData();
  const [expanded, setExpanded] = useState<string | null>(null);
  const activity = db.activity;
  const ads = activity.adProfile;

  const segments = useMemo(() => {
    if (!ads) return [];
    const rank = (category: string) => {
      const at = PERSONAL_FIRST.indexOf(category);
      return at === -1 ? PERSONAL_FIRST.length : at;
    };
    return [...ads.segments].sort(
      (a, b) => rank(a.category) - rank(b.category) || b.values.length - a.values.length,
    );
  }, [ads]);

  const totalSegmentValues = segments.reduce((n, s) => n + s.values.length, 0);

  /** Challenges are worth a second look when they come from somewhere new. */
  const challengeCountries = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of activity.challenges) {
      if (c.country) map.set(c.country, (map.get(c.country) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [activity.challenges]);

  const empty = !loading && !ads && activity.logins.length === 0;
  if (empty) {
    return (
      <>
        <PageHeader title="Privacy" subtitle="What LinkedIn knows about you" />
        <div className="p-6">
          <Empty>
            No advertising or security data imported. These files —{' '}
            <code className="font-mono">Ad_Targeting.csv</code>,{' '}
            <code className="font-mono">Inferences_about_you.csv</code>,{' '}
            <code className="font-mono">Logins.csv</code> — are only in the{' '}
            <strong>Complete</strong> export.{' '}
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
        title="Privacy"
        subtitle="The advertising profile and access log LinkedIn keeps on you"
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Targeting facets"
            value={segments.length}
            hint="ways to select you"
          />
          <Stat label="Segment values" value={totalSegmentValues} />
          <Stat label="Ads clicked" value={ads?.adsClicked ?? 0} />
          <Stat label="Logins on record" value={activity.logins.length} />
          <Stat
            label="Security challenges"
            value={activity.challenges.length}
            hint={challengeCountries.length ? `${challengeCountries.length} countries` : undefined}
          />
        </div>

        {ads && ads.inferences.length > 0 ? (
          <Section title="Inferences LinkedIn drew about you" count={ads.inferences.length}>
            <ul className="divide-y divide-line">
              {ads.inferences.map((inf) => (
                <li key={`${inf.category}-${inf.type}`} className="flex items-start gap-3 py-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      /^(no|false)$/i.test(inf.value)
                        ? 'border-line-strong bg-surface-sunken text-fg-subtle'
                        : 'border-brand/40 bg-brand/10 text-brand-dark'
                    }`}
                  >
                    {inf.value}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{inf.type}</span>
                    <span className="block text-xs text-fg-subtle">
                      {inf.category}
                      {inf.description ? ` · ${inf.description}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {segments.length > 0 ? (
          <Section title="Advertising segments you fall into" count={segments.length}>
            <p className="mb-3 text-xs text-fg-subtle">
              Each of these is a filter an advertiser can tick to reach you. Click one to see
              every value LinkedIn recorded.
            </p>
            <ul className="divide-y divide-line">
              {segments.map((segment) => {
                const open = expanded === segment.category;
                return (
                  <li key={segment.category} className="py-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : segment.category)}
                      className="flex w-full items-baseline justify-between gap-3 text-left"
                    >
                      <span className="text-sm text-fg">{segment.category}</span>
                      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                        {segment.values.length} {open ? '▾' : '▸'}
                      </span>
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(open ? segment.values : segment.values.slice(0, 6)).map((value) => (
                        <span key={value} className="chip">
                          {value}
                        </span>
                      ))}
                      {!open && segment.values.length > 6 ? (
                        <span className="text-[11px] text-fg-subtle">
                          +{segment.values.length - 6} more
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {ads ? (
            <Section title="Ad engagement">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <Field label="Ads clicked" value={ads.adsClicked.toLocaleString()} />
                <Field
                  label="Clicking since"
                  value={
                    ads.adsClickedFirstAt
                      ? new Date(ads.adsClickedFirstAt).toLocaleDateString()
                      : '—'
                  }
                />
                <Field
                  label="Most recent"
                  value={
                    ads.adsClickedLastAt
                      ? new Date(ads.adsClickedLastAt).toLocaleDateString()
                      : '—'
                  }
                />
                <Field
                  label="Off-site impressions"
                  value={ads.offsiteActions
                    .reduce((n, a) => n + a.count, 0)
                    .toLocaleString()}
                />
              </dl>
              {ads.offsiteApps.length > 0 ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="label mb-1">
                    Apps that showed you LinkedIn ads
                  </div>
                  <ul className="space-y-1 text-sm">
                    {ads.offsiteApps.slice(0, 8).map((app) => (
                      <li key={app.app} className="flex justify-between gap-2">
                        <span className="truncate text-fg-muted">{app.app}</span>
                        <span className="shrink-0 font-mono text-xs text-fg-subtle">
                          {app.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section title="Account access" count={activity.logins.length}>
            {activity.logins.length === 0 ? (
              <Empty>No login history imported.</Empty>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto text-xs">
                {activity.logins.map((login) => (
                  <li key={login.id} className="py-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-fg-muted">
                        {new Date(login.at).toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] text-fg-subtle">{login.type}</span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-fg-faint">
                      {login.ip} · {shortAgent(login.userAgent)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {activity.challenges.length > 0 ? (
          <Section
            title="Security challenges"
            count={activity.challenges.length}
            aside={
              challengeCountries.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {challengeCountries.map(([country, count]) => (
                    <span key={country} className="chip">
                      {country}
                      <span className="font-mono text-[10px] text-fg-subtle">{count}</span>
                    </span>
                  ))}
                </span>
              ) : null
            }
          >
            <p className="mb-2 text-xs text-fg-subtle">
              LinkedIn challenged a sign-in attempt on these occasions. A country you have never
              worked from is worth a second look.
            </p>
            <ul className="divide-y divide-line text-xs">
              {activity.challenges.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-fg-muted">{new Date(c.at).toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint">
                    {c.ip} · {shortAgent(c.userAgent)}
                  </span>
                  <span className="shrink-0 text-fg-muted">{c.country ?? '—'}</span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
                    {c.type?.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {activity.verifications.length > 0 ? (
          <Section title="Verifications" count={activity.verifications.length}>
            <ul className="space-y-2 text-sm">
              {activity.verifications.map((v) => (
                <li key={v.id}>
                  <span className="text-fg">{v.type}</span>
                  {v.organization ? (
                    <span className="text-fg-muted"> · {v.organization}</span>
                  ) : null}
                  <div className="font-mono text-[10px] text-fg-subtle">
                    {[
                      v.verifiedAt ? `verified ${v.verifiedAt}` : null,
                      v.expiresAt ? `expires ${v.expiresAt}` : null,
                      v.email,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="font-mono text-fg">{value}</dd>
    </div>
  );
}

/** User-agent strings are unreadable; the browser and OS are the useful part. */
function shortAgent(agent: string | null): string {
  if (!agent) return 'unknown client';
  const browser =
    agent.match(/(Edg|OPR|Chrome|Firefox|Safari)\/[\d.]+/)?.[0]?.split('/')[0] ?? 'browser';
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /Android/.test(agent)
      ? 'Android'
      : /iPhone|iPad/.test(agent)
        ? 'iOS'
        : /Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return [browser === 'Edg' ? 'Edge' : browser, os].filter(Boolean).join(' · ');
}
