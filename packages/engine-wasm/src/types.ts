export interface Subscores {
  anchor: number;
  cross: number;
  local: number;
  audience: number;
  friction: number;
}

export interface NullableSubs {
  anchor: number | null;
  cross: number | null;
  local: number | null;
  audience: number | null;
  friction: number | null;
}

export interface LedgerPoints extends Subscores {
  total: number;
}

export interface DisplayScore {
  text: string;
  why: string;
  limited: boolean;
  approx: number;
}

export interface ScoreLedger {
  rows: Array<{
    id: 'anchor' | 'cross' | 'local' | 'audience' | 'friction' | string;
    subscore: number | null;
    weight: number;
    points: number | null;
    provenance: { source: string; detail: string; evidenceRefs: string[] };
  }>;
  total: number | null;
}

export interface InsightScore {
  ledger: ScoreLedger;
  evidenceStrength: 'HIGH' | 'MEDIUM' | 'LIMITED' | string;
  gaps: string[];
  subscores: NullableSubs;
}

export interface SampleScore {
  subscores: Subscores;
  points: LedgerPoints;
  ledger: ScoreLedger;
  evidenceStrength: string;
  display: DisplayScore;
  packet: unknown;
}

export interface Rescore {
  baseline: number;
  total: number;
  predictedDelta: number;
  subscores: Subscores;
  points: LedgerPoints;
  ledger: ScoreLedger;
}

export interface ScoredPacket {
  score: number | null;
  subs: NullableSubs;
  ledger: {
    anchor: number | null;
    cross: number | null;
    local: number | null;
    audience: number | null;
    friction: number | null;
  };
  evidenceStrength: string;
  gaps: string[];
  display: DisplayScore | null;
}
