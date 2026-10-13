import { facetsInIdea } from './facets.js';
import { USER_AGENT, type HttpClient } from './http.js';
import { buildPacket, limitedNumber, namedSignal } from './packet.js';
import { evidenceSignal } from './signal.js';
import { unresolvedEntity } from './entity.js';
import { referenceFromEntity } from './entity.js';
import type {
  Brief,
  EvidencePacket,
  EvidenceProvider,
  NamedSignal,
  ResolveContext,
  ResolvedEntity,
} from './types.js';

const SOURCE = 'osm';
/** Radius around the geocoded city center. Recorded Los Angeles fixture uses this radius. */
export const OSM_CENTER_RADIUS_M = 6000;

/** Hand-chosen proxy tags. They are not a taste taxonomy. */
export const OSM_INDIE_TAGS: readonly (readonly [string, string])[] = [
  ['shop', 'music'],
  ['shop', 'art'],
  ['tourism', 'gallery'],
  ['amenity', 'arts_centre'],
  ['shop', 'books'],
];

export const OSM_LUXURY_TAGS: readonly (readonly [string, string])[] = [
  ['shop', 'jewelry'],
  ['shop', 'watches'],
];

interface GeocodedCity {
  name: string;
  lat: string;
  lon: string;
  url: string;
}

export class OsmProvider implements EvidenceProvider {
  readonly id = SOURCE;

  constructor(private readonly http: HttpClient) {}

  async resolveEntities(refs: readonly string[], _context?: ResolveContext): Promise<ResolvedEntity[]> {
    return refs.map((query) => unresolvedEntity({
      query,
      source: `${SOURCE}:nominatim`,
      status: 'ambiguous',
      resolution: 'none',
      detail: 'OpenStreetMap is not used to resolve brands, artists, or films. No entity was invented.',
    }));
  }

  async getEvidence(brief: Brief): Promise<EvidencePacket> {
    const facets = facetsInIdea(brief.idea);
    const entities = await this.resolveEntities(brief.refs);
    const local = await this.localSignals(brief.city);
    return buildPacket({
      sourceId: 'open-data',
      brief,
      facets,
      refs: entities.map((entity) => referenceFromEntity(entity, facets, brief.city)),
      localBase: limitedNumber(
        `${SOURCE}:overpass`,
        'POI counts are not an indie-district affinity. Raw counts and the labeled proxy share are in local.signals. local.base is left empty so it is not scored as taste.',
      ),
      audienceBase: limitedNumber(SOURCE, 'OpenStreetMap has no age-band taste data.'),
      localSignals: local.signals,
    });
  }

  async localSignals(city: string): Promise<{ signals: NamedSignal[] }> {
    const place = await this.geocode(city);
    if (place.status !== 'found') {
      return {
        signals: [namedSignal('osm.city', 'location', city || 'city', evidenceSignal({
          value: null,
          source: `${SOURCE}:nominatim`,
          status: place.status,
          detail: place.detail,
          url: place.url,
        }))],
      };
    }
    const indie = await this.countTags(place.city, OSM_INDIE_TAGS);
    const luxury = await this.countTags(place.city, OSM_LUXURY_TAGS);
    const signals: NamedSignal[] = [
      namedSignal('osm.city', 'location', place.city.name, evidenceSignal({
        value: place.city.name,
        source: `${SOURCE}:nominatim`,
        status: 'found',
        detail: `Nominatim name match at ${place.city.lat},${place.city.lon}.`,
        url: place.city.url,
      })),
    ];
    if (indie.ok) {
      signals.push(namedSignal('osm.poi.indie', 'location', 'Indie-coded POIs', evidenceSignal({
        value: indie.count,
        source: `${SOURCE}:overpass`,
        status: 'found',
        detail: `Count of ${describeTags(OSM_INDIE_TAGS)} within ${OSM_CENTER_RADIUS_M}m of the city center. A POI count, not a taste affinity.`,
      })));
    } else {
      signals.push(namedSignal('osm.poi.indie', 'location', 'Indie-coded POIs', evidenceSignal({
        value: null,
        source: `${SOURCE}:overpass`,
        status: indie.status,
        detail: indie.detail,
      })));
    }
    if (luxury.ok) {
      signals.push(namedSignal('osm.poi.luxury', 'location', 'Luxury-coded POIs', evidenceSignal({
        value: luxury.count,
        source: `${SOURCE}:overpass`,
        status: 'found',
        detail: `Count of ${describeTags(OSM_LUXURY_TAGS)} within ${OSM_CENTER_RADIUS_M}m of the city center. A POI count, not a taste affinity.`,
      })));
    } else {
      signals.push(namedSignal('osm.poi.luxury', 'location', 'Luxury-coded POIs', evidenceSignal({
        value: null,
        source: `${SOURCE}:overpass`,
        status: luxury.status,
        detail: luxury.detail,
      })));
    }
    if (indie.ok && luxury.ok && indie.count + luxury.count > 0) {
      const share = Math.round((indie.count / (indie.count + luxury.count)) * 100);
      signals.push(namedSignal('osm.poi.indie-share', 'location', 'Indie-coded POI share', evidenceSignal({
        value: share,
        source: `${SOURCE}:overpass`,
        status: 'limited',
        detail: `Proxy only: indie-coded count / (indie-coded + luxury-coded) within ${OSM_CENTER_RADIUS_M}m of the city center, rounded. Not a Qloo affinity and not a neighborhood heatmap.`,
      })));
    }
    return { signals };
  }

  private async geocode(city: string): Promise<
    | { status: 'found'; city: GeocodedCity; detail: string; url?: string }
    | { status: 'ambiguous' | 'failed'; detail: string; url?: string }
  > {
    const trimmed = city.trim();
    if (!trimmed) {
      return { status: 'ambiguous', detail: 'The brief has no city.' };
    }
    const params = new URLSearchParams({ q: trimmed, format: 'jsonv2', limit: '5', addressdetails: '1' });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    const response = await this.http.getJson(url, { headers: osmHeaders() });
    if (!response.ok) return { status: 'failed', detail: response.message, url };
    if (response.status !== 200) {
      return { status: 'failed', detail: `Nominatim returned HTTP ${response.status}.`, url };
    }
    const results = readNominatim(response.body);
    const exact = results.filter((row) => row.name.toLowerCase() === trimmed.toLowerCase());
    const pool = exact.length > 1
      ? exact.filter((row) => row.addresstype === 'city' || row.addresstype === 'town' || row.addresstype === 'village')
      : exact;
    if (pool.length !== 1) {
      return {
        status: 'ambiguous',
        url,
        detail: results.length === 0
          ? `Nominatim returned no place named “${trimmed}”.`
          : `Nominatim did not return exactly one place named “${trimmed}”, so no POI query was sent.`,
      };
    }
    const hit = pool[0];
    if (!hit) return { status: 'ambiguous', detail: `Nominatim returned no place named “${trimmed}”.`, url };
    return {
      status: 'found',
      url,
      detail: hit.displayName,
      city: { name: hit.name, lat: hit.lat, lon: hit.lon, url },
    };
  }

  private async countTags(
    city: GeocodedCity,
    tags: readonly (readonly [string, string])[],
  ): Promise<{ ok: true; count: number } | { ok: false; status: 'failed' | 'ambiguous'; detail: string }> {
    const query = overpassCountQuery(city.lat, city.lon, tags);
    const params = new URLSearchParams({ data: query });
    const url = `https://overpass-api.de/api/interpreter?${params.toString()}`;
    const response = await this.http.getJson(url, { headers: osmHeaders(), timeoutMs: 20_000 });
    if (!response.ok) return { ok: false, status: 'failed', detail: response.message };
    if (response.status !== 200) {
      return { ok: false, status: 'failed', detail: `Overpass returned HTTP ${response.status}.` };
    }
    const count = readOverpassCount(response.body);
    if (count == null) {
      return {
        ok: false,
        status: 'ambiguous',
        detail: 'Overpass responded without an out-count element. No POI total was guessed.',
      };
    }
    return { ok: true, count };
  }
}

export function overpassCountQuery(
  lat: string,
  lon: string,
  tags: readonly (readonly [string, string])[],
): string {
  const clauses = tags.flatMap(([key, value]) => [
    `node["${key}"="${value}"](around:${OSM_CENTER_RADIUS_M},${lat},${lon});`,
    `way["${key}"="${value}"](around:${OSM_CENTER_RADIUS_M},${lat},${lon});`,
  ]);
  return `[out:json][timeout:20];\n(\n  ${clauses.join('\n  ')}\n);\nout count;`;
}

function osmHeaders(): Record<string, string> {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

interface NominatimHit {
  name: string;
  lat: string;
  lon: string;
  addresstype: string;
  displayName: string;
}

function readNominatim(body: unknown): NominatimHit[] {
  if (!Array.isArray(body)) return [];
  const hits: NominatimHit[] = [];
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { name?: unknown; lat?: unknown; lon?: unknown; addresstype?: unknown; display_name?: unknown };
    if (typeof record.name !== 'string' || typeof record.lat !== 'string' || typeof record.lon !== 'string') continue;
    hits.push({
      name: record.name,
      lat: record.lat,
      lon: record.lon,
      addresstype: typeof record.addresstype === 'string' ? record.addresstype : '',
      displayName: typeof record.display_name === 'string' ? record.display_name : record.name,
    });
  }
  return hits;
}

export function readOverpassCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const elements = (body as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const record = element as { type?: unknown; tags?: { total?: unknown } };
    if (record.type !== 'count') continue;
    const total = record.tags?.total;
    if (typeof total === 'number' && Number.isFinite(total)) return total;
    if (typeof total === 'string' && /^\d+$/.test(total)) return Number(total);
  }
  return null;
}

function describeTags(tags: readonly (readonly [string, string])[]): string {
  return tags.map(([key, value]) => `${key}=${value}`).join(', ');
}
