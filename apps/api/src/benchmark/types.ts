import type { Spread } from './metrics.ts';

export interface NameTotals {
  unverifiableMentions: number;
  unverifiableNames: string[];
  hallucinatedMentions: number | null;
  hallucinatedNames: string[];
}

export interface ReasonRecord {
  personaId: string;
  label: string;
  age: string;
  reason: string;
  /** llm is a live model reply. template is the product fallback. offline-template never saw a model. */
  source: 'llm' | 'template' | 'offline-template';
  verified: string[];
  unverifiable: string[];
  hallucinated: string[];
  /** Verified names that are this persona's own taste anchors, not the city. */
  specific?: string[];
  score: number | null;
}

export interface ArmRecord {
  reasons: ReasonRecord[];
  verifiedReasons: number;
  reasonCount: number;
  citationShare: number | null;
  unverifiableMentions: number;
  unverifiableNames: string[];
  /** Null when this run did not search the claimed names. */
  hallucinatedMentions: number | null;
  hallucinatedNames: string[];
  segmentSpread: Spread | null;
  /** Published insight-ledger total for a case study. Null for examples and for the LLM arm. */
  ledgerScore: number | null;
  ledgerLocal: number | null;
  verdict: 'encourage' | 'caution' | null;
  matched: boolean | null;
}

export interface ItemRecord {
  id: string;
  title: string;
  kind: 'example' | 'case-study';
  city: string;
  outcome: 'sold_out' | 'left' | 'stayed' | null;
  qloo: ArmRecord;
  llm: ArmRecord;
}

export interface SampleCity {
  id: string;
  city: string;
  mean: number;
  segments: Array<{ age: string; score: number }>;
}

export interface BenchmarkFile {
  source: 'recorded' | 'live';
  live: boolean;
  label: string;
  generatedAt: string;
  model: string | null;
  qlooCalls: number;
  budgetCap: number;
  headline: {
    /** Reasons that name a taste entity from that persona's own anchors. */
    withQloo: string;
    withoutQloo: string;
    citationShareWithQloo: number | null;
    citationShareWithoutQloo: number | null;
    outcomeWithQloo: string | null;
    outcomeWithoutQloo: string | null;
  };
  agreement: {
    qlooLedger: { matched: number; total: number; source: string };
    llmPanel: { matched: number; total: number } | null;
  };
  totals: {
    qloo: NameTotals;
    llm: NameTotals;
  };
  scoreSpread: {
    qlooCaseStudies: Spread | null;
    qlooExamples: Spread | null;
    llmExamples: Spread | null;
    note: string;
  };
  sampleEngine: {
    label: string;
    cities: SampleCity[];
    citySpread: Spread | null;
    segmentSpread: Spread | null;
  } | null;
  items: ItemRecord[];
  limits: string[];
}
