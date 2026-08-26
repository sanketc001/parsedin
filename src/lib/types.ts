// ---------------------------------------------------------------------------
// Core domain model for the personal professional knowledge graph.
//
// Provenance principle: every fact carries the import batch it came from and
// when it landed. Scalar person fields track provenance individually in
// `fieldSources` so a profile assembled from several imports stays auditable.
// ---------------------------------------------------------------------------

export type ImportKind =
  | 'linkedin-archive'
  | 'linkedin-csv'
  | 'enriched-json'
  | 'manual';

/** Attached to every sub-record (position, education, skill, ...). */
export interface Provenanced {
  /** Batch that first introduced this record. */
  sourceBatchId: string;
  /** Batch that most recently confirmed or updated it. */
  lastSeenBatchId: string;
  /** ISO timestamp of first import. */
  importedAt: string;
  /** ISO timestamp of the most recent update. */
  updatedAt: string;
}

export interface FieldSource {
  batchId: string;
  importedAt: string;
  /** Human-readable origin, e.g. "Connections.csv". */
  sourceLabel: string;
}

export interface Position extends Provenanced {
  id: string;
  title: string | null;
  companyName: string | null;
  companyId: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  location: string | null;
  description: string | null;
}

export interface Education extends Provenanced {
  id: string;
  schoolName: string | null;
  schoolId: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  activities: string | null;
  notes: string | null;
}

export interface SkillEntry extends Provenanced {
  id: string;
  name: string;
}

export interface CertificationEntry extends Provenanced {
  id: string;
  name: string;
  authority: string | null;
  licenseNumber: string | null;
  url: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface VolunteeringEntry extends Provenanced {
  id: string;
  organization: string | null;
  role: string | null;
  cause: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface LanguageEntry extends Provenanced {
  id: string;
  name: string;
  proficiency: string | null;
}

export interface ProjectEntry extends Provenanced {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface HonorEntry extends Provenanced {
  id: string;
  title: string;
  issuer: string | null;
  date: string | null;
  description: string | null;
}

export interface Person {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  /** Normalized name key used for entity resolution. */
  nameKey: string;

  headline: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  currentCompanyId: string | null;
  location: string | null;
  industry: string | null;
  summary: string | null;

  linkedinUrl: string | null;
  /** Normalized LinkedIn URL, the strongest identity key we have. */
  urlKey: string | null;
  email: string | null;

  /** Date the connection was made (from Connections.csv). */
  connectedOn: string | null;
  /** 1 = direct connection, 2/3 = further out. Null when unknown. */
  connectionDegree: number | null;

  positions: Position[];
  education: Education[];
  skills: SkillEntry[];
  certifications: CertificationEntry[];
  volunteering: VolunteeringEntry[];
  languages: LanguageEntry[];
  projects: ProjectEntry[];
  honors: HonorEntry[];

  /** Per-field provenance for the scalar fields above. */
  fieldSources: Record<string, FieldSource>;
  /** Every batch that contributed something to this person. */
  sourceBatchIds: string[];

  firstSeenAt: string;
  lastUpdatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  nameKey: string;
  /** Alternate surface forms seen across imports. */
  aliases: string[];
  industry: string | null;
  website: string | null;
  /** Corporate parent, when known. Null for roots and standalone companies. */
  parentId: string | null;
  /** How this company relates to its parent. */
  relationToParent: CompanyRelation | null;
  /**
   * True when this record exists only to express hierarchy — a holding company
   * nobody in the network actually works at. Kept out of employer listings.
   */
  synthetic?: boolean;
  sourceBatchIds: string[];
  firstSeenAt: string;
  lastUpdatedAt: string;
}

/**
 * How one company relates to another. Only `same-entity` justifies merging —
 * the rest are real, distinct workplaces that merely roll up together.
 */
export type CompanyRelation =
  | 'subsidiary'
  | 'brand'
  | 'division'
  | 'joint-venture'
  | 'rebrand'
  | 'affiliate';

export type ResolutionSource = 'llm' | 'manual';

/** Evidence backing a proposed relationship. */
export interface Evidence {
  title: string;
  url: string;
  snippet: string;
}

/**
 * An alias rule: any company whose normalized key matches `fromKey` resolves to
 * `canonicalId`. Stored as a rule rather than applied once, so a later import
 * cannot resurrect the duplicate.
 */
export interface AliasRule {
  id: string;
  fromKey: string;
  /** Surface form that produced this rule, for display. */
  fromName: string;
  canonicalId: string;
  source: ResolutionSource;
  confidence: number | null;
  reasoning: string | null;
  evidence: Evidence[];
  createdAt: string;
}

/** A parent/child link between two distinct companies. */
export interface ParentRule {
  id: string;
  childId: string;
  parentId: string;
  relation: CompanyRelation;
  source: ResolutionSource;
  confidence: number | null;
  reasoning: string | null;
  evidence: Evidence[];
  createdAt: string;
}

/**
 * A proposal awaiting review. Anything the analyzer was not confident enough
 * to apply automatically lands here rather than changing the graph silently.
 */
export interface Proposal {
  id: string;
  kind: 'merge' | 'parent';
  /** Company ids involved. For merge: [duplicateId, canonicalId]. */
  companyIds: string[];
  /** Display names, so a proposal stays readable after a merge moves things. */
  names: string[];
  relation: CompanyRelation | null;
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
  createdAt: string;
  status: 'pending' | 'rejected';
}

/**
 * What an applied action changed, so it can be undone exactly. Auto-applied
 * actions are only safe because of this.
 */
export interface UndoRecord {
  id: string;
  kind: 'merge' | 'parent';
  appliedAt: string;
  auto: boolean;
  description: string;
  confidence: number | null;
  evidence: Evidence[];
  /** The alias or parent rule this action created. */
  ruleId: string;
  /** For merges: the company record that was absorbed, verbatim. */
  absorbedCompany?: Company;
  /** For merges: person ids whose currentCompanyId was rewritten. */
  rewrittenCurrent?: string[];
  /** For merges: [personId, positionId] pairs whose companyId was rewritten. */
  rewrittenPositions?: [string, string][];
  /** For parent links: the previous parent, to restore on revert. */
  previousParentId?: string | null;
  previousRelation?: CompanyRelation | null;
}

export interface Resolution {
  aliases: AliasRule[];
  parents: ParentRule[];
  proposals: Proposal[];
  log: UndoRecord[];
  /** ISO timestamp of the last analyzer run. */
  lastAnalyzedAt: string | null;
}

export function emptyResolution(): Resolution {
  return { aliases: [], parents: [], proposals: [], log: [], lastAnalyzedAt: null };
}

export interface School {
  id: string;
  name: string;
  nameKey: string;
  aliases: string[];
  sourceBatchIds: string[];
  firstSeenAt: string;
  lastUpdatedAt: string;
}

/** A timestamped private note about a person. Notes are never imported. */
export interface Note {
  id: string;
  personId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Private relationship assessment. Also never imported. */
export interface Relationship {
  personId: string;
  /** 1 (weak / barely know them) .. 5 (strong / close). */
  strength: number;
  tags: string[];
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  label: string;
  kind: ImportKind;
  filename: string | null;
  importedAt: string;
  /** Names of the files inside the batch that were actually understood. */
  files: string[];
  /** Files present but not recognized — surfaced so nothing is silently dropped. */
  skippedFiles: string[];
  stats: ImportStats;
  notes: string[];
}

export interface ImportStats {
  peopleCreated: number;
  peopleUpdated: number;
  positions: number;
  education: number;
  skills: number;
  certifications: number;
  volunteering: number;
  languages: number;
  projects: number;
  honors: number;
  companies: number;
  schools: number;
  selfProfileUpdated: boolean;
  rowsSkipped: number;
}

export function emptyStats(): ImportStats {
  return {
    peopleCreated: 0,
    peopleUpdated: 0,
    positions: 0,
    education: 0,
    skills: 0,
    certifications: 0,
    volunteering: 0,
    languages: 0,
    projects: 0,
    honors: 0,
    companies: 0,
    schools: 0,
    selfProfileUpdated: false,
    rowsSkipped: 0,
  };
}

export interface Database {
  version: number;
  /** The network owner's own profile, when a Profile.csv was imported. */
  self: Person | null;
  people: Person[];
  companies: Company[];
  schools: School[];
  notes: Note[];
  relationships: Relationship[];
  batches: ImportBatch[];
  /** Company de-duplication and corporate hierarchy. Survives re-imports. */
  resolution: Resolution;
}

export function emptyDatabase(): Database {
  return {
    version: 2,
    self: null,
    people: [],
    companies: [],
    schools: [],
    notes: [],
    relationships: [],
    batches: [],
    resolution: emptyResolution(),
  };
}
