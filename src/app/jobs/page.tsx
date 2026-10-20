'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';
import { resolveCompany } from '@/lib/derive';
import { statsFor } from '@/lib/contact';
import type { Person } from '@/lib/types';

// ---------------------------------------------------------------------------
// Job search, crossed with the network.
//
// The export records every job you applied to and every one you saved. On its
// own that is a diary. Joined against the people graph it answers the question
// that actually matters at the moment of applying: who do I already know here?
// ---------------------------------------------------------------------------

interface Target {
  key: string;
  name: string;
  applied: number;
  saved: number;
  lastAt: string | null;
  titles: string[];
  urls: string[];
  /** People in the network who work there now, best contact first. */
  insiders: Person[];
  formerInsiders: Person[];
}

export default function JobsPage() {
  const { db, idx, loading } = useData();
  const [onlyWarm, setOnlyWarm] = useState(false);
  const activity = db.activity;

  const targets = useMemo<Target[]>(() => {
    const map = new Map<string, Target>();
    const touch = (name: string | null, companyId: string | null): Target | null => {
      if (!name) return null;
      // Applications name companies that may not employ anybody you know, so
      // fall back to the fuzzy resolver before giving up on a link.
      const resolved = companyId ?? resolveCompany(db, name)?.id ?? null;
      const key = resolved ?? `name:${name.toLowerCase()}`;
      let target = map.get(key);
      if (!target) {
        const current = resolved ? (idx.currentByCompany.get(resolved) ?? []) : [];
        const past = resolved ? (idx.pastByCompany.get(resolved) ?? []) : [];
        const rank = (a: Person, b: Person) =>
          statsFor(idx.contactByPerson, b.id).signal - statsFor(idx.contactByPerson, a.id).signal ||
          a.fullName.localeCompare(b.fullName);
        target = {
          key,
          name: resolved ? (idx.companyById.get(resolved)?.name ?? name) : name,
          applied: 0,
          saved: 0,
          lastAt: null,
          titles: [],
          urls: [],
          insiders: [...current].sort(rank),
          formerInsiders: [...past].sort(rank),
        };
        map.set(key, target);
      }
      return target;
    };

    for (const app of activity.jobApplications) {
      const target = touch(app.company, app.companyId);
      if (!target) continue;
      target.applied += 1;
      if (app.title && !target.titles.includes(app.title)) target.titles.push(app.title);
      if (app.url) target.urls.push(app.url);
      if (app.at && (!target.lastAt || app.at > target.lastAt)) target.lastAt = app.at;
    }
    for (const job of activity.savedJobs) {
      const target = touch(job.company, job.companyId);
      if (!target) continue;
      target.saved += 1;
      if (job.title && !target.titles.includes(job.title)) target.titles.push(job.title);
      if (job.at && (!target.lastAt || job.at > target.lastAt)) target.lastAt = job.at;
    }

    return [...map.values()].sort(
      (a, b) =>
        b.insiders.length - a.insiders.length ||
        b.applied - a.applied ||
        (b.lastAt ?? '').localeCompare(a.lastAt ?? ''),
    );
  }, [activity, db, idx]);

  const visible = onlyWarm ? targets.filter((t) => t.insiders.length > 0) : targets;
  const warmCount = targets.filter((t) => t.insiders.length > 0).length;
  const prefs = activity.jobPreferences;

  const empty =
    !loading &&
    activity.jobApplications.length === 0 &&
    activity.savedJobs.length === 0 &&
    !prefs;

  if (empty) {
    return (
      <>
        <PageHeader title="Jobs" subtitle="Applications, saved roles and who you know there" />
        <div className="p-6">
          <Empty>
            No job-search data imported. It lives in the <code>Jobs/</code>{' '}
            folder of the LinkedIn export.{' '}
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
        title="Jobs"
        subtitle="Every role you applied to or saved, joined against your network"
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat label="Applications" value={activity.jobApplications.length} />
          <Stat label="Saved roles" value={activity.savedJobs.length} />
          <Stat label="Target companies" value={targets.length} />
          <Stat
            label="Warm targets"
            value={warmCount}
            hint="somebody you know works there"
          />
          <Stat label="Job alerts" value={activity.jobAlerts.length} />
        </div>

        {prefs ? (
          <Section title="What you told LinkedIn you want">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <PrefList label="Titles" values={prefs.jobTitles} />
              <PrefList label="Locations" values={prefs.locations} />
              <PrefList label="Types" values={prefs.jobTypes} />
              <div>
                <div className="label">Status</div>
                <ul className="mt-1 space-y-0.5 text-fg-muted">
                  {prefs.urgency ? <li>{prefs.urgency.replace(/_/g, ' ').toLowerCase()}</li> : null}
                  {prefs.openToRecruiters !== null ? (
                    <li>
                      {prefs.openToRecruiters ? 'open to recruiters' : 'not open to recruiters'}
                    </li>
                  ) : null}
                  {prefs.visibility ? (
                    <li className="text-fg-subtle">visible to {prefs.visibility.toLowerCase()}</li>
                  ) : null}
                </ul>
              </div>
            </div>
            {activity.jobAlerts.length > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <div className="label mb-1">Saved alerts</div>
                <div className="flex flex-wrap gap-1">
                  {activity.jobAlerts.map((a) => (
                    <span key={a.id} className="chip">
                      {a.keywords ?? 'any role'}
                      {a.location ? (
                        <span className="text-fg-subtle">· {a.location}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>
        ) : null}

        <Section
          title="Target companies"
          count={visible.length}
          aside={
            <button
              type="button"
              onClick={() => setOnlyWarm(!onlyWarm)}
              className={`chip transition-colors ${
                onlyWarm ? 'border-brand/50 bg-brand/15 text-brand-dark' : 'hover:border-line-strong'
              }`}
            >
              warm intros only
            </button>
          }
        >
          {visible.length === 0 ? (
            <Empty>
              {onlyWarm
                ? 'You know nobody at any company you applied to.'
                : 'No applications or saved roles.'}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((target) => (
                <TargetRow key={target.key} target={target} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Application history" count={activity.jobApplications.length}>
          {activity.jobApplications.length === 0 ? (
            <Empty>No applications recorded.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {activity.jobApplications.map((app) => (
                <li key={app.id} className="flex items-baseline gap-3 py-2">
                  <span className="w-24 shrink-0 text-[11px] text-fg-subtle">
                    {app.at ? new Date(app.at).toLocaleDateString() : '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {app.url ? (
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="link"
                        >
                          {app.title ?? 'Untitled role'}
                        </a>
                      ) : (
                        (app.title ?? 'Untitled role')
                      )}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {app.companyId ? (
                        <Link
                          href={`/companies/${encodeURIComponent(app.companyId)}`}
                          className="hover:text-fg-muted"
                        >
                          {app.company}
                        </Link>
                      ) : (
                        app.company
                      )}
                      {app.resume ? (
                        <span className="text-fg-faint"> · {app.resume}</span>
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function PrefList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.map((v) => (
          <span key={v} className="chip">
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function TargetRow({ target }: { target: Target }) {
  const warm = target.insiders.length > 0;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-fg">{target.name}</span>
        <span className="text-[11px] text-fg-subtle">
          {target.applied ? `${target.applied} applied` : ''}
          {target.applied && target.saved ? ' · ' : ''}
          {target.saved ? `${target.saved} saved` : ''}
          {target.lastAt ? ` · ${new Date(target.lastAt).toLocaleDateString()}` : ''}
        </span>
      </div>
      <div className="truncate text-xs text-fg-subtle">{target.titles.slice(0, 2).join(' · ')}</div>
      {warm ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-brand-dark">
            you know {target.insiders.length} here
          </span>
          {target.insiders.slice(0, 6).map((p) => (
            <Link
              key={p.id}
              href={`/people/${encodeURIComponent(p.id)}`}
              className="chip hover:border-brand/50 hover:text-brand-dark"
            >
              {p.fullName}
            </Link>
          ))}
          {target.insiders.length > 6 ? (
            <span className="text-[11px] text-fg-subtle">
              +{target.insiders.length - 6} more
            </span>
          ) : null}
        </div>
      ) : target.formerInsiders.length > 0 ? (
        <div className="mt-1 text-[11px] text-fg-subtle">
          {target.formerInsiders.length} former employee
          {target.formerInsiders.length === 1 ? '' : 's'} in your network
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-fg-faint">nobody you know</div>
      )}
    </li>
  );
}
