import type { DisplayScore, EvidencePacket, EvidenceStrength, LedgerPoints, Subscores } from './types.ts';

/**
 * Deterministic fit engine.
 * Weights are config (this server owns them); the LLM never sets a number.
 * Points are rounded per row so the ledger sums to the total.
 */
export const WEIGHTS = { anchor: 30, cross: 25, local: 20, audience: 25 } as const;
export const FRICTION_FACTOR = 0.4;

/**
 * The sample evidence provider is calibrated so the default brief still
 * produces these sub-scores. They are the contract, not a live input.
 */
export const SUBS1 = { anchor: 80, cross: 80, local: 74, audience: 68, friction: 12 } as const;
export const SUBS2 = { anchor: 80, cross: 80, local: 90, audience: 88, friction: 6 } as const;

export function clamp100(n: number): number {
  n = Math.round(n);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function avg(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / xs.length;
}

/** True when a packet left a former number unmeasured. Those are gaps, not zeroes. */
export function measurementsMissing(packet: EvidencePacket): boolean {
  if (packet.refs.some((ref) => typeof ref.affinity !== 'number')) return true;
  if (packet.domains.some((domain) => typeof domain.affinity !== 'number')) return true;
  if (typeof packet.local?.base !== 'number' || typeof packet.local?.penalty !== 'number') return true;
  if (typeof packet.audience?.base !== 'number' || typeof packet.audience?.penalty !== 'number') return true;
  if (typeof packet.friction !== 'number') return true;
  if (typeof packet.crossAdjust !== 'number') return true;
  if (typeof packet.signal?.fashion !== 'number') return true;
  if (typeof packet.signal?.music !== 'number') return true;
  if (typeof packet.signal?.design !== 'number') return true;
  return false;
}

/**
 * `packet` is what an evidence provider returns. A Qloo provider can replace
 * the sample one later; this function only reads affinities.
 */
export function deriveSubs(packet: EvidencePacket | null | undefined): Subscores {
  if (packet && measurementsMissing(packet)) {
    throw new Error('deriveSubs received a null signal. Missing evidence is a gap, not zero.');
  }
  const refs = (packet && packet.refs) || [];
  const domains = (packet && packet.domains) || [];
  const anchor = refs.length ? clamp100(avg(refs.map((r) => r.affinity ?? 0))) : 42;
  let cross = 36;
  if (domains.length) {
    // Coverage reaches full weight at 3 domains. Fewer domains scale the mean down.
    // crossAdjust is an evidence gap (for example, an electronic concept with no
    // artist reference). It is 0 for the calibrated default brief.
    const coverage = Math.min(1, domains.length / 3);
    cross = clamp100(avg(domains.map((d) => d.affinity ?? 0)) * coverage + ((packet && packet.crossAdjust) || 0));
  }
  const localIn = (packet && packet.local) || { base: 0, penalty: 0 };
  const audIn = (packet && packet.audience) || { base: 0, penalty: 0 };
  const local = clamp100((localIn.base || 0) - (localIn.penalty || 0));
  const audience = clamp100((audIn.base || 0) - (audIn.penalty || 0));
  const friction = clamp100((packet && packet.friction) || 0);
  return { anchor, cross, local, audience, friction };
}

export function ledgerPoints(subs: Subscores): LedgerPoints {
  const points: LedgerPoints = {
    anchor: Math.round((subs.anchor * WEIGHTS.anchor) / 100),
    cross: Math.round((subs.cross * WEIGHTS.cross) / 100),
    local: Math.round((subs.local * WEIGHTS.local) / 100),
    audience: Math.round((subs.audience * WEIGHTS.audience) / 100),
    friction: -Math.round(subs.friction * FRICTION_FACTOR),
    total: 0,
  };
  points.total = points.anchor + points.cross + points.local + points.audience + points.friction;
  return points;
}

/**
 * Evidence strength is the count of active, non-muted references.
 * 4 or more is HIGH, 2–3 is MEDIUM, fewer than 2 is LIMITED.
 */
export function evidenceKey(activeRefCount: number): EvidenceStrength {
  if (activeRefCount >= 4) return 'HIGH';
  if (activeRefCount >= 2) return 'MEDIUM';
  return 'LIMITED';
}

/**
 * LIMITED scores display rounded to the nearest 5.
 * The ledger underneath keeps the exact sum.
 */
export function displayScore(total: number, activeRefCount: number): DisplayScore {
  const limited = evidenceKey(activeRefCount) === 'LIMITED';
  if (!limited) return { text: String(total), why: 'Why ' + total + '?', limited: false, approx: total };
  const approx = Math.round(total / 5) * 5;
  return { text: '\u2248 ' + approx, why: 'Why \u2248 ' + approx + '?', limited: true, approx };
}
