/**
 * District layers for the brief map.
 *
 * Asks QlooClient for `filter.type=urn:heatmap` with `output.heatmap.boundary`
 * and `signal.interests.*`. When that call has no coordinates, falls back to
 * `urn:entity:place` pins for `filter.location.query`. No API key: the client
 * is already in mock mode, and known cities are drawn on their own districts.
 * This module does not open its own HTTP client.
 */
import { MapLayerSchema, type HeatmapCell, type MapLayer, type MapPin } from '@tastedraft/contracts';
import { ZodError, z } from 'zod';
import { QlooClient, type QlooInsightsParams, type QlooMode, type QlooResult } from './client.ts';

const GEO_BASE = '0123456789bcdefghjkmnpqrstuvwxyz';

interface Spot {
  name: string;
  lat: number;
  lng: number;
}

interface CitySpots {
  center: { lat: number; lng: number };
  fits: Spot[];
  friction: Spot[];
}

/** Neighbourhood centres shared with split/map.js. The map opens on `center`. */
const CITIES: Record<string, CitySpots> = {
  'los angeles': {
    center: { lat: 34.0522, lng: -118.2437 },
    fits: [
      { name: 'Silver Lake', lat: 34.0869, lng: -118.2702 },
      { name: 'Echo Park', lat: 34.0782, lng: -118.2606 },
    ],
    friction: [
      { name: 'Beverly Hills', lat: 34.0736, lng: -118.4004 },
      { name: 'West Hollywood', lat: 34.09, lng: -118.3617 },
    ],
  },
  'new york': {
    center: { lat: 40.7128, lng: -74.006 },
    fits: [
      { name: 'Lower East Side', lat: 40.715, lng: -73.9843 },
      { name: 'Williamsburg', lat: 40.7081, lng: -73.9571 },
    ],
    friction: [
      { name: 'Upper East Side', lat: 40.7736, lng: -73.9566 },
      { name: 'Tribeca', lat: 40.7163, lng: -74.0086 },
    ],
  },
  'san francisco': {
    center: { lat: 37.7749, lng: -122.4194 },
    fits: [
      { name: 'Mission', lat: 37.7599, lng: -122.4148 },
      { name: 'Hayes Valley', lat: 37.7763, lng: -122.4242 },
    ],
    friction: [
      { name: 'Pacific Heights', lat: 37.7925, lng: -122.4382 },
      { name: 'Union Square', lat: 37.788, lng: -122.4074 },
    ],
  },
  austin: {
    center: { lat: 30.2672, lng: -97.7431 },
    fits: [
      { name: 'East Austin', lat: 30.2628, lng: -97.7145 },
      { name: 'South Congress', lat: 30.25, lng: -97.749 },
    ],
    friction: [
      { name: 'Westlake', lat: 30.297, lng: -97.812 },
      { name: 'The Domain', lat: 30.4021, lng: -97.7255 },
    ],
  },
  miami: {
    center: { lat: 25.7617, lng: -80.1918 },
    fits: [
      { name: 'Wynwood', lat: 25.801, lng: -80.1994 },
      { name: 'Little Haiti', lat: 25.8246, lng: -80.1918 },
    ],
    friction: [
      { name: 'South Beach', lat: 25.7826, lng: -80.1341 },
      { name: 'Brickell', lat: 25.7617, lng: -80.1918 },
    ],
  },
  chicago: {
    center: { lat: 41.8781, lng: -87.6298 },
    fits: [
      { name: 'Logan Square', lat: 41.9231, lng: -87.7093 },
      { name: 'Wicker Park', lat: 41.9088, lng: -87.6796 },
    ],
    friction: [
      { name: 'Gold Coast', lat: 41.9058, lng: -87.6273 },
      { name: 'River North', lat: 41.8924, lng: -87.6341 },
    ],
  },
  bangkok: {
    center: { lat: 13.7563, lng: 100.5018 },
    fits: [
      { name: 'Yaowarat', lat: 13.741, lng: 100.51 },
      { name: 'Talad Neon', lat: 13.77, lng: 100.569 },
    ],
    friction: [
      { name: 'Thonglor', lat: 13.724, lng: 100.578 },
      { name: 'Siam', lat: 13.746, lng: 100.535 },
    ],
  },
  seattle: {
    center: { lat: 47.6062, lng: -122.3321 },
    fits: [
      { name: 'Capitol Hill', lat: 47.6253, lng: -122.3222 },
      { name: 'Fremont', lat: 47.651, lng: -122.35 },
    ],
    friction: [
      { name: 'Medina', lat: 47.6205, lng: -122.227 },
      { name: 'Bellevue', lat: 47.6101, lng: -122.2015 },
    ],
  },
};

const NameList = z.preprocess((value) => {
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return value;
}, z.array(z.string().min(1)).optional());

const InterestsSchema = z
  .object({
    entities: NameList,
    tags: NameList,
  })
  .strict();

const LocationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    image: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
  })
  .strict();

const VersionSchema = z
  .object({
    city: z.string().trim().min(1).optional(),
    interests: InterestsSchema.optional(),
  })
  .strict();

const MapRequestSchema = z
  .object({
    city: z.string().trim().min(1),
    interests: InterestsSchema.optional(),
    locations: z.array(LocationSchema).optional(),
    v2: VersionSchema.nullable().optional(),
  })
  .strict();

export type MapRequest = z.infer<typeof MapRequestSchema>;

export interface MapCard {
  id: string;
  name: string;
  lat: number;
  lng: number;
  image?: string;
  entityId?: string;
}

export interface MapPayload {
  city: string;
  center: { lat: number; lng: number };
  mode: QlooMode;
  basis: 'heatmap' | 'places';
  note: string;
  fits: { v1: MapLayer; v2: MapLayer | null };
  friction: { v1: MapLayer; v2: MapLayer | null };
  locations: MapLayer;
  cards: MapCard[];
}

type District = 'fits' | 'friction';
type VersionId = 'v1' | 'v2';
type Basis = 'heatmap' | 'places';

interface BuiltLayer {
  layer: MapLayer;
  basis: Basis;
  mode: QlooMode;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clampUnit(value: number): number {
  const cents = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return cents / 100;
}

function shiftWeight(base: number, delta: number): number {
  const cents = Math.round(base * 100) + Math.round(delta * 100);
  return Math.min(100, Math.max(0, cents)) / 100;
}

/** Centre of a geohash cell. Invalid characters return null. */
export function geohashCenter(hash: string): { lat: number; lng: number } | null {
  const text = hash.trim().toLowerCase();
  if (!text || [...text].some((char) => !GEO_BASE.includes(char))) return null;
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  for (const char of text) {
    const value = GEO_BASE.indexOf(char);
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (value >> bit) & 1;
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (set) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (set) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

function coordsOf(row: Record<string, unknown>): { lat: number; lng: number } | null {
  const properties = asRecord(row.properties);
  const nests = [row.location, properties?.location, properties?.geocode, row];
  for (const nest of nests) {
    const rec = nest === row ? row : asRecord(nest);
    if (!rec) continue;
    const lat = asNumber(rec.lat ?? rec.latitude);
    const lng = asNumber(rec.lng ?? rec.lon ?? rec.longitude);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (nest === row && rec.lat === undefined && rec.latitude === undefined) continue;
    return { lat: roundCoord(lat), lng: roundCoord(lng) };
  }
  if (typeof row.geohash === 'string') {
    const decoded = geohashCenter(row.geohash);
    if (decoded) return { lat: roundCoord(decoded.lat), lng: roundCoord(decoded.lng) };
  }
  return null;
}

function weightOf(row: Record<string, unknown>): number {
  const query = asRecord(row.query);
  const candidates = [query?.affinity, row.affinity, row.weight, row.popularity];
  for (const candidate of candidates) {
    const value = asNumber(candidate);
    if (value === null) continue;
    const unit = value > 1 && value <= 100 ? value / 100 : value;
    return clampUnit(unit);
  }
  return 0.5;
}

function textOf(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function rowsOf(body: unknown): unknown[] {
  const results = asRecord(body)?.results ?? body;
  const rec = asRecord(results);
  if (!rec) return Array.isArray(results) ? results : [];
  if (Array.isArray(rec.heatmap)) return rec.heatmap;
  if (Array.isArray(rec.entities)) return rec.entities;
  return [];
}

function uniqueId(id: string, seen: Set<string>): string {
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let n = 2;
  while (seen.has(`${id}-${n}`)) n += 1;
  const next = `${id}-${n}`;
  seen.add(next);
  return next;
}

function parseHeatCells(body: unknown): HeatmapCell[] {
  const seen = new Set<string>();
  const cells: HeatmapCell[] = [];
  rowsOf(body).forEach((row, index) => {
    const rec = asRecord(row);
    if (!rec) return;
    const coords = coordsOf(rec);
    if (!coords) return;
    const rawId = textOf(rec.id) || textOf(rec.entity_id) || textOf(rec.geohash) || `cell-${index + 1}`;
    const label = textOf(rec.label) || textOf(rec.name) || textOf(asRecord(rec.properties)?.name);
    const cell: HeatmapCell = {
      id: uniqueId(rawId, seen),
      lat: coords.lat,
      lng: coords.lng,
      weight: weightOf(rec),
      ...(label ? { label } : {}),
    };
    cells.push(cell);
  });
  return cells;
}

function parsePlacePins(body: unknown): MapPin[] {
  const seen = new Set<string>();
  const pins: MapPin[] = [];
  rowsOf(body).forEach((row, index) => {
    const rec = asRecord(row);
    if (!rec) return;
    const coords = coordsOf(rec);
    if (!coords) return;
    const name = textOf(rec.name) || textOf(rec.label) || textOf(asRecord(rec.properties)?.name);
    if (!name) return;
    const rawId = textOf(rec.entity_id) || textOf(rec.id) || `place-${index + 1}`;
    const entityId = textOf(rec.entity_id);
    pins.push({
      id: uniqueId(rawId, seen),
      name,
      lat: coords.lat,
      lng: coords.lng,
      ...(entityId ? { entityId } : {}),
    });
  });
  return pins;
}

function cityTable(city: string): CitySpots | undefined {
  return CITIES[city.trim().toLowerCase()];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mockCells(parsed: HeatmapCell[], city: string, district: District, version: VersionId): HeatmapCell[] {
  const table = cityTable(city);
  if (!table) return parsed;
  const spots = table[district];
  const delta = version === 'v2' ? (district === 'fits' ? 0.18 : -0.18) : 0;
  return spots.map((spot, index) => {
    const source = parsed.length ? parsed[index % parsed.length] : undefined;
    return {
      id: `${district}-${version}-${slug(spot.name)}`,
      lat: spot.lat,
      lng: spot.lng,
      weight: shiftWeight(source?.weight ?? 0.45, delta),
      label: spot.name,
    };
  });
}

function signalFrom(interests: MapRequest['interests']): QlooInsightsParams['signal'] | undefined {
  if (!interests) return undefined;
  const interestsParam: Record<string, string> = {};
  if (interests.entities?.length) interestsParam.entities = interests.entities.join(',');
  if (interests.tags?.length) interestsParam.tags = interests.tags.join(',');
  if (!Object.keys(interestsParam).length) return undefined;
  return { interests: interestsParam };
}

function layerName(district: District, version: VersionId, basis: Basis): string {
  const side = district === 'fits' ? 'Fits' : 'Friction';
  const ver = version.toUpperCase();
  return basis === 'places' ? `${side} · ${ver} · places` : `${side} · ${ver}`;
}

function heatLayer(district: District, version: VersionId, cells: HeatmapCell[]): MapLayer {
  return MapLayerSchema.parse({
    kind: 'heatmap',
    id: `${district}-${version}`,
    name: layerName(district, version, 'heatmap'),
    cells,
  });
}

function pinLayer(id: string, name: string, pins: MapPin[]): MapLayer {
  return MapLayerSchema.parse({ kind: 'pins', id, name, pins });
}

function usable(result: QlooResult): result is Extract<QlooResult, { ok: true }> {
  return result.ok && result.status === 200 && result.body.success !== false;
}

function splitList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function coerceMapInput(input: unknown): unknown {
  if (input == null || input === '') return { city: 'Los Angeles' };
  if (typeof input !== 'object' || Array.isArray(input)) return input;
  const rec = input as Record<string, unknown>;
  const queryLike = Object.values(rec).every((value) => typeof value === 'string');
  if (!queryLike) return input;
  const entities = splitList(rec.entities);
  const tags = splitList(rec.tags);
  const interests = {
    ...(entities ? { entities } : {}),
    ...(tags ? { tags } : {}),
  };
  return {
    city: typeof rec.city === 'string' ? rec.city : 'Los Angeles',
    ...(Object.keys(interests).length ? { interests } : {}),
    ...(rec.v2 === '1' || rec.v2 === 'true' ? { v2: {} } : {}),
  };
}

function centerFor(city: string, points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const known = cityTable(city);
  if (known) return known.center;
  if (!points.length) return { lat: 34.0522, lng: -118.2437 };
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

async function placePins(client: QlooClient, city: string, cache: Map<string, { pins: MapPin[]; mode: QlooMode }>): Promise<{ pins: MapPin[]; mode: QlooMode }> {
  const key = city.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await client.insights({
    filter: { type: 'urn:entity:place', location: { query: city } },
    take: 12,
  });
  const pins = usable(result) ? parsePlacePins(result.body) : [];
  const stored = { pins, mode: result.mode };
  cache.set(key, stored);
  return stored;
}

async function buildLayer(
  client: QlooClient,
  city: string,
  interests: MapRequest['interests'],
  district: District,
  version: VersionId,
  places: Map<string, { pins: MapPin[]; mode: QlooMode }>,
): Promise<BuiltLayer> {
  const signal = signalFrom(interests);
  const params: QlooInsightsParams = {
    filter: { type: 'urn:heatmap', location: { query: city } },
    output: { heatmap: { boundary: 'urn:entity:locality' } },
    take: 40,
    ...(signal ? { signal } : {}),
    ...(district === 'friction' ? { extra: { 'heatmap.dimensions': 'price_level' } } : {}),
  };
  const heat = await client.insights(params);
  if (usable(heat)) {
    const parsed = parseHeatCells(heat.body);
    const cells = heat.mode === 'mock' ? mockCells(parsed, city, district, version) : parsed;
    if (cells.length) return { layer: heatLayer(district, version, cells), basis: 'heatmap', mode: heat.mode };
  }
  const fallback = await placePins(client, city, places);
  return {
    layer: pinLayer(`${district}-${version}`, layerName(district, version, 'places'), fallback.pins),
    basis: 'places',
    mode: fallback.mode,
  };
}

function locationLayer(cards: MapCard[]): MapLayer {
  return pinLayer(
    'locations',
    'Chosen locations',
    cards.map((card) => ({
      id: card.id,
      name: card.name,
      lat: card.lat,
      lng: card.lng,
      ...(card.entityId ? { entityId: card.entityId } : {}),
    })),
  );
}

function noteFor(mode: QlooMode, basis: Basis, city: string): string {
  if (mode === 'mock' && basis === 'heatmap') return `Mock data · heatmap centred on ${city}`;
  if (basis === 'places') return `Place pins · heatmap unavailable · ${city}`;
  return `Qloo heatmap · ${city}`;
}

/** Build fits, friction, and chosen-location layers for one brief city. */
export async function loadMapLayers(input: unknown, client: QlooClient = new QlooClient()): Promise<MapPayload> {
  const parsed = MapRequestSchema.safeParse(coerceMapInput(input));
  if (!parsed.success) throw new ZodError(parsed.error.issues);
  const request = parsed.data;
  const places = new Map<string, { pins: MapPin[]; mode: QlooMode }>();
  const fitsV1 = await buildLayer(client, request.city, request.interests, 'fits', 'v1', places);
  const frictionV1 = await buildLayer(client, request.city, request.interests, 'friction', 'v1', places);
  let fitsV2: MapLayer | null = null;
  let frictionV2: MapLayer | null = null;
  if (request.v2) {
    const v2City = request.v2.city ?? request.city;
    const v2Interests = request.v2.interests ?? request.interests;
    fitsV2 = (await buildLayer(client, v2City, v2Interests, 'fits', 'v2', places)).layer;
    frictionV2 = (await buildLayer(client, v2City, v2Interests, 'friction', 'v2', places)).layer;
  }
  const cards = (request.locations ?? []).map((card) => ({ ...card }));
  const sample = fitsV1.layer.kind === 'heatmap' ? fitsV1.layer.cells : fitsV1.layer.pins;
  return {
    city: request.city,
    center: centerFor(request.city, sample),
    mode: client.mode,
    basis: fitsV1.basis,
    note: noteFor(client.mode, fitsV1.basis, request.city),
    fits: { v1: fitsV1.layer, v2: fitsV2 },
    friction: { v1: frictionV1.layer, v2: frictionV2 },
    locations: locationLayer(cards),
    cards,
  };
}
