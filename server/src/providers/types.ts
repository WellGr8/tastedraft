import type { EvidenceSignal } from './signal.js';

/** Reference kinds the sample packet already uses. */
export type ReferenceType = 'Brand' | 'Artist' | 'Film' | 'Place' | 'Reference';

export type PresentationFit = 'logo' | 'circle' | 'photo';

/**
 * The brief `provideEvidence` already receives from `split/logic.js`.
 * `interests` is stored by the prototype and is not measured here.
 */
export interface Brief {
  idea: string;
  age: string;
  city: string;
  pos: string;
  refs: readonly string[];
  applied?: boolean;
  interests?: string;
}

export type ResolutionKind = 'unique' | 'none' | 'collision' | 'http';

export interface EntityCandidate {
  id: string;
  name: string;
  description?: string;
  /** Name-match score from the source, when it has one. Not an affinity. */
  matchScore?: number;
}

export interface ResolvedEntity {
  query: string;
  name: string | null;
  id: string | null;
  type: EvidenceSignal<ReferenceType | null>;
  description: string | null;
  image: string | null;
  url: string | null;
  /** Genre, movement, country, language, or tag labels actually returned. */
  labels: readonly string[];
  /** P131 located-in labels, when the source has them. */
  locatedIn: readonly string[];
  /** Source measurements keyed by label, such as MusicBrainz tag votes. Not affinities. */
  measurements: Readonly<Record<string, number>>;
  status: EvidenceSignal<null>['status'];
  resolution: ResolutionKind;
  source: string;
  candidates: readonly EntityCandidate[];
}

export interface FacetAffinity {
  facet: string;
  /** Label the source stated, when one matched this facet. */
  matchedLabel: string | null;
  affinity: EvidenceSignal<number | null>;
}

/**
 * One reference in the same role as `provideEvidence().refs[]`.
 * Numeric affinities stay null unless a source measured them.
 */
export interface ReferenceEvidence {
  name: string;
  type: EvidenceSignal<ReferenceType | null>;
  fit: PresentationFit | null;
  provenance: string;
  city: EvidenceSignal<string | null>;
  /** True only when a source statement places the reference in the brief city. */
  inBriefCity: EvidenceSignal<boolean | null>;
  facets: readonly FacetAffinity[];
  affinity: EvidenceSignal<number | null>;
  minimal: EvidenceSignal<number | null>;
  electronic: EvidenceSignal<number | null>;
  streetwear: EvidenceSignal<number | null>;
  japanese: EvidenceSignal<number | null>;
  status: EvidenceSignal<null>['status'];
  entity: ResolvedEntity;
}

export interface NamedSignal extends EvidenceSignal<number | string | boolean | null> {
  id: string;
  domain: string;
  name: string;
}

export interface DomainAffinity {
  type: string;
  affinity: EvidenceSignal<number | null>;
}

/**
 * Evidence packet. Keys match `provideEvidence` in `split/evidence.js`.
 * Every former bare number is a signal with `source` and `status`.
 * `toSamplePacket` unwraps `.value` for `deriveSubs`, which still expects numbers.
 */
export interface EvidencePacket {
  sourceId: 'qloo' | 'open-data' | 'mixed' | 'none';
  mixed: boolean;
  facets: readonly string[];
  refs: readonly ReferenceEvidence[];
  domains: readonly DomainAffinity[];
  local: {
    base: EvidenceSignal<number | null>;
    penalty: EvidenceSignal<number | null>;
    signals: readonly NamedSignal[];
  };
  audience: {
    base: EvidenceSignal<number | null>;
    penalty: EvidenceSignal<number | null>;
    signals: readonly NamedSignal[];
  };
  friction: EvidenceSignal<number | null>;
  signal: {
    fashion: EvidenceSignal<number | null>;
    music: EvidenceSignal<number | null>;
    design: EvidenceSignal<number | null>;
  };
  crossAdjust: EvidenceSignal<number | null>;
  posture: string;
  scarcity: 'limited' | 'preorder' | 'none';
  /** Audit list. The same signals also sit on the fields above. */
  signals: readonly NamedSignal[];
}

export interface ResolveContext {
  city?: string;
}

export interface EvidenceProvider {
  readonly id: string;
  resolveEntities(refs: readonly string[], context?: ResolveContext): Promise<ResolvedEntity[]>;
  getEvidence(brief: Brief): Promise<EvidencePacket>;
}

/** Numeric view of a packet. Null means the provider refused to invent a score. */
export interface SampleEvidencePacket {
  sourceId: EvidencePacket['sourceId'];
  mixed: boolean;
  facets: string[];
  refs: Array<{
    name: string;
    type: ReferenceType | null;
    fit: PresentationFit | null;
    provenance: string;
    affinity: number | null;
    minimal: number | null;
    electronic: number | null;
    streetwear: number | null;
    city: string;
  }>;
  domains: Array<{ type: string; affinity: number | null }>;
  local: { base: number | null; penalty: number | null };
  audience: { base: number | null; penalty: number | null };
  friction: number | null;
  signal: { fashion: number | null; music: number | null; design: number | null };
  crossAdjust: number | null;
  posture: string;
  scarcity: EvidencePacket['scarcity'];
}
