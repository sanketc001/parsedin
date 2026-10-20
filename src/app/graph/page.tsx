'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { GraphCanvas } from '@/components/GraphCanvas';
import { Empty, PageHeader } from '@/components/ui';
import {
  DEFAULT_GRAPH_OPTIONS,
  buildGraph,
  type GraphNode,
  type GraphOptions,
} from '@/lib/graph';
import { emptyFilters, filterPeople, type Filters } from '@/lib/query/filters';

export default function GraphPage() {
  const { db, idx, loading } = useData();
  const [opts, setOpts] = useState<GraphOptions>(DEFAULT_GRAPH_OPTIONS);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const filters = useMemo<Filters>(() => ({ ...emptyFilters(), q }), [q]);
  const people = useMemo(() => filterPeople(db, filters, idx), [db, filters, idx]);

  const model = useMemo(() => buildGraph(db, people, idx, opts), [db, people, idx, opts]);

  // Selecting a node highlights it and everything one hop away.
  const highlight = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected.id]);
    for (const edge of model.edges) {
      if (edge.source === selected.id) set.add(edge.target);
      else if (edge.target === selected.id) set.add(edge.source);
    }
    return set;
  }, [selected, model.edges]);

  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<string>();
    for (const edge of model.edges) {
      if (edge.source === selected.id) ids.add(edge.target);
      else if (edge.target === selected.id) ids.add(edge.source);
    }
    return model.nodes.filter((n) => ids.has(n.id) && n.kind !== 'self').slice(0, 60);
  }, [selected, model]);

  const truncated = people.length > opts.maxPeople;

  return (
    <>
      <PageHeader
        title="Graph"
        subtitle={
          loading
            ? 'loading…'
            : `${model.nodes.length.toLocaleString()} nodes · ${model.edges.length.toLocaleString()} edges`
        }
        actions={
          <input
            className="input w-64"
            placeholder="Narrow the graph…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />

      <div className="flex h-[calc(100vh-var(--chrome-h))]">
        <div className="w-60 shrink-0 space-y-4 overflow-y-auto border-r border-line p-3">
          <div>
            <label className="label mb-1 block">
              Hub threshold: {opts.minDegree}+ people
            </label>
            <input
              type="range"
              min={1}
              max={8}
              value={opts.minDegree}
              onChange={(e) => setOpts({ ...opts, minDegree: Number(e.target.value) })}
              className="w-full accent-brand"
            />
            <p className="mt-1 text-[11px] text-fg-subtle">
              Companies and schools appear only when this many people share them.
            </p>
          </div>

          <div>
            <label className="label mb-1 block">Max people: {opts.maxPeople}</label>
            <input
              type="range"
              min={50}
              max={1200}
              step={50}
              value={opts.maxPeople}
              onChange={(e) => setOpts({ ...opts, maxPeople: Number(e.target.value) })}
              className="w-full accent-brand"
            />
          </div>

          <div className="space-y-1.5 border-t border-line pt-3">
            {(
              [
                ['includeCompanies', 'Companies'],
                ['includeSchools', 'Schools'],
                ['includePastRoles', 'Past roles'],
                ['includeSelf', 'Link to you'],
              ] as [keyof GraphOptions, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={Boolean(opts[key])}
                  onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="border-t border-line pt-3 text-[10px] text-fg-subtle">
            <div>{people.length.toLocaleString()} people matched</div>
            {truncated ? (
              <div className="text-warn">
                showing first {opts.maxPeople} — raise the cap to see more
              </div>
            ) : null}
            {model.hiddenCompanies > 0 ? (
              <div>{model.hiddenCompanies} companies below threshold</div>
            ) : null}
            {model.hiddenSchools > 0 ? (
              <div>{model.hiddenSchools} schools below threshold</div>
            ) : null}
          </div>

          {selected ? (
            <div className="border-t border-line pt-3">
              <div className="label mb-1">{selected.kind}</div>
              <div className="text-sm text-fg">{selected.label}</div>
              <NodeLink node={selected} />
              <div className="label mt-3 mb-1">Connected ({neighbours.length})</div>
              <ul className="space-y-0.5">
                {neighbours.map((n) => (
                  <li key={n.id} className="truncate text-xs">
                    <NodeLink node={n} compact />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="border-t border-line pt-3 text-[11px] text-fg-subtle">
              Click a node to inspect it and dim everything more than one hop away.
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {db.people.length === 0 && !loading ? (
            <Empty>
              Nothing to plot.{' '}
              <Link href="/import" className="link">
                Import data
              </Link>{' '}
              first.
            </Empty>
          ) : (
            <GraphCanvas
              model={model}
              onSelect={setSelected}
              selectedId={selected?.id ?? null}
              highlight={highlight}
            />
          )}
        </div>
      </div>
    </>
  );
}

function NodeLink({ node, compact }: { node: GraphNode; compact?: boolean }) {
  const href =
    node.kind === 'person'
      ? `/people/${encodeURIComponent(node.entityId)}`
      : node.kind === 'company'
        ? `/companies/${encodeURIComponent(node.entityId)}`
        : node.kind === 'school'
          ? `/schools/${encodeURIComponent(node.entityId)}`
          : null;
  if (!href) return compact ? <span className="text-fg-muted">{node.label}</span> : null;
  return (
    <Link href={href} className={compact ? 'text-fg-muted hover:text-brand-dark' : 'link text-xs'}>
      {compact ? node.label : 'open →'}
    </Link>
  );
}
