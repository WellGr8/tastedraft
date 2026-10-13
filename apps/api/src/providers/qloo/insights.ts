import type { BriefV2, ExplainabilityContribution, InsightSignal } from '@tastedraft/contracts';
import { scoreInsights as scoreInsightsWasm } from '@tastedraft/engine-wasm';
import { engineBackend } from '../../engine/engine-mode.ts';
import {
  scoreInsightMeasurements,
  type DimensionInput,
  type InsightScore,
  type InsightScoreInput,
  type MeasuredGroup,
} from '../../engine/insights-score.ts';
import { appendQlooParams, QlooClient, type QlooInsightsParams } from './client.ts';
import { authoredInsightBody, type InsightRole } from './insights-mock.ts';

/**
 * Category-agnostic `/v2/insights` queries for a BriefV2.
 * Target entity types come from the brief's entities and idea. Streetwear is not the default.
 */

const AGE_BANDS: Record<string, string> = {
  '18–25': '24_and_younger',
  '18-25': '24_and_younger',
  '26–35': '30_to_34',
  '26-35': '30_to_34',
  '36–45': '35_to_44',
  '36-45': '35_to_44',
  '46+': '45_to_54',
};

const QLOO_AGES = new Set([
  '24_and_younger',
  '25_to_29',
  '30_to_34',
  '35_and_younger',
  '35_to_44',
  '36_to_55',
  '45_to_54',
  '55_and_older',
]);

const LABEL_URN: Record<string, string> = {
  brand: 'urn:entity:brand',
  artist: 'urn:entity:artist',
  film: 'urn:entity:movie',
  movie: 'urn:entity:movie',
  place: 'urn:entity:place',
  destination: 'urn:entity:destination',
  person: 'urn:entity:person',
  book: 'urn:entity:book',
  podcast: 'urn:entity:podcast',
  tv_show: 'urn:entity:tv_show',
  'tv show': 'urn:entity:tv_show',
  videogame: 'urn:entity:videogame',
  video_game: 'urn:entity:videogame',
  restaurant: 'urn:entity:place',
};

const CATEGORY_CUES: ReadonlyArray<{ re: RegExp; types: readonly string[] }> = [
  { re: /sneaker|streetwear|fashion|apparel|clothing|รองเท้า|แฟชั่น/i, types: ['urn:entity:brand'] },
  { re: /night[- ]?market|\bsnack\b|street food|restaurant|\bfood\b|อาหาร|ของกิน/i, types: ['urn:entity:place', 'urn:entity:brand'] },
  { re: /\bmusic\b|\bvenue\b|\bdj\b|\bband\b|\balbum\b|concert|เพลง|ดนตรี|\bindie\b/i, types: ['urn:entity:artist', 'urn:entity:place'] },
  { re: /\bfilm\b|\bmovie\b|cinema|หนัง/i, types: ['urn:entity:movie'] },
  { re: /podcast/i, types: ['urn:entity:podcast'] },
  { re: /\bbook\b|\bnovel\b/i, types: ['urn:entity:book'] },
  { re: /video game|videogame|\bgame\b/i, types: ['urn:entity:videogame'] },
  { re: /hotel|destination|neighborhood|district|ย่าน/i, types: ['urn:entity:destination', 'urn:entity:place'] },
];

export interface BuiltInsightQuery {
  role: InsightRole;
  entityType: string;
  params: QlooInsightsParams;
}

export interface InsightsCall {
  role: InsightRole;
  entityType: string;
  params: QlooInsightsParams;
  ok: boolean;
  url: string;
}

export interface InsightsRun extends InsightScore {
  mode: 'live' | 'mock';
  queries: BuiltInsightQuery[];
  calls: InsightsCall[];
  signals: InsightSignal[];
  explainability: ExplainabilityContribution[];
}

interface ParsedEntity {
  id: string;
  name: string;
  type: string;
  affinity: number | null;
  contributions: ExplainabilityContribution[];
}

/** Product age band → `signal.demographics.age`. Unknown bands are omitted, not guessed. */
export function qlooAge(age: string): string | null {
  const trimmed = age.trim();
  if (AGE_BANDS[trimmed]) return AGE_BANDS[trimmed];
  if (QLOO_AGES.has(trimmed)) return trimmed;
  return null;
}

/** `signal.demographics.gender` accepts male or female. Anything else is omitted. */
export function qlooGender(gender: string | undefined): string | null {
  if (!gender) return null;
  const value = gender.trim().toLowerCase();
  if (value === 'female' || value === 'male') return value;
  if (value === 'f') return 'female';
  if (value === 'm') return 'male';
  return null;
}

export function toEntityUrn(type: string): string | null {
  const raw = type.trim();
  // The hackathon host returns HTTP 400 for `urn:entity:video_game`. The working type is `videogame`.
  if (raw === 'urn:entity:video_game') return 'urn:entity:videogame';
  if (raw.startsWith('urn:entity:')) return raw;
  return LABEL_URN[raw.toLowerCase()] ?? null;
}

/** Up to four target types. Explicit entity types win over idea cues. No type is assumed. */
export function targetEntityTypes(brief: BriefV2): string[] {
  const out: string[] = [];
  const add = (urn: string | null): void => {
    if (!urn || out.includes(urn) || out.length >= 4) return;
    out.push(urn);
  };
  for (const item of [...brief.references, ...brief.locations]) add(toEntityUrn(item.type));
  const text = [brief.idea, ...brief.interests.map((tag) => tag.name)].join(' ');
  for (const cue of CATEGORY_CUES) {
    if (!cue.re.test(text)) continue;
    for (const type of cue.types) add(type);
  }
  return out;
}

function joinIds(ids: readonly string[]): string | undefined {
  return ids.length ? ids.join(',') : undefined;
}

function idsOfType(brief: BriefV2, urn: string): string[] {
  return brief.references.filter((item) => toEntityUrn(item.type) === urn).map((item) => item.id);
}

function signalOf(parts: {
  entities?: string;
  tags?: string;
  age?: string;
  gender?: string;
  location?: string;
}): QlooInsightsParams['signal'] {
  const signal: Record<string, string | { [key: string]: string }> = {};
  const interests: Record<string, string> = {};
  if (parts.entities) interests.entities = parts.entities;
  if (parts.tags) interests.tags = parts.tags;
  if (Object.keys(interests).length) signal.interests = interests;
  const demographics: Record<string, string> = {};
  if (parts.age) demographics.age = parts.age;
  if (parts.gender) demographics.gender = parts.gender;
  if (Object.keys(demographics).length) signal.demographics = demographics;
  if (parts.location) signal.location = { query: parts.location };
  return Object.keys(signal).length ? signal : undefined;
}

export function buildInsightQueries(brief: BriefV2): BuiltInsightQuery[] {
  const types = targetEntityTypes(brief);
  const city = brief.city.trim();
  const tags = joinIds(brief.interests.map((tag) => tag.id));
  const referenceIds = joinIds(brief.references.map((item) => item.id));
  const age = qlooAge(brief.age) ?? undefined;
  const gender = qlooGender(brief.gender) ?? undefined;
  const queries: BuiltInsightQuery[] = [];

  for (const type of types) {
    const anchors = joinIds(idsOfType(brief, type));
    if (anchors) {
      queries.push({
        role: 'anchor',
        entityType: type,
        params: {
          filter: { type, results: { entities: anchors } },
          signal: signalOf({ entities: referenceIds, tags, age, gender, location: city || undefined }),
          feature: { explainability: true },
          take: 20,
        },
      });
      if (age || gender) {
        queries.push({
          role: 'audience',
          entityType: type,
          params: {
            filter: { type, results: { entities: anchors } },
            signal: signalOf({ tags, age, gender, location: city || undefined }),
            feature: { explainability: true },
            take: 20,
          },
        });
      }
    }
    queries.push({
      role: 'cross',
      entityType: type,
      params: {
        filter: { type },
        signal: signalOf({ entities: referenceIds, tags, location: city || undefined }),
        feature: { explainability: true },
        take: 10,
      },
    });
  }

  if (city) {
    const places = brief.locations.filter((item) => {
      const urn = toEntityUrn(item.type);
      return urn === 'urn:entity:place' || urn === 'urn:entity:destination';
    });
    const localType = places.length > 0 && places.every((item) => toEntityUrn(item.type) === 'urn:entity:destination')
      ? 'urn:entity:destination'
      : 'urn:entity:place';
    const localIds = joinIds(places.filter((item) => toEntityUrn(item.type) === localType).map((item) => item.id));
    const filter: NonNullable<QlooInsightsParams['filter']> = { type: localType, location: { query: city } };
    if (localIds) filter.results = { entities: localIds };
    if (brief.priceLevel) filter.price_level = { max: brief.priceLevel };
    queries.push({
      role: 'local',
      entityType: localType,
      params: {
        filter,
        signal: signalOf({ entities: referenceIds, tags, location: city }),
        feature: { explainability: true },
        take: 10,
      },
    });
  }

  return queries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAffinity(row: Record<string, unknown>): number | null {
  const query = isRecord(row.query) ? row.query : undefined;
  const raw = query && 'affinity' in query ? query.affinity : row.affinity;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const unit = raw > 1 && raw <= 100 ? raw / 100 : raw;
  if (unit < 0 || unit > 1) return null;
  return unit;
}

function contributionWeight(item: Record<string, unknown>): number | null {
  const raw = typeof item.weight === 'number' ? item.weight : typeof item.score === 'number' ? item.score : null;
  if (raw === null || !Number.isFinite(raw) || raw < 0 || raw > 1) return null;
  return raw;
}

export function readContributions(row: Record<string, unknown>, target: string): ExplainabilityContribution[] {
  const query = isRecord(row.query) ? row.query : undefined;
  const raw = query?.explainability ?? row.explainability;
  const out: ExplainabilityContribution[] = [];
  const push = (item: Record<string, unknown>, fallbackInput: string): void => {
    const input = typeof item.input === 'string' && item.input
      ? item.input
      : typeof item.entity_id === 'string' && item.entity_id
        ? item.entity_id
        : typeof item.tag_id === 'string' && item.tag_id
          ? item.tag_id
          : typeof item.id === 'string' && item.id
            ? item.id
            : fallbackInput;
    const weight = contributionWeight(item);
    const itemTarget = typeof item.target === 'string' && item.target ? item.target : target;
    if (!input || !itemTarget || weight === null) return;
    out.push({ input, weight, target: itemTarget });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item)) push(item, '');
    }
    return out;
  }
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (isRecord(item)) push(item, key);
    }
  }
  return out;
}

function entityTypeOf(row: Record<string, unknown>): string {
  if (typeof row.subtype === 'string' && row.subtype.startsWith('urn:')) return row.subtype;
  if (Array.isArray(row.types) && typeof row.types[0] === 'string') return row.types[0];
  if (typeof row.type === 'string' && row.type.startsWith('urn:entity:')) return row.type;
  return 'urn:entity';
}

function parseEntities(body: unknown): ParsedEntity[] {
  if (!isRecord(body) || body.success === false) return [];
  const results = isRecord(body.results) ? body.results : undefined;
  const list = results && Array.isArray(results.entities) ? results.entities : [];
  const out: ParsedEntity[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = typeof item.entity_id === 'string' ? item.entity_id : typeof item.id === 'string' ? item.id : '';
    if (!id) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name : id;
    out.push({
      id,
      name,
      type: entityTypeOf(item),
      affinity: readAffinity(item),
      contributions: readContributions(item, id),
    });
  }
  return out;
}

function requestedIds(params: QlooInsightsParams): string[] | null {
  const results = params.filter?.results;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null;
  const entities = results.entities;
  if (typeof entities !== 'string' || !entities.trim()) return null;
  return entities.split(',').map((id) => id.trim()).filter(Boolean);
}

function rowsFor(query: BuiltInsightQuery, body: unknown): ParsedEntity[] {
  const wanted = requestedIds(query.params);
  const pool = parseEntities(body).filter((row) => row.type === query.entityType);
  if (query.role === 'cross') return pool;
  if (!wanted) return query.role === 'local' ? pool : [];
  return pool.filter((row) => wanted.includes(row.id));
}

function dottedParams(params: QlooInsightsParams): Record<string, string> {
  const search = new URLSearchParams();
  appendQlooParams(search, { ...params });
  const out: Record<string, string> = {};
  for (const [key, value] of search.entries()) out[key] = value;
  return out;
}

function sourceFor(mode: 'live' | 'mock'): string {
  return mode === 'mock' ? 'mock:/v2/insights' : 'qloo:/v2/insights';
}

function groupsFrom(rows: readonly ParsedEntity[], label: string): MeasuredGroup {
  return {
    label,
    rows: rows.map((row) => ({
      affinity: row.affinity,
      contributions: row.contributions,
      evidenceRefs: [row.id],
    })),
  };
}

export async function runInsights(client: QlooClient, brief: BriefV2): Promise<InsightsRun> {
  const queries = buildInsightQueries(brief);
  const calls = await Promise.all(queries.map(async (query) => {
    const result = await client.insights(query.params);
    const body = result.ok && result.mode === 'mock'
      ? (authoredInsightBody(query.params, query.role) ?? result.body)
      : result.ok ? result.body : undefined;
    return { query, result, body };
  }));

  const buckets: Record<InsightRole, MeasuredGroup[]> = { anchor: [], cross: [], local: [], audience: [] };
  const signals: InsightSignal[] = [];
  const explainability: ExplainabilityContribution[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    const rows = call.body ? rowsFor(call.query, call.body) : [];
    buckets[call.query.role].push(groupsFrom(rows, call.query.entityType));
    const params = dottedParams(call.query.params);
    const source = sourceFor(call.result.mode);
    for (const row of rows) {
      signals.push({ id: row.id, name: row.name, type: row.type, affinity: row.affinity, source, params });
      for (const contribution of row.contributions) {
        const key = `${contribution.input}\n${contribution.target}\n${contribution.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        explainability.push(contribution);
      }
    }
  }

  const source = sourceFor(client.mode);
  const dimension = (role: InsightRole): DimensionInput => ({ groups: buckets[role], source });
  const measured: InsightScoreInput = {
    anchor: dimension('anchor'),
    cross: dimension('cross'),
    local: dimension('local'),
    audience: dimension('audience'),
    activeRefCount: brief.references.length,
  };
  const scored = engineBackend() === 'ts' ? scoreInsightMeasurements(measured) : (scoreInsightsWasm(measured) as InsightScore);

  return {
    ...scored,
    mode: client.mode,
    queries,
    calls: calls.map((call) => ({
      role: call.query.role,
      entityType: call.query.entityType,
      params: call.query.params,
      ok: call.result.ok,
      url: call.result.url,
    })),
    signals,
    explainability,
  };
}
