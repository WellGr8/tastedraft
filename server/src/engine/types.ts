import type { BriefV2 } from '@tastedraft/contracts';

/**
 * Shapes the deterministic engine reads and writes.
 * A Qloo-backed EvidenceProvider can replace the sample packet later;
 * deriveSubs() only reads affinities.
 */

export interface Brief {
  idea: string;
  age: string;
  city: string;
  pos: string;
  /** Playlist order. Muted names stay listed but are not passed as evidence. */
  refs: string[];
  muted?: string[];
  /** Stored for the client. The score does not read this field. */
  interests?: string;
  /**
   * Prototype flag. `true` means the agent proposal is on:
   * accessible premium and independent pre-order drops.
   * Concept versions created by apply set `posture` / `scarcity` instead.
   */
  applied?: boolean;
  /** When set, overrides the posture derived from `pos` (or from `applied`). */
  posture?: string;
  /** When set, overrides scarcity derived from the idea (or from `applied`). */
  scarcity?: string;
  /**
   * Card brief from the input screen. Present when the client sent interests,
   * resolved entities, and a city. The calibrated demo omits this, or sends
   * the default streetwear brief, and stays on the sample graph.
   */
  briefV2?: BriefV2;
}

export interface EvidenceRef {
  name: string;
  type: string;
  fit: string;
  provenance: string;
  /** 0–100 concept affinity. Null when the source did not measure one. */
  affinity: number | null;
  minimal: number | null;
  electronic: number | null;
  streetwear: number | null;
  city: string;
}

export interface EvidenceDomain {
  type: string;
  /** 0–100 mean affinity of one cultural domain. Null when unmeasured. */
  affinity: number | null;
}

export interface EvidencePacket {
  /**
   * Label the screen shows: `sample`, `inferred`, `qloo`, or `open-data`.
   * Provider packets that say `open-data` stay on that id so the UI does not
   * fall through to sample data.
   */
  sourceId: string;
  /** True when some, but not all, references were inferred. */
  mixed: boolean;
  facets: string[];
  refs: EvidenceRef[];
  domains: EvidenceDomain[];
  /** Indie-district fit before and after the conflict drag. Null when unmeasured. */
  local: { base: number | null; penalty: number | null };
  /** Age × city fit before and after the price drag. Null when unmeasured. */
  audience: { base: number | null; penalty: number | null };
  /** 0–100 conflict gap. Not yet weighted. Null when the source did not measure it. */
  friction: number | null;
  signal: { fashion: number | null; music: number | null; design: number | null };
  /**
   * Evidence gap added after domain coverage.
   * An electronic concept with no artist reference is −6.
   * The calibrated default brief is 0.
   * Null means the provider refused to invent the adjustment.
   */
  crossAdjust: number | null;
  posture: string;
  scarcity: string;
}

export interface Subscores {
  anchor: number;
  cross: number;
  local: number;
  audience: number;
  friction: number;
}

/** Rounded ledger rows. `friction` is already negative. `total` is their sum. */
export interface LedgerPoints {
  anchor: number;
  cross: number;
  local: number;
  audience: number;
  friction: number;
  total: number;
}

export type EvidenceStrength = 'HIGH' | 'MEDIUM' | 'LIMITED';

export interface DisplayScore {
  text: string;
  why: string;
  limited: boolean;
  approx: number;
}

export interface Districts {
  min: string[];
  lux: string[];
}
