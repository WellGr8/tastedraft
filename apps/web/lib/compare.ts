import { optionScore } from '@tastedraft/contracts';

/** Compare never sends more than five options to Qloo. */
export const COMPARE_OPTION_CAP = 5;
export const COMPARE_CONCURRENCY = 4;
/** Mean heatmap affinity at or above this is a crowded market. */
export const CROWDED_AT = 0.66;

export type CompareKind = 'cities' | 'neighborhoods' | 'variants';
export type CompareVerdict = 'best-bet' | 'safe-market';

export interface CompareSignal {
  id: string;
  label: string;
  /** Engine fit, 0–100. Kept for the evidence line. The card score is separate. */
  fit: number | null;
  /** Audience alignment, 0–1. Mean measured persona affinity, otherwise engine fit / 100. */
  local: number | null;
  heatmap: number | null;
  popularity: number | null;
  /** Mean nearby-place affinity, 0–1. Higher means a more crowded market. */
  saturation: number | null;
  /** Names from this option's own panel. The reason uses these, not a shared sentence. */
  anchors: string[];
  risk: string;
  reason: string;
  personas: string[];
}

export interface CompareCard extends CompareSignal {
  rank: number | null;
  score: number | null;
  verdict: CompareVerdict | null;
}

export function capCompareLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const capped: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    capped.push(label);
    if (capped.length === COMPARE_OPTION_CAP) break;
  }
  return capped;
}

export function isCrowded(saturation: number | null): boolean {
  return saturation != null && saturation >= CROWDED_AT;
}

/** city-rank-2 points. Local and heatmap are taste lift against that option's popularity. */
export function comparePoints(option: Pick<CompareSignal, 'local' | 'heatmap' | 'popularity'>): number | null {
  return optionScore(option).score;
}

function byScore(a: CompareCard, b: CompareCard): number {
  if (a.score == null && b.score == null) return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  if (b.score !== a.score) return b.score - a.score;
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function tasteOf(anchors: readonly string[]): string {
  const names = anchors.map((name) => name.trim()).filter(Boolean).slice(0, 2);
  if (names.length > 1) return `${names[0]} and ${names[1]}`;
  return names[0] ?? 'this audience';
}

/** A line for this option alone. A good score is curious or better, not a shared rejection. */
export function cardReason(card: Pick<CompareCard, 'label' | 'score' | 'saturation' | 'anchors'>): string {
  const taste = tasteOf(card.anchors);
  const crowded = isCrowded(card.saturation);
  const score = card.score ?? 0;
  if (score >= 60 && !crowded) return `${card.label} fits. ${taste} already shows up here, and the market still has room.`;
  if (score >= 60 && crowded) return `${card.label} has real demand around ${taste}. The audience is there, and the market is already crowded.`;
  if (score >= 52 && !crowded) return `${card.label} is close. ${taste} pulls in this direction, and it is not a crowded market.`;
  if (score >= 52 && crowded) return `${card.label} draws ${taste}, but the neighborhoods are already crowded.`;
  if (!crowded) return `${card.label} has room to enter, though ${taste} is only a partial fit.`;
  return `${card.label} is a weaker fit. ${taste} is the taste on the ground, and the market is crowded.`;
}

/**
 * Sort by the city-rank-2 score, highest first. Equal scores break by label, then id.
 * Ranks are 1..N with no ties. Best bet is the highest of those that are not crowded.
 * Safe big market is the highest crowded option, always a different card.
 */
export function rankCompare(options: readonly CompareSignal[]): CompareCard[] {
  const capped = options.slice(0, COMPARE_OPTION_CAP);
  const cards: CompareCard[] = capped.map((option) => ({
    ...option,
    rank: null,
    score: comparePoints(option),
    verdict: null,
    reason: option.reason,
  }));
  cards.sort(byScore);
  for (const [index, card] of cards.entries()) {
    card.rank = index + 1;
    card.reason = cardReason(card);
    card.risk = riskLine(card.score, card.saturation);
  }
  const open = cards.find((card) => !isCrowded(card.saturation));
  const best = open ?? [...cards].sort((a, b) => (a.saturation ?? 1) - (b.saturation ?? 1) || a.label.localeCompare(b.label))[0];
  if (best) best.verdict = 'best-bet';
  const safe = cards.find((card) => card !== best && isCrowded(card.saturation)) ?? cards.find((card) => card !== best);
  if (safe) safe.verdict = 'safe-market';
  return cards;
}

export function compareSummary(cards: readonly CompareCard[]): string {
  const best = cards.find((card) => card.verdict === 'best-bet');
  const safe = cards.find((card) => card.verdict === 'safe-market');
  if (!best) return 'Add two options to compare.';
  const bestScore = best.score ?? '—';
  const bestWhy = !isCrowded(best.saturation)
    ? best.rank === 1
      ? 'it leads the list and the market is not crowded, so it should sell sooner'
      : 'it is the highest score that is not crowded, so it should sell sooner'
    : 'every option is crowded, so this is the least crowded';
  if (!safe) return `Best bet: ${best.label} (${bestScore}) — ${bestWhy}.`;
  const safeScore = safe.score ?? '—';
  const safeWhy = isCrowded(safe.saturation)
    ? 'the strongest crowded market, real demand with more competition'
    : 'the other market worth knowing';
  return `Best bet: ${best.label} (${bestScore}) — ${bestWhy}. Safe big market: ${safe.label} (${safeScore}) — ${safeWhy}.`;
}

export function saturationLabel(value: number | null): string {
  if (value == null) return 'Not measured';
  if (value >= 0.66) return 'Crowded';
  if (value >= 0.4) return 'Contested';
  return 'Room to enter';
}

export function riskLine(score: number | null, saturation: number | null): string {
  if (isCrowded(saturation)) return 'Crowded market. A new name has to stand out.';
  if (score != null && score >= 60) return 'Good fit, and the market is not crowded.';
  if (score != null && score < 52) return 'Weaker fit for this audience.';
  return 'Close fit. Likely to sell sooner than a crowded market.';
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
