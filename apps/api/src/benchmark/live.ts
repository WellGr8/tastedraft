/**
 * Live arm.
 * Qloo calls go through QlooGateway and stay inside the script budget.
 * The grounded panel is the product persona drafter, so a reply that invents
 * past its anchors falls back to the template.
 * The no-Qloo panel is the same model with an empty anchor list.
 * Response bodies are not returned.
 */
import type { PersonaChatRequest } from '@tastedraft/contracts';
import { createLlmClient, OPENROUTER_MODEL, type LlmClient } from '../llm/client.ts';
import { draftPersonaReply } from '../llm/persona.ts';
import { parseEntities } from '../features/parse.ts';
import { qlooAge, qlooGender } from '../providers/qloo/insights.ts';
import { normalizeName } from '../providers/qloo/search.ts';
import type { QlooGateway } from '../runner/gateway.ts';
import type { PublicOutcome } from '../case-studies/cases.ts';
import { benchmarkItems, type BenchItem, type PublishedStudy } from './items.ts';
import { classifyReason, sameEntityName, specificTasteNames } from './metrics.ts';
import { armFromReasons, BUDGET_CAP, summarize } from './publish.ts';
import { PANEL_QUESTION } from './recorded.ts';
import { segmentsFor } from './segments.ts';
import type { BenchmarkFile, ItemRecord, ReasonRecord } from './types.ts';

interface NamedHit {
  id: string;
  name: string;
  type: string;
  affinity: number | null;
}

const LIVE_LABEL =
  'Live run. Grounded reasons use the persona panel with Qloo entities from this run. The other arm is the same model with no Qloo entities. A Qloo ledger is reported only when the published case-study file still carries one. City ranks are a separate rule.';

/** The persona panel still votes encourage or caution. A later exit agrees with caution. */
function panelAgrees(verdict: 'encourage' | 'caution', outcome: PublicOutcome): boolean {
  return outcome === 'left' ? verdict === 'caution' : verdict === 'encourage';
}

function entityId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function hitsFrom(body: unknown, fallbackType: string): NamedHit[] {
  if (body && typeof body === 'object' && (body as { mock?: unknown }).mock === true) return [];
  return parseEntities(body, fallbackType)
    .filter((row) => row.name && !row.id.startsWith('td-mock-'))
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      affinity: row.affinity,
    }));
}

function remember(catalog: NamedHit[], rows: readonly NamedHit[]): void {
  for (const row of rows) {
    if (!catalog.some((item) => sameEntityName(item.name, row.name))) catalog.push(row);
  }
}

async function resolveQueries(item: BenchItem, gateway: QlooGateway, catalog: NamedHit[]): Promise<void> {
  const queries = item.references.slice(0, 2);
  for (const reference of queries) {
    if (gateway.calls >= BUDGET_CAP) return;
    const result = await gateway.search({ query: reference.name, take: 1 });
    if (!result.ok || result.mode !== 'live') continue;
    const [hit] = hitsFrom(result.body, reference.type).filter((row) => sameEntityName(row.name, reference.name));
    if (hit) remember(catalog, [hit]);
  }
}

async function segmentHits(item: BenchItem, gateway: QlooGateway, catalog: NamedHit[], age: string, gender: 'female' | 'male'): Promise<NamedHit[]> {
  if (gateway.calls >= BUDGET_CAP) return [];
  const ageBucket = qlooAge(age);
  const genderBucket = qlooGender(gender);
  const ids = catalog.map((row) => row.id).filter(entityId).slice(0, 4);
  const result = await gateway.insights({
    filter: { type: item.insightType },
    signal: {
      location: { query: item.city },
      ...(ageBucket || genderBucket
        ? { demographics: { ...(ageBucket ? { age: ageBucket } : {}), ...(genderBucket ? { gender: genderBucket } : {}) } }
        : {}),
      ...(ids.length ? { interests: { entities: ids.join(',') } } : {}),
    },
    take: 3,
  });
  if (!result.ok || result.mode !== 'live') return [];
  const rows = hitsFrom(result.body, item.insightType).slice(0, 3);
  remember(catalog, rows);
  return rows;
}

function meanScore(rows: readonly NamedHit[]): number | null {
  const values = rows.map((row) => row.affinity).filter((value): value is number => value != null);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100);
}

async function verifyClaim(name: string, gateway: QlooGateway, catalog: NamedHit[], searched: Map<string, 'hit' | 'miss'>): Promise<void> {
  const key = normalizeName(name);
  if (!key || searched.has(key) || catalog.some((row) => sameEntityName(row.name, name))) return;
  if (gateway.calls >= BUDGET_CAP) return;
  const result = await gateway.search({ query: name, take: 1 });
  if (!result.ok || result.mode !== 'live') return;
  const [hit] = hitsFrom(result.body, 'urn:entity').filter((row) => sameEntityName(row.name, name));
  searched.set(key, hit ? 'hit' : 'miss');
  if (hit) remember(catalog, [hit]);
}

function parseUngrounded(raw: string): { message: string; entities: string[]; fit: number | null; verdict: 'encourage' | 'caution' | null } | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  try {
    const parsed = JSON.parse(slice) as { message?: unknown; entities?: unknown; fit?: unknown; verdict?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) return null;
    const entities = Array.isArray(parsed.entities) ? parsed.entities.filter((item): item is string => typeof item === 'string') : [];
    const fit = typeof parsed.fit === 'number' && parsed.fit >= 0 && parsed.fit <= 100 ? Math.round(parsed.fit) : null;
    const verdict = parsed.verdict === 'encourage' || parsed.verdict === 'caution' ? parsed.verdict : null;
    return { message, entities, fit, verdict };
  } catch {
    return null;
  }
}

async function ungroundedReply(llm: LlmClient, item: BenchItem, label: string): Promise<{
  message: string;
  entities: string[];
  fit: number | null;
  verdict: 'encourage' | 'caution' | null;
  source: 'llm' | 'template' | 'offline-template';
}> {
  if (llm.mode !== 'live') {
    return {
      message: 'I might look at something like this. Nothing here is tied to a place or a taste I already have.',
      entities: [],
      fit: null,
      verdict: null,
      source: 'offline-template',
    };
  }
  const raw = await llm.complete(
    [
      {
        role: 'system',
        content: [
          `You are ${label} in ${item.city}. You have no taste graph and no list of entities.`,
          `The idea: ${item.idea.slice(0, 500)}`,
          'Answer in the first person, in 1 to 3 sentences.',
          'Name the specific artists, brands, places, films, or shows you are using.',
          'Guess a fit from 0 to 100. The guess is not a measurement.',
          'Pick verdict encourage or caution.',
          'Return JSON only: {"message":"...","entities":["Name"],"fit":50,"verdict":"caution"}',
        ].join('\n'),
      },
      { role: 'user', content: PANEL_QUESTION },
    ],
    { temperature: 0, maxTokens: 180, timeoutMs: 20_000 },
  );
  const parsed = parseUngrounded(raw);
  if (!parsed) {
    return {
      message: 'I might look at something like this. Nothing here is tied to a place or a taste I already have.',
      entities: [],
      fit: null,
      verdict: null,
      source: 'template',
    };
  }
  return { ...parsed, source: 'llm' };
}

function majorityVerdict(votes: readonly ('encourage' | 'caution' | null)[]): 'encourage' | 'caution' | null {
  const encourage = votes.filter((vote) => vote === 'encourage').length;
  const caution = votes.filter((vote) => vote === 'caution').length;
  if (encourage === 0 && caution === 0) return null;
  return encourage > caution ? 'encourage' : 'caution';
}

async function runItem(item: BenchItem, gateway: QlooGateway, llm: LlmClient): Promise<ItemRecord> {
  const catalog: NamedHit[] = item.verifiedNames.map((name) => ({
    id: `published-${normalizeName(name).replace(/ /g, '-')}`,
    name,
    type: item.insightType,
    affinity: null,
  }));
  await resolveQueries(item, gateway, catalog);
  const searched = new Map<string, 'hit' | 'miss'>();
  const qlooReasons: ReasonRecord[] = [];
  const llmReasons: ReasonRecord[] = [];
  const llmVotes: Array<'encourage' | 'caution' | null> = [];
  let verifyBudget = 2;

  for (const segment of segmentsFor(item.city, item.age)) {
    const rows = await segmentHits(item, gateway, catalog, segment.age, segment.gender);
    const anchors = (rows.length ? rows : catalog.filter((row) => item.verifiedNames.some((name) => sameEntityName(name, row.name)))).slice(0, 3);
    let groundedMessage = 'Still measuring what this person actually likes.';
    let groundedSource: ReasonRecord['source'] = 'template';
    let claims: string[] = [];
    if (anchors.length) {
      const request: PersonaChatRequest = {
        persona: {
          id: segment.id,
          label: segment.label,
          location: item.city,
          age: segment.age,
          gender: segment.gender,
          anchors: anchors.map((anchor) => ({
            id: anchor.id,
            name: anchor.name,
            type: anchor.type,
            ...(anchor.affinity != null ? { affinity: anchor.affinity } : {}),
          })),
        },
        message: PANEL_QUESTION,
        context: { idea: item.idea.slice(0, 500) },
      };
      const draft = await draftPersonaReply(llm, request);
      groundedMessage = draft.message;
      groundedSource = draft.source === 'llm' ? 'llm' : 'template';
      claims = draft.citations.map((citation) => citation.name);
    }
    const grounded = classifyReason({
      message: groundedMessage,
      claims,
      verified: catalog.map((row) => row.name),
      searched,
    });
    qlooReasons.push({
      personaId: segment.id,
      label: segment.label,
      age: segment.age,
      reason: groundedMessage,
      source: groundedSource,
      verified: grounded.verified,
      unverifiable: grounded.unverifiable,
      hallucinated: grounded.hallucinated,
      specific: specificTasteNames(grounded.verified, anchors.map((anchor) => anchor.name), item.city),
      score: meanScore(rows),
    });

    const plain = await ungroundedReply(llm, item, segment.label);
    for (const name of plain.entities) {
      if (verifyBudget <= 0) break;
      if (catalog.some((row) => sameEntityName(row.name, name))) continue;
      verifyBudget -= 1;
      await verifyClaim(name, gateway, catalog, searched);
    }
    const plainClass = classifyReason({
      message: plain.message,
      claims: plain.entities,
      verified: catalog.map((row) => row.name),
      searched,
    });
    llmVotes.push(plain.verdict);
    llmReasons.push({
      personaId: segment.id,
      label: segment.label,
      age: segment.age,
      reason: plain.message,
      source: plain.source,
      verified: plainClass.verified,
      unverifiable: plainClass.unverifiable,
      hallucinated: plainClass.hallucinated,
      specific: [],
      score: plain.fit,
    });
  }

  const panelVerdict = majorityVerdict(llmVotes);
  const matched = panelVerdict && item.outcome ? panelAgrees(panelVerdict, item.outcome as PublicOutcome) : null;
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    city: item.city,
    outcome: item.outcome,
    qloo: armFromReasons(
      qlooReasons,
      {
        score: item.ledger?.total ?? null,
        local: item.ledger?.local ?? null,
        verdict: item.ledger?.verdict ?? null,
        matched: item.rankMatched ?? item.ledger?.matched ?? null,
      },
      true,
    ),
    llm: armFromReasons(
      llmReasons,
      {
        score: null,
        local: null,
        verdict: item.kind === 'case-study' ? panelVerdict : null,
        matched: item.kind === 'case-study' ? matched : null,
      },
      true,
    ),
  };
}

export async function runLiveBenchmark(options: {
  gateway: QlooGateway;
  llm?: LlmClient;
  studies: readonly PublishedStudy[];
  now: string;
  model?: string | null;
}): Promise<BenchmarkFile> {
  const llm = options.llm ?? createLlmClient();
  if (options.gateway.mode !== 'live') {
    throw new Error('The live benchmark refuses mock Qloo. Unset keys use the recorded path.');
  }
  if (llm.mode !== 'live') {
    throw new Error('The live benchmark needs LLM_API_KEY. Unset keys use the recorded path.');
  }
  const items = benchmarkItems(options.studies);
  const records: ItemRecord[] = [];
  for (const item of items) records.push(await runItem(item, options.gateway, llm));
  const panelRows = records.filter((item) => item.kind === 'case-study' && item.llm.verdict);
  const llmPanel = panelRows.length
    ? { matched: panelRows.filter((item) => item.llm.matched).length, total: panelRows.length }
    : null;
  return summarize({
    source: 'live',
    label: LIVE_LABEL,
    generatedAt: options.now,
    model: options.model ?? (process.env.LLM_MODEL?.trim() || OPENROUTER_MODEL),
    qlooCalls: options.gateway.calls,
    items: records,
    sampleEngine: null,
    llmPanel,
  });
}
