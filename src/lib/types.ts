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

/**
 * A reply you are composing, or one you have already sent.
 *
 * Private and never imported, like notes and ratings. Drafts exist because the
 * app cannot send a LinkedIn message — no public API covers personal-account
 * messaging, and a page on localhost cannot borrow the browser's LinkedIn
 * session. So the app owns the writing and the record-keeping, and hands the
 * finished text to LinkedIn through the clipboard.
 *
 * Sent drafts are kept rather than deleted: they are the only evidence the
 * archive will never contain, and they are what lets Reconnect stop asking
 * about a thread you have already answered.
 */
export interface Draft {
  id: string;
  /**
   * Stable grouping key — the conversation when there is one, otherwise the
   * person. At most one draft per key is open (`sentAt === null`) at a time.
   */
  key: string;
  conversationId: string | null;
  personId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Set when you confirm you actually sent it. */
  sentAt: string | null;
}

/** Private relationship assessment. Also never imported. */
export interface Relationship {
  personId: string;
  /** 1 (weak / barely know them) .. 5 (strong / close). */
  strength: number;
  tags: string[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Activity: the half of the export that is not a profile.
//
// LinkedIn hands over rich *history* about the account owner — every message,
// invitation, endorsement, follow, job application, post, reaction, login and
// ad segment. None of it describes what a connection's career looks like, so
// it lives beside the people graph rather than inside it, and links back by
// person id wherever a counterparty could be resolved.
//
// Every record carries a deterministic id derived from its natural key, so
// re-importing an overlapping archive updates rather than duplicates.
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** True when the account owner sent it. */
  outbound: boolean;
  /** Display name of the sender as the export wrote it. */
  from: string;
  subject: string | null;
  body: string;
  hasAttachment: boolean;
}

export interface Conversation {
  /** LinkedIn's own conversation id — stable across exports. */
  id: string;
  title: string | null;
  /** Resolved counterparties. Empty when the other party was un-attributable. */
  personIds: string[];
  /** Counterparty display names, kept even when no person record matched. */
  participantNames: string[];
  /** Counterparty profile URLs, for threads with nobody in the graph. */
  participantUrls: string[];
  folder: string | null;
  messages: Message[];
  /** Denormalized for listing without walking every message. */
  firstAt: string | null;
  lastAt: string | null;
  sent: number;
  received: number;
  /** The most recent message came from them. */
  lastInbound: boolean;
  /**
   * A sponsored InMail — an advert dressed as a message. LinkedIn files these
   * in the same archive as real conversations, and they are overwhelmingly
   * "unanswered", so counting them as messages you owe a reply to would drown
   * the signal. Kept, but never counted as contact.
   */
  sponsored: boolean;
  sourceBatchIds: string[];
}

export type InvitationDirection = 'incoming' | 'outgoing';

export interface InvitationRecord {
  id: string;
  personId: string | null;
  name: string;
  profileUrl: string | null;
  direction: InvitationDirection;
  sentAt: string | null;
  /** The note attached to the invite. Usually empty; gold when it is not. */
  message: string | null;
  sourceBatchIds: string[];
}

export interface EndorsementRecord {
  id: string;
  personId: string | null;
  name: string;
  profileUrl: string | null;
  skill: string;
  /** 'received' = they endorsed you. */
  direction: 'received' | 'given';
  at: string | null;
  status: string | null;
  sourceBatchIds: string[];
}

export interface CompanyFollow {
  id: string;
  name: string;
  companyId: string | null;
  at: string | null;
  sourceBatchIds: string[];
}

export interface MemberFollow {
  id: string;
  name: string;
  personId: string | null;
  at: string | null;
  status: string | null;
  sourceBatchIds: string[];
}

export interface JobApplication {
  id: string;
  at: string | null;
  company: string | null;
  companyId: string | null;
  title: string | null;
  url: string | null;
  resume: string | null;
  sourceBatchIds: string[];
}

export interface SavedJob {
  id: string;
  at: string | null;
  company: string | null;
  companyId: string | null;
  title: string | null;
  url: string | null;
  sourceBatchIds: string[];
}

export interface JobAlert {
  id: string;
  keywords: string | null;
  location: string | null;
  sourceBatchIds: string[];
}

export interface JobPreferences {
  locations: string[];
  jobTitles: string[];
  jobTypes: string[];
  industries: string[];
  dreamCompanies: string[];
  openToRecruiters: boolean | null;
  urgency: string | null;
  visibility: string | null;
  introduction: string | null;
}

export type EngagementKind = 'post' | 'comment' | 'reaction' | 'vote';

/** One thing the account owner did in the feed. */
export interface EngagementItem {
  id: string;
  kind: EngagementKind;
  at: string;
  /** Permalink to the activity. */
  url: string | null;
  /** Post commentary, comment body, reaction type, or poll option. */
  text: string | null;
  /** Reaction type (LIKE / PRAISE / ...), only for reactions. */
  reactionType: string | null;
  /** Audience of a post. */
  visibility: string | null;
  sourceBatchIds: string[];
}

export interface LearningItem {
  id: string;
  title: string;
  description: string | null;
  contentType: string | null;
  lastWatchedAt: string | null;
  completedAt: string | null;
  saved: boolean;
  sourceBatchIds: string[];
}

export interface EventItem {
  id: string;
  name: string;
  time: string | null;
  status: string | null;
  url: string | null;
  sourceBatchIds: string[];
}

/** One targeting facet LinkedIn built about you, e.g. "Job Titles" -> [...]. */
export interface AdSegment {
  category: string;
  values: string[];
}

export interface InferenceRecord {
  category: string;
  type: string;
  description: string | null;
  /** LinkedIn's own verdict, usually "Yes" / "No". */
  value: string;
}

export interface AdProfile {
  segments: AdSegment[];
  inferences: InferenceRecord[];
  /** Ads you clicked. Only the count and range are worth keeping. */
  adsClicked: number;
  adsClickedFirstAt: string | null;
  adsClickedLastAt: string | null;
  /** Off-LinkedIn ad network activity, tallied by action. */
  offsiteActions: { action: string; count: number }[];
  offsiteApps: { app: string; count: number }[];
}

export interface LoginRecord {
  id: string;
  at: string;
  ip: string | null;
  userAgent: string | null;
  type: string | null;
}

export interface SecurityChallenge {
  id: string;
  at: string;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  type: string | null;
}

export interface VerificationRecord {
  id: string;
  type: string;
  organization: string | null;
  email: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
}

export interface Activity {
  conversations: Conversation[];
  invitations: InvitationRecord[];
  endorsements: EndorsementRecord[];
  companyFollows: CompanyFollow[];
  memberFollows: MemberFollow[];
  jobApplications: JobApplication[];
  savedJobs: SavedJob[];
  jobAlerts: JobAlert[];
  jobPreferences: JobPreferences | null;
  engagement: EngagementItem[];
  learning: LearningItem[];
  events: EventItem[];
  adProfile: AdProfile | null;
  logins: LoginRecord[];
  challenges: SecurityChallenge[];
  verifications: VerificationRecord[];
}

export function emptyActivity(): Activity {
  return {
    conversations: [],
    invitations: [],
    endorsements: [],
    companyFollows: [],
    memberFollows: [],
    jobApplications: [],
    savedJobs: [],
    jobAlerts: [],
    jobPreferences: null,
    engagement: [],
    learning: [],
    events: [],
    adProfile: null,
    logins: [],
    challenges: [],
    verifications: [],
  };
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
  /** Activity-layer rows, counted separately from profile facts. */
  messages: number;
  conversations: number;
  invitations: number;
  endorsements: number;
  follows: number;
  jobRecords: number;
  engagement: number;
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
    messages: 0,
    conversations: 0,
    invitations: 0,
    endorsements: 0,
    follows: 0,
    jobRecords: 0,
    engagement: 0,
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
  /** Replies you have composed. Private, never imported. */
  drafts: Draft[];
  batches: ImportBatch[];
  /** Company de-duplication and corporate hierarchy. Survives re-imports. */
  resolution: Resolution;
  /** Messages, engagement, job search and everything else the export carries. */
  activity: Activity;
}

export function emptyDatabase(): Database {
  return {
    version: 4,
    self: null,
    people: [],
    companies: [],
    schools: [],
    notes: [],
    relationships: [],
    drafts: [],
    batches: [],
    resolution: emptyResolution(),
    activity: emptyActivity(),
  };
}
