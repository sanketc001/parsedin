import type { Database, Person } from './types';
import { currentCompanyIds, pastCompanyIds, schoolIds, type Indexes } from './derive';

// ---------------------------------------------------------------------------
// Graph projection. People, companies and schools become nodes; employment and
// education become edges. Company/school nodes are only included when they
// connect at least `minDegree` of the selected people, which is what keeps the
// picture readable — a few hundred one-person companies add nothing.
// ---------------------------------------------------------------------------

export type NodeKind = 'self' | 'person' | 'company' | 'school';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Number of edges — drives node size. */
  weight: number;
  /** Underlying entity id for navigation. */
  entityId: string;
}

export type EdgeKind = 'works-at' | 'worked-at' | 'studied-at' | 'connected';

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Entities dropped by the minDegree threshold, so the UI can say so. */
  hiddenCompanies: number;
  hiddenSchools: number;
}

export interface GraphOptions {
  /** Only include companies/schools shared by at least this many people. */
  minDegree: number;
  includeCompanies: boolean;
  includeSchools: boolean;
  includePastRoles: boolean;
  /** Cap on person nodes, to keep the simulation responsive. */
  maxPeople: number;
  /** Link every person to a central "you" node. */
  includeSelf: boolean;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  minDegree: 2,
  includeCompanies: true,
  includeSchools: true,
  includePastRoles: true,
  maxPeople: 400,
  includeSelf: true,
};

export function buildGraph(
  db: Database,
  people: Person[],
  idx: Indexes,
  opts: GraphOptions,
): GraphModel {
  const selected = people.slice(0, opts.maxPeople);
  const personIds = new Set(selected.map((p) => p.id));

  // First pass: how many of the selected people touch each entity?
  const companyTouch = new Map<string, number>();
  const schoolTouch = new Map<string, number>();
  for (const person of selected) {
    const companies = new Set([
      ...currentCompanyIds(person),
      ...(opts.includePastRoles ? pastCompanyIds(person) : []),
    ]);
    for (const id of companies) companyTouch.set(id, (companyTouch.get(id) ?? 0) + 1);
    for (const id of schoolIds(person)) schoolTouch.set(id, (schoolTouch.get(id) ?? 0) + 1);
  }

  const keptCompanies = new Set<string>();
  let hiddenCompanies = 0;
  if (opts.includeCompanies) {
    for (const [id, n] of companyTouch) {
      if (n >= opts.minDegree) keptCompanies.add(id);
      else hiddenCompanies += 1;
    }
  }
  const keptSchools = new Set<string>();
  let hiddenSchools = 0;
  if (opts.includeSchools) {
    for (const [id, n] of schoolTouch) {
      if (n >= opts.minDegree) keptSchools.add(id);
      else hiddenSchools += 1;
    }
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const weight = new Map<string, number>();
  const bump = (id: string) => weight.set(id, (weight.get(id) ?? 0) + 1);

  const SELF_ID = 'self';
  if (opts.includeSelf) {
    nodes.push({
      id: SELF_ID,
      label: db.self?.fullName ?? 'You',
      kind: 'self',
      weight: selected.length,
      entityId: db.self?.id ?? 'self',
    });
  }

  for (const person of selected) {
    nodes.push({
      id: `p:${person.id}`,
      label: person.fullName,
      kind: 'person',
      weight: 1,
      entityId: person.id,
    });
    if (opts.includeSelf) {
      edges.push({ source: SELF_ID, target: `p:${person.id}`, kind: 'connected' });
    }
  }

  for (const id of keptCompanies) {
    nodes.push({
      id: `c:${id}`,
      label: idx.companyById.get(id)?.name ?? id,
      kind: 'company',
      weight: companyTouch.get(id) ?? 1,
      entityId: id,
    });
  }
  for (const id of keptSchools) {
    nodes.push({
      id: `s:${id}`,
      label: idx.schoolById.get(id)?.name ?? id,
      kind: 'school',
      weight: schoolTouch.get(id) ?? 1,
      entityId: id,
    });
  }

  for (const person of selected) {
    if (!personIds.has(person.id)) continue;
    const src = `p:${person.id}`;
    for (const id of currentCompanyIds(person)) {
      if (!keptCompanies.has(id)) continue;
      edges.push({ source: src, target: `c:${id}`, kind: 'works-at' });
      bump(src);
    }
    if (opts.includePastRoles) {
      for (const id of pastCompanyIds(person)) {
        if (!keptCompanies.has(id)) continue;
        edges.push({ source: src, target: `c:${id}`, kind: 'worked-at' });
        bump(src);
      }
    }
    for (const id of schoolIds(person)) {
      if (!keptSchools.has(id)) continue;
      edges.push({ source: src, target: `s:${id}`, kind: 'studied-at' });
      bump(src);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'person') node.weight = 1 + (weight.get(node.id) ?? 0);
  }

  return { nodes, edges, hiddenCompanies, hiddenSchools };
}
