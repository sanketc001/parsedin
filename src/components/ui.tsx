'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FieldSource, Person } from '@/lib/types';
import { formatDate } from '@/lib/normalize';

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
    <header className="sticky top-0 z-10 border-b border-ink-700 bg-ink-950/85 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-100">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-slate-400">{subtitle}</div> : null}
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
        <h2 className="text-sm font-semibold text-slate-200">
          {title}
          {count !== undefined ? (
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">{count}</span>
          ) : null}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-slate-500">{children}</div>;
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
    <div className="card px-4 py-3 transition-colors hover:border-ink-600">
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-2xl text-slate-100">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
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
      className="ml-1.5 cursor-help select-none align-middle font-mono text-[10px] text-slate-600 hover:text-slate-400"
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
    <div className="mt-1 font-mono text-[10px] text-slate-600">
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
      ? 'border-fuchsia-800/60 bg-fuchsia-950/40 text-fuchsia-300'
      : degree === 1
        ? 'border-accent/40 bg-accent/10 text-accent-soft'
        : 'border-ink-600 bg-ink-800 text-slate-400';
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}>{label}</span>
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
          filled ? 'border-accent bg-accent' : 'border-ink-500 bg-transparent'
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
            className={`${cls} hover:border-accent-soft`}
          />
        );
      })}
    </span>
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
    <Link
      href={`/people/${encodeURIComponent(person.id)}`}
      className="flex items-center gap-3 border-b border-ink-800 px-3 py-2 last:border-0 hover:bg-ink-850"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-slate-100">{person.fullName}</span>
          <DegreeBadge degree={person.connectionDegree} />
          {noteCount ? (
            <span className="font-mono text-[10px] text-amber-500/80" title={`${noteCount} note(s)`}>
              ✎{noteCount}
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-slate-500">{role || person.headline || '—'}</div>
      </div>
      {person.location ? (
        <div className="hidden w-40 shrink-0 truncate text-xs text-slate-500 lg:block">
          {person.location}
        </div>
      ) : null}
      {strength ? <StrengthDots value={strength} /> : null}
      {right}
    </Link>
  );
}

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-600">—</span>;
  return <span>{formatDate(value)}</span>;
}
