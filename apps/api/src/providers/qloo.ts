import { referenceFromEntity, typedEntity, unresolvedEntity } from './entity.js';
import { facetsInIdea, type FacetSpec } from './facets.js';
import { mapPool, USER_AGENT, type HttpClient } from './http.js';
import { buildPacket, limitedNumber, namedSignal } from './packet.js';
import { chooseByName, type NameHit } from './resolve.js';
import { evidenceSignal, type EvidenceSignal } from './signal.js';
import type {
  Brief,
  EvidencePacket,
  EvidenceProvider,
  FacetAffinity,
  NamedSignal,
  ReferenceType,
  ResolveContext,
  ResolvedEntity,
} from './types.js';

/**
 * Hackathon base URL and header, from the Qloo Agentic Hackathon developer guide.
 * Keys for this host do not work on api.qloo.com or staging.api.qloo.com.
 */
export const QLOO_BASE_URL = 'https://hackathon.api.qloo.com';
export const QLOO_API_HEADER = 'X-Api-Key';

/**
 * Paths and fields this package treats as documented.
 * Insights entity fields are the ones in the official onboarding response example
 * (`success`, `results.entities`, `entity_id`, `name`, `subtype`, `properties.*`).
 */
export const QLOO_DOCUMENTED = {
  paths: ['/search', '/v2/insights', '/v2/tags'],
  filterTypes: [
    'urn:entity:artist',
    'urn:entity:book',
    'urn:entity:brand',
    'urn:entity:destination',
    'urn:entity:movie',
    'urn:entity:person',
    'urn:entity:place',
    'urn:entity:podcast',
    'urn:entity:tv_show',
    'urn:entity:videogame',
  ],
} as const;

/**
 * Field names and parameters that were NOT in the official pages checked while
 * writing this stub (hackathon guide, onboarding response example, parameter
 * lists). research-report.md cites them from community clients or a docs pass
 * that this package did not repeat. Readers must log a real response before
 * depending on them.
 */
export const QLOO_UNVERIFIED = {
  affinityPath: 'query.affinity',
  searchResultList: 'results[] and results.entities[] are both accepted; the search envelope was not in the onboarding example',
  tagIdPath: 'results.tags[].id',
  tagQueryParameter: 'filter.query',
  tagSemanticParameter: 'feature.semantic_search',
  searchTakeParameter: 'take',
  searchNotFoundStatus: 'HTTP 404 as an empty search (community clients; the hackathon guide does not say this)',
  ageBuckets: '24_and_younger, 30_to_34, 35_to_44, 45_to_54 do not match the brief bands 18–25, 26–35, 36–45, 46+',
  notCalled: [
    'filter.type=urn:heatmap is not in the hackathon guide’s supported type list',
    'filter.type=urn:tag is not in that list either',
    'feature.explainability was not in the pages checked here',
    '/recommendations and /recs are legacy and must not be called',
  ],
} as const;

/**
 * Brief age band → one Qloo demographic bucket from research-report.md.
 * The buckets are not the same ranges, so audience signals stay `limited`.
 */
export const QLOO_AGE_BUCKETS: Readonly<Record<string, string>> = {
  '18–25': '24_and_younger',
  '26–35': '30_to_34',
  '36–45': '35_to_44',
  '46+': '45_to_54',
};

const SOURCE = 'qloo';

export interface QlooProviderOptions {
  apiKey?: string;
  http: HttpClient;
  baseUrl?: string;
}

export class QlooProvider implements EvidenceProvider {
  readonly id = SOURCE;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private readonly options: QlooProviderOptions) {
    this.apiKey = options.apiKey?.trim() ?? '';
    this.baseUrl = (options.baseUrl ?? QLOO_BASE_URL).replace(/\/$/, '');
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  async resolveEntities(refs: readonly string[], _context?: ResolveContext): Promise<ResolvedEntity[]> {
    if (!this.isEnabled()) {
      return refs.map((query) => disabledEntity(query));
    }
    return mapPool(refs, 4, (query) => this.searchOne(query));
  }

  async getEvidence(brief: Brief): Promise<EvidencePacket> {
    const facets = facetsInIdea(brief.idea);
    if (!this.isEnabled()) {
      const entities = brief.refs.map((query) => disabledEntity(query));
      return buildPacket({
        sourceId: 'none',
        brief,
        facets,
        refs: entities.map((entity) => referenceFromEntity(entity, facets, brief.city)),
        localBase: failedNumber('QLOO_API_KEY is not set.'),
        audienceBase: failedNumber('QLOO_API_KEY is not set.'),
      });
    }
    const entities = await this.resolveEntities(brief.refs, { city: brief.city });
    const tags = await this.resolveTags(facets);
    const facetRows = await mapPool(entities, 4, (entity) => this.facetRows(entity, facets, tags));
    const refs = entities.map((entity, index) => referenceFromEntity(
      entity,
      facets,
      brief.city,
      facetRows[index] ?? [],
    ));
    const ids = entities.flatMap((entity) => (entity.status === 'found' && entity.id ? [entity.id] : []));
    const localSignals = await this.localSignals(brief.city, ids);
    const audienceSignals = await this.audienceSignals(brief, tags);
    return buildPacket({
      sourceId: 'qloo',
      brief,
      facets,
      refs,
      localBase: limitedNumber(
        `${SOURCE}:/v2/insights`,
        'Place insights are recommendations, not the sample packet’s indie-district base. urn:heatmap is not called because it is not in the hackathon guide’s filter.type list. Names that came back are in local.signals.',
      ),
      audienceBase: limitedNumber(
        `${SOURCE}:/v2/insights`,
        audienceDetail(brief.age),
      ),
      localSignals,
      audienceSignals,
    });
  }

  private async searchOne(query: string): Promise<ResolvedEntity> {
    const params = new URLSearchParams({ query, take: '5' });
    const url = `${this.baseUrl}/search?${params.toString()}`;
    const response = await this.options.http.getJson(url, { headers: this.headers() });
    if (!response.ok) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'failed',
        resolution: 'http',
        detail: response.message,
        url,
      });
    }
    if (response.status === 404) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'ambiguous',
        resolution: 'none',
        detail: `Search returned HTTP 404 for “${query}”. ${QLOO_UNVERIFIED.searchNotFoundStatus}. No entity was invented.`,
        url,
      });
    }
    if (response.status !== 200) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'failed',
        resolution: 'http',
        detail: `Qloo search returned HTTP ${response.status}.`,
        url,
      });
    }
    if (successFlag(response.body) === false) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'failed',
        resolution: 'http',
        detail: 'Qloo search returned success: false.',
        url,
      });
    }
    const rows = readResultRows(response.body);
    if (!rows) {
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'ambiguous',
        resolution: 'collision',
        detail: `Search JSON did not contain ${QLOO_UNVERIFIED.searchResultList}. No entity was chosen.`,
        url,
      });
    }
    const hits = rows.flatMap((row) => {
      const hit = toNameHit(row);
      return hit ? [hit] : [];
    });
    const choice = chooseByName(query, hits);
    if (choice.kind !== 'one') {
      const none = choice.kind === 'none';
      return unresolvedEntity({
        query,
        source: `${SOURCE}:/search`,
        status: 'ambiguous',
        resolution: none ? 'none' : 'collision',
        detail: none
          ? `Qloo search returned no entity for “${query}”.`
          : choice.note,
        url,
        candidates: none ? [] : choice.hits.map((hit) => ({
          id: hit.id,
          name: hit.label,
          description: hit.description,
        })),
      });
    }
    const row = rows.find((item) => readString(item, 'entity_id') === choice.hit.id) ?? null;
    const typed = referenceTypeFromUrn(readUrn(row));
    const image = readString(row, 'properties.image.url');
    return typedEntity({
      query,
      source: `${SOURCE}:/search`,
      name: choice.hit.label,
      id: choice.hit.id,
      type: typed.type,
      typeStatus: typed.type ? 'found' : 'limited',
      typeDetail: `${typed.detail} Search field paths are unverified; entity_id and subtype match the insights example and may differ on /search.`,
      description: choice.hit.description ?? null,
      image,
      url,
      labels: readTagNames(row),
    });
  }

  private async resolveTags(facets: readonly FacetSpec['id'][]): Promise<Map<string, TagHit | null>> {
    const map = new Map<string, TagHit | null>();
    await mapPool(facets, 4, async (facet) => {
      map.set(facet, await this.searchTag(facet));
    });
    return map;
  }

  private async searchTag(facet: string): Promise<TagHit | null> {
    const params = new URLSearchParams({
      'filter.query': facet,
      'feature.semantic_search': 'true',
      take: '5',
    });
    const url = `${this.baseUrl}/v2/tags?${params.toString()}`;
    const response = await this.options.http.getJson(url, { headers: this.headers() });
    if (!response.ok || response.status !== 200 || successFlag(response.body) === false) return null;
    const tags = readTags(response.body);
    const matched = tags.find((tag) => tag.name.toLowerCase().includes(facet.toLowerCase()));
    return matched ?? null;
  }

  private async facetRows(
    entity: ResolvedEntity,
    facets: readonly FacetSpec['id'][],
    tags: Map<string, TagHit | null>,
  ): Promise<FacetAffinity[]> {
    const filterType = filterTypeFor(entity.type.value);
    if (entity.status !== 'found' || !entity.id || !filterType) {
      return facets.map((facet) => ({
        facet,
        matchedLabel: null,
        affinity: evidenceSignal({
          value: null,
          source: `${SOURCE}:/v2/insights`,
          status: entity.status === 'found' ? 'limited' : entity.status,
          detail: entity.status === 'found'
            ? 'The resolved Qloo type has no supported filter.type, so no per-facet affinity was requested.'
            : entity.type.detail,
        }),
      }));
    }
    return mapPool(facets, 4, async (facet) => {
      const tag = tags.get(facet) ?? null;
      if (!tag) {
        return {
          facet,
          matchedLabel: null,
          affinity: evidenceSignal({
            value: null,
            source: `${SOURCE}:/v2/tags`,
            status: 'ambiguous' as const,
            detail: `No tag id whose name contains “${facet}” was found. ${QLOO_UNVERIFIED.tagIdPath} is unverified, and no tag id was invented.`,
            unverifiedField: true,
          }),
        };
      }
      const affinity = await this.affinityFor(entity.id!, filterType, tag);
      return { facet, matchedLabel: tag.name, affinity };
    });
  }

  private async affinityFor(entityId: string, filterType: string, tag: TagHit): Promise<EvidenceSignal<number | null>> {
    const params = new URLSearchParams({
      'filter.type': filterType,
      'filter.results.entities': entityId,
      'signal.interests.tags': tag.id,
      take: '5',
    });
    const url = `${this.baseUrl}/v2/insights?${params.toString()}`;
    const response = await this.options.http.getJson(url, { headers: this.headers() });
    if (!response.ok) {
      return evidenceSignal({ value: null, source: `${SOURCE}:/v2/insights`, status: 'failed', detail: response.message, url });
    }
    if (response.status !== 200 || successFlag(response.body) === false) {
      return evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'failed',
        detail: `Insights returned HTTP ${response.status}${successFlag(response.body) === false ? ' and success: false' : ''}.`,
        url,
      });
    }
    const rows = readResultRows(response.body);
    if (!rows) {
      return evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'ambiguous',
        detail: 'Insights JSON had no results.entities array. No affinity was guessed.',
        url,
        unverifiedField: true,
      });
    }
    const row = rows.find((item) => (readString(item, 'entity_id') ?? '').toLowerCase() === entityId.toLowerCase());
    if (!row) {
      return evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'ambiguous',
        detail: 'Insights did not return the requested entity, so its affinity was not inferred from other rows.',
        url,
      });
    }
    const popularity = readNumber(row, 'properties.popularity');
    const raw = readNumber(row, QLOO_UNVERIFIED.affinityPath);
    if (raw == null) {
      return evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'ambiguous',
        detail: popularity == null
          ? `${QLOO_UNVERIFIED.affinityPath} is absent. No affinity was invented.`
          : `${QLOO_UNVERIFIED.affinityPath} is absent. properties.popularity (${popularity}) is a documented field and was not used as an affinity.`,
        url,
        unverifiedField: true,
      });
    }
    return scaleAffinity(raw, url);
  }

  private async localSignals(city: string, ids: readonly string[]): Promise<NamedSignal[]> {
    if (!city.trim() || ids.length === 0) {
      return [namedSignal('qloo.local', 'location', 'Local places', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'limited',
        detail: 'Local insights need a city and at least one resolved entity id.',
      }))];
    }
    const params = new URLSearchParams({
      'filter.type': 'urn:entity:place',
      'signal.interests.entities': ids.join(','),
      'filter.location.query': city,
      take: '10',
    });
    const url = `${this.baseUrl}/v2/insights?${params.toString()}`;
    const response = await this.options.http.getJson(url, { headers: this.headers() });
    if (!response.ok || response.status !== 200 || successFlag(response.body) === false) {
      return [namedSignal('qloo.local', 'location', 'Local places', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'failed',
        detail: response.ok ? `Local insights returned HTTP ${response.status}.` : response.message,
        url,
      }))];
    }
    const rows = readResultRows(response.body) ?? [];
    if (!rows.length) {
      return [namedSignal('qloo.local', 'location', 'Local places', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'limited',
        detail: 'Insights returned no places for this city. An empty list is not a local-fit score of 0.',
        url,
      }))];
    }
    return rows.slice(0, 10).flatMap((row, index) => {
      const name = readString(row, 'name');
      if (!name) return [];
      return [namedSignal(`qloo.place.${index}`, 'location', name, evidenceSignal({
        value: name,
        source: `${SOURCE}:/v2/insights`,
        status: 'found' as const,
        detail: 'Place recommendation for the brief city. Not an indie-district affinity.',
        url,
      }))];
    });
  }

  private async audienceSignals(brief: Brief, tags: Map<string, TagHit | null>): Promise<NamedSignal[]> {
    const bucket = QLOO_AGE_BUCKETS[brief.age];
    if (!bucket) {
      return [namedSignal('qloo.audience.age', 'audience', 'Age bucket', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'ambiguous',
        detail: `“${brief.age}” is not a known brief age band, so no demographic signal was sent.`,
      }))];
    }
    const tagIds = [...tags.values()].flatMap((tag) => (tag ? [tag.id] : []));
    const params = new URLSearchParams({
      'filter.type': 'urn:entity:brand',
      'signal.demographics.age': bucket,
      take: '5',
    });
    if (brief.city.trim()) params.set('filter.location.query', brief.city);
    if (tagIds.length) params.set('signal.interests.tags', tagIds.join(','));
    const url = `${this.baseUrl}/v2/insights?${params.toString()}`;
    const response = await this.options.http.getJson(url, { headers: this.headers() });
    if (!response.ok || response.status !== 200 || successFlag(response.body) === false) {
      return [namedSignal('qloo.audience', 'audience', 'Audience insights', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'failed',
        detail: response.ok ? `Audience insights returned HTTP ${response.status}.` : response.message,
        url,
      }))];
    }
    const rows = readResultRows(response.body) ?? [];
    if (!rows.length) {
      return [namedSignal('qloo.audience', 'audience', 'Audience insights', evidenceSignal({
        value: null,
        source: `${SOURCE}:/v2/insights`,
        status: 'limited',
        detail: `${audienceDetail(brief.age)} The call returned no entities.`,
        url,
      }))];
    }
    return rows.slice(0, 5).flatMap((row, index) => {
      const name = readString(row, 'name');
      if (!name) return [];
      const raw = readNumber(row, QLOO_UNVERIFIED.affinityPath);
      const scaled = raw == null ? null : scaleAffinity(raw, url);
      return [namedSignal(`qloo.audience.${index}`, 'audience', name, evidenceSignal({
        value: scaled && scaled.status === 'found' ? scaled.value : name,
        source: `${SOURCE}:/v2/insights`,
        status: 'limited',
        detail: `${audienceDetail(brief.age)} This row is a recommendation (${name}), not an audience-fit score for the brief.`,
        url,
        unverifiedField: raw != null,
      }))];
    });
  }

  private headers(): Record<string, string> {
    return {
      [QLOO_API_HEADER]: this.apiKey,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
  }
}

function disabledEntity(query: string): ResolvedEntity {
  return unresolvedEntity({
    query,
    source: SOURCE,
    status: 'failed',
    resolution: 'http',
    detail: 'QLOO_API_KEY is not set.',
  });
}

function failedNumber(detail: string): EvidenceSignal<number | null> {
  return evidenceSignal({ value: null, source: SOURCE, status: 'failed', detail });
}

function audienceDetail(age: string): string {
  const bucket = QLOO_AGE_BUCKETS[age];
  if (!bucket) return `No Qloo age bucket was sent for “${age}”.`;
  return `signal.demographics.age=${bucket} was sent for brief age “${age}”. ${QLOO_UNVERIFIED.ageBuckets}.`;
}

interface TagHit {
  id: string;
  name: string;
}

function scaleAffinity(raw: number, url: string): EvidenceSignal<number | null> {
  if (raw >= 0 && raw <= 1) {
    return evidenceSignal({
      value: Math.round(raw * 100),
      source: `${SOURCE}:/v2/insights`,
      status: 'found',
      detail: `${QLOO_UNVERIFIED.affinityPath} was ${raw} and was scaled from 0–1 to 0–100. That path is unverified.`,
      url,
      unverifiedField: true,
    });
  }
  if (raw > 1 && raw <= 100) {
    return evidenceSignal({
      value: Math.round(raw),
      source: `${SOURCE}:/v2/insights`,
      status: 'found',
      detail: `${QLOO_UNVERIFIED.affinityPath} was ${raw}, already above 1, and was rounded. Official examples do not document this field or its scale.`,
      url,
      unverifiedField: true,
    });
  }
  return evidenceSignal({
    value: null,
    source: `${SOURCE}:/v2/insights`,
    status: 'ambiguous',
    detail: `${QLOO_UNVERIFIED.affinityPath} was ${raw}, which is outside 0–1 and 0–100. It was not clamped into a score.`,
    url,
    unverifiedField: true,
  });
}

function referenceTypeFromUrn(urn: string | null): { type: ReferenceType | null; detail: string } {
  if (!urn) return { type: null, detail: 'No subtype was present.' };
  if (urn.includes(':artist')) return { type: 'Artist', detail: urn };
  if (urn.includes(':brand')) return { type: 'Brand', detail: urn };
  if (urn.includes(':movie')) return { type: 'Film', detail: urn };
  if (urn.includes(':place') || urn.includes(':destination')) return { type: 'Place', detail: urn };
  return { type: null, detail: `${urn} is not mapped to Brand, Artist, Film, or Place.` };
}

function filterTypeFor(type: ReferenceType | null): string | null {
  if (type === 'Artist') return 'urn:entity:artist';
  if (type === 'Brand') return 'urn:entity:brand';
  if (type === 'Film') return 'urn:entity:movie';
  if (type === 'Place') return 'urn:entity:place';
  return null;
}

function successFlag(body: unknown): boolean | null {
  if (!body || typeof body !== 'object' || !('success' in body)) return null;
  const success = (body as { success?: unknown }).success;
  return typeof success === 'boolean' ? success : null;
}

function readResultRows(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null;
  const results = (body as { results?: unknown }).results;
  if (Array.isArray(results)) return results;
  if (results && typeof results === 'object') {
    const entities = (results as { entities?: unknown }).entities;
    if (Array.isArray(entities)) return entities;
  }
  return null;
}

function readTags(body: unknown): TagHit[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as { results?: unknown }).results;
  const lists: unknown[] = [];
  if (results && typeof results === 'object') {
    const record = results as { tags?: unknown; entities?: unknown };
    if (Array.isArray(record.tags)) lists.push(...record.tags);
    if (Array.isArray(record.entities)) lists.push(...record.entities);
  }
  const tags: TagHit[] = [];
  for (const row of lists) {
    const id = readString(row, 'id') ?? readString(row, 'entity_id') ?? readString(row, 'tag_id');
    const name = readString(row, 'name');
    if (id && name) tags.push({ id, name });
  }
  return tags;
}

function toNameHit(row: unknown): NameHit | null {
  const id = readString(row, 'entity_id') ?? readString(row, 'id');
  const label = readString(row, 'name');
  if (!id || !label) return null;
  const description = readString(row, 'properties.description') ?? readString(row, 'disambiguation') ?? undefined;
  return { id, label, description };
}

function readUrn(row: unknown): string | null {
  return readString(row, 'subtype') ?? readString(row, 'type') ?? readString(row, 'types.0');
}

function readTagNames(row: unknown): string[] {
  const tags = readPath(row, 'properties.tags');
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    const name = readString(tag, 'name');
    return name ? [name] : [];
  });
}

function readString(value: unknown, path: string): string | null {
  const found = readPath(value, path);
  return typeof found === 'string' && found.trim() ? found : null;
}

function readNumber(value: unknown, path: string): number | null {
  const found = readPath(value, path);
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (part === '0' && Array.isArray(current)) {
      current = current[0];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
