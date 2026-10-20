/**
 * Relative ranking for a taste across options (cities, in the case studies).
 * Compare mode and the case-study probe both call `rankOptions`. Neither
 * reimplements the sort or the weights.
 *
 * city-rank-2 was locked 2026-10-14, after the city-rank-1 live run ranked
 * every real city 1 of 5 because raw popularity crowned Tokyo and New York,
 * and before the rerun. Local and heatmap are taste lift: affinity divided
 * by that option's popularity (market size), then scaled. Popularity itself
 * keeps a small weight so size cannot decide the rank. A missing measurement
 * stays null. It is not filled with zero. Ties share a rank (1, 1, 3).
 * Display order inside a tie follows the caller's list order, which for case
 * studies is the locked city list.
 */
import { QLOO_DEMOGRAPHIC_AGES } from './features.ts';

export const RANK_RULE = {
  version: 'city-rank-2',
  lockedOn: '2026-10-14',
  topK: 2,
  /** Taste lift uses 60 + 35. Popularity is 5 so a capital cannot win on size. */
  weights: { local: 60, heatmap: 35, popularity: 5 },
  /**
   * Affinity / popularity is 1 when taste matches market size.
   * Divide by this and cap at 1 so a tiny market cannot score past a full lift.
   */
  liftScale: 2,
  /** Sent on every insights call. Same value for every case and every city. */
  trends: 'mid',
  /** Primary entity plus this many closest neighbors. */
  maxRelated: 4,
  /** Search + related entities + demographics, then two calls per city. */
  fixedCalls: 3,
  callsPerOption: 2,
} as const;

export type PanelConfidence = 'HIGH' | 'MEDIUM' | 'LIMITED';

export type RankPolarity = 'positive' | 'negative';

export interface RankOptionInput {
  id: string;
  label: string;
  /** Mean place affinity, 0–1. */
  local: number | null;
  /** Mean in-bounds heatmap affinity, 0–1. */
  heatmap: number | null;
  /** Mean popularity, 0–1. Heatmap popularity first, otherwise place popularity. */
  popularity: number | null;
}

export interface RankedOption {
  id: string;
  label: string;
  score: number | null;
  rank: number | null;
  parts: { local: number | null; heatmap: number | null; popularity: number | null };
}

export interface AudienceSkew {
  dimension: 'age' | 'gender';
  bucket: string;
  value: number;
}

export interface LeadingAudience {
  age: string | null;
  gender: string | null;
  ageValue: number | null;
  genderValue: number | null;
}

const GENDERS = new Set(['female', 'male']);
const AGES = new Set<string>(QLOO_DEMOGRAPHIC_AGES);

function unitPoints(value: number | null, weight: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return Math.round(value * weight);
}

/**
 * Taste per unit of market size. Popularity is that option's own size, not a
 * shared national constant (a shared divisor would not change the order).
 * Missing or non-positive size leaves the affinity as-is.
 */
export function tasteLift(affinity: number | null, popularity: number | null): number | null {
  if (typeof affinity !== 'number' || !Number.isFinite(affinity) || affinity < 0 || affinity > 1) return null;
  if (typeof popularity !== 'number' || !Number.isFinite(popularity) || popularity <= 0 || popularity > 1) return affinity;
  return Math.min(1, affinity / popularity / RANK_RULE.liftScale);
}

/** Points for one option. Null when every part is missing. */
export function optionScore(input: Pick<RankOptionInput, 'local' | 'heatmap' | 'popularity'>): {
  score: number | null;
  parts: RankedOption['parts'];
} {
  const parts = {
    local: unitPoints(tasteLift(input.local, input.popularity), RANK_RULE.weights.local),
    heatmap: unitPoints(tasteLift(input.heatmap, input.popularity), RANK_RULE.weights.heatmap),
    popularity: unitPoints(input.popularity, RANK_RULE.weights.popularity),
  };
  const present = [parts.local, parts.heatmap, parts.popularity].filter((points): points is number => points != null);
  return { score: present.length ? present.reduce((sum, points) => sum + points, 0) : null, parts };
}

/**
 * Rank options by score, highest first. Unscored options stay at the end
 * and have a null rank. They are not treated as zero.
 */
export function rankOptions(options: readonly RankOptionInput[]): RankedOption[] {
  const scored = options.map((option, index) => ({ option, index, ...optionScore(option) }));
  scored.sort((a, b) => {
    if (a.score == null && b.score == null) return a.index - b.index;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  let rank = 0;
  let previous: number | null = null;
  return scored.map((item, position) => {
    let assigned: number | null = null;
    if (item.score != null) {
      if (previous == null || item.score !== previous) {
        rank = position + 1;
        previous = item.score;
      }
      assigned = rank;
    }
    return {
      id: item.option.id,
      label: item.option.label,
      score: item.score,
      rank: assigned,
      parts: item.parts,
    };
  });
}

/**
 * A positive launch hits when its option is in the top `topK`.
 * A negative launch hits when its option is in the bottom `topK`.
 * The middle is a miss for both. A null rank is unscored.
 */
export function realCityHit(rank: number | null, optionCount: number, polarity: RankPolarity): boolean | null {
  if (rank == null || optionCount < 1 || rank < 1 || rank > optionCount) return null;
  if (polarity === 'positive') return rank <= RANK_RULE.topK;
  const bottomStart = optionCount - RANK_RULE.topK + 1;
  return rank >= bottomStart;
}

export function meanRank(ranks: readonly number[]): number | null {
  if (!ranks.length) return null;
  const mean = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
  return Math.round(mean * 100) / 100;
}

/** Same bands as the engine: 4 or more HIGH, 2–3 MEDIUM, fewer than 2 LIMITED. */
export function panelConfidence(referenceCount: number): PanelConfidence {
  if (referenceCount >= 4) return 'HIGH';
  if (referenceCount >= 2) return 'MEDIUM';
  return 'LIMITED';
}

function leading(skews: readonly AudienceSkew[], allowed: ReadonlySet<string>): { bucket: string; value: number } | null {
  const rows = skews.filter((skew) => allowed.has(skew.bucket) && Number.isFinite(skew.value));
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.bucket.localeCompare(b.bucket));
  const winner = sorted[0]!;
  if (winner.value <= 0) return null;
  return { bucket: winner.bucket, value: winner.value };
}

/**
 * The audience is the strongest positive age bucket and the strongest
 * positive gender on the demographics payload. A non-positive skew is not
 * a target. Ties break by bucket name. The same audience is used for every option.
 */
export function leadingAudience(skews: readonly AudienceSkew[]): LeadingAudience {
  const ageRows = skews.filter((skew) => skew.dimension === 'age');
  const genderRows = skews.filter((skew) => skew.dimension === 'gender');
  const age = leading(ageRows, AGES);
  const gender = leading(genderRows, GENDERS);
  return {
    age: age?.bucket ?? null,
    gender: gender?.bucket ?? null,
    ageValue: age?.value ?? null,
    genderValue: gender?.value ?? null,
  };
}

export function caseStudyCallEstimate(cases: number, optionsPerCase: number): number {
  return cases * (RANK_RULE.fixedCalls + optionsPerCase * RANK_RULE.callsPerOption);
}
