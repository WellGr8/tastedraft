/**
 * Results view model: ledger provenance, the V1/V2 diff, and the demo timeline.
 * Points and weights are copied off the engine score. This file does not invent them.
 */
import type { BriefV2, Proposal } from '@tastedraft/contracts';
import type { EvidencePacket, EvidenceRef } from '../engine/types.ts';
import {
  ageBucket,
  channelLabel,
  provenanceDetail,
  referenceList,
  weightLabel,
  type EngineScore,
} from './model.ts';

export interface LedgerRowView {
  id: 'anchor' | 'cross' | 'local' | 'audience' | 'friction';
  label: string;
  points: number;
  provenance: string;
}

export interface FieldView {
  label: string;
  value: string;
}

export interface DiffRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface DemoView {
  captions: string[];
  considered: number;
  frictionCount: number;
  honesty: string;
  v1: { total: number; rows: LedgerRowView[]; fields: FieldView[] };
  v2: { total: number; delta: number; rows: LedgerRowView[]; fields: FieldView[] };
  diff: DiffRow[];
  shortlist: Array<{
    id: string;
    param: string;
    from: string | null;
    to: string | null;
    why: string;
    evidenceRefs: string[];
    predictedDelta: number;
  }>;
  approved: {
    id: string;
    why: string;
    param: string;
    from: string | null;
    to: string | null;
    predictedDelta: number;
  };
  timeline: Array<{ id: string; label: string; title: string; score: number; note: string }>;
}

export const DEMO_CAPTIONS = [
  'Default brief. Japanese minimalist streetwear, ages 18–25, Los Angeles, Premium. Version 1 scores 71.',
  'The ledger is anchor 24, cross 20, local 15, audience 17, friction −5. Each row names the Qloo input that contributed.',
  'The agent writes counterfactuals as Qloo parameter diffs. The fixed accessible-premium and pre-order pair is not offered.',
  'Six diffs are scored again by the deterministic engine. The model only writes the reason.',
  'Ranked by that measured lift. The shortlist is price +9, positioning +5, and age +3.',
  'Approving filter.price_level.max 3 → 2 re-scores to 80. Version 1 stays 71 beside it.',
] as const;

const ROW_LABELS = [
  ['anchor', 'Anchor affinity'],
  ['cross', 'Cross-domain fit'],
  ['local', 'Local fit'],
  ['audience', 'Audience fit'],
  ['friction', 'Cultural friction'],
] as const;

export function fieldsOf(brief: BriefV2): FieldView[] {
  const district = brief.locations[0]?.name;
  const location = district && district !== brief.city ? `${district}, ${brief.city}` : brief.city;
  return [
    { label: 'Price level', value: brief.priceLevel == null ? 'Not set' : String(brief.priceLevel) },
    { label: 'Age', value: brief.age },
    { label: 'Gender', value: brief.gender ?? 'Not set' },
    { label: 'Location', value: location },
    { label: 'Channel', value: channelLabel(brief) },
    { label: 'Positioning', value: brief.positioning },
    { label: 'References', value: referenceList(brief) },
  ];
}

export function ledgerRows(brief: BriefV2, score: EngineScore): LedgerRowView[] {
  const inputs = contributions(brief, score.packet);
  return ROW_LABELS.map(([id, label]) => ({
    id,
    label,
    points: score.points[id],
    provenance: provenanceDetail(inputs[id].input, inputs[id].weight),
  }));
}

export function diffRows(before: FieldView[], after: FieldView[]): DiffRow[] {
  return before.map((field, index) => {
    const next = after[index]?.value ?? '';
    return { label: field.label, before: field.value, after: next, changed: field.value !== next };
  });
}

function contributions(brief: BriefV2, packet: EvidencePacket): Record<LedgerRowView['id'], { input: string; weight: string }> {
  const ranked = [...packet.refs].filter((reference) => typeof reference.affinity === 'number');
  ranked.sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
  const top = ranked[0];
  const artist = packet.refs.find((reference) => reference.type === 'Artist') ?? top;
  const place = packet.refs.find((reference) => reference.type === 'Place') ?? top;
  const frictionInput = /premium|luxury/i.test(brief.positioning) || /premium/i.test(brief.idea) ? 'premium' : 'limited-run';
  return {
    anchor: named(top, 'anchor'),
    cross: named(artist, 'cross-domain'),
    local: named(place, brief.city),
    audience: { input: ageBucket(brief.age), weight: weightLabel(packet.audience.base ?? 0) },
    friction: { input: frictionInput, weight: weightLabel(packet.friction ?? 0) },
  };
}

function named(reference: EvidenceRef | undefined, fallback: string): { input: string; weight: string } {
  if (!reference || typeof reference.affinity !== 'number') return { input: fallback, weight: weightLabel(0) };
  return { input: reference.name, weight: weightLabel(reference.affinity) };
}

function shortOf(proposal: Proposal) {
  const change = proposal.changes[0];
  return {
    id: proposal.id,
    param: change?.param ?? '',
    from: change?.from ?? null,
    to: change?.to ?? null,
    why: proposal.why,
    evidenceRefs: proposal.evidenceRefs,
    predictedDelta: proposal.predictedDelta ?? 0,
  };
}

export function demoView(input: {
  brief: BriefV2;
  considered: number;
  frictionCount: number;
  proposals: Proposal[];
  approvalBrief: BriefV2;
  proposal: Proposal;
  delta: number;
  v1: EngineScore;
  v2: EngineScore;
}): DemoView {
  const approved = shortOf(input.proposal);
  const before = fieldsOf(input.brief);
  const after = fieldsOf(input.approvalBrief);
  const v1Rows = ledgerRows(input.brief, input.v1);
  const v2Rows = ledgerRows(input.approvalBrief, input.v2);
  return {
    captions: [...DEMO_CAPTIONS],
    considered: input.considered,
    frictionCount: input.frictionCount,
    honesty:
      'Sample graph, rendered in the Qloo explainability shape. A live key replaces the weights. The engine, not the model, sets every point and every predicted lift.',
    v1: { total: input.v1.total, rows: v1Rows, fields: before },
    v2: { total: input.v2.total, delta: input.delta, rows: v2Rows, fields: after },
    diff: diffRows(before, after),
    shortlist: input.proposals.map(shortOf),
    approved,
    timeline: [
      {
        id: 'v1',
        label: 'Version 1',
        title: 'Default brief',
        score: input.v1.total,
        note: `${input.brief.positioning} · ${input.brief.age} · ${input.brief.city}`,
      },
      {
        id: 'v2',
        label: 'Version 2',
        title: `${approved.param} ${approved.from ?? 'none'} → ${approved.to ?? 'none'}`,
        score: input.v2.total,
        note: approved.why,
      },
    ],
  };
}
