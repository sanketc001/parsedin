'use client';

import { useMemo, useState } from 'react';
import type { FacetOption, Facets, Filters } from '@/lib/query/filters';
import { countActiveFilters } from '@/lib/query/filters';

// ---------------------------------------------------------------------------
// Facet sidebar. Values within a group are OR'd, groups are AND'd — stated in
// the UI so a narrow result set is never mysterious.
// ---------------------------------------------------------------------------

interface Props {
  filters: Filters;
  facets: Facets;
  onChange: (next: Filters) => void;
  onReset: () => void;
}

export function FilterPanel({ filters, facets, onChange, onReset }: Props) {
  const active = countActiveFilters(filters);

  const toggle = (key: keyof Filters, value: string) => {
    const list = filters[key] as string[];
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    onChange({ ...filters, [key]: next });
  };

  const toggleDegree = (value: number) => {
    const next = filters.degrees.includes(value)
      ? filters.degrees.filter((d) => d !== value)
      : [...filters.degrees, value];
    onChange({ ...filters, degrees: next });
  };

  return (
    <div className="w-64 shrink-0 space-y-3 overflow-y-auto border-r border-ink-700 p-3">
      <div className="flex items-center justify-between">
        <span className="label">
          Filters{active > 0 ? ` · ${active}` : ''}
        </span>
        {active > 0 ? (
          <button type="button" onClick={onReset} className="text-xs text-slate-500 hover:text-slate-300">
            clear all
          </button>
        ) : null}
      </div>

      <div>
        <label className="label mb-1 block">Title contains</label>
        <input
          className="input"
          placeholder="e.g. product manager"
          value={filters.title}
          onChange={(e) => onChange({ ...filters, title: e.target.value })}
        />
      </div>

      <FacetGroup
        title="Currently at"
        options={facets.currentCompanies}
        selected={filters.currentCompanyIds}
        onToggle={(v) => toggle('currentCompanyIds', v)}
      />
      <FacetGroup
        title="Previously at"
        options={facets.pastCompanies}
        selected={filters.pastCompanyIds}
        onToggle={(v) => toggle('pastCompanyIds', v)}
      />
      <FacetGroup
        title="School"
        options={facets.schools}
        selected={filters.schoolIds}
        onToggle={(v) => toggle('schoolIds', v)}
      />
      <FacetGroup
        title="Location"
        options={facets.locations}
        selected={filters.locations}
        onToggle={(v) => toggle('locations', v)}
      />
      <FacetGroup
        title="Skill"
        options={facets.skills}
        selected={filters.skills}
        onToggle={(v) => toggle('skills', v)}
      />
      <FacetGroup
        title="Certification"
        options={facets.certifications}
        selected={filters.certifications}
        onToggle={(v) => toggle('certifications', v)}
      />
      <FacetGroup
        title="Volunteering"
        options={facets.volunteering}
        selected={filters.volunteering}
        onToggle={(v) => toggle('volunteering', v)}
      />
      <FacetGroup
        title="Industry"
        options={facets.industries}
        selected={filters.industries}
        onToggle={(v) => toggle('industries', v)}
      />

      <div className="border-t border-ink-800 pt-3">
        <span className="label mb-1 block">Connection degree</span>
        <div className="flex flex-wrap gap-1">
          {facets.degrees.map((d) => {
            const n = Number(d.value);
            const on = filters.degrees.includes(n);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDegree(n)}
                className={`chip ${on ? 'border-accent/60 bg-accent/15 text-accent-soft' : ''}`}
              >
                {d.label}
                <span className="font-mono text-[10px] text-slate-500">{d.count}</span>
              </button>
            );
          })}
          {facets.degrees.length === 0 ? (
            <span className="text-xs text-slate-600">not recorded</span>
          ) : null}
        </div>
      </div>

      <div className="border-t border-ink-800 pt-3">
        <span className="label mb-1 block">Private signals</span>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="accent-accent"
              checked={filters.hasNotes}
              onChange={(e) => onChange({ ...filters, hasNotes: e.target.checked })}
            />
            has notes
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span>min strength</span>
            <select
              className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-xs"
              value={filters.minStrength ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  minStrength: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

const COLLAPSED_LIMIT = 6;

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    // Selected values stay visible even when they fall outside the top slice.
    const selectedSet = new Set(selected);
    const chosen = base.filter((o) => selectedSet.has(o.value));
    const rest = base.filter((o) => !selectedSet.has(o.value));
    const visible = expanded || needle ? rest : rest.slice(0, COLLAPSED_LIMIT);
    return { rows: [...chosen, ...visible], total: base.length };
  }, [options, search, expanded, selected]);

  if (options.length === 0) return null;

  return (
    <div className="border-t border-ink-800 pt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{title}</span>
        <span className="font-mono text-[10px] text-slate-600">{options.length}</span>
      </div>

      {options.length > COLLAPSED_LIMIT ? (
        <input
          className="input mb-1.5 py-1 text-xs"
          placeholder="filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      ) : null}

      <div className="space-y-0.5">
        {filtered.rows.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-ink-800 ${
                on ? 'text-accent-soft' : 'text-slate-400'
              }`}
              title={o.label}
            >
              <input
                type="checkbox"
                className="accent-accent"
                checked={on}
                onChange={() => onToggle(o.value)}
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-600">{o.count}</span>
            </label>
          );
        })}
      </div>

      {!search && filtered.total > COLLAPSED_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          {expanded ? 'show less' : `show all ${filtered.total}`}
        </button>
      ) : null}
    </div>
  );
}
