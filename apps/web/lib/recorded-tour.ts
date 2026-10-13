import {
  FRICTION_LABEL,
  PERSONA_RESPONSE_LABEL,
  RunSnapshotSchema,
  type BriefV2,
  type RunSnapshot,
} from '@tastedraft/contracts';
import { scoreLive, type LiveScore } from './engine-preview.ts';
import { playbackDistricts } from './places.ts';

/** Place labels and weights from apps/api/src/runner/recordings/tokyo-tour.json. */
export const RECORDED_AREAS = [
  { label: 'Shimokitazawa', weight: 0.84, price: null as number | null, popularity: null as number | null },
  { label: 'Koenji', weight: 0.71, price: null, popularity: null },
  { label: 'Shibuya', weight: 0.66, price: null, popularity: null },
] as const;

export const RECORDED_NOTE = 'Recorded run. Demographic skew was not in this playback.';

const SLICES: Array<{ age: string; gender: 'female' | 'male'; indexes: number[] }> = [
  { age: '18–25', gender: 'female', indexes: [0, 1] },
  { age: '26–35', gender: 'male', indexes: [1, 2] },
  { age: '36–45', gender: 'female', indexes: [2, 3] },
  { age: '46+', gender: 'male', indexes: [3, 0] },
];

function posture(price: number): string | null {
  if (price === 1) return 'Mass';
  if (price === 2) return 'accessible';
  if (price === 4) return 'Luxury';
  return null;
}

function position(price: number): string {
  if (price === 1) return 'Mass';
  if (price === 2) return 'Independent';
  if (price === 4) return 'Luxury';
  return 'Premium';
}

function scarcityOf(brief: BriefV2): string {
  if (brief.constraints.some((item) => /preorder/i.test(item))) return 'preorder';
  if (brief.constraints.some((item) => /limited/i.test(item))) return 'limited';
  return 'none';
}

function ledger(scored: LiveScore) {
  const points = (id: string) => scored.rows.find((row) => row.id === id)?.points ?? null;
  return {
    anchor: points('anchor'),
    cross: points('cross'),
    local: points('local'),
    audience: points('audience'),
    friction: points('friction'),
  };
}

export async function scoreBrief(brief: BriefV2, priceLevel: number = brief.priceLevel ?? 3): Promise<LiveScore> {
  return scoreLive({
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    pos: position(priceLevel),
    refs: brief.references.map((item) => item.name),
    posture: posture(priceLevel),
    scarcity: scarcityOf(brief),
  });
}

/** Engine playback for the tour when live Qloo does not return in time. */
export function recordedSnapshot(brief: BriefV2, before: number, delta: number): RunSnapshot | null {
  const from = brief.priceLevel ?? 3;
  const to = from > 1 ? from - 1 : null;
  const strength = brief.references.length >= 4 ? 'HIGH' : brief.references.length >= 2 ? 'MEDIUM' : 'LIMITED';
  const evidence = [
    ...brief.references.slice(0, 4).map((entity) => ({
      id: `ev:recorded-${entity.id}`,
      name: entity.name,
      kind: 'entity' as const,
      ref: entity.id,
      strength,
      affinity: null,
      source: 'recorded',
    })),
    {
      id: 'ev:recorded-live-music',
      name: brief.interests[0]?.name ?? 'launch',
      kind: 'tag' as const,
      ref: 'tag-live',
      strength,
      affinity: null,
      source: 'recorded',
    },
  ];
  const playback = playbackDistricts(brief.city);
  const cells = playback.map((area) => ({
    id: `cell-${area.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    lat: area.lat,
    lng: area.lng,
    weight: area.weight,
    label: area.label,
  }));
  const firstEvidence = evidence[0]?.id ?? 'ev:recorded-live-music';
  const personas = SLICES.flatMap((slice) => {
    const anchors = slice.indexes
      .map((index) => brief.references[index])
      .filter((entity): entity is BriefV2['references'][number] => Boolean(entity))
      .slice(0, 2)
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        affinity: null,
        ...(entity.image ? { image: entity.image } : {}),
      }));
    if (!anchors.length) return [];
    const taste = anchors.map((entity) => ({
      name: entity.name,
      type: entity.type,
      affinity: null,
    }));
    return [
      {
        id: `recorded-${brief.city}-${slice.age}-${slice.gender}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label: `${brief.city} ${slice.age} ${slice.gender}`,
        location: brief.city,
        age: slice.age,
        gender: slice.gender,
        anchors,
        ...(taste.length ? { taste } : {}),
        quote: 'Simulated persona response',
        quoteLabel: PERSONA_RESPONSE_LABEL,
      },
    ];
  });
  const proposals =
    to && delta > 0
      ? [
          {
            id: 'recorded-merch-price',
            changes: [{ param: 'filter.price_level.max', from: String(from), to: String(to) }],
            why: 'Lower the price one level. The engine scores that higher for this audience.',
            evidenceRefs: [firstEvidence],
            predictedDelta: delta,
          },
        ]
      : [];
  const parsed = RunSnapshotSchema.safeParse({
    id: 'recorded-tour',
    status: proposals.length ? 'awaiting_approval' : 'stopped',
    version: 1,
    round: 0,
    qlooCalls: 0,
    budget: 40,
    score: before,
    evidenceStrength: strength,
    stopReason: proposals.length ? null : 'no_meaningful_improvement',
    grounding: 'recorded',
    personas,
    frictions: [
      {
        id: 'friction-price',
        hypothesis: 'Premium price',
        label: FRICTION_LABEL,
        evidenceRefs: [firstEvidence],
        confidence: strength,
      },
    ],
    evidence,
    districts: cells,
    proposals,
    applied: [],
    links: proposals.map((item) => ({
      proposalId: item.id,
      entities: evidence.filter((row) => row.kind === 'entity').map((row) => row.id).slice(0, 4),
      tags: ['ev:recorded-live-music'],
      cells: cells.map((cell) => cell.label),
    })),
    steps: [
      {
        id: 'rec-1',
        seq: 1,
        kind: 'score',
        label: 'Recorded run. Scoring this launch on the engine.',
        detail: 'Playback. Affinities were not measured on this pass.',
      },
    ],
    report: 'Recorded run.',
    simulation: {
      version: 1,
      total: before,
      ledger: { anchor: null, cross: null, local: null, audience: null, friction: null },
      evidenceStrength: strength,
      mode: 'sample',
    },
  });
  return parsed.success ? parsed.data : null;
}

export async function buildRecordedRun(brief: BriefV2): Promise<RunSnapshot | null> {
  const from = brief.priceLevel ?? 3;
  const to = from > 1 ? from - 1 : null;
  try {
    const before = await scoreBrief(brief, from);
    const after = to ? await scoreBrief(brief, to) : null;
    const delta = after ? after.total - before.total : 0;
    const snapshot = recordedSnapshot(brief, before.total, delta);
    if (!snapshot?.simulation) return snapshot;
    return { ...snapshot, simulation: { ...snapshot.simulation, ledger: ledger(before) } };
  } catch {
    return null;
  }
}
