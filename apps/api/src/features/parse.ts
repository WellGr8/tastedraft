/**
 * Reads the fields the feature routes need from a Qloo envelope.
 * Explainability is accepted as an array of {entity_id, score} or as an object
 * keyed by signal name whose value is that array. Nothing else from the body is returned.
 */
import type { ExplainabilityContribution } from '@tastedraft/contracts';
import { readContributions } from '../providers/qloo/insights.ts';

export interface ParsedEntity {
  id: string;
  name: string;
  type: string;
  affinity: number | null;
  popularity: number | null;
  audienceGrowth: number | null;
  explainability: ExplainabilityContribution[];
  priceLevel: 1 | 2 | 3 | 4 | null;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
}

export interface HeatReading {
  geohash: string;
  lat: number;
  lng: number;
  affinity: number;
  popularityAffinity: number | null;
  priceLevelAffinity: number | null;
}

export interface DemographicSkew {
  dimension: 'age' | 'gender';
  bucket: string;
  value: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  if (scaled < 0 || scaled > 1) return null;
  return Math.round(scaled * 10000) / 10000;
}

function signed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * 1000) / 1000;
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function named(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return null;
  for (const key of ['name', 'label', 'value', 'title']) {
    const found = text(value[key]);
    if (found) return found;
  }
  return null;
}

export function priceLevelOf(value: unknown): 1 | 2 | 3 | 4 | null {
  if (typeof value === 'number' && value >= 1 && value <= 4) return Math.round(value) as 1 | 2 | 3 | 4;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\$+$/.test(trimmed) && trimmed.length <= 4) return trimmed.length as 1 | 2 | 3 | 4;
    const parsed = Number(trimmed);
    if (parsed >= 1 && parsed <= 4) return Math.round(parsed) as 1 | 2 | 3 | 4;
  }
  if (isRecord(value)) {
    return priceLevelOf(value.value ?? value.level ?? value.score ?? value.price_level);
  }
  return null;
}

function coordsOf(row: Record<string, unknown>): { lat: number | null; lng: number | null } {
  const properties = isRecord(row.properties) ? row.properties : undefined;
  const nests = [row.location, properties?.geocode, properties?.location, row];
  for (const nest of nests) {
    const rec = nest === row ? row : isRecord(nest) ? nest : null;
    if (!rec) continue;
    const lat = typeof rec.latitude === 'number' ? rec.latitude : typeof rec.lat === 'number' ? rec.lat : null;
    const lng = typeof rec.longitude === 'number' ? rec.longitude : typeof rec.lng === 'number' ? rec.lng : typeof rec.lon === 'number' ? rec.lon : null;
    if (lat == null || lng == null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (nest === row && rec.latitude == null && rec.lat == null) continue;
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }
  return { lat: null, lng: null };
}

export function entityList(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body) || body.success === false) return [];
  const results = isRecord(body.results) ? body.results : undefined;
  const list = results && Array.isArray(results.entities) ? results.entities : Array.isArray(body.results) ? body.results : [];
  return list.filter(isRecord);
}

export function parseEntity(row: Record<string, unknown>, fallbackType: string): ParsedEntity | null {
  const id = text(row.entity_id) || text(row.id);
  const name = text(row.name) || id;
  if (!id || !name) return null;
  const properties = isRecord(row.properties) ? row.properties : undefined;
  const query = isRecord(row.query) ? row.query : undefined;
  const measurements = query && isRecord(query.measurements) ? query.measurements : undefined;
  const types = Array.isArray(row.types) ? row.types.find((item) => typeof item === 'string' && item.startsWith('urn:entity:')) : undefined;
  const type = text(row.subtype) || (typeof types === 'string' ? types : '') || fallbackType;
  const locality = properties && isRecord(properties.locality) ? properties.locality : undefined;
  const coords = coordsOf(row);
  const growth = measurements && typeof measurements.audience_growth === 'number' && Number.isFinite(measurements.audience_growth)
    ? measurements.audience_growth
    : null;
  return {
    id,
    name,
    type,
    affinity: unit(query?.affinity ?? row.affinity),
    popularity: unit(row.popularity ?? properties?.popularity),
    audienceGrowth: growth,
    explainability: readContributions(row, id),
    priceLevel: priceLevelOf(properties?.price_level ?? properties?.price),
    lat: coords.lat,
    lng: coords.lng,
    neighborhood: named(locality?.neighborhood) ?? named(properties?.neighborhood),
  };
}

export function parseEntities(body: unknown, fallbackType: string): ParsedEntity[] {
  const rows: ParsedEntity[] = [];
  for (const row of entityList(body)) {
    const parsed = parseEntity(row, fallbackType);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export function parseDemographics(body: unknown): DemographicSkew[] {
  if (!isRecord(body) || body.success === false) return [];
  const results = isRecord(body.results) ? body.results : undefined;
  const list = results && Array.isArray(results.demographics) ? results.demographics : [];
  const row = list.find(isRecord);
  const query = row && isRecord(row.query) ? row.query : undefined;
  if (!query) return [];
  const out: DemographicSkew[] = [];
  const age = isRecord(query.age) ? query.age : undefined;
  const gender = isRecord(query.gender) ? query.gender : undefined;
  if (age) {
    for (const [bucket, value] of Object.entries(age)) {
      const scored = signed(value);
      if (scored == null) continue;
      out.push({ dimension: 'age', bucket, value: scored });
    }
  }
  if (gender) {
    for (const bucket of ['female', 'male']) {
      const scored = signed(gender[bucket]);
      if (scored == null) continue;
      out.push({ dimension: 'gender', bucket, value: scored });
    }
  }
  return out;
}

export function parseHeatmap(body: unknown): HeatReading[] {
  if (!isRecord(body) || body.success === false) return [];
  const results = isRecord(body.results) ? body.results : undefined;
  const list = results && Array.isArray(results.heatmap) ? results.heatmap : [];
  const cells: HeatReading[] = [];
  list.forEach((item, index) => {
    if (!isRecord(item)) return;
    const location = isRecord(item.location) ? item.location : undefined;
    const query = isRecord(item.query) ? item.query : undefined;
    const lat = typeof location?.latitude === 'number' ? location.latitude : null;
    const lng = typeof location?.longitude === 'number' ? location.longitude : null;
    if (lat == null || lng == null) return;
    const affinity = unit(query?.affinity);
    if (affinity == null) return;
    cells.push({
      geohash: text(location?.geohash) || `cell-${index + 1}`,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      affinity,
      popularityAffinity: unit(query?.popularity_affinity),
      priceLevelAffinity: unit(query?.price_level_affinity),
    });
  });
  return cells;
}

export function searchHits(body: unknown): Array<{ id: string; name: string; type: string }> {
  if (!isRecord(body)) return [];
  const list = Array.isArray(body.results) ? body.results : isRecord(body.results) && Array.isArray(body.results.entities) ? body.results.entities : [];
  const hits: Array<{ id: string; name: string; type: string }> = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = text(item.entity_id) || text(item.id);
    const name = text(item.name);
    if (!id || !name) continue;
    const types = Array.isArray(item.types) ? item.types.find((entry) => typeof entry === 'string') : undefined;
    hits.push({ id, name, type: typeof types === 'string' ? types : 'urn:entity' });
  }
  return hits;
}
