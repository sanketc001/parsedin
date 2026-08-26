import type { Person } from '../types';
import {
  allCompanyIds,
  allTitles,
  currentCompanyIds,
  schoolIds,
  skillNames,
  type Indexes,
} from '../derive';
import type { Aggregation } from './nl';

export interface AggRow {
  key: string;
  label: string;
  count: number;
  /** Link target when the row corresponds to a real entity page. */
  href: string | null;
}

/** Count people per entity for "which X has the most people I know" questions. */
export function runAggregation(
  people: Person[],
  agg: Aggregation,
  idx: Indexes,
): AggRow[] {
  const counts = new Map<string, { label: string; count: number; href: string | null }>();

  const bump = (key: string, label: string, href: string | null) => {
    if (!key) return;
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { label, count: 1, href });
  };

  for (const person of people) {
    switch (agg.kind) {
      case 'companies': {
        const ids = agg.scope === 'any' ? allCompanyIds(person) : currentCompanyIds(person);
        for (const id of ids) {
          bump(id, idx.companyById.get(id)?.name ?? id, `/companies/${encodeURIComponent(id)}`);
        }
        break;
      }
      case 'schools':
        for (const id of schoolIds(person)) {
          bump(id, idx.schoolById.get(id)?.name ?? id, `/schools/${encodeURIComponent(id)}`);
        }
        break;
      case 'locations':
        if (person.location) bump(person.location.toLowerCase(), person.location, null);
        break;
      case 'industries':
        if (person.industry) bump(person.industry.toLowerCase(), person.industry, null);
        break;
      case 'titles':
        for (const t of allTitles(person)) bump(t.toLowerCase(), t, null);
        break;
      case 'skills':
        for (const s of skillNames(person)) bump(s.toLowerCase(), s, null);
        break;
    }
  }

  return Array.from(counts.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count, href: v.href }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, agg.limit);
}

export function aggregationTitle(agg: Aggregation): string {
  const scope = agg.kind === 'companies' && agg.scope === 'any' ? ' (current or past)' : '';
  const noun = {
    companies: 'Companies',
    schools: 'Schools',
    locations: 'Locations',
    titles: 'Titles',
    skills: 'Skills',
    industries: 'Industries',
  }[agg.kind];
  return `${noun}${scope} by number of people in your network`;
}
