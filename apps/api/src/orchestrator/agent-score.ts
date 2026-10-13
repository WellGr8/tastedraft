/**
 * One scoring decision for a stored brief.
 * The default streetwear demo stays on the calibrated sample graph.
 * Any other BriefV2 — different idea, interests, city, or resolved cards — is scored by runInsights.
 * Proposals always come from the taste agent. The older posture/scarcity pair is not emitted.
 */
import type { BriefV2, ExplainabilityContribution, InsightSignal, QlooParamDiff } from '@tastedraft/contracts';
import { runAgent, type AgentRun } from '../agent/loop.ts';
import { defaultBriefV2, SAMPLE_ENTITIES, slug } from '../agent/model.ts';
import { DEMO_CAPTIONS, ledgerRows } from '../agent/view.ts';
import type { RecommendationChange } from '../domain/llm.ts';
import type { Friction, Signal } from '../domain/llm.ts';
import { DEFAULT_BRIEF, DEFAULT_IDEA, isCityName } from '../engine/constants.ts';
import { displayScore } from '../engine/score.ts';
import type { Brief, Districts, EvidencePacket } from '../engine/types.ts';
import type { ScoredPacket } from '../wiring/gaps.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { runInsights, type InsightsRun } from '../providers/qloo/insights.ts';

const DEFAULT_TAGS = ['tag-electronic', 'tag-japanese', 'tag-minimal', 'tag-streetwear'];

export interface ScoreDecision {
  mode: 'sample' | 'insights';
  briefV2: BriefV2;
  scored: ScoredPacket | null;
  insights: InsightsRun | null;
}

export interface AgentDecision {
  run: AgentRun | null;
  frictions: Friction[];
  recommendations: Array<{
    before: string;
    after: string;
    why: string;
    evidence: string;
    evidenceIds: string[];
    change: RecommendationChange;
    predictedDelta: number;
    param: string;
    from: string | null;
    to: string | null;
  }>;
  considered: number;
}

export interface StoryView {
  mode: 'sample' | 'insights';
  considered: number;
  baseline: number | null;
  captions: string[];
  provenance: Array<{ id: string; label: string; points: number | null; detail: string }>;
}

const PARAM_LABEL: Record<string, string> = {
  'filter.price_level.max': 'Price level',
  'filter.price_level.min': 'Price level',
  'signal.interests.tags': 'Positioning',
  'signal.demographics.age': 'Age',
  'signal.demographics.gender': 'Gender',
  'filter.location.query': 'Location',
  'filter.tags': 'Channel',
  'signal.interests.entities': 'References',
};

/** Prototype briefs with no card payload stay on whatever provider the app was given. */
export function isCalibratedDemo(brief: Brief): boolean {
  const v2 = brief.briefV2;
  if (!v2) return true;
  if (v2.idea.trim() !== DEFAULT_IDEA) return false;
  if (!isCityName(v2.city) || v2.city !== DEFAULT_BRIEF.city) return false;
  const names = v2.references.map((reference) => reference.name).sort().join('\n');
  const expected = [...DEFAULT_BRIEF.refs].sort().join('\n');
  if (names !== expected) return false;
  const tags = v2.interests.map((tag) => tag.id).sort();
  if (tags.length && tags.join('\n') !== [...DEFAULT_TAGS].sort().join('\n')) return false;
  return true;
}

export function briefForAgent(brief: Brief): BriefV2 {
  if (brief.briefV2) return brief.briefV2;
  if (
    brief.idea.trim() === DEFAULT_IDEA &&
    brief.city === DEFAULT_BRIEF.city &&
    brief.age === DEFAULT_BRIEF.age &&
    [...brief.refs].sort().join('\n') === [...DEFAULT_BRIEF.refs].sort().join('\n') &&
    !brief.posture &&
    !brief.scarcity
  ) {
    return defaultBriefV2();
  }
  return synthesizeBrief(brief);
}

export async function scoreInsightsBrief(brief: BriefV2, env: { QLOO_API_KEY?: string } = process.env): Promise<InsightsRun> {
  const client = new QlooClient({ apiKey: env.QLOO_API_KEY });
  return runInsights(client, brief);
}

export function scoredFromInsights(run: InsightsRun, activeRefs: number): ScoredPacket {
  const cell = (id: string) => run.ledger.rows.find((row) => row.id === id)?.points ?? null;
  const ledger = {
    anchor: cell('anchor'),
    cross: cell('cross'),
    local: cell('local'),
    audience: cell('audience'),
    friction: cell('friction'),
  };
  return {
    score: run.ledger.total,
    subs: run.subscores,
    ledger,
    evidenceStrength: run.evidenceStrength,
    gaps: run.gaps,
    display: run.ledger.total == null ? null : displayScore(run.ledger.total, activeRefs),
  };
}

export function packetFromInsights(brief: Brief, run: InsightsRun): EvidencePacket {
  const byId = new Map<string, InsightSignal>();
  for (const signal of run.signals) {
    const prev = byId.get(signal.id);
    if (!prev || (signal.affinity ?? -1) > (prev.affinity ?? -1)) byId.set(signal.id, signal);
  }
  const refs = [...byId.values()].map((signal) => ({
    name: signal.name,
    type: signal.type,
    fit: 'photo',
    provenance: signal.affinity == null ? 'unmeasured' : signal.source,
    affinity: signal.affinity == null ? null : Math.round(signal.affinity * 100),
    minimal: null,
    electronic: null,
    streetwear: null,
    city: brief.city,
  }));
  const sub = run.subscores;
  return {
    sourceId: 'qloo',
    mixed: false,
    facets: [],
    refs,
    domains: [],
    local: { base: sub.local, penalty: null },
    audience: { base: sub.audience, penalty: null },
    friction: sub.friction,
    signal: {
      fashion: sub.anchor,
      music: sub.cross,
      design: sub.local,
    },
    crossAdjust: null,
    posture: brief.pos,
    scarcity: 'none',
  };
}

export async function decideProposals(
  brief: Brief,
  score: number | null,
  signals: InsightSignal[] = [],
  explainability: ExplainabilityContribution[] = [],
): Promise<AgentDecision> {
  if (score == null) {
    return { run: null, frictions: [], recommendations: [], considered: 0 };
  }
  const run = await runAgent({ brief: briefForAgent(brief), signals, explainability });
  const recommendations = run.proposals.map((proposal) => {
    const change = proposal.changes[0];
    const labeled = change ? labelDiff(change) : { before: proposal.id, after: proposal.id };
    return {
      before: labeled.before,
      after: labeled.after,
      why: proposal.why,
      evidence: proposal.evidenceRefs.join(', '),
      evidenceIds: proposal.evidenceRefs,
      change: {
        kind: 'qloo' as const,
        changes: proposal.changes,
        predictedDelta: proposal.predictedDelta ?? 0,
      },
      predictedDelta: proposal.predictedDelta ?? 0,
      param: change?.param ?? '',
      from: change?.from ?? null,
      to: change?.to ?? null,
    };
  });
  return {
    run,
    frictions: run.frictions.map((friction) => ({ text: friction.text, why: friction.text })),
    recommendations,
    considered: run.considered.length,
  };
}

export function districtsForBrief(city: string, fallback: Districts): Districts {
  if (city === 'Bangkok') return { min: ['Yaowarat', 'Talad Neon'], lux: ['Thonglor', 'Siam'] };
  if (city === 'Tokyo') return { min: ['Shimokitazawa', 'Koenji'], lux: ['Ginza', 'Roppongi'] };
  if (city === 'Berlin') return { min: ['Kreuzberg', 'Neukölln'], lux: ['Mitte', 'Charlottenburg'] };
  return fallback;
}

export function signalsFromInsights(run: InsightsRun): Signal[] {
  const byId = new Map<string, InsightSignal>();
  for (const signal of run.signals) {
    const prev = byId.get(signal.id);
    if (!prev || (signal.affinity ?? -1) > (prev.affinity ?? -1)) byId.set(signal.id, signal);
  }
  return [...byId.values()].map((signal) => {
    const affinity = signal.affinity == null ? 0 : Math.round(signal.affinity * 100);
    const level: Signal['level'] = affinity >= 75 ? 'Strong' : affinity >= 55 ? 'Moderate' : 'Limited';
    return {
      domain: typeLabel(signal.type),
      name: signal.name,
      level,
      feeds: 'Insights affinity',
      sources: [
        {
          name: signal.name,
          type: signal.type,
          provenance: signal.source,
          ...(signal.affinity == null ? {} : { affinity }),
        },
      ],
    };
  });
}

export function storyFor(input: {
  mode: 'sample' | 'insights';
  brief: Brief;
  briefV2: BriefV2;
  scored: ScoredPacket;
  insights: InsightsRun | null;
  considered: number;
  samplePacket?: EvidencePacket;
}): StoryView {
  const provenance = input.mode === 'sample' && input.samplePacket
    ? ledgerRows(input.briefV2, {
        total: input.scored.score ?? 0,
        points: pointsOf(input.scored),
        packet: input.samplePacket,
      }).map((row) => ({ id: row.id, label: row.label, points: row.points, detail: row.provenance }))
    : (input.insights?.ledger.rows ?? []).map((row) => ({
        id: row.id,
        label: rowLabel(row.id),
        points: row.points,
        detail: row.provenance.detail,
      }));
  return {
    mode: input.mode,
    considered: input.considered,
    baseline: input.scored.score,
    captions:
      input.mode === 'sample' && isUntouchedDemo(input.brief) && input.scored.score === 71
        ? [...DEMO_CAPTIONS]
        : insightCaptions(input.brief, input.scored),
    provenance,
  };
}

function isUntouchedDemo(brief: Brief): boolean {
  return (
    brief.idea.trim() === DEFAULT_IDEA &&
    brief.city === DEFAULT_BRIEF.city &&
    brief.age === DEFAULT_BRIEF.age &&
    !brief.posture &&
    !brief.scarcity
  );
}

function insightCaptions(brief: Brief, scored: ScoredPacket): string[] {
  const local = scored.subs.local;
  const total = scored.score == null ? 'unmeasured' : String(scored.score);
  return [
    `${brief.idea} · ${brief.age} · ${brief.city}.`,
    `Insights scored this brief at ${total}. Local fit is ${local == null ? 'unmeasured' : local}.`,
    'The agent shortlist is Qloo parameter diffs. The deterministic engine sets every predicted lift.',
  ];
}

function pointsOf(scored: ScoredPacket) {
  return {
    anchor: scored.ledger.anchor ?? 0,
    cross: scored.ledger.cross ?? 0,
    local: scored.ledger.local ?? 0,
    audience: scored.ledger.audience ?? 0,
    friction: scored.ledger.friction ?? 0,
    total: scored.score ?? 0,
  };
}

function typeLabel(type: string): string {
  if (type.includes('brand')) return 'Brand';
  if (type.includes('artist')) return 'Artist';
  if (type.includes('movie') || type.includes('film')) return 'Film';
  if (type.includes('place')) return 'Place';
  return 'Taste';
}

function rowLabel(id: string): string {
  if (id === 'anchor') return 'Anchor affinity';
  if (id === 'cross') return 'Cross-domain fit';
  if (id === 'local') return 'Local fit';
  if (id === 'audience') return 'Audience fit';
  return 'Cultural friction';
}

function labelDiff(change: QlooParamDiff): { before: string; after: string } {
  const name = PARAM_LABEL[change.param] ?? change.param;
  return {
    before: `${name} ${change.from ?? 'none'}`,
    after: `${name} ${change.to ?? 'none'}`,
  };
}

function synthesizeBrief(brief: Brief): BriefV2 {
  const known = new Map(SAMPLE_ENTITIES.map((entity) => [entity.name, entity]));
  const references = brief.refs.map((name) => {
    const entity = known.get(name);
    return {
      id: entity?.id ?? slug(name),
      name,
      type: entity?.type ?? 'urn:entity',
      source: 'sample',
    };
  });
  const base = defaultBriefV2();
  return {
    ...base,
    idea: brief.idea,
    references,
    locations: references.filter((reference) => reference.type.includes('place')),
    city: brief.city,
    age: brief.age,
    positioning: brief.pos,
    constraints: brief.scarcity === 'preorder' ? ['independent pre-order drops'] : base.constraints,
    ...(brief.posture === 'accessible' ? { priceLevel: 2 as const } : {}),
  };
}
