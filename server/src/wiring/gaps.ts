import {
  FRICTION_FACTOR,
  WEIGHTS,
  avg,
  clamp100,
  deriveSubs,
  displayScore,
  evidenceKey,
  ledgerPoints,
  measurementsMissing,
} from '../engine/score.ts';
import type { DisplayScore, EvidencePacket, EvidenceStrength } from '../engine/types.ts';

export type ScoreDimension = 'anchor' | 'cross' | 'local' | 'audience' | 'friction';

export interface NullableSubs {
  anchor: number | null;
  cross: number | null;
  local: number | null;
  audience: number | null;
  friction: number | null;
}

/** Weighted rows. A null cell was not measured and is not a zero. */
export interface NullableLedger {
  anchor: number | null;
  cross: number | null;
  local: number | null;
  audience: number | null;
  friction: number | null;
  /** Present only on older stored rows. The HTTP ledger omits it; `score` is the total. */
  total?: number | null;
}

export interface ScoredPacket {
  score: number | null;
  subs: NullableSubs;
  ledger: NullableLedger;
  evidenceStrength: EvidenceStrength;
  gaps: ScoreDimension[];
  display: DisplayScore | null;
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Score a packet without turning a missing signal into 0.
 * A fully measured packet uses the calibrated deriveSubs path (default brief 71, applied 82).
 * A null dimension is left out of the total and forces evidenceStrength LIMITED.
 */
export function scorePacket(packet: EvidencePacket): ScoredPacket {
  if (!measurementsMissing(packet)) {
    const subs = deriveSubs(packet);
    const points = ledgerPoints(subs);
    const active = packet.refs.length;
    return {
      score: points.total,
      subs,
      ledger: {
        anchor: points.anchor,
        cross: points.cross,
        local: points.local,
        audience: points.audience,
        friction: points.friction,
      },
      evidenceStrength: evidenceKey(active),
      gaps: [],
      display: displayScore(points.total, active),
    };
  }
  return scorePartial(packet);
}

function scorePartial(packet: EvidencePacket): ScoredPacket {
  const gaps: ScoreDimension[] = [];
  const affinities = packet.refs.map((ref) => ref.affinity).filter(isNum);
  let anchor: number | null;
  if (affinities.length) anchor = clamp100(avg(affinities));
  else if (packet.refs.length === 0) anchor = 42;
  else {
    anchor = null;
    gaps.push('anchor');
  }

  const domainValues = packet.domains.map((domain) => domain.affinity).filter(isNum);
  let cross: number | null;
  if (domainValues.length) {
    const coverage = Math.min(1, domainValues.length / 3);
    let value = avg(domainValues) * coverage;
    if (isNum(packet.crossAdjust)) value += packet.crossAdjust;
    cross = clamp100(value);
  } else if (packet.domains.length === 0 && packet.refs.length === 0) {
    cross = 36;
  } else {
    cross = null;
    gaps.push('cross');
  }

  const local = side(packet.local?.base ?? null, packet.local?.penalty ?? null, 'local', gaps);
  const audience = side(packet.audience?.base ?? null, packet.audience?.penalty ?? null, 'audience', gaps);
  let friction: number | null;
  if (isNum(packet.friction)) friction = clamp100(packet.friction);
  else {
    friction = null;
    gaps.push('friction');
  }

  const subs: NullableSubs = { anchor, cross, local, audience, friction };
  const ledger: NullableLedger = {
    anchor: weighted(anchor, WEIGHTS.anchor),
    cross: weighted(cross, WEIGHTS.cross),
    local: weighted(local, WEIGHTS.local),
    audience: weighted(audience, WEIGHTS.audience),
    friction: friction == null ? null : -Math.round(friction * FRICTION_FACTOR),
  };
  const present = [ledger.anchor, ledger.cross, ledger.local, ledger.audience, ledger.friction].filter(isNum);
  const score = present.length ? present.reduce((sum, row) => sum + row, 0) : null;
  const measuredRefs = affinities.length;
  const evidenceStrength: EvidenceStrength =
    gaps.length > 0 || measuredRefs < packet.refs.length ? 'LIMITED' : evidenceKey(packet.refs.length);
  return {
    score,
    subs,
    ledger,
    evidenceStrength,
    gaps,
    display: score == null ? null : displayScore(score, evidenceStrength === 'LIMITED' ? 0 : packet.refs.length),
  };
}

function side(
  base: number | null,
  penalty: number | null,
  name: ScoreDimension,
  gaps: ScoreDimension[],
): number | null {
  if (!isNum(base)) {
    gaps.push(name);
    return null;
  }
  if (!isNum(penalty)) return clamp100(base);
  return clamp100(base - penalty);
}

function weighted(sub: number | null, weight: number): number | null {
  if (sub == null) return null;
  return Math.round((sub * weight) / 100);
}
