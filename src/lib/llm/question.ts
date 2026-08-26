import type { Database } from '../types';
import { resolveCompanies, resolveSchools } from '../derive';
import { emptyFilters, type Filters } from '../query/filters';
import type { Aggregation, AggregationKind, Interpretation, ParsedQuery } from '../query/nl';
import { chatJson, LlmError } from './azure';

// ---------------------------------------------------------------------------
// LLM-assisted question understanding.
//
// Privacy boundary, deliberately drawn tight: the *only* thing sent to Azure is
// the question text the user typed. No names, employers, emails or any other
// part of the network is included in the prompt.
//
// The model's job is purely linguistic — turn a sentence into a structured
// intent naming entities in plain text. Resolving those names against the
// actual graph stays local and deterministic, reusing the same resolvers the
// rule-based parser uses. So the LLM improves language coverage without
// becoming a source of truth about the data.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You translate questions about a personal professional network into a JSON query.

You never see the network. Emit the entity names exactly as the user wrote them; they are resolved elsewhere. Do not invent names, do not expand acronyms, do not guess employers.

Return ONLY a JSON object with these keys (omit or use null/[] when not applicable):

{
  "currentCompany": [],   // employers the person works at NOW ("works at X", "is at X")
  "pastCompany": [],      // employers they have LEFT ("used to work at X", "ex-X", "previously at X")
  "anyCompany": [],       // employer at any time ("ever worked at X")
  "school": [],           // schools/colleges/universities ("went to X", "studied at X")
  "location": [],         // places to live/be based in
  "title": "",            // job-title words to match, e.g. "product manager"
  "skills": [],
  "certifications": [],
  "volunteering": [],     // volunteering organizations
  "industries": [],
  "degrees": [],          // connection degree numbers: 1 = direct connection, 2, 3
  "minStrength": null,    // 1-5, the user's own private relationship rating
  "hasNotes": false,      // true when they ask about people they have notes on
  "freeText": "",         // domain/topic words with no better home, e.g. "AI" in "works in AI"
  "rankBy": null,         // "companies"|"schools"|"locations"|"titles"|"skills"|"industries" for
                          // "which X has the most people" questions; otherwise null
  "rankScope": "current", // "current" or "any" (use "any" for "ever worked at")
  "limit": 20,
  "reading": ""           // one short clause describing how you read the question
}

Rules:
- A domain or field of work ("AI", "fintech", "robotics") goes in freeText, NOT currentCompany.
- "works in London" is a location; "works in AI" is freeText. Judge by whether it is a place.
- Past tense or "ex-"/"former" means pastCompany, never currentCompany.
- Ranking questions ("which companies have the most people I know") set rankBy and may also carry filters.
- Keep title to the role words only, without "who is a".

Connection degree in this dataset:
- 1 means a confirmed direct connection.
- 2 means an invitation was sent or received but the connection was never made.
  So "who did I invite but never connected with" is degrees: [2].
- Do not set minStrength unless the user mentions a rating, closeness, or how
  well they know someone. It is their own 1-5 score, not a relevance measure.`;

/* eslint-disable @typescript-eslint/no-explicit-any */

function strArray(value: any): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function str(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

const RANK_KINDS: AggregationKind[] = [
  'companies', 'schools', 'locations', 'titles', 'skills', 'industries',
];

function addInterp(list: Interpretation[], facet: string, values: string[]) {
  if (values.length === 0) return;
  const existing = list.find((i) => i.facet === facet);
  if (existing) existing.values.push(...values);
  else list.push({ facet, values });
}

/**
 * Turn the model's intent into the same ParsedQuery shape the rule-based
 * parser produces, resolving every entity name locally.
 */
function buildParsed(intent: any, db: Database): ParsedQuery {
  const filters: Filters = emptyFilters();
  const interpretation: Interpretation[] = [];
  const unresolved: string[] = [];

  const companyFacets: [string, keyof Filters, string][] = [
    ['currentCompany', 'currentCompanyIds', 'Currently at'],
    ['pastCompany', 'pastCompanyIds', 'Previously at'],
    ['anyCompany', 'anyCompanyIds', 'Ever at'],
  ];

  for (const [key, target, label] of companyFacets) {
    for (const name of strArray(intent?.[key])) {
      const hits = resolveCompanies(db, name);
      if (hits.length === 0) {
        unresolved.push(`company "${name}"`);
        // Keep the answer useful rather than empty.
        filters.q = [filters.q, name].filter(Boolean).join(' ');
        continue;
      }
      (filters[target] as string[]).push(...hits.map((c) => c.id));
      addInterp(interpretation, label, hits.map((c) => c.name));
    }
  }

  for (const name of strArray(intent?.school)) {
    const hits = resolveSchools(db, name);
    if (hits.length === 0) {
      unresolved.push(`school "${name}"`);
      filters.q = [filters.q, name].filter(Boolean).join(' ');
      continue;
    }
    filters.schoolIds.push(...hits.map((s) => s.id));
    addInterp(interpretation, 'Studied at', hits.map((s) => s.name));
  }

  const plain: [string, keyof Filters, string][] = [
    ['location', 'locations', 'Location contains'],
    ['skills', 'skills', 'Skill'],
    ['certifications', 'certifications', 'Certification'],
    ['volunteering', 'volunteering', 'Volunteered at'],
    ['industries', 'industries', 'Industry'],
  ];
  for (const [key, target, label] of plain) {
    const values = strArray(intent?.[key]);
    if (values.length === 0) continue;
    (filters[target] as string[]).push(...values);
    addInterp(interpretation, label, values);
  }

  const title = str(intent?.title);
  if (title) {
    filters.title = title;
    addInterp(interpretation, 'Title contains', [title]);
  }

  const freeText = str(intent?.freeText);
  if (freeText) {
    filters.q = [filters.q, freeText].filter(Boolean).join(' ');
    addInterp(interpretation, 'Mentions', [freeText]);
  }

  const degrees = (Array.isArray(intent?.degrees) ? intent.degrees : [])
    .map((d: any) => Number(d))
    .filter((d: number) => d === 1 || d === 2 || d === 3);
  if (degrees.length > 0) {
    filters.degrees = degrees;
    addInterp(interpretation, 'Connection degree', degrees.map(String));
  }

  const minStrength = Number(intent?.minStrength);
  if (Number.isFinite(minStrength) && minStrength >= 1 && minStrength <= 5) {
    filters.minStrength = Math.round(minStrength);
    addInterp(interpretation, 'Strength at least', [String(filters.minStrength)]);
  }
  if (intent?.hasNotes === true) {
    filters.hasNotes = true;
    addInterp(interpretation, 'Has notes', ['yes']);
  }

  let aggregation: Aggregation | null = null;
  const rankBy = str(intent?.rankBy) as AggregationKind;
  if (RANK_KINDS.includes(rankBy)) {
    const limit = Number(intent?.limit);
    aggregation = {
      kind: rankBy,
      scope: str(intent?.rankScope) === 'any' ? 'any' : 'current',
      limit: Number.isFinite(limit) && limit > 0 && limit <= 200 ? Math.round(limit) : 20,
    };
  }

  return {
    filters,
    aggregation,
    interpretation,
    unresolved,
    fellBackToSearch: !!freeText && interpretation.length === 1,
  };
}

export interface LlmParseResult {
  parsed: ParsedQuery;
  /** The model's own one-line description of how it read the question. */
  reading: string;
}

/**
 * The asker's own affiliations, so possessive questions resolve — "my old
 * college", "people at my company", "folks from my school".
 *
 * This is the only data added to the prompt, and it is the user's own profile:
 * their schools and employers. No connection of theirs is ever included.
 */
function selfContext(db: Database): string | null {
  const self = db.self;
  if (!self) return null;

  const schools = self.education
    .map((e) => e.schoolName)
    .filter((s): s is string => !!s);
  const current = self.positions
    .filter((p) => p.isCurrent && p.companyName)
    .map((p) => p.companyName as string);
  const past = self.positions
    .filter((p) => !p.isCurrent && p.companyName)
    .map((p) => p.companyName as string);

  const lines: string[] = [];
  if (schools.length) lines.push(`Their schools: ${[...new Set(schools)].join('; ')}`);
  if (current.length) lines.push(`Where they work now: ${[...new Set(current)].join('; ')}`);
  if (past.length) lines.push(`Where they worked before: ${[...new Set(past)].join('; ')}`);
  if (self.location) lines.push(`Where they are based: ${self.location}`);
  if (lines.length === 0) return null;

  return [
    'Context about the person asking, for resolving possessives like "my college"',
    'or "my company". Use these names when the question refers to their own',
    'affiliations; otherwise ignore this block.',
    ...lines,
  ].join('\n');
}

/** Parse a question with the LLM. Throws LlmError on any failure. */
export async function parseQuestionWithLlm(
  question: string,
  db: Database,
): Promise<LlmParseResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new LlmError('Empty question.');

  const context = selfContext(db);
  const system = context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT;

  const intent = await chatJson([
    { role: 'system', content: system },
    { role: 'user', content: trimmed },
  ]);

  if (!intent || typeof intent !== 'object') {
    throw new LlmError('Model returned an unexpected shape.');
  }

  return {
    parsed: buildParsed(intent, db),
    reading: str((intent as any).reading),
  };
}
