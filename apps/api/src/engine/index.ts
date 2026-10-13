export {
  AGES,
  CITY_DISTRICTS,
  CITY_NAMES,
  DEFAULT_BRIEF,
  DEFAULT_IDEA,
  DEFAULT_REFS,
  POS,
  districtsFor,
  isAgeBand,
  isCityName,
  isPositioning,
} from './constants.ts';
export type { AgeBand, CityName, Positioning } from './constants.ts';
export { provideEvidence, hasLimitedLanguage, hasPremiumLanguage, readFacets } from './sample-evidence.ts';
export type { EvidenceInput } from './sample-evidence.ts';
export { scoreInsightMeasurements } from './insights-score.ts';
export {
  DEMOGRAPHIC_AGE_ORDER,
  MIND_CHANGE_POINTS,
  demographicAgeBucket,
  demographicGender,
  demographicMismatch,
  estimateAvoidedCost,
  personaMindChange,
} from './features.ts';
export type { AffinityMove, CostAssumptions, MindChange, MismatchScore, SkewRow } from './features.ts';
export type { DimensionInput, InsightScore, InsightScoreInput, MeasuredAffinity, MeasuredGroup } from './insights-score.ts';
export {
  FRICTION_FACTOR,
  SUBS1,
  SUBS2,
  WEIGHTS,
  avg,
  clamp100,
  deriveSubs,
  displayScore,
  evidenceKey,
  ledgerPoints,
} from './score.ts';
export type {
  Brief,
  DisplayScore,
  Districts,
  EvidenceDomain,
  EvidencePacket,
  EvidenceRef,
  EvidenceStrength,
  LedgerPoints,
  Subscores,
} from './types.ts';
