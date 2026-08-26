import type {
  Company,
  CompanyRelation,
  Database,
  Evidence,
} from '../types';
import { companyKey, newId, slugId } from '../normalize';
import { currentCompanyIds, pastCompanyIds } from '../derive';
import { linkParent, mergeCompanies } from '../resolution';
import { searchCompany, activeProvider } from '../web/search';
import { chatJson, isConfigured, LlmError } from './azure';

// ---------------------------------------------------------------------------
// Company entity resolution with an LLM adjudicating web evidence.
//
// Three stages, in this order for a reason:
//
//  1. Block locally. Comparing all 553 companies pairwise would be 150k
//     comparisons and a huge prompt. Cheap string signals (shared tokens,
//     compact-prefix, edit distance) narrow it to a few dozen small clusters,
//     which is also what keeps each prompt focused enough to reason well.
//
//  2. Ground each cluster on the web. The model's own knowledge is demonstrably
//     insufficient and partly stale for exactly the companies that matter here,
//     so relationships must come from retrieved text with a citation.
//
//  3. Adjudicate. The model decides same-entity vs corporate-relative, which is
//     the judgement string similarity cannot make: "Jio" and "JioHotstar" look
//     alike but are different workplaces, while "Infocom" and "Infocomm" look
//     different by one letter and are the same company.
// ---------------------------------------------------------------------------

const CLUSTER_LIMIT = 40;
const CONCURRENCY = 5;
const MAX_CLUSTER_SIZE = 15;

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- stage 1: local blocking ------------------------------------------------

interface Candidate {
  company: Company;
  key: string;
  compact: string;
  tokens: string[];
  headcount: number;
}

function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  // Classic DP, bailing out once the best possible score exceeds max.
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return false;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length] <= max;
}

/**
 * Words that say nothing about identity. Without this list, "Solutions",
 * "Services" and "Technologies" chain hundreds of unrelated companies into one
 * cluster — the transitive closure of a generic word is the whole database.
 */
const GENERIC_TOKENS = new Set([
  'solution', 'solutions', 'service', 'services', 'system', 'systems',
  'consulting', 'consultancy', 'consultants', 'digital', 'data', 'tech',
  'technologies', 'technology', 'software', 'global', 'international',
  'india', 'indian', 'institute', 'institutes', 'university', 'college',
  'school', 'academy', 'labs', 'laboratory', 'laboratories', 'bank',
  'finance', 'financial', 'insurance', 'media', 'marketing', 'research',
  'development', 'engineering', 'enterprise', 'enterprises', 'industries',
  'ventures', 'partners', 'capital', 'health', 'healthcare', 'information',
  'computer', 'computers', 'network', 'networks', 'infotech', 'projects',
  'management', 'business', 'foundation', 'centre', 'center', 'national',
  'science', 'sciences', 'corporation', 'company', 'private', 'limited',
  'group', 'holdings', 'world', 'first', 'best', 'top', 'pvt', 'ltd',
  'inc', 'llc', 'llp', 'studio', 'works', 'hub', 'official',
  // Generic modifiers and place-ish words that group unrelated organizations.
  'general', 'central', 'north', 'south', 'east', 'west', 'city', 'state',
  'valley', 'park', 'point', 'prime', 'smart', 'next', 'open', 'cloud',
  'mobile', 'online', 'college', 'hospital', 'medical', 'summer', 'code',
]);

interface BlockingContext {
  /** How many companies contain each token. Common tokens carry no signal. */
  documentFrequency: Map<string, number>;
  /** Compact keys that are themselves a whole company name. */
  wholeNames: Set<string>;
}

/** A token is distinctive only if it is specific and genuinely rare. */
function isDistinctive(token: string, ctx: BlockingContext): boolean {
  if (token.length < 4) return false;
  if (GENERIC_TOKENS.has(token)) return false;
  return (ctx.documentFrequency.get(token) ?? 0) <= 8;
}

/** Should these two be shown to the model together? */
function related(a: Candidate, b: Candidate, ctx: BlockingContext): boolean {
  const shorter = a.compact.length <= b.compact.length ? a.compact : b.compact;
  const longer = a.compact.length <= b.compact.length ? b.compact : a.compact;

  // Brand prefix, but only when the prefix is itself a company in the network.
  // "Jio" is a real employer here, so it may claim "JioStar"/"JioHotstar";
  // a bare fragment like "ind" or "sol" may not claim anything.
  if (
    shorter.length >= 3 &&
    longer !== shorter &&
    longer.startsWith(shorter) &&
    ctx.wholeNames.has(shorter)
  ) {
    return true;
  }

  // A rare shared word: "reliance jio infocom" / "reliance industries".
  if (a.tokens.some((t) => isDistinctive(t, ctx) && b.tokens.includes(t))) return true;

  // Near-identical spellings: "infocom" / "infocomm".
  if (
    shorter.length >= 6 &&
    editDistanceWithin(a.compact, b.compact, a.compact.length > 12 ? 2 : 1)
  ) {
    return true;
  }
  return false;
}

export interface Cluster {
  companies: Company[];
  headcount: number;
  /** Members dropped by the size cap, if any. */
  truncated: number;
}

/**
 * Whether two names are demonstrably the same entity from the strings alone.
 *
 * This matters because web evidence is not always available — Wikipedia has no
 * article for a local university campus — yet "D Y Patil ... Akrudi, Pune" and
 * "D Y Patil ... Akurdi, Pune" differ by one transposed letter and obviously
 * denote one place. Requiring a citation for cases like that would leave
 * unambiguous typos sitting in a review queue forever.
 *
 * Kept deliberately strict: it proves *spelling* identity, never corporate
 * relationship. "Jio" and "JioStar" can never satisfy it.
 */
export function locallyProvableSameEntity(a: Company, b: Company): boolean {
  const ka = a.nameKey.replace(/ /g, '');
  const kb = b.nameKey.replace(/ /g, '');
  if (!ka || !kb) return false;

  // Identical once spacing and punctuation are normalized away.
  if (ka === kb) return true;

  // One is the other plus a trailing number ("... Pune 44").
  const stripTrailingDigits = (s: string) => s.replace(/\d+$/, '');
  if (
    stripTrailingDigits(ka) === stripTrailingDigits(kb) &&
    Math.min(ka.length, kb.length) >= 8
  ) {
    return true;
  }

  // A typo in a long name. Short names are excluded: at 6 characters an edit
  // distance of 1 separates real, different companies.
  const shorter = Math.min(ka.length, kb.length);
  if (shorter >= 12 && editDistanceWithin(ka, kb, 2)) return true;
  if (shorter >= 8 && editDistanceWithin(ka, kb, 1)) return true;

  return false;
}

/** Group companies that plausibly relate to each other. */
export function buildClusters(db: Database): Cluster[] {
  const counts = new Map<string, number>();
  for (const person of db.people) {
    for (const id of currentCompanyIds(person)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of pastCompanyIds(person)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const candidates: Candidate[] = db.companies.map((company) => {
    const key = company.nameKey;
    return {
      company,
      key,
      compact: key.replace(/ /g, ''),
      tokens: key.split(' ').filter(Boolean),
      headcount: counts.get(company.id) ?? 0,
    };
  });

  // Union-find over the relation above.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let walk = id;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) ?? root;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const union = (x: string, y: string) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const c of candidates) parent.set(c.company.id, c.company.id);

  // Document frequency and whole-name index drive the distinctiveness tests.
  const documentFrequency = new Map<string, number>();
  for (const c of candidates) {
    for (const token of new Set(c.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const ctx: BlockingContext = {
    documentFrequency,
    wholeNames: new Set(candidates.map((c) => c.compact)),
  };

  // Bucket by first three characters so this is not fully quadratic, then also
  // compare within shared distinctive tokens to catch differing prefixes.
  const byPrefix = new Map<string, Candidate[]>();
  const byToken = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const p = c.compact.slice(0, 3);
    (byPrefix.get(p) ?? byPrefix.set(p, []).get(p)!).push(c);
    for (const token of c.tokens) {
      if (!isDistinctive(token, ctx)) continue;
      (byToken.get(token) ?? byToken.set(token, []).get(token)!).push(c);
    }
  }
  const buckets = [...byPrefix.values(), ...byToken.values()];
  for (const bucket of buckets) {
    if (bucket.length < 2 || bucket.length > 60) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (related(bucket[i], bucket[j], ctx)) {
          union(bucket[i].company.id, bucket[j].company.id);
        }
      }
    }
  }

  const grouped = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const root = find(c.company.id);
    (grouped.get(root) ?? grouped.set(root, []).get(root)!).push(c);
  }

  return [...grouped.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const sorted = members.sort((a, b) => b.headcount - a.headcount);
      // Defensive cap. A cluster this large means blocking has over-grouped;
      // keep the most significant members rather than sending a huge prompt
      // that the model would reason poorly over anyway.
      const kept = sorted.slice(0, MAX_CLUSTER_SIZE);
      return {
        companies: kept.map((m) => m.company),
        headcount: kept.reduce((sum, m) => sum + m.headcount, 0),
        truncated: sorted.length - kept.length,
      };
    })
    .sort((a, b) => b.headcount - a.headcount);
}

// --- stage 2 + 3: ground and adjudicate -------------------------------------

const SYSTEM_PROMPT = `You resolve company identity for a professional-network database.

You are given a group of company names that look similar, each with how many people in the network work there, plus web evidence retrieved for them.

Decide, for each pair that warrants it, whether they are:
  (a) THE SAME company written differently -> a "merge"
  (b) DIFFERENT companies in one corporate group -> a "parent" link
  (c) unrelated -> say nothing about them

This distinction matters enormously and is the main thing you are here to get right:
- "Reliance Jio Infocom Limited" and "Reliance Jio Infocomm Ltd" are the SAME company (spelling variant) -> merge.
- "Google" and "Google LLC" are the SAME company -> merge.
- "Jio" and "JioHotstar" are DIFFERENT workplaces in the same group -> parent link, NEVER merge. Merging would destroy the information that someone works at JioHotstar specifically.
- A subsidiary is never a merge, however similar the name looks.

Ground every claim in the supplied evidence. If the evidence does not establish a relationship, give it a low confidence or omit it. Do not rely on memory for corporate structure; ownership changes and your training data may be stale. Never invent an evidence URL.

Return ONLY this JSON:
{
  "merges": [
    {"duplicate":"<exact name from the list>","canonical":"<exact name from the list>",
     "confidence":0.0,"reasoning":"one clause","evidenceUrls":["..."]}
  ],
  "parents": [
    {"child":"<exact name from the list>","parent":"<company name>","relation":"subsidiary|brand|division|joint-venture|rebrand|affiliate",
     "confidence":0.0,"reasoning":"one clause","evidenceUrls":["..."]}
  ]
}

Rules:
- "duplicate" and "canonical" MUST both be names from the provided list. Prefer the cleaner, more common form as canonical, and the one with more people if equal.
- "child" MUST be a name from the provided list. "parent" may be a company not in the list (a holding company) if the evidence names one.
- Do not propose both a merge and a parent link for the same pair.
- Do not propose a parent link from a company to itself or create circular ownership.
- confidence is 0..1 and should reflect the evidence, not how similar the names look.

SIBLINGS — important. Two companies sharing a brand are often siblings under a
common parent, not parent and child of each other. When that is the case, emit a
parent link for EACH of them naming the shared parent. Do not chain one under
the other just because they were listed together.
  Correct:   Tata Consultancy Services -> Tata Sons,  Tata Technologies -> Tata Motors
  Wrong:     Tata Consultancy Services -> Tata Technologies
Only link A under B when the evidence says B actually owns or contains A.`;

interface RawDecision {
  merges?: any[];
  parents?: any[];
}

function evidenceFor(urls: any, pool: Evidence[]): Evidence[] {
  if (!Array.isArray(urls)) return [];
  const wanted = new Set(urls.filter((u) => typeof u === 'string'));
  // Only ever return evidence we actually retrieved, so a hallucinated URL
  // cannot masquerade as a citation.
  return pool.filter((e) => wanted.has(e.url));
}

const RELATIONS: CompanyRelation[] = [
  'subsidiary', 'brand', 'division', 'joint-venture', 'rebrand', 'affiliate',
];

export interface AnalyzeOptions {
  /** How many clusters to examine, largest first. */
  maxClusters?: number;
  /** Skip web lookups (uses model knowledge only — much less reliable). */
  skipWeb?: boolean;
  /** Confidence at or above which a merge is applied without review. */
  mergeThreshold?: number;
  /** Confidence at or above which a parent link is applied without review. */
  parentThreshold?: number;
  /** Propose only; apply nothing automatically. */
  dryRun?: boolean;
  /** Skip the cross-cluster root reconciliation pass. */
  skipRoots?: boolean;
  /** How many group roots to reconcile. */
  maxRoots?: number;
}

export interface AnalyzeReport {
  provider: string;
  clustersExamined: number;
  clustersTotal: number;
  appliedMerges: string[];
  appliedParents: string[];
  queued: number;
  skipped: string[];
  errors: string[];
}

/** Run `tasks` with bounded concurrency, preserving order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Analyze company names, applying confident conclusions and queueing the rest.
 * Mutates `db`; the caller saves.
 */
export async function analyzeCompanies(
  db: Database,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeReport> {
  if (!isConfigured()) throw new LlmError('Azure OpenAI is not configured.');

  const mergeThreshold = opts.mergeThreshold ?? 0.9;
  const parentThreshold = opts.parentThreshold ?? 0.75;

  const allClusters = buildClusters(db);
  const clusters = allClusters.slice(0, opts.maxClusters ?? CLUSTER_LIMIT);

  const report: AnalyzeReport = {
    provider: opts.skipWeb ? 'none (model knowledge only)' : activeProvider(),
    clustersExamined: clusters.length,
    clustersTotal: allClusters.length,
    appliedMerges: [],
    appliedParents: [],
    queued: 0,
    skipped: [],
    errors: [],
  };
  if (allClusters.length > clusters.length) {
    report.skipped.push(
      `${allClusters.length - clusters.length} smaller clusters not examined this run`,
    );
  }

  // Ground and adjudicate each cluster. Concurrency is bounded so a large run
  // does not open hundreds of sockets at once.
  const decisions = await pool(clusters, CONCURRENCY, async (cluster) => {
    const evidence: Evidence[] = [];
    if (!opts.skipWeb) {
      // Look up the most significant names; the tail is rarely informative.
      for (const company of cluster.companies.slice(0, 6)) {
        evidence.push(...(await searchCompany(company.name, 2)));
      }
    }

    const listing = cluster.companies
      .map((c) => {
        const n = db.people.filter(
          (p) => currentCompanyIds(p).includes(c.id) || pastCompanyIds(p).includes(c.id),
        ).length;
        const aliases = c.aliases.filter((a) => a !== c.name);
        return `- ${c.name} (${n} ${n === 1 ? 'person' : 'people'})${
          aliases.length ? ` [also seen as: ${aliases.join('; ')}]` : ''
        }`;
      })
      .join('\n');

    const evidenceBlock = evidence.length
      ? evidence
          .map((e, i) => `[${i + 1}] ${e.title} <${e.url}>\n${e.snippet}`)
          .join('\n\n')
      : '(no web evidence retrieved)';

    try {
      const raw = (await chatJson(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Company names:\n${listing}\n\nWeb evidence:\n${evidenceBlock}`,
          },
        ],
        { maxTokens: 1200, timeoutMs: 30_000 },
      )) as RawDecision;
      return { cluster, evidence, raw, error: null as string | null };
    } catch (err) {
      return { cluster, evidence, raw: null, error: (err as Error).message };
    }
  });

  const now = new Date().toISOString();

  for (const { cluster, evidence, raw, error } of decisions) {
    if (error) {
      report.errors.push(`${cluster.companies[0]?.name ?? 'cluster'}: ${error}`);
      continue;
    }
    if (!raw) continue;

    const byName = new Map<string, Company>();
    for (const c of cluster.companies) byName.set(c.name.toLowerCase(), c);

    // --- merges ---
    for (const m of Array.isArray(raw.merges) ? raw.merges : []) {
      const duplicate = byName.get(String(m?.duplicate ?? '').toLowerCase());
      const canonical = byName.get(String(m?.canonical ?? '').toLowerCase());
      const confidence = Number(m?.confidence);
      if (!duplicate || !canonical || duplicate.id === canonical.id) continue;
      if (!Number.isFinite(confidence)) continue;

      const cited = evidenceFor(m?.evidenceUrls, evidence);
      const reasoning = String(m?.reasoning ?? '').slice(0, 400);
      // A merge is destructive, so it needs high confidence plus proof —
      // either a citation, or names close enough that the strings prove it.
      const proven = cited.length > 0 || locallyProvableSameEntity(duplicate, canonical);
      const auto = !opts.dryRun && confidence >= mergeThreshold && proven;

      if (auto) {
        const result = mergeCompanies(db, duplicate.id, canonical.id, {
          source: 'llm',
          confidence,
          reasoning,
          evidence: cited,
          auto: true,
        });
        if (result.ok) {
          report.appliedMerges.push(`${duplicate.name} → ${canonical.name}`);
          byName.delete(duplicate.name.toLowerCase());
        } else {
          report.errors.push(result.error ?? 'merge failed');
        }
      } else {
        db.resolution.proposals.push({
          id: newId('pp'),
          kind: 'merge',
          companyIds: [duplicate.id, canonical.id],
          names: [duplicate.name, canonical.name],
          relation: null,
          confidence,
          reasoning,
          evidence: cited,
          createdAt: now,
          status: 'pending',
        });
        report.queued += 1;
      }
    }

    // --- parent links ---
    for (const p of Array.isArray(raw.parents) ? raw.parents : []) {
      const child = byName.get(String(p?.child ?? '').toLowerCase());
      let parentName = String(p?.parent ?? '').trim();
      const confidence = Number(p?.confidence);
      if (!child || !parentName || !Number.isFinite(confidence)) continue;

      // The model may name the parent using a surface form we have already
      // folded into an alias ("Jio Platforms Limited (JPL)"). Prefer the
      // canonical name so proposals read consistently.
      const namedKey = companyKey(parentName);
      const namedCompany = db.companies.find((c) => c.nameKey === namedKey);
      if (namedCompany) parentName = namedCompany.name;

      const relation = RELATIONS.includes(p?.relation) ? (p.relation as CompanyRelation) : 'affiliate';
      const cited = evidenceFor(p?.evidenceUrls, evidence);
      const reasoning = String(p?.reasoning ?? '').slice(0, 400);

      // The named parent may not be an employer anyone in the network works at.
      const parentKey = companyKey(parentName);
      if (!parentKey || parentKey === child.nameKey) continue;
      let parentCompany = db.companies.find((c) => c.nameKey === parentKey);

      const auto = !opts.dryRun && confidence >= parentThreshold && cited.length > 0;
      if (!auto) {
        db.resolution.proposals.push({
          id: newId('pp'),
          kind: 'parent',
          companyIds: [child.id, parentCompany?.id ?? ''],
          names: [child.name, parentName],
          relation,
          confidence,
          reasoning,
          evidence: cited,
          createdAt: now,
          status: 'pending',
        });
        report.queued += 1;
        continue;
      }

      if (!parentCompany) {
        // Create a holding-company node so the hierarchy can be expressed.
        // Marked synthetic: it is not a workplace, just a group root.
        parentCompany = {
          id: slugId('co', parentKey),
          name: parentName,
          nameKey: parentKey,
          aliases: [parentName],
          industry: null,
          website: null,
          parentId: null,
          relationToParent: null,
          synthetic: true,
          sourceBatchIds: [],
          firstSeenAt: now,
          lastUpdatedAt: now,
        };
        db.companies.push(parentCompany);
      }

      const result = linkParent(db, child.id, parentCompany.id, relation, {
        source: 'llm',
        confidence,
        reasoning,
        evidence: cited,
        auto: true,
      });
      if (result.ok) {
        report.appliedParents.push(`${child.name} → ${parentCompany.name} (${relation})`);
      } else {
        report.errors.push(result.error ?? 'parent link failed');
      }
    }
  }

  if (!opts.skipRoots) {
    await reconcileRoots(db, opts, report);
  }

  db.resolution.lastAnalyzedAt = now;
  return report;
}

const ROOTS_SYSTEM_PROMPT = `For each company listed, name its ultimate corporate parent, using only the supplied web evidence.

Most companies are independent and have no parent — say so rather than inventing one. Only name a parent when the evidence states that the company is owned by, a subsidiary of, or part of another company.

Return ONLY this JSON:
{
  "results": [
    {"company":"<exact name from the list>","parent":"<parent company name, or null>",
     "relation":"subsidiary|brand|division|joint-venture|rebrand|affiliate",
     "confidence":0.0,"reasoning":"one clause","evidenceUrls":["..."]}
  ]
}

Rules:
- parent must be null when the company is independent, is itself the top-level holding company, or the evidence does not say.
- Name the immediate parent, not a distant grandparent, when the evidence distinguishes them.
- Never name a company as its own parent.
- Never invent an evidence URL.`;

/**
 * Second pass: link the tops of separate groups to each other.
 *
 * Clustering necessarily isolates families — "Jio Platforms" and "Reliance
 * Industries" fall into different clusters because they share no distinctive
 * token, so the per-cluster pass can never discover that one owns the other.
 * This pass looks at group roots and significant unparented companies and asks
 * specifically what sits above them.
 */
async function reconcileRoots(
  db: Database,
  opts: AnalyzeOptions,
  report: AnalyzeReport,
): Promise<void> {
  const headcount = new Map<string, number>();
  for (const person of db.people) {
    for (const id of currentCompanyIds(person)) {
      headcount.set(id, (headcount.get(id) ?? 0) + 1);
    }
  }

  const hasChildren = new Set(
    db.companies.filter((c) => c.parentId).map((c) => c.parentId as string),
  );
  const candidates = db.companies
    .filter((c) => !c.parentId)
    .filter((c) => hasChildren.has(c.id) || (headcount.get(c.id) ?? 0) >= 5)
    .sort((a, b) => (headcount.get(b.id) ?? 0) - (headcount.get(a.id) ?? 0))
    .slice(0, opts.maxRoots ?? 24);

  if (candidates.length === 0) return;

  const BATCH = 6;
  const batches: Company[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    batches.push(candidates.slice(i, i + BATCH));
  }

  const parentThreshold = opts.parentThreshold ?? 0.75;

  const outcomes = await pool(batches, CONCURRENCY, async (batch) => {
    const evidence: Evidence[] = [];
    if (!opts.skipWeb) {
      for (const company of batch) {
        evidence.push(...(await searchCompany(company.name, 2)));
      }
    }
    const listing = batch.map((c) => `- ${c.name}`).join('\n');
    const evidenceBlock = evidence.length
      ? evidence.map((e, i) => `[${i + 1}] ${e.title} <${e.url}>\n${e.snippet}`).join('\n\n')
      : '(no web evidence retrieved)';

    try {
      const raw = (await chatJson(
        [
          { role: 'system', content: ROOTS_SYSTEM_PROMPT },
          { role: 'user', content: `Companies:\n${listing}\n\nWeb evidence:\n${evidenceBlock}` },
        ],
        { maxTokens: 1200, timeoutMs: 30_000 },
      )) as { results?: any[] };
      return { batch, evidence, raw, error: null as string | null };
    } catch (err) {
      return { batch, evidence, raw: null, error: (err as Error).message };
    }
  });

  const now = new Date().toISOString();

  for (const { batch, evidence, raw, error } of outcomes) {
    if (error) {
      report.errors.push(`root pass: ${error}`);
      continue;
    }
    const byName = new Map(batch.map((c) => [c.name.toLowerCase(), c]));

    for (const r of Array.isArray(raw?.results) ? raw!.results! : []) {
      const child = byName.get(String(r?.company ?? '').toLowerCase());
      const rawParent = r?.parent;
      if (!child) continue;
      // Independent companies are the common case and the correct answer.
      if (rawParent === null || rawParent === undefined || rawParent === '') continue;

      let parentName = String(rawParent).trim();
      if (!parentName || /^(none|null|independent|n\/a)$/i.test(parentName)) continue;

      const confidence = Number(r?.confidence);
      if (!Number.isFinite(confidence)) continue;

      const parentKey = companyKey(parentName);
      if (!parentKey || parentKey === child.nameKey) continue;

      let parentCompany = db.companies.find((c) => c.nameKey === parentKey);
      if (parentCompany) parentName = parentCompany.name;

      const relation = RELATIONS.includes(r?.relation)
        ? (r.relation as CompanyRelation)
        : 'subsidiary';
      const cited = evidenceFor(r?.evidenceUrls, evidence);
      const reasoning = String(r?.reasoning ?? '').slice(0, 400);

      const auto = !opts.dryRun && confidence >= parentThreshold && cited.length > 0;
      if (!auto) {
        db.resolution.proposals.push({
          id: newId('pp'),
          kind: 'parent',
          companyIds: [child.id, parentCompany?.id ?? ''],
          names: [child.name, parentName],
          relation,
          confidence,
          reasoning,
          evidence: cited,
          createdAt: now,
          status: 'pending',
        });
        report.queued += 1;
        continue;
      }

      if (!parentCompany) {
        parentCompany = {
          id: slugId('co', parentKey),
          name: parentName,
          nameKey: parentKey,
          aliases: [parentName],
          industry: null,
          website: null,
          parentId: null,
          relationToParent: null,
          synthetic: true,
          sourceBatchIds: [],
          firstSeenAt: now,
          lastUpdatedAt: now,
        };
        db.companies.push(parentCompany);
      }

      const result = linkParent(db, child.id, parentCompany.id, relation, {
        source: 'llm',
        confidence,
        reasoning,
        evidence: cited,
        auto: true,
      });
      if (result.ok) {
        report.appliedParents.push(`${child.name} → ${parentCompany.name} (${relation})`);
      } else if (result.error && !result.error.includes('cycle')) {
        report.errors.push(result.error);
      }
    }
  }
}
