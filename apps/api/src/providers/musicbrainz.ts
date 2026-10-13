import { referenceFromEntity, typedEntity, unresolvedEntity } from './entity.js';
import { facetsInIdea, matchingLabel } from './facets.js';
import { USER_AGENT, type HttpClient } from './http.js';
import { buildPacket, limitedNumber, namedSignal } from './packet.js';
import { chooseMusicBrainz, type NameHit } from './resolve.js';
import { evidenceSignal } from './signal.js';
import type {
  Brief,
  EvidencePacket,
  EvidenceProvider,
  NamedSignal,
  ResolveContext,
  ResolvedEntity,
} from './types.js';

const SOURCE = 'musicbrainz';
const API = 'https://musicbrainz.org/ws/2';

export class MusicBrainzProvider implements EvidenceProvider {
  readonly id = SOURCE;

  constructor(private readonly http: HttpClient) {}

  async resolveEntities(refs: readonly string[], _context?: ResolveContext): Promise<ResolvedEntity[]> {
    const out: ResolvedEntity[] = [];
    for (const query of refs) {
      out.push(await this.resolveOne(query));
    }
    return out;
  }

  async getEvidence(brief: Brief): Promise<EvidencePacket> {
    const facets = facetsInIdea(brief.idea);
    const entities = await this.resolveEntities(brief.refs);
    const tagSignals: NamedSignal[] = [];
    const refs = entities.map((entity) => {
      const ranked = [...entity.labels].sort((a, b) => (entity.measurements[b] ?? 0) - (entity.measurements[a] ?? 0));
      const ref = referenceFromEntity({ ...entity, labels: ranked }, facets, brief.city);
      for (const facet of facets) {
        const matched = matchingLabel(facet, ranked);
        if (!matched || entity.status !== 'found') continue;
        const count = entity.measurements[matched];
        if (typeof count !== 'number') continue;
        tagSignals.push(namedSignal(
          `musicbrainz.tag.${entity.id}.${facet}`,
          'facet',
          `${entity.name ?? entity.query} ${facet} tag votes`,
          evidenceSignal({
            value: count,
            source: `${SOURCE}:artist.lookup`,
            status: 'found',
            detail: `MusicBrainz genre/tag vote count for “${matched}”. This is not a 0–100 taste affinity.`,
            url: entity.url ?? undefined,
          }),
        ));
      }
      return ref;
    });
    return buildPacket({
      sourceId: 'open-data',
      brief,
      facets,
      refs,
      localBase: limitedNumber(SOURCE, 'MusicBrainz has no city or district taste data.'),
      audienceBase: limitedNumber(SOURCE, 'MusicBrainz has no age-band taste data.'),
      extraSignals: tagSignals,
    });
  }

  private async resolveOne(query: string): Promise<ResolvedEntity> {
    const url = `${API}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    const response = await this.http.getJson(url, { headers: mbHeaders() });
    if (!response.ok) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:artist.search`,
        status: 'failed',
        resolution: 'http',
        detail: response.message,
        url,
      });
    }
    if (response.status !== 200) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:artist.search`,
        status: 'failed',
        resolution: 'http',
        detail: `MusicBrainz search returned HTTP ${response.status}.`,
        url,
      });
    }
    const hits = readArtists(response.body);
    const choice = chooseMusicBrainz(query, hits);
    if (choice.kind !== 'one') {
      const none = choice.kind === 'none';
      return unresolvedEntity({
        query,
        source: `${SOURCE}:artist.search`,
        status: 'ambiguous',
        resolution: none ? 'none' : 'collision',
        detail: none
          ? `MusicBrainz returned no artist for “${query}”.`
          : choice.note,
        url,
        candidates: none ? [] : choice.hits.map((hit) => ({
          id: hit.id,
          name: hit.label,
          description: hit.description,
          matchScore: hit.matchScore,
        })),
      });
    }
    const lookupUrl = `${API}/artist/${choice.hit.id}?inc=genres+tags&fmt=json`;
    const lookup = await this.http.getJson(lookupUrl, { headers: mbHeaders() });
    const original = hits.find((hit) => hit.id === choice.hit.id);
    const fromSearch = countsFromTags(original?.rawTags ?? []);
    if (!lookup.ok || lookup.status !== 200) {
      return typedEntity({
        query,
        source: `${SOURCE}:artist.search`,
        name: choice.hit.label,
        id: choice.hit.id,
        type: 'Artist',
        typeDetail: 'MusicBrainz artist search hit. The artist lookup failed, so only tags carried on the search row are listed.',
        description: choice.hit.description ?? null,
        image: null,
        url: `https://musicbrainz.org/artist/${choice.hit.id}`,
        labels: [...fromSearch.keys()],
        measurements: Object.fromEntries(fromSearch),
      });
    }
    const lookedUp = readLookupTags(lookup.body);
    const counts = lookedUp.counts.size ? lookedUp.counts : fromSearch;
    return typedEntity({
      query,
      source: `${SOURCE}:artist.lookup`,
      name: choice.hit.label,
      id: choice.hit.id,
      type: 'Artist',
      typeDetail: 'MusicBrainz artist. The search score is a name match and is not stored as an affinity.',
      description: choice.hit.description ?? null,
      image: null,
      url: `https://musicbrainz.org/artist/${choice.hit.id}`,
      labels: [...counts.keys()],
      measurements: Object.fromEntries(counts),
    });
  }
}

interface TagRow {
  name?: unknown;
  count?: unknown;
}

function mbHeaders(): Record<string, string> {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

function readArtists(body: unknown): Array<NameHit & { rawTags: TagRow[] }> {
  if (!body || typeof body !== 'object') return [];
  const artists = (body as { artists?: unknown }).artists;
  if (!Array.isArray(artists)) return [];
  const hits: Array<NameHit & { rawTags: TagRow[] }> = [];
  for (const row of artists) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; name?: unknown; score?: unknown; disambiguation?: unknown; tags?: unknown };
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue;
    hits.push({
      id: record.id,
      label: record.name,
      description: typeof record.disambiguation === 'string' ? record.disambiguation : undefined,
      matchScore: typeof record.score === 'number' ? record.score : undefined,
      rawTags: Array.isArray(record.tags) ? record.tags as TagRow[] : [],
    });
  }
  return hits;
}

function readLookupTags(body: unknown): { labels: string[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  if (!body || typeof body !== 'object') return { labels: [], counts };
  const record = body as { genres?: unknown; tags?: unknown };
  for (const row of [...asTags(record.genres), ...asTags(record.tags)]) {
    if (typeof row.name !== 'string') continue;
    const count = typeof row.count === 'number' ? row.count : 0;
    if (count <= 0) continue;
    const previous = counts.get(row.name) ?? 0;
    if (count > previous) counts.set(row.name, count);
  }
  return { labels: [...counts.keys()], counts };
}

function asTags(value: unknown): TagRow[] {
  return Array.isArray(value) ? value as TagRow[] : [];
}

function countsFromTags(rows: readonly TagRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.name !== 'string') continue;
    const count = typeof row.count === 'number' ? row.count : 0;
    if (count <= 0) continue;
    const previous = counts.get(row.name) ?? 0;
    if (count > previous) counts.set(row.name, count);
  }
  return counts;
}
