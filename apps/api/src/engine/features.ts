/**
 * Deterministic feature scores.
 * Demographic mismatch, avoided market-test cost, and the re-interview
 * changed-mind flag are computed here. A model does not set these numbers.
 * The Rust engine mirrors the same formulas in `packages/engine-rs/src/features.rs`.
 */

export const DEMOGRAPHIC_AGE_ORDER = [
  '24_and_younger',
  '25_to_29',
  '30_to_34',
  '35_to_44',
  '45_to_54',
  '55_and_older',
] as const;

/** A persona changes their mind when the 0–100 engine score moves by at least this many points. */
export const MIND_CHANGE_POINTS = 5;

const PRODUCT_AGE: Record<string, string> = {
  '18–25': '24_and_younger',
  '18-25': '24_and_younger',
  '26–35': '30_to_34',
  '26-35': '30_to_34',
  '36–45': '35_to_44',
  '36-45': '35_to_44',
  '46+': '45_to_54',
  '35-44': '35_to_44',
  '35–44': '35_to_44',
};

export interface SkewRow {
  dimension: 'age' | 'gender';
  bucket: string;
  value: number;
}

export interface MismatchScore {
  mismatch: number;
  peak: { bucket: string; value: number } | null;
  targetValue: number | null;
}

export interface CostAssumptions {
  pilotCost: number | null;
  focusGroupCost: number | null;
  sampleSize: number;
  roundsAvoided: number;
}

export interface AffinityMove {
  id: string;
  name: string;
  before: number | null;
  after: number | null;
}

export interface MindChange {
  delta: number | null;
  changedMind: boolean;
  reason: string;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Product band or a Qloo bucket. Unknown text is null so the caller does not invent a bucket. */
export function demographicAgeBucket(age: string): string | null {
  const trimmed = age.trim();
  if (PRODUCT_AGE[trimmed]) return PRODUCT_AGE[trimmed];
  if ((DEMOGRAPHIC_AGE_ORDER as readonly string[]).includes(trimmed)) return trimmed;
  return null;
}

export function demographicGender(gender: string | undefined): 'male' | 'female' | null {
  if (!gender) return null;
  const value = gender.trim().toLowerCase();
  if (value === 'female' || value === 'f') return 'female';
  if (value === 'male' || value === 'm') return 'male';
  return null;
}

/**
 * How far a reference's demographic skew sits from the target audience.
 * 0 is a peak on the target bucket with a strong positive skew. 100 is no overlap.
 * Age distance is the bucket gap. Skew penalty treats +1 as a fit and −1 as a miss.
 */
export function demographicMismatch(
  skew: readonly SkewRow[],
  targetAge: string | null,
  targetGender: 'male' | 'female' | null,
): MismatchScore {
  const ages = skew.filter((row) => row.dimension === 'age');
  let peak: { bucket: string; value: number } | null = null;
  for (const row of ages) {
    const earlier = peak ? DEMOGRAPHIC_AGE_ORDER.indexOf(row.bucket as (typeof DEMOGRAPHIC_AGE_ORDER)[number]) : -1;
    const peakAt = peak ? DEMOGRAPHIC_AGE_ORDER.indexOf(peak.bucket as (typeof DEMOGRAPHIC_AGE_ORDER)[number]) : -1;
    const wins = !peak || row.value > peak.value || (row.value === peak.value && earlier >= 0 && (peakAt < 0 || earlier < peakAt));
    if (wins) peak = { bucket: row.bucket, value: row.value };
  }
  const targetRow = targetAge ? ages.find((row) => row.bucket === targetAge) : undefined;
  const targetValue = targetRow ? targetRow.value : null;
  const peakIndex = peak ? DEMOGRAPHIC_AGE_ORDER.indexOf(peak.bucket as (typeof DEMOGRAPHIC_AGE_ORDER)[number]) : -1;
  const targetIndex = targetAge ? DEMOGRAPHIC_AGE_ORDER.indexOf(targetAge as (typeof DEMOGRAPHIC_AGE_ORDER)[number]) : -1;
  const distance = peakIndex < 0 || targetIndex < 0 ? 1 : Math.abs(peakIndex - targetIndex) / (DEMOGRAPHIC_AGE_ORDER.length - 1);
  const skewPenalty = targetValue == null ? 1 : clamp01((1 - targetValue) / 2);
  const agePart = 0.55 * distance + 0.45 * skewPenalty;
  let combined = agePart;
  if (targetGender) {
    const genderRow = skew.find((row) => row.dimension === 'gender' && row.bucket === targetGender);
    const genderPenalty = genderRow ? clamp01((1 - genderRow.value) / 2) : 1;
    combined = 0.75 * agePart + 0.25 * genderPenalty;
  }
  return { mismatch: Math.round(clamp01(combined) * 100), peak, targetValue };
}

/**
 * Market-test spend the product decision avoids.
 * One round costs the pilot plus the focus group (per person × sample size).
 * A missing cost is 0. The result is an estimate, not a forecast.
 */
export function estimateAvoidedCost(input: CostAssumptions): { perRound: number; costAvoided: number; formula: string } {
  const pilot = input.pilotCost ?? 0;
  const focus = (input.focusGroupCost ?? 0) * input.sampleSize;
  const perRoundCents = Math.round((pilot + focus) * 100);
  const avoidedCents = perRoundCents * input.roundsAvoided;
  return {
    perRound: perRoundCents / 100,
    costAvoided: avoidedCents / 100,
    formula: 'costAvoided = roundsAvoided × (pilotCost + focusGroupCost × sampleSize). A missing cost counts as 0. This is an estimate, not a sales forecast.',
  };
}

/** Compares two engine subscores. The reason cites the reference whose affinity moved the most. */
export function personaMindChange(before: number | null, after: number | null, moves: readonly AffinityMove[]): MindChange {
  if (before == null || after == null) {
    return {
      delta: null,
      changedMind: false,
      reason: 'The engine could not score both versions, so this persona is not marked as having changed their mind.',
    };
  }
  const delta = after - before;
  const changedMind = Math.abs(delta) >= MIND_CHANGE_POINTS;
  const ranked = moves
    .map((move) => ({
      ...move,
      gap: move.before == null && move.after == null
        ? -1
        : Math.abs((move.after ?? 0) - (move.before ?? 0)),
    }))
    .filter((move) => move.gap >= 0)
    .sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id));
  const top = ranked[0];
  const shown = (value: number | null) => (value == null ? 'unmeasured' : value.toFixed(2));
  const shift = top
    ? ` Largest shift: ${top.name} (${top.id}) affinity ${shown(top.before)} → ${shown(top.after)}.`
    : '';
  const signed = delta > 0 ? `+${delta}` : String(delta);
  const where = changedMind ? 'past' : 'inside';
  return {
    delta,
    changedMind,
    reason: `Engine score moved from ${before} to ${after} (${signed}), ${where} the ${MIND_CHANGE_POINTS}-point threshold.${shift}`,
  };
}
