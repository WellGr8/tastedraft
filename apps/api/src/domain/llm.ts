import type { QlooParamDiff } from '@tastedraft/contracts';
import type { Brief, Districts, EvidenceStrength } from '../engine/types.ts';

/**
 * LLM boundary. `createEngineLlm` adapts `server/src/llm` onto this client.
 * The model must not invent ledger numbers. parseBrief returns terms only.
 * explain and critique return prose. Proposal `change` values are the only
 * structured edits, and apply re-runs the deterministic engine.
 */

export interface ModelLedger {
  anchor: number | null;
  cross: number | null;
  local: number | null;
  audience: number | null;
  friction: number | null;
  total: number | null;
}

export interface ParsedBrief {
  conceptTerms: string[];
  /** Hypotheses such as "premium" or "scarcity". Not scores. */
  conflictHypotheses: string[];
  domains: string[];
}

export interface SignalSource {
  name: string;
  type: string;
  provenance: string;
  affinity?: number;
}

export interface Signal {
  domain: string;
  name: string;
  level: 'Limited' | 'Moderate' | 'Strong';
  /** Ledger row this signal feeds, e.g. "Anchor affinity". */
  feeds: string;
  sources: SignalSource[];
}

export interface Fit {
  text: string;
  isNew?: boolean;
}

export interface Friction {
  text: string;
  why: string;
}

/**
 * Machine-readable edit.
 * `qloo` is the product path: a parameter diff the agent already re-scored.
 * `posture` and `scarcity` remain so an older row can be read. New runs do not emit them.
 */
export type RecommendationChange =
  | { kind: 'posture'; posture: 'accessible' }
  | { kind: 'scarcity'; scarcity: 'preorder' }
  | { kind: 'qloo'; changes: QlooParamDiff[]; predictedDelta: number };

export interface ProposalDraft {
  before: string;
  after: string;
  why: string;
  evidence: string;
  /** Signal domains cited by this proposal. Must exist on the simulation. */
  evidenceIds: string[];
  change: RecommendationChange;
}

export interface ExplainInput {
  brief: Brief;
  /** Dimension cells may be null when that signal was not measured. The model must not be shown the numbers. */
  ledger: ModelLedger;
  evidenceStrength: EvidenceStrength;
  signals: Signal[];
  districts: Districts;
  /** Packet source id: sample, inferred, qloo, or open-data. */
  provider: string;
  posture: string;
  scarcity: string;
}

export interface CritiqueInput extends ExplainInput {
  evidenceIds: string[];
}

export interface LlmClient {
  parseBrief(brief: Brief): Promise<ParsedBrief>;
  explain(input: ExplainInput): Promise<{ fits: Fit[] }>;
  critique(input: CritiqueInput): Promise<{ frictions: Friction[]; proposals: ProposalDraft[] }>;
}
