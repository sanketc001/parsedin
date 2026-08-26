import type { Database } from '../types';
import { resolveCompanies, resolveSchools } from '../derive';
import { wordPrefixMatch } from '../match';
import { companyKey, normalizeKey } from '../normalize';
import { emptyFilters, isEmptyFilters, type Filters } from './filters';

// ---------------------------------------------------------------------------
// Question parsing.
//
// Rule-based and fully local — no model call. The point is not to understand
// arbitrary English but to map the handful of shapes this database is actually
// asked about ("who works at X", "who previously worked at Y", "which
// companies have the most people I know") onto the same Filters object the
// People page uses, and to *show its work* so a wrong reading is obvious
// rather than mysterious.
// ---------------------------------------------------------------------------

export type AggregationKind =
  | 'companies'
  | 'schools'
  | 'locations'
  | 'titles'
  | 'skills'
  | 'industries';

export interface Aggregation {
  kind: AggregationKind;
  /** For companies: count current employees only, or anyone ever there. */
  scope: 'current' | 'any';
  limit: number;
}

export interface Interpretation {
  /** Facet label shown on the chip, e.g. "Currently at". */
  facet: string;
  /** Resolved values, e.g. ["Google"]. */
  values: string[];
}

export interface ParsedQuery {
  filters: Filters;
  aggregation: Aggregation | null;
  interpretation: Interpretation[];
  /** Phrases we recognized as a constraint but could not resolve to anything. */
  unresolved: string[];
  /** True when we fell back to a plain full-text search. */
  fellBackToSearch: boolean;
}

type PredicateKind =
  | 'current-company'
  | 'past-company'
  | 'any-company'
  | 'school'
  | 'location'
  | 'skill'
  | 'certification'
  | 'volunteering'
  | 'title'
  | 'ambiguous-in';

interface Predicate {
  re: RegExp;
  kind: PredicateKind;
}

// Order matters: longer / more specific phrasings first, since the scanner
// takes the earliest match at each position.
const PREDICATES: Predicate[] = [
  // past employment — check before present tense so "used to work at" wins
  { re: /\b(?:previously|formerly|once|earlier)\s+(?:worked?|working|was)\s*(?:at|for|with|in)?\b/g, kind: 'past-company' },
  { re: /\bused\s+to\s+(?:work|be)\s*(?:at|for|with|in)?\b/g, kind: 'past-company' },
  { re: /\bex[-\s]?(?:employee\s+of|from)?\b/g, kind: 'past-company' },
  { re: /\bworked\s+(?:at|for|with|in)\b/g, kind: 'past-company' },
  { re: /\bleft\b/g, kind: 'past-company' },
  { re: /\balumni?\s+of\b/g, kind: 'school' },

  // education
  { re: /\b(?:went\s+to|attended|graduated\s+from|studied\s+at|studies\s+at)\b/g, kind: 'school' },

  // present employment
  { re: /\b(?:works?|working)\s+(?:at|for|with)\b/g, kind: 'current-company' },
  { re: /\b(?:employed\s+(?:at|by))\b/g, kind: 'current-company' },
  { re: /\bis\s+(?:at|with)\b/g, kind: 'current-company' },
  { re: /\bever\s+(?:worked?|been)\s+(?:at|for)\b/g, kind: 'any-company' },

  // location
  { re: /\b(?:lives?|living|based|located|resides?)\s+(?:in|at|near|around)\b/g, kind: 'location' },
  { re: /\b(?:is|are)\s+(?:from|based\s+in)\b/g, kind: 'location' },

  // skills / certifications / volunteering
  { re: /\b(?:knows|skilled\s+(?:in|at)|expert\s+(?:in|at|on)|good\s+at|does)\b/g, kind: 'skill' },
  { re: /\b(?:has\s+(?:a\s+)?(?:certification|certificate)\s*(?:in|as|for)?|certified\s*(?:in|as|for)?)\b/g, kind: 'certification' },
  { re: /\bvolunteer(?:s|ed|ing)?\s+(?:at|for|with)\b/g, kind: 'volunteering' },

  // title
  { re: /\b(?:is|are)\s+(?:a|an|the)\b/g, kind: 'title' },
  { re: /\b(?:title|role|job)\s+(?:is|of|as)?\b/g, kind: 'title' },
  { re: /\bas\s+(?:a|an)\b/g, kind: 'title' },

  // needs resolving by value — "works in AI" vs "works in London"
  { re: /\b(?:works?|working)\s+in\b/g, kind: 'ambiguous-in' },
  { re: /\bin\s+the\s+(?:field\s+of|area\s+of|space\s+of)\b/g, kind: 'ambiguous-in' },
];

/** Words that never carry meaning as a filter value. */
const VALUE_STOPWORDS = [
  'my network', 'the network', 'my connections', 'my contacts', 'my graph',
  'anyone', 'someone', 'people', 'person', 'somebody', 'anybody',
  'right now', 'currently', 'today', 'now', 'also', 'still',
];

function stripValue(raw: string): string {
  let v = raw.trim();
  v = v.replace(/[?!.;:]+$/g, '');
  v = v.replace(/^(?:the|a|an)\s+/i, '');
  v = v.replace(/\s+(?:and|or)$/i, '');
  v = v.replace(/^(?:and|or|,)\s+/i, '');
  for (const stop of VALUE_STOPWORDS) {
    const re = new RegExp(`\\b${stop}\\b`, 'gi');
    v = v.replace(re, ' ');
  }
  return v.replace(/\s+/g, ' ').trim();
}

interface Hit {
  start: number;
  end: number;
  kind: PredicateKind;
}

/** Find every predicate phrase in the question, left to right, non-overlapping. */
function scanPredicates(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const { re, kind } of PREDICATES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, kind });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  // Drop overlaps, keeping the earliest (and among ties, the longest) match.
  const kept: Hit[] = [];
  for (const hit of hits) {
    const last = kept[kept.length - 1];
    if (last && hit.start < last.end) continue;
    kept.push(hit);
  }
  return kept;
}

// --- aggregation detection ---------------------------------------------------

interface AggPattern {
  re: RegExp;
  kind: AggregationKind;
  scope?: 'current' | 'any';
}

const AGG_PATTERNS: AggPattern[] = [
  { re: /\b(?:which|what|top|list)\b[^?]*\b(?:companies|company|employers|organi[sz]ations|firms)\b/i, kind: 'companies' },
  { re: /\bwhere\s+do\b[^?]*\bwork\b/i, kind: 'companies' },
  { re: /\b(?:which|what|top|list)\b[^?]*\b(?:schools?|colleges?|universit(?:y|ies)|institutes?)\b/i, kind: 'schools' },
  { re: /\b(?:which|what|top|list)\b[^?]*\b(?:cities|city|locations?|places?|countries|regions?)\b/i, kind: 'locations' },
  { re: /\b(?:which|what|top|list)\b[^?]*\b(?:titles?|roles?|positions?|job\s+titles?)\b/i, kind: 'titles' },
  { re: /\b(?:which|what|top|list)\b[^?]*\bskills?\b/i, kind: 'skills' },
  { re: /\b(?:which|what|top|list)\b[^?]*\bindustr(?:y|ies)\b/i, kind: 'industries' },
];

function detectAggregation(text: string): Aggregation | null {
  for (const p of AGG_PATTERNS) {
    if (p.re.test(text)) {
      const limitMatch = text.match(/\btop\s+(\d{1,3})\b/i);
      const scope: 'current' | 'any' = /\bever\b|\banyone\s+who\s+has\b|\bpast\b/i.test(text)
        ? 'any'
        : 'current';
      return {
        kind: p.kind,
        scope: p.scope ?? scope,
        limit: limitMatch ? Number(limitMatch[1]) : 20,
      };
    }
  }
  return null;
}

// --- main entry --------------------------------------------------------------

export function parseQuestion(question: string, db: Database): ParsedQuery {
  const filters = emptyFilters();
  const interpretation: Interpretation[] = [];
  const unresolved: string[] = [];

  const original = question.trim();
  const text = original.toLowerCase().replace(/\s+/g, ' ');
  const aggregation = detectAggregation(text);

  // Relationship-strength and note constraints are position-independent.
  const strengthMatch = text.match(/\b(?:strength|rated|rating)\s*(?:of|>=|>|at\s+least)?\s*([1-5])\s*\+?/);
  if (strengthMatch) {
    filters.minStrength = Number(strengthMatch[1]);
    interpretation.push({ facet: 'Strength at least', values: [strengthMatch[1]] });
  }
  if (/\b(?:with|have|having)\s+(?:my\s+)?notes\b|\bi\s+(?:have\s+)?noted\b/.test(text)) {
    filters.hasNotes = true;
    interpretation.push({ facet: 'Has notes', values: ['yes'] });
  }
  const degreeMatch = text.match(/\b(?:(1st|first|2nd|second|3rd|third)[-\s]?degree)\b/);
  if (degreeMatch) {
    const d = /1st|first/.test(degreeMatch[1]) ? 1 : /2nd|second/.test(degreeMatch[1]) ? 2 : 3;
    filters.degrees.push(d);
    interpretation.push({ facet: 'Connection degree', values: [`${d}`] });
  }

  const hits = scanPredicates(text);

  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const next = hits[i + 1];
    const rawValue = text.slice(hit.end, next ? next.start : text.length);
    const value = stripValue(rawValue);
    if (!value) continue;
    applyPredicate(db, filters, interpretation, unresolved, hit.kind, value);
  }

  // Nothing structured came out of it — treat the whole thing as a search.
  let fellBackToSearch = false;
  if (isEmptyFilters(filters) && !aggregation) {
    const bare = stripValue(
      text
        .replace(/^\s*(?:who|whom|which|what|show\s+me|find|list|give\s+me)\b/, '')
        .replace(/\b(?:in\s+my\s+network|do\s+i\s+know|i\s+know|does|is|are|has|have)\b/g, ' '),
    );
    if (bare) {
      filters.q = bare;
      interpretation.push({ facet: 'Full-text search', values: [bare] });
      fellBackToSearch = true;
    }
  }

  return { filters, aggregation, interpretation, unresolved, fellBackToSearch };
}

function addInterp(list: Interpretation[], facet: string, values: string[]) {
  if (values.length === 0) return;
  const existing = list.find((i) => i.facet === facet);
  if (existing) existing.values.push(...values);
  else list.push({ facet, values });
}

function applyPredicate(
  db: Database,
  filters: Filters,
  interpretation: Interpretation[],
  unresolved: string[],
  kind: PredicateKind,
  value: string,
): void {
  switch (kind) {
    case 'current-company':
    case 'past-company':
    case 'any-company': {
      const companies = resolveCompanies(db, value);
      if (companies.length === 0) {
        unresolved.push(`company "${value}"`);
        // Still useful: fall back to full text so the answer is not empty.
        filters.q = [filters.q, value].filter(Boolean).join(' ');
        return;
      }
      const ids = companies.map((c) => c.id);
      const names = companies.map((c) => c.name);
      if (kind === 'current-company') {
        filters.currentCompanyIds.push(...ids);
        addInterp(interpretation, 'Currently at', names);
      } else if (kind === 'past-company') {
        filters.pastCompanyIds.push(...ids);
        addInterp(interpretation, 'Previously at', names);
      } else {
        filters.anyCompanyIds.push(...ids);
        addInterp(interpretation, 'Ever at', names);
      }
      return;
    }

    case 'school': {
      const schools = resolveSchools(db, value);
      if (schools.length === 0) {
        unresolved.push(`school "${value}"`);
        filters.q = [filters.q, value].filter(Boolean).join(' ');
        return;
      }
      filters.schoolIds.push(...schools.map((s) => s.id));
      addInterp(interpretation, 'Studied at', schools.map((s) => s.name));
      return;
    }

    case 'location':
      filters.locations.push(value);
      addInterp(interpretation, 'Location contains', [value]);
      return;

    case 'skill':
      filters.skills.push(value);
      addInterp(interpretation, 'Skill', [value]);
      return;

    case 'certification':
      filters.certifications.push(value);
      addInterp(interpretation, 'Certification', [value]);
      return;

    case 'volunteering':
      filters.volunteering.push(value);
      addInterp(interpretation, 'Volunteered at', [value]);
      return;

    case 'title':
      filters.title = filters.title ? `${filters.title} ${value}` : value;
      addInterp(interpretation, 'Title contains', [value]);
      return;

    case 'ambiguous-in': {
      // "works in <X>": X is most often a field ("works in AI"), sometimes a
      // city, and only occasionally an employer. So require an *exact* company
      // name here rather than the fuzzy resolution used for "works at X" —
      // otherwise a domain gets read as whichever company it resembles.
      const exactKey = companyKey(value);
      const companies = db.companies.filter((c) => c.nameKey === exactKey);
      if (companies.length > 0) {
        filters.currentCompanyIds.push(...companies.map((c) => c.id));
        addInterp(interpretation, 'Currently at', companies.map((c) => c.name));
        return;
      }
      const knownLocation = db.people.some((p) =>
        wordPrefixMatch(normalizeKey(p.location), normalizeKey(value)),
      );
      if (knownLocation) {
        filters.locations.push(value);
        addInterp(interpretation, 'Location contains', [value]);
        return;
      }
      // Treat as a domain/field: match anywhere in the profile.
      filters.q = [filters.q, value].filter(Boolean).join(' ');
      addInterp(interpretation, 'Mentions', [value]);
      return;
    }

    default:
      return;
  }
}

/** Questions offered as one-click examples on the Ask page. */
export const EXAMPLE_QUESTIONS = [
  'Who in my network works at Google?',
  'Who previously worked at McKinsey?',
  'Which companies have the most people I know?',
  'Who went to IIT and works in AI?',
  'Who lives in Bengaluru?',
  'Who knows machine learning?',
  'Which schools show up most in my network?',
  'Who is a product manager?',
];
