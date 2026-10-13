/**
 * TasteDraft search for the input screen.
 *
 * Qloo `/search` is first. Entity images are the ones Qloo returned.
 * Wikidata and MusicBrainz run only when that call fails (no key, HTTP
 * error, timeout, or success: false). Place searches still bias by appending
 * the city, then drop places whose city conflicts. This module does not open
 * its own Qloo HTTP client and does not read the offline mock catalog.
 */
import { EntitySchema, SearchResultSchema, TagSchema, type Entity, type SearchResult, type Tag } from '@tastedraft/contracts';
import { QlooClient, type QlooResult } from './client.ts';
import { createOpenCatalog, type OpenCatalog } from './open-search.ts';

const TAKE = 8;

export interface EntitySearchInput {
  client: QlooClient;
  q: string;
  type?: string;
  city?: string;
  /** Wikidata + MusicBrainz. Used only after Qloo search fails. */
  openData?: OpenCatalog;
}

export interface TagSearchResult {
  query: string;
  tags: Tag[];
  source: string;
}

export function canonicalType(type: string | undefined): string {
  const lower = (type ?? '').trim().toLowerCase();
  if (!lower) return '';
  if (lower.startsWith('urn:')) {
    if (lower.includes(':movie') || lower.includes(':film')) return 'urn:entity:movie';
    if (lower.includes(':brand')) return 'urn:entity:brand';
    if (lower.includes(':artist')) return 'urn:entity:artist';
    if (lower.includes(':place') || lower.includes(':destination') || lower.includes(':locality')) return 'urn:entity:place';
    if (lower.includes(':person')) return 'urn:entity:person';
    return lower;
  }
  if (lower === 'brand') return 'urn:entity:brand';
  if (lower === 'artist') return 'urn:entity:artist';
  if (lower === 'film' || lower === 'movie') return 'urn:entity:movie';
  if (lower === 'place' || lower === 'location') return 'urn:entity:place';
  if (lower === 'person') return 'urn:entity:person';
  return lower;
}

export function sameType(left: string | undefined, right: string | undefined): boolean {
  const a = canonicalType(left);
  const b = canonicalType(right);
  return !!a && a === b;
}

export function isPlaceType(type: string | undefined): boolean {
  return canonicalType(type) === 'urn:entity:place';
}

export function isBrandType(type: string | undefined): boolean {
  return canonicalType(type) === 'urn:entity:brand';
}

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameCity(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function rank(entity: Entity, query: string, city: string, typed: boolean): number {
  const name = normalizeName(entity.name);
  let score = 0;
  if (query && name === query) score += 100;
  else if (query && name.startsWith(query)) score += 40;
  else if (query && name.includes(query)) score += 20;
  if (city && entity.city && sameCity(entity.city, city)) score += 30;
  // Same-name collisions: the brand is the cultural reference (Muji).
  if (!typed && query && name === query && isBrandType(entity.type)) score += 8;
  return score;
}

/**
 * Filter by requested type, bias places toward `city`, and rank an exact
 * brand match ahead of another type with the same name.
 */
export function disambiguateEntities(
  entities: readonly Entity[],
  options: { query: string; type?: string; city?: string },
): Entity[] {
  const wanted = canonicalType(options.type);
  const city = (options.city ?? '').trim();
  const placeSearch = isPlaceType(wanted);
  const query = normalizeName(options.query);
  const seen = new Set<string>();
  const rows: Entity[] = [];
  for (const entity of entities) {
    if (wanted && !sameType(entity.type, wanted)) continue;
    if (placeSearch && city && entity.city && !sameCity(entity.city, city)) continue;
    const next = placeSearch && city && !entity.city ? { ...entity, city } : entity;
    const key = `${next.id}|${canonicalType(next.type)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(next);
  }
  const typed = !!wanted;
  return rows
    .map((entity, index) => ({ entity, index, score: rank(entity, query, city, typed) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.entity);
}

function sourceId(mode: QlooResult['mode']): string {
  return mode === 'mock' ? 'mock' : 'qloo';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function readString(value: unknown, path: string): string | undefined {
  const found = path ? readPath(value, path) : value;
  return typeof found === 'string' && found.trim() ? found.trim() : undefined;
}

function readNumber(value: unknown, path: string): number | undefined {
  const found = readPath(value, path);
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined;
}

function readImage(row: unknown): string | undefined {
  return (
    readString(row, 'properties.image.url') ??
    readString(row, 'properties.images.0.url') ??
    readString(row, 'image.url') ??
    readString(row, 'properties.image') ??
    readString(row, 'image')
  );
}

function readCity(row: unknown): string | undefined {
  return (
    readString(row, 'properties.city') ??
    readString(row, 'properties.location.city') ??
    readString(row, 'location.city') ??
    readString(row, 'properties.address.city')
  );
}

function readGeo(row: unknown): Entity['geo'] | undefined {
  const lat =
    readNumber(row, 'properties.location.lat') ??
    readNumber(row, 'location.lat') ??
    readNumber(row, 'properties.geocode.lat');
  const lng =
    readNumber(row, 'properties.location.lng') ??
    readNumber(row, 'properties.location.lon') ??
    readNumber(row, 'location.lng') ??
    readNumber(row, 'location.lon');
  if (lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function readUrn(row: unknown): string {
  const types = readPath(row, 'types');
  if (Array.isArray(types)) {
    const urn = types.find((item) => typeof item === 'string' && item.startsWith('urn:entity:') && item !== 'urn:entity');
    if (typeof urn === 'string') return urn;
  }
  const subtype = readString(row, 'subtype');
  const type = readString(row, 'type');
  if (subtype && subtype !== 'urn:entity') return subtype;
  if (type && type !== 'urn:entity') return type;
  return subtype || type || 'Reference';
}

function resultRows(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  const results = body.results;
  if (Array.isArray(results)) return results;
  if (isRecord(results) && Array.isArray(results.entities)) return results.entities;
  return [];
}

export function entitiesFromQloo(body: unknown, source: string): Entity[] {
  const entities: Entity[] = [];
  for (const row of resultRows(body)) {
    const id = readString(row, 'entity_id') ?? readString(row, 'id');
    const name = readString(row, 'name');
    if (!id || !name) continue;
    const entity: Entity = { id, name, type: readUrn(row), source };
    const image = readImage(row);
    const city = readCity(row);
    const geo = readGeo(row);
    if (image) entity.image = image;
    if (city) entity.city = city;
    if (geo) entity.geo = geo;
    const parsed = EntitySchema.safeParse(entity);
    if (parsed.success) entities.push(parsed.data);
  }
  return entities;
}

function tagRows(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  const results = body.results;
  if (Array.isArray(results)) return results;
  if (!isRecord(results)) return [];
  const tags = Array.isArray(results.tags) ? results.tags : [];
  const entities = Array.isArray(results.entities) ? results.entities : [];
  return [...tags, ...entities];
}

export function tagsFromQloo(body: unknown): Tag[] {
  const tags: Tag[] = [];
  for (const row of tagRows(body)) {
    const id = readString(row, 'id') ?? readString(row, 'tag_id') ?? readString(row, 'entity_id');
    const name = readString(row, 'name');
    if (!id || !name) continue;
    const tag: Tag = { id, name };
    const type = readString(row, 'type') ?? readString(row, 'subtype');
    if (type && type !== 'urn:entity') tag.type = type;
    const parsed = TagSchema.safeParse(tag);
    if (parsed.success) tags.push(parsed.data);
  }
  return tags;
}

function searchQueries(q: string, type: string | undefined, city: string | undefined): string[] {
  const queries = [q];
  const place = isPlaceType(type);
  const where = (city ?? '').trim();
  if (place && where && !normalizeName(q).includes(normalizeName(where))) {
    queries.push(`${q} ${where}`.trim());
  }
  return queries;
}

function qlooSearchOk(result: QlooResult): result is Extract<QlooResult, { ok: true }> {
  return result.ok && result.mode === 'live' && result.status === 200 && result.body.success !== false;
}

async function openFallback(input: EntitySearchInput, q: string, type: string | undefined, city: string | undefined): Promise<SearchResult> {
  try {
    const catalog = input.openData ?? createOpenCatalog();
    const opened = await catalog.search(q, type, city);
    const entities = disambiguateEntities(opened, { query: q, type, city }).slice(0, TAKE);
    return SearchResultSchema.parse({ query: q, entities, source: 'open-data' });
  } catch {
    return SearchResultSchema.parse({ query: q, entities: [], source: 'open-data' });
  }
}

export async function searchEntities(input: EntitySearchInput): Promise<SearchResult> {
  const q = input.q.trim();
  const type = input.type?.trim() || undefined;
  const city = input.city?.trim() || undefined;
  const queries = searchQueries(q, type, city);
  const merged: Entity[] = [];
  let live = false;
  for (const query of queries) {
    const result = await input.client.search({
      query,
      ...(type ? { types: canonicalType(type) || type } : {}),
      take: TAKE,
    });
    if (!qlooSearchOk(result)) continue;
    live = true;
    merged.push(...entitiesFromQloo(result.body, 'qloo'));
  }
  if (!live) return openFallback(input, q, type, city);
  const entities = disambiguateEntities(merged, { query: q, type, city }).slice(0, TAKE);
  return SearchResultSchema.parse({ query: q, entities, source: 'qloo' });
}

export async function searchTags(client: QlooClient, q: string): Promise<TagSearchResult> {
  const query = q.trim();
  const result = await client.tags({
    filter: { query },
    feature: { semantic_search: true },
    take: TAKE,
  });
  const tags = result.ok && result.body.success !== false ? tagsFromQloo(result.body).slice(0, TAKE) : [];
  return { query, tags, source: sourceId(result.mode) };
}
