'use client';

import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, Section, Stat } from '@/components/ui';
import type { Evidence, Proposal, UndoRecord } from '@/lib/types';

interface AnalyzeReport {
  provider: string;
  clustersExamined: number;
  clustersTotal: number;
  appliedMerges: string[];
  appliedParents: string[];
  queued: number;
  skipped: string[];
  errors: string[];
}

export default function ResolvePage() {
  const { db, idx, refresh, loading } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [dryRun, setDryRun] = useState(false);

  const pending = useMemo(
    () =>
      db.resolution.proposals
        .filter((p) => p.status === 'pending')
        .sort((a, b) => b.confidence - a.confidence),
    [db.resolution.proposals],
  );
  const rejected = useMemo(
    () => db.resolution.proposals.filter((p) => p.status === 'rejected'),
    [db.resolution.proposals],
  );

  const headcount = (companyId: string) =>
    (idx.currentByCompany.get(companyId)?.length ?? 0) +
    (idx.pastByCompany.get(companyId)?.length ?? 0);

  const act = async (label: string, body: unknown) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch('/api/companies/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`);
      await refresh();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy('analyze');
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/companies/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`);
      setReport(json.report as AnalyzeReport);
      await refresh();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Company resolution"
        subtitle="Merge name variants and record corporate structure"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                className="accent-brand"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              propose only
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null || loading}
              onClick={() => void analyze()}
            >
              {busy === 'analyze' ? 'Analyzing…' : 'Run analysis'}
            </button>
          </>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Companies" value={db.companies.length} />
          <Stat label="Pending review" value={pending.length} />
          <Stat
            label="Applied"
            value={db.resolution.log.length}
            hint="all revertible"
          />
          <Stat
            label="Last analyzed"
            value={
              db.resolution.lastAnalyzedAt
                ? new Date(db.resolution.lastAnalyzedAt).toLocaleDateString()
                : '—'
            }
          />
        </div>

        {error ? (
          <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {report ? (
          <Section title="Last run">
            <div className="space-y-1 text-sm text-fg-muted">
              <div className="text-xs text-fg-subtle">
                {report.clustersExamined} of {report.clustersTotal} name clusters examined ·
                grounding: {report.provider}
              </div>
              {report.appliedMerges.length > 0 ? (
                <div>
                  <span className="label">Merged</span>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {report.appliedMerges.map((m) => (
                      <li key={m}>· {m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.appliedParents.length > 0 ? (
                <div>
                  <span className="label">Linked</span>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {report.appliedParents.map((m) => (
                      <li key={m}>· {m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="text-xs text-fg-muted">{report.queued} queued for review</div>
              {report.errors.length > 0 ? (
                <ul className="space-y-0.5 text-xs text-warn">
                  {report.errors.slice(0, 6).map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Section>
        ) : null}

        <Section title="Needs your call" count={pending.length}>
          {pending.length === 0 ? (
            <Empty>
              Nothing waiting. Run the analysis to look for name variants and corporate
              relationships.
            </Empty>
          ) : (
            <ul className="space-y-2">
              {pending.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  headcount={headcount}
                  busy={busy === p.id}
                  onAccept={() => void act(p.id, { action: 'accept', proposalId: p.id })}
                  onReject={() => void act(p.id, { action: 'reject', proposalId: p.id })}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Applied" count={db.resolution.log.length}>
          {db.resolution.log.length === 0 ? (
            <Empty>Nothing applied yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {db.resolution.log.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  busy={busy === entry.id}
                  onRevert={() => void act(entry.id, { action: 'revert', undoId: entry.id })}
                />
              ))}
            </ul>
          )}
        </Section>

        {rejected.length > 0 ? (
          <Section title="Rejected" count={rejected.length}>
            <ul className="space-y-0.5 text-xs text-fg-subtle">
              {rejected.map((p) => (
                <li key={p.id}>
                  {p.names[0]} {p.kind === 'merge' ? '≠' : '⇸'} {p.names[1]}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="How this works">
          <div className="space-y-2 text-sm text-fg-muted">
            <p>
              <span className="text-fg">Merging</span> is for one company written two
              ways — a typo or a legal suffix. It rewrites everyone&apos;s references and is
              destructive, so it needs either web evidence or names close enough that the
              spelling itself proves it.
            </p>
            <p>
              <span className="text-fg">Parent links</span> are for genuinely different
              workplaces in one corporate group. Nothing is rewritten:
              &quot;who works at JioHotstar&quot; still answers precisely, while the group rolls
              up. Subsidiaries are never merged, however similar the names look.
            </p>
            <p>
              Relationships are grounded in retrieved web text rather than model memory, because
              corporate structure changes faster than a training snapshot. Every applied action
              is listed above and revertible, and merges are stored as rules — so a future
              import cannot resurrect a duplicate you have already dealt with.
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}

function ProposalRow({
  proposal,
  headcount,
  busy,
  onAccept,
  onReject,
}: {
  proposal: Proposal;
  headcount: (companyId: string) => number;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isMerge = proposal.kind === 'merge';
  return (
    <li className="rounded border border-line bg-surface-sunken p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`chip ${
                isMerge
                  ? 'border-warn/30 bg-warn/10 text-warn'
                  : 'border-brand/40 bg-brand/10 text-brand-dark'
              }`}
            >
              {isMerge ? 'merge' : `parent · ${proposal.relation}`}
            </span>
            <span className="font-mono text-[11px] text-fg-subtle">
              confidence {proposal.confidence.toFixed(2)}
            </span>
          </div>

          <div className="mt-1.5 text-sm text-fg">
            {isMerge ? (
              <>
                <span>{proposal.names[0]}</span>
                <span className="mx-2 text-fg-subtle">is the same as</span>
                <span>{proposal.names[1]}</span>
              </>
            ) : (
              <>
                <span>{proposal.names[0]}</span>
                <span className="mx-2 text-fg-subtle">sits under</span>
                <span>{proposal.names[1]}</span>
              </>
            )}
          </div>

          <div className="mt-0.5 text-xs text-fg-subtle">
            {isMerge
              ? `${headcount(proposal.companyIds[0])} people would move`
              : 'nothing is rewritten — this only records structure'}
          </div>

          <p className="mt-1.5 text-xs text-fg-muted">{proposal.reasoning}</p>
          <EvidenceList evidence={proposal.evidence} />
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={onReject}>
            Reject
          </button>
          <button
            type="button"
            className="btn btn-primary px-2 py-1 text-xs"
            disabled={busy}
            onClick={onAccept}
          >
            {busy ? '…' : 'Apply'}
          </button>
        </div>
      </div>
    </li>
  );
}

function LogRow({
  entry,
  busy,
  onRevert,
}: {
  entry: UndoRecord;
  busy: boolean;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-line px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">{entry.description}</span>
            {entry.auto ? (
              <span className="chip font-mono text-[10px]">auto</span>
            ) : null}
          </div>
          <div className="font-mono text-[10px] text-fg-faint">
            {new Date(entry.appliedAt).toLocaleString()}
            {entry.confidence !== null ? ` · confidence ${entry.confidence.toFixed(2)}` : ''}
            {entry.kind === 'merge' && entry.rewrittenCurrent
              ? ` · ${entry.rewrittenCurrent.length} people moved`
              : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entry.evidence.length > 0 ? (
            <button
              type="button"
              className="text-[11px] text-fg-subtle hover:text-fg-muted"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'hide source' : 'source'}
            </button>
          ) : (
            <span className="text-[11px] text-fg-faint">no citation</span>
          )}
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            disabled={busy}
            onClick={onRevert}
          >
            {busy ? '…' : 'Revert'}
          </button>
        </div>
      </div>
      {open ? <EvidenceList evidence={entry.evidence} /> : null}
    </li>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="mt-1.5 text-[11px] text-fg-faint">
        No web source — judged from the names alone.
      </div>
    );
  }
  return (
    <ul className="mt-1.5 space-y-1">
      {evidence.map((e) => (
        <li key={e.url} className="rounded border border-line bg-surface p-2">
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer noopener"
            className="link text-[11px]"
          >
            {e.title} ↗
          </a>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            {e.snippet.slice(0, 280)}
            {e.snippet.length > 280 ? '…' : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}
