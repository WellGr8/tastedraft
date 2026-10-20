import { stripEntityIds } from '@tastedraft/contracts';

/** Ease a score from the first version to the second. `t` is 0–1. */
export function revealAt(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - clamped) ** 3;
  return Math.round(from + (to - from) * eased);
}

/** The Qloo names that explain a move, without raw ids. */
export function moveEvidence(
  beforeNames: readonly string[],
  afterNames: readonly string[],
  reason: string | null,
  friction: string | null,
): string {
  const before = new Set(beforeNames.map((name) => name.trim()).filter(Boolean));
  const after = afterNames.map((name) => stripEntityIds(name)).filter(Boolean);
  const fresh = after.filter((name) => !before.has(name));
  const names = (fresh.length ? fresh : after).slice(0, 2);
  const cited = names.join(' and ');
  const verb = names.length > 1 ? 'are' : 'is';
  const cleanReason = reason ? stripEntityIds(reason) : '';
  const usefulReason = cleanReason && !/could not score|no qloo/i.test(cleanReason) ? cleanReason : '';
  if (cited && usefulReason) return `${cited}. ${usefulReason}`;
  if (cited && friction) return `${cited} ${verb} the Qloo taste that moved this. Snag: ${stripEntityIds(friction)}.`;
  if (cited) return `${cited} ${verb} the Qloo taste behind this score.`;
  return 'No Qloo anchor on this version.';
}
