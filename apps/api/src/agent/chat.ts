/**
 * Offline chat planner for the TasteDraft agent.
 * Common commands are parsed here. Predicted numbers come from the engine.
 * When an LLM key is set, the sentence can be polished, but the plan stays.
 */
import type { BriefV2, Entity, QlooParamDiff } from '@tastedraft/contracts';
import { rescoreParamDiffs } from '../engine/wasm-adapter.ts';
import type { LlmClient } from '../llm/client.ts';
import { ageBucket, nextAgeBand } from './model.ts';
import { searchEntities } from '../providers/qloo/search.ts';
import { QlooClient } from '../providers/qloo/client.ts';

const CITIES = [
  'Los Angeles',
  'New York',
  'San Francisco',
  'Austin',
  'Miami',
  'Chicago',
  'Seattle',
  'Bangkok',
  'Tokyo',
  'Berlin',
  'London',
  'Paris',
  'Seoul',
];

const AGES = ['18–25', '26–35', '36–45', '46+'] as const;

export interface ChatProposalInput {
  id: string;
  param?: string | null;
  from?: string | null;
  to?: string | null;
  why?: string;
  predictedDelta?: number | null;
}

export interface ProvenanceInput {
  id: string;
  label: string;
  points: number | null;
  detail: string;
}

export interface ChatRequest {
  message: string;
  brief: BriefV2;
  provenance?: ProvenanceInput[];
  proposals?: ChatProposalInput[];
  considered?: number;
}

export interface ChatProposal {
  id: string;
  title: string;
  from: string;
  to: string;
  delta: number | null;
  why: string;
  kind: 'server' | 'local';
  patch?: {
    city?: string;
    age?: string;
    positioning?: string;
    priceLevel?: 1 | 2 | 3 | 4;
    reference?: Entity;
  };
}

export interface ChatConfirm {
  id: string;
  label: string;
  patch: ChatProposal['patch'];
}

export interface ChatTool {
  title: string;
  detail: string;
}

export interface ChatPlan {
  steps: string[];
  message: string;
  tools: ChatTool[];
  proposals: ChatProposal[];
  confirm?: ChatConfirm;
}

function cityIn(text: string): string | null {
  const lower = text.toLowerCase();
  const found = CITIES.find((city) => lower.includes(city.toLowerCase()));
  return found ?? null;
}

function previousAge(age: string): string | null {
  const index = AGES.indexOf(age as (typeof AGES)[number]);
  if (index <= 0) return null;
  return AGES[index - 1] ?? null;
}

function deltaFor(brief: BriefV2, changes: readonly QlooParamDiff[]): number | null {
  try {
    return rescoreParamDiffs(brief, changes).predictedDelta;
  } catch {
    return null;
  }
}

function localProposal(input: {
  id: string;
  title: string;
  from: string;
  to: string;
  why: string;
  delta: number | null;
  patch: NonNullable<ChatProposal['patch']>;
}): ChatProposal {
  return { kind: 'local', ...input };
}

function review(request: ChatRequest): ChatPlan {
  const proposals: ChatProposal[] = (request.proposals ?? []).slice(0, 3).map((item) => ({
    id: item.id,
    title: item.why?.trim() || 'Engine proposal',
    from: item.from ?? 'current',
    to: item.to ?? 'next',
    delta: item.predictedDelta ?? null,
    why: item.why?.trim() || 'The engine re-scored this parameter diff.',
    kind: 'server' as const,
  }));
  const simulated = request.considered && request.considered > 0 ? request.considered : Math.max(proposals.length, 1);
  return {
    steps: [
      'Resolving references via Qloo',
      'Querying insights',
      `Simulating ${simulated} alternatives`,
      'Ranking',
    ],
    message: proposals.length
      ? 'Here is the shortlist. Nothing changes until you approve.'
      : 'I do not have a measured lift to propose yet. Score the profile, or ask for a city, an age band, or a reference.',
    tools: proposals.length
      ? [{ title: 'Ranked shortlist', detail: `${proposals.length} diffs, ordered by the engine.` }]
      : [],
    proposals,
  };
}

async function addReference(name: string, request: ChatRequest): Promise<ChatPlan> {
  const steps = ['Resolving references via open data', 'Checking the taste profile', 'Preparing a confirmation'];
  let entity: Entity | null = null;
  try {
    const result = await searchEntities({ client: new QlooClient(), q: name });
    entity = result.entities[0] ?? null;
  } catch {
    entity = null;
  }
  if (!entity) {
    return {
      steps,
      message: `I could not resolve “${name}”. Try the full name, or search it in the taste profile.`,
      tools: [{ title: 'Resolve reference', detail: `No Wikidata or MusicBrainz hit for ${name}.` }],
      proposals: [],
    };
  }
  const from = request.brief.references.map((item) => item.id).join(',') || 'none';
  const delta = deltaFor(request.brief, [
    { param: 'signal.interests.entities', from, to: [...request.brief.references.map((item) => item.id), entity.id].join(',') },
  ]);
  return {
    steps,
    message: `I found ${entity.name}. Add it to the taste profile?`,
    tools: [{ title: 'Resolve reference', detail: `${entity.name} · ${entity.source}` }],
    proposals: [
      localProposal({
        id: `add-${entity.id}`,
        title: `Add ${entity.name}`,
        from: 'not in the profile',
        to: entity.name,
        why: 'A new reference joins the playlist. The engine re-scores after you approve.',
        delta,
        patch: { reference: entity },
      }),
    ],
    confirm: { id: `add-${entity.id}`, label: `Add ${entity.name}`, patch: { reference: entity } },
  };
}

export async function planChat(request: ChatRequest, llm?: LlmClient): Promise<ChatPlan> {
  const text = request.message.trim();
  const plan = await planOffline(text, request);
  if (!llm || llm.mode !== 'live') return plan;
  try {
    const polished = await llm.complete([
      {
        role: 'system',
        content:
          'Rewrite the assistant line as JSON {"say":"..."}. Do not add digits, scores, or parameter names. One sentence.',
      },
      { role: 'user', content: plan.message },
    ]);
    const match = polished.match(/"say"\s*:\s*"([^"]+)"/);
    const say = match?.[1]?.trim();
    if (say && !/\d/.test(say)) plan.message = say;
  } catch {
    // The deterministic line stays.
  }
  return plan;
}

async function planOffline(text: string, request: ChatRequest): Promise<ChatPlan> {
  const lower = text.toLowerCase();
  if (!text || /review|shortlist|what should|propose/.test(lower)) return review(request);

  if (/why/.test(lower) && /local/.test(lower)) {
    const row = request.provenance?.find((item) => item.id === 'local');
    const points = row?.points;
    const detail = row?.detail?.trim();
    return {
      steps: ['Reading the provenance ledger', 'Checking the local-fit row'],
      message: points == null
        ? 'Local fit was not measured, so that row stays a gap.'
        : `Local fit is ${points} on the engine ledger.${detail ? ` ${detail}` : ''}`,
      tools: [{ title: 'Provenance · local fit', detail: detail || 'The ledger row is the source.' }],
      proposals: [],
    };
  }

  if (/older audience|older crowd|what if older/.test(lower)) {
    const next = nextAgeBand(request.brief.age);
    if (!next) {
      return {
        steps: ['Reading the age band'],
        message: 'This profile is already on the oldest age band.',
        tools: [],
        proposals: [],
      };
    }
    const delta = deltaFor(request.brief, [
      { param: 'signal.demographics.age', from: ageBucket(request.brief.age), to: ageBucket(next) },
    ]);
    return {
      steps: ['Reading the audience band', 'Simulating the next age band', 'Ranking the engine delta'],
      message: `The next age band is ${next}. Approve it and I will re-score.`,
      tools: [{ title: 'Simulate age', detail: `${request.brief.age} → ${next}` }],
      proposals: [
        localProposal({
          id: 'age-older',
          title: `Older audience ${request.brief.age} → ${next}`,
          from: request.brief.age,
          to: next,
          why: 'The engine re-scores the age band. The brief does not change until you approve.',
          delta,
          patch: { age: next },
        }),
      ],
    };
  }

  if (/younger audience|what if younger/.test(lower)) {
    const next = previousAge(request.brief.age);
    if (!next) {
      return {
        steps: ['Reading the age band'],
        message: 'This profile is already on the youngest age band.',
        tools: [],
        proposals: [],
      };
    }
    const delta = deltaFor(request.brief, [
      { param: 'signal.demographics.age', from: ageBucket(request.brief.age), to: ageBucket(next) },
    ]);
    return {
      steps: ['Reading the audience band', 'Simulating the younger age band', 'Ranking the engine delta'],
      message: `The younger age band is ${next}. Approve it and I will re-score.`,
      tools: [{ title: 'Simulate age', detail: `${request.brief.age} → ${next}` }],
      proposals: [
        localProposal({
          id: 'age-younger',
          title: `Younger audience ${request.brief.age} → ${next}`,
          from: request.brief.age,
          to: next,
          why: 'The engine re-scores the age band. The brief does not change until you approve.',
          delta,
          patch: { age: next },
        }),
      ],
    };
  }

  const added = text.match(/add\s+(.+?)\s+as\s+(?:a\s+)?(?:reference|ref)\b/i);
  if (added?.[1]) return addReference(added[1].trim(), request);

  const city = (/make it work|move|city|what if/.test(lower) ? cityIn(text) : null);
  if (city && city.toLowerCase() !== request.brief.city.toLowerCase()) {
    const delta = deltaFor(request.brief, [
      { param: 'filter.location.query', from: request.brief.city, to: city },
    ]);
    return {
      steps: ['Resolving the city', 'Simulating the brief in that city', 'Preparing a confirmation'],
      message: `I can move this profile to ${city}. Confirm and I will re-score.`,
      tools: [{ title: 'Simulate city', detail: `${request.brief.city} → ${city}` }],
      proposals: [
        localProposal({
          id: `city-${city}`,
          title: `Move to ${city}`,
          from: request.brief.city,
          to: city,
          why: 'The engine re-scores the city. Approve to write the next version.',
          delta,
          patch: { city },
        }),
      ],
      confirm: { id: `city-${city}`, label: `Move to ${city}`, patch: { city } },
    };
  }

  return review(request);
}

export function encodeChatLine(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}
