import type { RecommendationChange } from './llm.ts';
import type { Fit, Friction, ParsedBrief, Signal } from './llm.ts';
import type { Brief, DisplayScore, Districts, EvidencePacket, EvidenceStrength } from '../engine/types.ts';
import type { NullableLedger, NullableSubs } from '../wiring/gaps.ts';
import type { StoryView } from '../orchestrator/agent-score.ts';

export type VersionOrigin = 'initial' | 'brief_edit' | 'recommendation_applied';
export type SimulationStatus = 'complete' | 'failed' | 'stale';
export type RecommendationStatus = 'open' | 'applied' | 'dismissed';

export interface Project {
  id: string;
  name: string;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptVersion {
  id: string;
  projectId: string;
  number: number;
  parentId: string | null;
  origin: VersionOrigin;
  brief: Brief;
  recommendationId: string | null;
  createdAt: string;
}

export interface EvidenceSnapshot {
  id: string;
  projectId: string;
  conceptVersionId: string;
  providerId: string;
  packet: EvidencePacket;
  createdAt: string;
}

/** Score payload frozen at the end of a successful run. Never rewritten. */
export interface StoredScore {
  /** Null when every scored dimension was unmeasured. Not a failed run and not a zero. */
  score: number | null;
  displayScore: DisplayScore | null;
  ledger: NullableLedger;
  subs: NullableSubs;
  evidenceStrength: EvidenceStrength;
  signals: Signal[];
  districts: Districts;
  fits: Fit[];
  frictions: Friction[];
  provider: string;
  mixed: boolean;
  parsedBrief: ParsedBrief;
  story?: StoryView | null;
}

export interface StoredSimulation {
  id: string;
  projectId: string;
  conceptVersionId: string;
  evidenceSnapshotId: string | null;
  status: SimulationStatus;
  /** Null when the run failed. A later success is a new row, not an update. */
  result: StoredScore | null;
  error: string | null;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  simulationId: string;
  projectId: string;
  position: number;
  before: string;
  after: string;
  why: string;
  evidence: string;
  evidenceIds: string[];
  change: RecommendationChange;
  status: RecommendationStatus;
  appliedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalView {
  id: string;
  before: string;
  after: string;
  why: string;
  evidence: string;
  evidenceIds: string[];
  change: RecommendationChange;
  status: RecommendationStatus;
  predictedDelta: number | null;
  param: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Response body for a simulation. Required screen fields match the frontend
 * contract; ids and displayScore are how the client acts on the result.
 */
export interface SimulationView {
  id: string;
  projectId: string;
  conceptVersionId: string;
  versionNumber: number;
  evidenceSnapshotId: string | null;
  status: SimulationStatus;
  provider: string | null;
  score: number | null;
  displayScore: DisplayScore | null;
  ledger: NullableLedger | null;
  evidenceStrength: EvidenceStrength | null;
  signals: Signal[];
  districts: Districts;
  fits: Fit[];
  frictions: Friction[];
  proposals: ProposalView[];
  subs: NullableSubs | null;
  mixed: boolean | null;
  parsedBrief: ParsedBrief | null;
  story: StoryView | null;
  error: string | null;
}
