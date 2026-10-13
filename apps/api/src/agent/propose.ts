/**
 * Frictions come from the measured packet. Each one becomes at most a few
 * Qloo parameter diffs. The engine, not this file, decides whether they help.
 */
import type { BriefV2, ExplainabilityContribution, InsightSignal, QlooParamDiff } from '@tastedraft/contracts';
import { deriveSubs } from '../engine/score.ts';
import { hasPremiumLanguage, readFacets } from '../engine/sample-evidence.ts';
import type { EvidencePacket } from '../engine/types.ts';
import {
  ageBucket,
  applyDiffsToEngine,
  entityId,
  indieDistrictsExcept,
  nextAgeBand,
  previousAgeBand,
  priceLevelForPositioning,
  SAMPLE_ENTITIES,
  scoreEngine,
  slug,
  type EngineScore,
} from './model.ts';

export type FrictionKind =
  | 'price'
  | 'positioning'
  | 'age'
  | 'gender'
  | 'location'
  | 'channel'
  | 'references';

export interface DetectedFriction {
  id: string;
  kind: FrictionKind;
  text: string;
  evidenceRefs: string[];
  /** Set when the evidence names the replacement, such as `female`. */
  replacement?: string;
}

export interface Candidate {
  id: string;
  kind: FrictionKind;
  frictionText: string;
  evidenceRefs: string[];
  changes: QlooParamDiff[];
}

export interface ScoredCandidate extends Candidate {
  predictedDelta: number;
  total: number;
}

const GENDER_FEMALE = /\bwomen\b|\bwoman\b|\bfemale\b|ผู้หญิง/i;
const GENDER_MALE = /\bmale\b|\bmen\b|ผู้ชาย/i;

export function detectFrictions(
  brief: BriefV2,
  baseline: EngineScore,
  signals: readonly InsightSignal[] = [],
  explainability: readonly ExplainabilityContribution[] = [],
): DetectedFriction[] {
  const packet = baseline.packet;
  const frictions: DetectedFriction[] = [];
  const priceLevel = brief.priceLevel ?? priceLevelForPositioning(brief.positioning);
  const premium = priceLevel >= 3 || /premium|luxury/i.test(brief.positioning) || hasPremiumLanguage(brief.idea);
  if (premium && baseline.points.friction <= -4) {
    frictions.push({
      id: 'friction.price',
      kind: 'price',
      text: 'Premium price pulls against this audience',
      evidenceRefs: ['friction.price', 'audience.age'],
    });
  }
  const place = packet.refs.find((reference) => reference.type === 'Place' && reference.city);
  if (premium && place && /premium|luxury/i.test(brief.positioning)) {
    frictions.push({
      id: 'friction.positioning',
      kind: 'positioning',
      text: 'Premium positioning sits away from the indie place in the evidence',
      evidenceRefs: ['friction.positioning', `ref.${slug(place.name)}`],
    });
  }
  const subs = deriveSubs(baseline.packet);
  const audienceIsWeak = subs.audience <= subs.anchor && subs.audience <= subs.cross && subs.audience <= subs.local;
  if (audienceIsWeak && premium && nextAgeBand(brief.age)) {
    frictions.push({
      id: 'audience.age',
      kind: 'age',
      text: 'This age band is the weak fit for the current price',
      evidenceRefs: ['audience.age'],
    });
  }
  const hinted = hintedGender(signals, explainability);
  if (hinted && brief.gender !== hinted) {
    const ref = genderEvidenceRef(signals, explainability) ?? 'audience.gender';
    frictions.push({
      id: ref,
      kind: 'gender',
      text: 'A measured audience signal does not match the gender on the brief',
      evidenceRefs: [ref],
      replacement: hinted,
    });
  }
  if (premium && baseline.packet.local.penalty != null && baseline.packet.local.penalty > 0) {
    frictions.push({
      id: `local.${slug(brief.city)}`,
      kind: 'location',
      text: 'Local price drag is heavier in this city than in another indie district',
      evidenceRefs: [`local.${slug(brief.city)}`],
    });
  }
  const scarce = brief.constraints.some((item) => /limited|exclusive|scarce/i.test(item)) || /limited|exclusive|scarcity/i.test(brief.idea);
  if (scarce && baseline.packet.scarcity === 'limited') {
    frictions.push({
      id: 'friction.scarcity',
      kind: 'channel',
      text: 'Limited runs add scarcity friction for this audience',
      evidenceRefs: ['friction.scarcity'],
    });
  }
  const weakest = weakestReference(packet);
  if (weakest && weakest.gap >= 15) {
    frictions.push({
      id: `ref.${slug(weakest.name)}`,
      kind: 'references',
      text: 'One reference sits much farther from the idea than the others',
      evidenceRefs: [`ref.${slug(weakest.name)}`],
    });
  }
  const facets = readFacets(brief.idea);
  const hasArtist = brief.references.some((reference) => reference.type.includes('artist') || reference.type === 'Artist');
  if (facets.includes('electronic') && !hasArtist) {
    frictions.push({
      id: 'gap.artist',
      kind: 'references',
      text: 'An electronic idea has no artist reference for the music domain',
      evidenceRefs: ['gap.artist'],
    });
  }
  return frictions;
}

function hintedGender(
  signals: readonly InsightSignal[],
  explainability: readonly ExplainabilityContribution[],
): 'female' | 'male' | null {
  const text = [
    ...signals.map((signal) => `${signal.id} ${signal.name}`),
    ...explainability.map((row) => `${row.input} ${row.target}`),
  ].join('\n');
  const female = GENDER_FEMALE.test(text);
  const male = GENDER_MALE.test(text);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return null;
}

function genderEvidenceRef(
  signals: readonly InsightSignal[],
  explainability: readonly ExplainabilityContribution[],
): string | null {
  const signal = signals.find((row) => GENDER_FEMALE.test(`${row.id} ${row.name}`) || GENDER_MALE.test(`${row.id} ${row.name}`));
  if (signal) return signal.id;
  const row = explainability.find((item) => GENDER_FEMALE.test(`${item.input} ${item.target}`) || GENDER_MALE.test(`${item.input} ${item.target}`));
  return row ? slug(row.input) : null;
}

function weakestReference(packet: EvidencePacket): { name: string; gap: number } | null {
  const measured = packet.refs.filter((reference) => typeof reference.affinity === 'number');
  if (measured.length < 2) return null;
  let top = measured[0]!;
  let low = measured[0]!;
  for (const reference of measured) {
    if ((reference.affinity ?? 0) > (top.affinity ?? 0)) top = reference;
    if ((reference.affinity ?? 0) < (low.affinity ?? 0)) low = reference;
  }
  return { name: low.name, gap: (top.affinity ?? 0) - (low.affinity ?? 0) };
}

export function proposeCandidates(brief: BriefV2, frictions: readonly DetectedFriction[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const friction of frictions) {
    if (friction.kind === 'price') candidates.push(...priceCandidates(brief, friction));
    else if (friction.kind === 'positioning') candidates.push(...positioningCandidates(brief, friction));
    else if (friction.kind === 'age') candidates.push(...ageCandidates(brief, friction));
    else if (friction.kind === 'gender') candidates.push(...genderCandidates(brief, friction));
    else if (friction.kind === 'location') candidates.push(...locationCandidates(brief, friction));
    else if (friction.kind === 'channel') candidates.push(...channelCandidates(friction));
    else if (friction.kind === 'references' && friction.id === 'gap.artist') candidates.push(...addArtistCandidates(brief, friction));
    else if (friction.kind === 'references') candidates.push(...swapCandidates(brief, friction));
  }
  return candidates.filter((candidate) => candidate.changes.every((change) => change.from !== change.to));
}

function priceCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  const level = brief.priceLevel ?? priceLevelForPositioning(brief.positioning);
  if (level <= 1) return [];
  const next = String(level - 1);
  return [
    {
      id: 'price-level',
      kind: 'price',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'filter.price_level.max', from: String(level), to: next }],
    },
  ];
}

function positioningCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  if (!/premium|luxury/i.test(brief.positioning)) return [];
  return [
    {
      id: 'positioning',
      kind: 'positioning',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'signal.interests.tags', from: brief.positioning.toLowerCase(), to: 'independent' }],
    },
  ];
}

function ageCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  const next = nextAgeBand(brief.age);
  if (!next) return [];
  return [
    {
      id: 'audience-age',
      kind: 'age',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'signal.demographics.age', from: ageBucket(brief.age), to: ageBucket(next) }],
    },
  ];
}

function genderCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  const target = friction.replacement === 'female' || friction.replacement === 'male' ? friction.replacement : null;
  if (!target || target === brief.gender) return [];
  return [
    {
      id: 'audience-gender',
      kind: 'gender',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'signal.demographics.gender', from: brief.gender ?? null, to: target }],
    },
  ];
}

function locationCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  let best: { query: string; total: number } | null = null;
  for (const district of indieDistrictsExcept(brief.city)) {
    const changes: QlooParamDiff[] = [
      { param: 'filter.location.query', from: brief.city, to: district.query },
    ];
    const total = scoreEngine(applyDiffsToEngine(brief, changes)).total;
    if (!best || total > best.total || (total === best.total && district.query.localeCompare(best.query) < 0)) {
      best = { query: district.query, total };
    }
  }
  if (!best || best.query === brief.city) return [];
  return [
    {
      id: 'location',
      kind: 'location',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'filter.location.query', from: brief.city, to: best.query }],
    },
  ];
}

function channelCandidates(friction: DetectedFriction): Candidate[] {
  return [
    {
      id: 'channel',
      kind: 'channel',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'filter.tags', from: 'limited-run', to: 'preorder-drop' }],
    },
  ];
}

function swapCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  const weakId = friction.evidenceRefs.find((id) => id.startsWith('ref.'))?.slice(4);
  const weak = brief.references.find((reference) => slug(reference.name) === weakId || reference.id === weakId);
  if (!weak) return [];
  const from = brief.references.map((reference) => reference.id).join(',');
  const to = brief.references
    .filter((reference) => reference.id !== weak.id)
    .map((reference) => reference.id)
    .join(',');
  if (!to) return [];
  return [
    {
      id: 'references-swap',
      kind: 'references',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'signal.interests.entities', from, to }],
    },
  ];
}

function addArtistCandidates(brief: BriefV2, friction: DetectedFriction): Candidate[] {
  const artist = SAMPLE_ENTITIES.find((entity) => entity.type.includes('artist'));
  if (!artist) return [];
  if (brief.references.some((reference) => reference.id === artist.id || reference.name === artist.name)) return [];
  const from = brief.references.map((reference) => entityId(brief, reference.name)).join(',');
  const to = `${from},${artist.id}`;
  return [
    {
      id: 'references-add',
      kind: 'references',
      frictionText: friction.text,
      evidenceRefs: friction.evidenceRefs,
      changes: [{ param: 'signal.interests.entities', from, to }],
    },
  ];
}

/**
 * When the measured frictions have no upward move, try a neighboring age,
 * a second known anchor, or a lighter scarcity. The engine still has to
 * show a positive delta before any of these is offered.
 */
export function rescueCandidates(brief: BriefV2): Candidate[] {
  const out: Candidate[] = [];
  for (const age of [previousAgeBand(brief.age), nextAgeBand(brief.age)]) {
    if (!age) continue;
    const from = ageBucket(brief.age);
    const to = ageBucket(age);
    if (from === to) continue;
    out.push({
      id: `rescue-age-${slug(age)}`,
      kind: 'age',
      frictionText: 'A neighboring age band fits this audience more closely',
      evidenceRefs: ['audience.age'],
      changes: [{ param: 'signal.demographics.age', from, to }],
    });
  }
  const fromIds = brief.references.map((reference) => reference.id).join(',');
  for (const entity of SAMPLE_ENTITIES) {
    if (brief.references.some((reference) => reference.id === entity.id || reference.name === entity.name)) continue;
    const to = fromIds ? `${fromIds},${entity.id}` : entity.id;
    if (to === fromIds) continue;
    out.push({
      id: `rescue-ref-${entity.id}`,
      kind: 'references',
      frictionText: `Adding ${entity.name} gives this idea a second cultural anchor`,
      evidenceRefs: [entity.id],
      changes: [{ param: 'signal.interests.entities', from: fromIds || null, to }],
    });
  }
  const scarce =
    brief.constraints.some((item) => /limited|exclusive|scarce/i.test(item)) || /limited|exclusive|scarcity/i.test(brief.idea);
  if (scarce) {
    out.push({
      id: 'rescue-channel',
      kind: 'channel',
      frictionText: 'A preorder drop is a lighter scarcity signal than a limited run',
      evidenceRefs: ['friction.scarcity'],
      changes: [{ param: 'filter.tags', from: 'limited-run', to: 'preorder-drop' }],
    });
  }
  return out.filter((candidate) => candidate.changes.every((change) => change.from !== change.to));
}

export function simulateCandidates(brief: BriefV2, candidates: readonly Candidate[], baselineTotal: number): ScoredCandidate[] {
  return candidates.map((candidate) => {
    const total = scoreEngine(applyDiffsToEngine(brief, candidate.changes)).total;
    return { ...candidate, total, predictedDelta: total - baselineTotal };
  });
}

export function rankCandidates(scored: readonly ScoredCandidate[]): ScoredCandidate[] {
  return [...scored].sort((a, b) => b.predictedDelta - a.predictedDelta || a.id.localeCompare(b.id));
}
