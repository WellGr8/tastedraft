/**
 * Search when Qloo is not configured.
 * Wikidata supplies names, types, and Commons images. MusicBrainz supplies artists.
 * The mock catalog is not consulted here.
 */
import type { Entity } from '@tastedraft/contracts';
import { createHttpClient, type HttpClient } from '../http.ts';
import { MusicBrainzProvider } from '../musicbrainz.ts';
import type { ResolvedEntity } from '../types.ts';
import { WikidataProvider } from '../wikidata.ts';
function canonicalType(type: string | undefined): string {
  const lower = (type ?? '').trim().toLowerCase();
  if (!lower) return '';
  if (lower.includes('movie') || lower.includes('film')) return 'urn:entity:movie';
  if (lower.includes('brand')) return 'urn:entity:brand';
  if (lower.includes('artist')) return 'urn:entity:artist';
  if (lower.includes('place') || lower.includes('destination') || lower.includes('locality')) return 'urn:entity:place';
  return lower;
}

function isPlaceType(type: string | undefined): boolean {
  return canonicalType(type) === 'urn:entity:place';
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const URN: Record<string, string> = {
  Brand: 'urn:entity:brand',
  Artist: 'urn:entity:artist',
  Film: 'urn:entity:movie',
  Place: 'urn:entity:place',
  Reference: 'urn:entity',
};

export interface OpenCatalog {
  search(query: string, type?: string, city?: string): Promise<Entity[]>;
}

function urnFor(type: string | null | undefined): string {
  if (!type) return 'urn:entity';
  return URN[type] ?? 'urn:entity';
}

function toEntity(row: ResolvedEntity, source: 'wikidata' | 'musicbrainz'): Entity | null {
  if (row.status !== 'found' || !row.id || !row.name) return null;
  const entity: Entity = {
    id: row.id,
    name: row.name,
    type: urnFor(row.type.value),
    source,
  };
  if (row.image) entity.image = row.image;
  const city = row.locatedIn[0];
  if (city) entity.city = city;
  return entity;
}

function wanted(type: string | undefined, entityType: string): boolean {
  const filter = canonicalType(type);
  if (!filter) return true;
  return canonicalType(entityType) === filter;
}

const CULTURAL = /\b(girl group|boy group|boy band|musical group|musical ensemble|idol group|animation studio|anime studio|film studio|fashion house|retailer|clothing company)\b/i;
const RELEASE = /\b(ep|album|single|song|discography|soundtrack|episode|compilation)\b/i;

function preferredCandidate(candidates: ReadonlyArray<{ id: string; description?: string }>): string | null {
  const ranked = candidates
    .map((candidate) => {
      const description = candidate.description ?? '';
      let score = 0;
      if (CULTURAL.test(description)) score += 3;
      if (RELEASE.test(description)) score -= 3;
      return { id: candidate.id, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  if (ranked[1] && ranked[1].score === top.score) return null;
  return top.id;
}

export function createOpenCatalog(http: HttpClient = createHttpClient()): OpenCatalog {
  const wikidata = new WikidataProvider({ http });
  const musicbrainz = new MusicBrainzProvider(http);
  return {
    async search(query, type, city) {
      const place = isPlaceType(type);
      const context = city ? { city } : undefined;
      const loadWiki = () => wikidata.resolveEntities([query], context).catch(() => []);
      let wikiRows = await loadWiki();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const usable = wikiRows.some((row) => row.status === 'found' || (row.status === 'ambiguous' && row.candidates.length > 0));
        if (usable) break;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        wikiRows = await loadWiki();
      }
      const extraIds = wikiRows.flatMap((row) => {
        if (row.status === 'found' || !row.candidates.length) return [];
        const id = preferredCandidate(row.candidates);
        return id ? [id] : [];
      });
      if (extraIds.length) {
        const hydrated = await wikidata.resolveKnownIds(extraIds, query).catch(() => []);
        wikiRows = [...wikiRows, ...hydrated];
      }
      const musicRows = place ? [] : await musicbrainz.resolveEntities([query]).catch(() => []);
      const merged: Entity[] = [];
      const seen = new Set<string>();
      for (const row of wikiRows) {
        const entity = toEntity(row, 'wikidata');
        if (!entity || !wanted(type, entity.type)) continue;
        const key = normalizeName(entity.name);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entity);
      }
      for (const row of musicRows) {
        const entity = toEntity(row, 'musicbrainz');
        if (!entity || !wanted(type, entity.type)) continue;
        const key = normalizeName(entity.name);
        const existing = merged.find((item) => normalizeName(item.name) === key);
        if (existing) {
          if (!existing.image && entity.image) existing.image = entity.image;
          if (existing.type === 'urn:entity' && entity.type !== 'urn:entity') existing.type = entity.type;
          continue;
        }
        seen.add(key);
        merged.push(entity);
      }
      return merged;
    },
  };
}
