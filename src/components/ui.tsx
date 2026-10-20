'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FieldSource, Person } from '@/lib/types';
import { formatDate } from '@/lib/normalize';
import { personLink } from '@/lib/linkedin';

// --- layout -----------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-[var(--nav-h)] z-20 border-b border-line bg-canvas/90 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-fg">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-fg-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  count,
  children,
  aside,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">
          {title}
          {count !== undefined ? (
            <span className="ml-2 text-xs font-normal text-fg-subtle">{count}</span>
          ) : null}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-fg-subtle">{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    // The hint line is always rendered, empty or not: a row of stat cards where
    // only some have hints comes out visibly ragged.
    <div className="card h-full px-4 py-3 transition-shadow hover:shadow-raised">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fg">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="mt-0.5 min-h-[1rem] text-xs text-fg-subtle">{hint ?? ''}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Initials in a circle, standing in for the profile photo LinkedIn shows on
 * every row. The export contains no photos for connections, so the fallback has
 * to carry the whole job: a stable tint per person makes a long list scannable
 * by shape as well as by reading.
 */
export function Avatar({
  person,
  size = 48,
  className = '',
}: {
  person: Person;
  size?: number;
  className?: string;
}) {
  const initials =
    [person.firstName, person.lastName]
      .filter(Boolean)
      .map((part) => part![0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ||
    person.fullName.trim()[0]?.toUpperCase() ||
    '?';

  // Muted, LinkedIn-compatible tones — a rainbow would fight the brand blue.
  const TONES = ['#4a6f8a', '#6b5b7b', '#7a6a52', '#4f7060', '#7a5b5b', '#55627a'];
  let hash = 0;
  for (const ch of person.nameKey || person.fullName) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: TONES[hash % TONES.length],
        fontSize: Math.round(size * 0.36),
      }}
    >
      {initials}
    </span>
  );
}

/**
 * Activity per month as a bar chart.
 *
 * Months with nothing in them are drawn as gaps rather than skipped, because
 * the gaps are the point — a year of silence should look like a year of
 * silence, not like two adjacent bars.
 */
export function MonthHistogram({
  counts,
  height = 56,
  title,
}: {
  /** Month bucket ("2026-08") to count. Sparse; gaps are filled in here. */
  counts: Map<string, number>;
  height?: number;
  title?: string;
}) {
  const keys = [...counts.keys()].sort();
  if (keys.length === 0) return <Empty>Nothing to chart.</Empty>;

  const months: string[] = [];
  const [startY, startM] = keys[0].split('-').map(Number);
  const [endY, endM] = keys[keys.length - 1].split('-').map(Number);
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const max = Math.max(...counts.values(), 1);
  return (
    <div>
      {title ? <div className="label mb-1">{title}</div> : null}
      <div className="flex items-end gap-px overflow-x-auto" style={{ height }}>
        {months.map((month) => {
          const count = counts.get(month) ?? 0;
          return (
            <div
              key={month}
              className="min-w-[3px] flex-1 rounded-sm bg-brand/60 transition-colors hover:bg-brand"
              style={{ height: count ? `${Math.max(6, (count / max) * 100)}%` : '1px' }}
              title={`${month}: ${count}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-fg-faint">
        <span>{months[0]}</span>
        <span>peak {max}/mo</span>
        <span>{months[months.length - 1]}</span>
      </div>
    </div>
  );
}

// --- data bits --------------------------------------------------------------

/**
 * Provenance marker. Every imported fact can show where it came from — this is
 * the small "i" that reveals it on hover.
 */
export function SourceTag({ source }: { source: FieldSource | undefined }) {
  if (!source) return null;
  return (
    <span
      className="ml-1.5 cursor-help select-none align-middle text-[10px] text-fg-faint hover:text-fg-muted"
      title={`from ${source.sourceLabel} · imported ${new Date(source.importedAt).toLocaleString()}`}
    >
      ⓘ
    </span>
  );
}

export function ProvenanceLine({
  sourceBatchId,
  importedAt,
  updatedAt,
  labelResolver,
}: {
  sourceBatchId: string;
  importedAt: string;
  updatedAt?: string;
  labelResolver: (batchId: string) => string;
}) {
  const changed = updatedAt && updatedAt !== importedAt;
  return (
    <div className="mt-1 text-[10px] text-fg-faint">
      {labelResolver(sourceBatchId)} · imported {new Date(importedAt).toLocaleDateString()}
      {changed ? ` · updated ${new Date(updatedAt!).toLocaleDateString()}` : ''}
    </div>
  );
}

export function DegreeBadge({ degree }: { degree: number | null }) {
  if (degree === null) return null;
  const label = degree === 0 ? 'you' : degree === 1 ? '1st' : degree === 2 ? '2nd' : `${degree}rd`;
  const tone =
    degree === 0
      ? 'border-node-self/30 bg-node-self/10 text-node-self'
      : degree === 1
        ? 'border-brand/40 bg-brand/10 text-brand-dark'
        : 'border-line-strong bg-surface-sunken text-fg-muted';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>{label}</span>
  );
}

/** Relationship strength as five clickable dots. Read-only when onChange is absent. */
export function StrengthDots({
  value,
  onChange,
  size = 'sm',
}: {
  value: number;
  onChange?: (next: number | null) => void;
  size?: 'sm' | 'md';
}) {
  const dot = size === 'md' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const cls = `${dot} rounded-full border transition-colors ${
          filled ? 'border-brand bg-brand' : 'border-line-strong bg-transparent'
        }`;
        if (!onChange) return <span key={n} className={cls} />;
        return (
          <button
            key={n}
            type="button"
            aria-label={`Set strength ${n}`}
            title={value === n ? 'Click to clear' : `Set strength ${n}`}
            // Clicking the current value clears the rating.
            onClick={() => onChange(value === n ? null : n)}
            className={`${cls} hover:border-brand-dark`}
          />
        );
      })}
    </span>
  );
}

/**
 * Straight out to someone's real LinkedIn profile.
 *
 * Rendered as its own anchor rather than inside a row's internal `<Link>`,
 * because nesting anchors is invalid HTML and browsers recover from it by
 * dropping one — usually not the one you wanted.
 */
export function LinkedInLink({
  person,
  className = '',
  label,
}: {
  person: Person;
  className?: string;
  /** Show text beside the arrow instead of the icon alone. */
  label?: string;
}) {
  const link = personLink(person);
  if (!link) return null;
  const isSearch = link.kind === 'search';
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noreferrer noopener"
      // The row around this is itself a link; stop the click bubbling into it.
      onClick={(e) => e.stopPropagation()}
      title={
        isSearch
          ? `No profile URL on record — search LinkedIn for ${person.fullName}`
          : `Open ${person.fullName} on LinkedIn`
      }
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
        isSearch
          ? 'text-fg-faint hover:bg-surface-sunken hover:text-fg-muted'
          : 'text-fg-subtle hover:bg-surface-sunken hover:text-brand-dark'
      } ${className}`}
    >
      {label ? `${label} ` : ''}
      {isSearch ? '⌕' : 'in'} ↗
    </a>
  );
}

export function PersonLine({
  person,
  strength,
  noteCount,
  right,
}: {
  person: Person;
  strength?: number;
  noteCount?: number;
  right?: ReactNode;
}) {
  const role = [person.currentTitle, person.currentCompany].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center border-b border-line last:border-0 hover:bg-surface-sunken">
      <Link
        href={`/people/${encodeURIComponent(person.id)}`}
        className="group flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
      >
        <Avatar person={person} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg group-hover:text-brand group-hover:underline">
              {person.fullName}
            </span>
            <DegreeBadge degree={person.connectionDegree} />
            {noteCount ? (
              <span className="text-[10px] text-warn" title={`${noteCount} note(s)`}>
                ✎{noteCount}
              </span>
            ) : null}
          </div>
          {/* Omitted rather than dashed when unknown — a column of em-dashes is
              litter, and most connections have no title on record. */}
          {role || person.headline ? (
            <div className="truncate text-xs text-fg-subtle">{role || person.headline}</div>
          ) : null}
        </div>
        {person.location ? (
          <div className="hidden w-40 shrink-0 truncate text-xs text-fg-subtle lg:block">
            {person.location}
          </div>
        ) : null}
        {strength ? <StrengthDots value={strength} /> : null}
      </Link>
      {right}
      <LinkedInLink person={person} className="mr-2 ml-2" />
    </div>
  );
}

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-fg-faint">—</span>;
  return <span>{formatDate(value)}</span>;
}
