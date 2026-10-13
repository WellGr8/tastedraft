/**
 * Audience segments from one brief.
 *
 * Each bucket is scored across artists, brands, places, dining, and film.
 * Dining is `urn:entity:place` plus the restaurant genre tag. Calls go through
 * QlooClient. A failed category becomes an empty list and a warning.
 */
import {
  PersonaResultSchema,
  type AudienceBucket,
  type BriefV2,
  type PersonaCategory,
  type PersonaInsight,
  type PersonaInsights,
  type PersonaRequest,
  type PersonaResult,
} from '@tastedraft/contracts';
import { type QlooCallOptions, type QlooInsightsParams, type QlooResult } from './client.ts';
import { qlooAge, qlooGender } from './insights.ts';

/** What `buildPersona` needs from Qloo. The gateway and `QlooClient` both satisfy it. */
export interface PersonaCaller {
  readonly mode: 'live' | 'mock';
  insights(params: QlooInsightsParams, init?: QlooCallOptions): Promise<QlooResult>;
}

const TAKE = 4;
const DINING_TAG = 'urn:tag:genre:place:restaurant';

const CATEGORY_TYPE: Record<PersonaCategory, string> = {
  artists: 'urn:entity:artist',
  brands: 'urn:entity:brand',
  places: 'urn:entity:place',
  dining: 'urn:entity:place',
  film: 'urn:entity:movie',
};

const EMPTY: PersonaInsights = {
  artists: [],
  brands: [],
  places: [],
  dining: [],
  film: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(row: unknown, path: string): string | undefined {
  let current = row;
  for (const part of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function qlooId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id.startsWith('urn:');
}

function interestIds(brief: BriefV2): { entities?: string; tags?: string } {
  const entities = [...brief.references, ...brief.locations].map((item) => item.id).filter(qlooId);
  const tags = brief.interests.map((tag) => tag.id).filter((id) => id.startsWith('urn:tag:') || qlooId(id));
  return {
    ...(entities.length ? { entities: entities.join(',') } : {}),
    ...(tags.length ? { tags: tags.join(',') } : {}),
  };
}

function affinityOf(row: Record<string, unknown>): number | null {
  const query = isRecord(row.query) ? row.query : undefined;
  const raw = query && typeof query.affinity === 'number' ? query.affinity : typeof row.affinity === 'number' ? row.affinity : null;
  if (raw === null || !Number.isFinite(raw)) return null;
  const unit = raw > 1 && raw <= 100 ? raw / 100 : raw;
  if (unit < 0 || unit > 1) return null;
  return unit;
}

function typeOf(row: Record<string, unknown>, fallback: string): string {
  if (typeof row.subtype === 'string' && row.subtype.startsWith('urn:entity:')) return row.subtype;
  if (Array.isArray(row.types)) {
    const urn = row.types.find((item) => typeof item === 'string' && item.startsWith('urn:entity:') && item !== 'urn:entity');
    if (typeof urn === 'string') return urn;
  }
  return fallback;
}

function imageOf(row: Record<string, unknown>): string | undefined {
  return (
    readString(row, 'properties.image.url') ??
    readString(row, 'properties.images.0.url') ??
    readString(row, 'image.url')
  );
}

function insightsFrom(body: unknown, fallbackType: string): PersonaInsight[] {
  if (!isRecord(body) || body.success === false) return [];
  const results = isRecord(body.results) ? body.results : undefined;
  const list = results && Array.isArray(results.entities) ? results.entities : [];
  const rows: PersonaInsight[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = typeof item.entity_id === 'string' ? item.entity_id : typeof item.id === 'string' ? item.id : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name) continue;
    const image = imageOf(item);
    const row: PersonaInsight = {
      id,
      name,
      type: typeOf(item, fallbackType),
      affinity: affinityOf(item),
      ...(image ? { image } : {}),
    };
    rows.push(row);
  }
  return rows
    .sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1))
    .slice(0, TAKE);
}

function paramsFor(category: PersonaCategory, brief: BriefV2, location: string, bucket: AudienceBucket): QlooInsightsParams {
  const place = category === 'places' || category === 'dining';
  const age = qlooAge(bucket.age ?? brief.age) ?? undefined;
  const gender = qlooGender(bucket.gender ?? brief.gender) ?? undefined;
  const interests = interestIds(brief);
  const filter: NonNullable<QlooInsightsParams['filter']> = { type: CATEGORY_TYPE[category] };
  if (place) {
    filter.location = { query: location };
    if (brief.priceLevel) filter.price_level = { max: brief.priceLevel };
    if (category === 'dining') filter.tags = DINING_TAG;
  }
  const signal: NonNullable<QlooInsightsParams['signal']> = {};
  if (interests.entities || interests.tags) signal.interests = interests;
  if (age || gender) {
    signal.demographics = {
      ...(age ? { age } : {}),
      ...(gender ? { gender } : {}),
    };
  }
  signal.location = { query: location };
  return {
    filter,
    signal,
    feature: { explainability: true },
    take: TAKE,
  };
}

function warningFor(category: PersonaCategory, label: string, result: QlooResult): string | null {
  if (result.ok && result.status === 200 && result.body.success !== false) return null;
  const detail = result.ok ? `HTTP ${result.status}` : result.timedOut ? 'timed out' : result.message;
  return `${label} / ${category}: ${detail}`;
}

export async function buildPersona(client: PersonaCaller, request: PersonaRequest): Promise<PersonaResult> {
  const location = request.location.trim();
  const warnings: string[] = [];
  const segments = await Promise.all(request.audiences.map(async (bucket) => {
    const categories = Object.keys(CATEGORY_TYPE) as PersonaCategory[];
    const calls = await Promise.all(categories.map(async (category) => {
      const result = await client.insights(paramsFor(category, request.brief, location, bucket));
      const note = warningFor(category, bucket.label, result);
      if (note) warnings.push(note);
      const rows = result.ok ? insightsFrom(result.body, CATEGORY_TYPE[category]) : [];
      return [category, rows] as const;
    }));
    const insights: PersonaInsights = { ...EMPTY };
    for (const [category, rows] of calls) insights[category] = rows;
    return {
      id: bucket.id,
      label: bucket.label,
      location,
      ...(bucket.age ? { age: bucket.age } : {}),
      ...(bucket.gender ? { gender: bucket.gender } : {}),
      insights,
    };
  }));
  return PersonaResultSchema.parse({
    location,
    segments,
    mode: client.mode,
    warnings,
  });
}
