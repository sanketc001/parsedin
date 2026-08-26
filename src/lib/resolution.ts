import type {
  AliasRule,
  Company,
  CompanyRelation,
  Database,
  Evidence,
  ParentRule,
  ResolutionSource,
  UndoRecord,
} from './types';
import { newId } from './normalize';
import { uniq } from './normalize';

// ---------------------------------------------------------------------------
// Company resolution: merging duplicates and recording corporate hierarchy.
//
// Two distinct operations, deliberately not conflated:
//
//   mergeCompanies  — for the *same* company written differently ("Reliance Jio
//                     Infocom Limited" vs "Reliance Jio Infocomm Ltd"). Rewrites
//                     references and absorbs the duplicate. Destructive.
//
//   linkParent      — for genuinely different companies in one corporate group
//                     (JioHotstar under JioStar under Reliance). Adds a link and
//                     changes nothing else, so "who works at JioHotstar" still
//                     answers 8 while the group rolls up to 88.
//
// Every applied action writes an UndoRecord capturing exactly what changed,
// which is what makes automatic application of high-confidence results safe.
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  source: ResolutionSource;
  confidence?: number | null;
  reasoning?: string | null;
  evidence?: Evidence[];
  auto?: boolean;
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  undo?: UndoRecord;
}

/**
 * Fold `duplicate` into `canonical`. People and positions pointing at the
 * duplicate are rewritten, its surface forms become aliases of the canonical
 * company, and an alias rule is recorded so future imports resolve directly.
 */
export function mergeCompanies(
  db: Database,
  duplicateId: string,
  canonicalId: string,
  opts: ApplyOptions,
): ApplyResult {
  if (duplicateId === canonicalId) {
    return { ok: false, error: 'A company cannot be merged into itself.' };
  }
  const duplicate = db.companies.find((c) => c.id === duplicateId);
  const canonical = db.companies.find((c) => c.id === canonicalId);
  if (!duplicate) return { ok: false, error: `Unknown company ${duplicateId}.` };
  if (!canonical) return { ok: false, error: `Unknown company ${canonicalId}.` };

  const now = new Date().toISOString();
  const rewrittenCurrent: string[] = [];
  const rewrittenPositions: [string, string][] = [];

  const everyone = db.self ? [...db.people, db.self] : db.people;
  for (const person of everyone) {
    if (person.currentCompanyId === duplicateId) {
      person.currentCompanyId = canonicalId;
      rewrittenCurrent.push(person.id);
    }
    for (const position of person.positions) {
      if (position.companyId === duplicateId) {
        position.companyId = canonicalId;
        rewrittenPositions.push([person.id, position.id]);
      }
    }
  }

  // Any company parented to the duplicate now hangs off the canonical one.
  for (const company of db.companies) {
    if (company.parentId === duplicateId) company.parentId = canonicalId;
  }
  for (const rule of db.resolution.parents) {
    if (rule.parentId === duplicateId) rule.parentId = canonicalId;
    if (rule.childId === duplicateId) rule.childId = canonicalId;
  }
  // Existing alias rules that pointed at the duplicate must follow it.
  for (const rule of db.resolution.aliases) {
    if (rule.canonicalId === duplicateId) rule.canonicalId = canonicalId;
  }

  canonical.aliases = uniq([...canonical.aliases, ...duplicate.aliases, duplicate.name]);
  canonical.sourceBatchIds = uniq([...canonical.sourceBatchIds, ...duplicate.sourceBatchIds]);
  canonical.industry = canonical.industry ?? duplicate.industry;
  canonical.website = canonical.website ?? duplicate.website;
  if (duplicate.firstSeenAt < canonical.firstSeenAt) {
    canonical.firstSeenAt = duplicate.firstSeenAt;
  }
  canonical.lastUpdatedAt = now;
  // If the duplicate had a parent and the canonical does not, inherit it.
  if (!canonical.parentId && duplicate.parentId && duplicate.parentId !== canonicalId) {
    canonical.parentId = duplicate.parentId;
    canonical.relationToParent = duplicate.relationToParent;
  }

  const absorbed: Company = JSON.parse(JSON.stringify(duplicate));
  db.companies = db.companies.filter((c) => c.id !== duplicateId);

  const aliasRule: AliasRule = {
    id: newId('ar'),
    fromKey: duplicate.nameKey,
    fromName: duplicate.name,
    canonicalId,
    source: opts.source,
    confidence: opts.confidence ?? null,
    reasoning: opts.reasoning ?? null,
    evidence: opts.evidence ?? [],
    createdAt: now,
  };
  db.resolution.aliases.push(aliasRule);

  const undo: UndoRecord = {
    id: newId('un'),
    kind: 'merge',
    appliedAt: now,
    auto: !!opts.auto,
    description: `Merged "${duplicate.name}" into "${canonical.name}"`,
    confidence: opts.confidence ?? null,
    evidence: opts.evidence ?? [],
    ruleId: aliasRule.id,
    absorbedCompany: absorbed,
    rewrittenCurrent,
    rewrittenPositions,
  };
  db.resolution.log.unshift(undo);
  return { ok: true, undo };
}

/** Record that `childId` sits under `parentId`. Non-destructive. */
export function linkParent(
  db: Database,
  childId: string,
  parentId: string,
  relation: CompanyRelation,
  opts: ApplyOptions,
): ApplyResult {
  if (childId === parentId) {
    return { ok: false, error: 'A company cannot be its own parent.' };
  }
  const child = db.companies.find((c) => c.id === childId);
  const parent = db.companies.find((c) => c.id === parentId);
  if (!child) return { ok: false, error: `Unknown company ${childId}.` };
  if (!parent) return { ok: false, error: `Unknown company ${parentId}.` };

  // Walking up from the proposed parent must not lead back to the child.
  if (ancestorIds(db, parentId).includes(childId)) {
    return {
      ok: false,
      error: `Linking "${child.name}" under "${parent.name}" would create a cycle.`,
    };
  }

  const now = new Date().toISOString();
  const previousParentId = child.parentId;
  const previousRelation = child.relationToParent;

  child.parentId = parentId;
  child.relationToParent = relation;
  child.lastUpdatedAt = now;

  // One link per child: replace any earlier rule rather than stacking them.
  db.resolution.parents = db.resolution.parents.filter((r) => r.childId !== childId);
  const parentRule: ParentRule = {
    id: newId('pr'),
    childId,
    parentId,
    relation,
    source: opts.source,
    confidence: opts.confidence ?? null,
    reasoning: opts.reasoning ?? null,
    evidence: opts.evidence ?? [],
    createdAt: now,
  };
  db.resolution.parents.push(parentRule);

  const undo: UndoRecord = {
    id: newId('un'),
    kind: 'parent',
    appliedAt: now,
    auto: !!opts.auto,
    description: `Linked "${child.name}" under "${parent.name}" (${relation})`,
    confidence: opts.confidence ?? null,
    evidence: opts.evidence ?? [],
    ruleId: parentRule.id,
    previousParentId,
    previousRelation,
  };
  db.resolution.log.unshift(undo);
  return { ok: true, undo };
}

/** Undo a previously applied action, restoring the graph exactly. */
export function revert(db: Database, undoId: string): ApplyResult {
  const index = db.resolution.log.findIndex((u) => u.id === undoId);
  if (index === -1) return { ok: false, error: 'No such action to revert.' };
  const record = db.resolution.log[index];

  if (record.kind === 'parent') {
    const rule = db.resolution.parents.find((r) => r.id === record.ruleId);
    const childId = rule?.childId;
    if (childId) {
      const child = db.companies.find((c) => c.id === childId);
      if (child) {
        child.parentId = record.previousParentId ?? null;
        child.relationToParent = record.previousRelation ?? null;
      }
    }
    db.resolution.parents = db.resolution.parents.filter((r) => r.id !== record.ruleId);
    db.resolution.log.splice(index, 1);
    return { ok: true };
  }

  // Merge: restore the absorbed company and re-point everything back at it.
  const absorbed = record.absorbedCompany;
  if (!absorbed) return { ok: false, error: 'This merge has no undo snapshot.' };
  if (db.companies.some((c) => c.id === absorbed.id)) {
    return { ok: false, error: `"${absorbed.name}" already exists.` };
  }

  const canonical = db.companies.find(
    (c) => c.id === db.resolution.aliases.find((a) => a.id === record.ruleId)?.canonicalId,
  );

  db.companies.push(absorbed);

  const byId = new Map((db.self ? [...db.people, db.self] : db.people).map((p) => [p.id, p]));
  for (const personId of record.rewrittenCurrent ?? []) {
    const person = byId.get(personId);
    if (person) person.currentCompanyId = absorbed.id;
  }
  for (const [personId, positionId] of record.rewrittenPositions ?? []) {
    const position = byId.get(personId)?.positions.find((p) => p.id === positionId);
    if (position) position.companyId = absorbed.id;
  }

  // Surface forms that belonged to the absorbed company go back with it.
  if (canonical) {
    const returning = new Set(absorbed.aliases);
    canonical.aliases = canonical.aliases.filter(
      (a) => !returning.has(a) || a === canonical.name,
    );
  }

  db.resolution.aliases = db.resolution.aliases.filter((a) => a.id !== record.ruleId);
  db.resolution.log.splice(index, 1);
  return { ok: true };
}

// --- hierarchy queries ------------------------------------------------------

const MAX_DEPTH = 12;

/** Ids from the immediate parent up to the root. Cycle-safe. */
export function ancestorIds(db: Database, companyId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([companyId]);
  let current = db.companies.find((c) => c.id === companyId)?.parentId ?? null;
  let depth = 0;
  while (current && depth < MAX_DEPTH && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = db.companies.find((c) => c.id === current)?.parentId ?? null;
    depth += 1;
  }
  return out;
}

/** The top of this company's corporate group — itself when it has no parent. */
export function rootId(db: Database, companyId: string): string {
  const chain = ancestorIds(db, companyId);
  return chain.length > 0 ? chain[chain.length - 1] : companyId;
}

export function childIds(db: Database, companyId: string): string[] {
  return db.companies.filter((c) => c.parentId === companyId).map((c) => c.id);
}

/** This company plus everything beneath it, for group rollups. */
export function descendantIds(db: Database, companyId: string): string[] {
  const out: string[] = [companyId];
  const queue = [companyId];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const child of childIds(db, next)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** Group every company under its root, for a grouped companies view. */
export function groupByRoot(db: Database): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const company of db.companies) {
    const root = rootId(db, company.id);
    const list = groups.get(root);
    if (list) list.push(company.id);
    else groups.set(root, [company.id]);
  }
  return groups;
}
