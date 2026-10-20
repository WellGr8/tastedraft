/**
 * Case studies and Compare mode both import `rankOptions`.
 * The implementation lives in `@tastedraft/contracts` so the web app can use it too.
 */
export {
  RANK_RULE,
  caseStudyCallEstimate,
  leadingAudience,
  meanRank,
  optionScore,
  panelConfidence,
  rankOptions,
  realCityHit,
} from '@tastedraft/contracts';

export type {
  AudienceSkew,
  LeadingAudience,
  PanelConfidence,
  RankOptionInput,
  RankPolarity,
  RankedOption,
} from '@tastedraft/contracts';
