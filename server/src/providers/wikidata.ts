import { referenceFromEntity, typedEntity, unresolvedEntity, withCity } from './entity.js';
import { facetsInIdea } from './facets.js';
import { USER_AGENT, type HttpClient } from './http.js';
import { buildPacket, limitedNumber } from './packet.js';
import { chooseByName, type NameHit } from './resolve.js';
import { evidenceSignal } from './signal.js';
import type {
  Brief,
  EvidencePacket,
  EvidenceProvider,
  ReferenceType,
  ResolveContext,
  ResolvedEntity,
} from './types.js';

const API = 'https://www.wikidata.org/w/api.php';
const SOURCE = 'wikidata';

const LABEL_PROPS = ['P31', 'P106', 'P136', 'P135', 'P17', 'P27', 'P495', 'P364', 'P915', 'P131', 'P101', 'P452'] as const;

const FILM = /\bfilm\b/i;
const PLACE = /\b(neighborhood|neighbourhood|city|town|village|district|borough|municipality|settlement)\b/i;
const BRAND = /\b(brand|fashion house|trademark|business|company|enterprise|retail)\b/i;
const GROUP = /\b(musical group|musical ensemble|band)\b/i;
const ARTIST_JOB = /\b(musician|composer|singer|disc jockey|\bdj\b|rapper|guitarist|record producer|music producer|dj producer)\b/i;

interface WdEntity {
  id?: string;
  labels?: { en?: { value?: string } };
  descriptions?: { en?: { value?: string } };
  claims?: Record<string, WdClaim[] | undefined>;
}

interface WdClaim {
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: unknown };
  };
}

export interface WikidataProviderOptions {
  http: HttpClient;
  language?: string;
}

export class WikidataProvider implements EvidenceProvider {
  readonly id = SOURCE;
  private readonly language: string;

  constructor(private readonly options: WikidataProviderOptions) {
    this.language = options.language ?? 'en';
  }

  async resolveEntities(refs: readonly string[], context?: ResolveContext): Promise<ResolvedEntity[]> {
    const searched = await Promise.all(refs.map((query) => this.search(query, context?.city)));
    const ids = searched.flatMap((row) => (row.chosenId ? [row.chosenId] : []));
    const entities = await this.fetchEntities(ids);
    const labelIds = new Set<string>();
    for (const entity of entities.values()) {
      for (const id of claimItemIds(entity, LABEL_PROPS)) labelIds.add(id);
    }
    const labels = await this.fetchLabels([...labelIds]);
    return searched.map((row) => {
      if (!row.chosenId) return row.entity;
      const record = entities.get(row.chosenId);
      if (!record) {
        return unresolvedEntity({
          query: row.query,
          source: `${SOURCE}:wbgetentities`,
          status: 'failed',
          resolution: 'http',
          detail: `Wikidata search returned ${row.chosenId}, but the entity payload did not include it.`,
          id: row.chosenId,
          name: row.chosenName,
        });
      }
      return this.toResolved(row.query, record, labels, row.note);
    });
  }

  async getEvidence(brief: Brief): Promise<EvidencePacket> {
    const facets = facetsInIdea(brief.idea);
    const entities = await this.resolveEntities(brief.refs, { city: brief.city });
    const refs = entities.map((entity) => {
      const ref = referenceFromEntity(entity, facets, brief.city);
      const city = (brief.city ?? '').trim().toLowerCase();
      const located = entity.status === 'found'
        ? entity.locatedIn.find((label) => label.toLowerCase() === city)
        : undefined;
      const placeLabel = located ?? null;
      if (!placeLabel) return ref;
      return withCity(
        ref,
        evidenceSignal({
          value: placeLabel,
          source: `${SOURCE}:P131`,
          status: 'found',
          detail: `located in administrative territorial entity: ${placeLabel}.`,
          url: entity.url ?? undefined,
        }),
        evidenceSignal({
          value: true,
          source: `${SOURCE}:P131`,
          status: 'found',
          detail: `The located-in label matches the brief city “${brief.city}”.`,
          url: entity.url ?? undefined,
        }),
      );
    });
    return buildPacket({
      sourceId: 'open-data',
      brief,
      facets,
      refs,
      localBase: limitedNumber(
        SOURCE,
        'Wikidata can place a reference in a city. It does not publish an indie-district affinity.',
      ),
      audienceBase: limitedNumber(SOURCE, 'Wikidata has no age-band taste data.'),
      localSignals: refs
        .filter((ref) => ref.inBriefCity.value === true)
        .map((ref) => ({
          id: `wikidata.place.${ref.name}`,
          domain: 'location',
          name: `${ref.name} is in ${brief.city}`,
          value: true,
          source: `${SOURCE}:P131`,
          status: 'found' as const,
          detail: ref.inBriefCity.detail,
          url: ref.entity.url ?? undefined,
        })),
    });
  }

  private async search(query: string, city?: string): Promise<{
    query: string;
    chosenId: string | null;
    chosenName: string | null;
    note?: string;
    entity: ResolvedEntity;
  }> {
    const url = searchUrl(query, this.language);
    const response = await this.options.http.getJson(url, { headers: wdHeaders() });
    if (!response.ok) {
      return {
        query,
        chosenId: null,
        chosenName: null,
        entity: unresolvedEntity({
          query,
          source: `${SOURCE}:wbsearchentities`,
          status: 'failed',
          resolution: 'http',
          detail: response.message,
          url,
        }),
      };
    }
    if (response.status !== 200) {
      return {
        query,
        chosenId: null,
        chosenName: null,
        entity: unresolvedEntity({
          query,
          source: `${SOURCE}:wbsearchentities`,
          status: 'failed',
          resolution: 'http',
          detail: `Wikidata search returned HTTP ${response.status}.`,
          url,
        }),
      };
    }
    const hits = readSearchHits(response.body);
    const choice = chooseByName(query, hits, city);
    if (choice.kind === 'one') {
      return {
        query,
        chosenId: choice.hit.id,
        chosenName: choice.hit.label,
        note: choice.note,
        entity: unresolvedEntity({ query, source: SOURCE, status: 'ambiguous', resolution: 'none', detail: 'pending' }),
      };
    }
    const none = choice.kind === 'none';
    return {
      query,
      chosenId: null,
      chosenName: null,
      entity: unresolvedEntity({
        query,
        source: `${SOURCE}:wbsearchentities`,
        status: 'ambiguous',
        resolution: none ? 'none' : 'collision',
        detail: none
          ? `Wikidata returned no entity for “${query}”. No profile was invented.`
          : choice.note,
        url,
        candidates: none ? [] : choice.hits.map((hit) => ({
          id: hit.id,
          name: hit.label,
          description: hit.description,
        })),
      }),
    };
  }

  private toResolved(
    query: string,
    record: WdEntity,
    labels: Map<string, string>,
    note?: string,
  ): ResolvedEntity {
    const id = record.id ?? '';
    const name = record.labels?.en?.value ?? query;
    const description = record.descriptions?.en?.value ?? null;
    const url = id ? `https://www.wikidata.org/wiki/${id}` : null;
    const instanceLabels = labelsFor(record, 'P31', labels);
    const jobLabels = labelsFor(record, 'P106', labels);
    const classified = classify(instanceLabels, jobLabels);
    const locatedIn = labelsFor(record, 'P131', labels);
    const facetLabels = LABEL_PROPS
      .filter((prop) => prop !== 'P31' && prop !== 'P106')
      .flatMap((prop) => labelsFor(record, prop, labels));
    const imageName = claimStrings(record, 'P18')[0] ?? null;
    const image = imageName
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName)}`
      : null;
    return typedEntity({
      query,
      source: `${SOURCE}:${classified.via}`,
      name,
      id,
      type: classified.type,
      typeStatus: classified.type ? 'found' : 'limited',
      typeDetail: classified.detail,
      description,
      image,
      url,
      labels: unique(facetLabels),
      locatedIn,
      note,
    });
  }

  private async fetchEntities(ids: readonly string[]): Promise<Map<string, WdEntity>> {
    const map = new Map<string, WdEntity>();
    if (!ids.length) return map;
    for (const chunk of chunks(unique(ids), 40)) {
      const url = entityUrl(chunk, this.language, 'labels|descriptions|claims');
      const response = await this.options.http.getJson(url, { headers: wdHeaders() });
      if (!response.ok || response.status !== 200) continue;
      for (const [id, entity] of readEntities(response.body)) map.set(id, entity);
    }
    return map;
  }

  private async fetchLabels(ids: readonly string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    for (const chunk of chunks(unique(ids), 40)) {
      const url = entityUrl(chunk, this.language, 'labels');
      const response = await this.options.http.getJson(url, { headers: wdHeaders() });
      if (!response.ok || response.status !== 200) continue;
      for (const [id, entity] of readEntities(response.body)) {
        const label = entity.labels?.en?.value;
        if (label) map.set(id, label);
      }
    }
    return map;
  }
}

function wdHeaders(): Record<string, string> {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

function searchUrl(query: string, language: string): string {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language,
    format: 'json',
    limit: '5',
    type: 'item',
  });
  return `${API}?${params.toString()}`;
}

function entityUrl(ids: readonly string[], language: string, props: string): string {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props,
    languages: language,
    format: 'json',
  });
  return `${API}?${params.toString()}`;
}

function readSearchHits(body: unknown): NameHit[] {
  if (!body || typeof body !== 'object') return [];
  const search = (body as { search?: unknown }).search;
  if (!Array.isArray(search)) return [];
  const hits: NameHit[] = [];
  for (const row of search) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; label?: unknown; description?: unknown };
    if (typeof record.id !== 'string' || typeof record.label !== 'string') continue;
    hits.push({
      id: record.id,
      label: record.label,
      description: typeof record.description === 'string' ? record.description : undefined,
    });
  }
  return hits;
}

function readEntities(body: unknown): Array<[string, WdEntity]> {
  if (!body || typeof body !== 'object') return [];
  const entities = (body as { entities?: unknown }).entities;
  if (!entities || typeof entities !== 'object') return [];
  return Object.entries(entities as Record<string, WdEntity>);
}

function claimItemIds(entity: WdEntity, props: readonly string[]): string[] {
  const ids: string[] = [];
  for (const prop of props) {
    for (const claim of entity.claims?.[prop] ?? []) {
      const value = claim.mainsnak?.datavalue?.value;
      if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') ids.push(value.id);
    }
  }
  return ids;
}

function labelsFor(entity: WdEntity, prop: string, labels: Map<string, string>): string[] {
  return claimItemIds(entity, [prop]).flatMap((id) => {
    const label = labels.get(id);
    return label ? [label] : [];
  });
}

function claimStrings(entity: WdEntity, prop: string): string[] {
  const out: string[] = [];
  for (const claim of entity.claims?.[prop] ?? []) {
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value === 'string') out.push(value);
  }
  return out;
}

function classify(instanceLabels: readonly string[], jobLabels: readonly string[]): {
  type: ReferenceType | null;
  via: string;
  detail: string;
} {
  if (instanceLabels.some((label) => FILM.test(label))) {
    return { type: 'Film', via: 'P31', detail: `instance of ${instanceLabels.join(', ')}.` };
  }
  if (instanceLabels.some((label) => PLACE.test(label))) {
    return { type: 'Place', via: 'P31', detail: `instance of ${instanceLabels.join(', ')}.` };
  }
  if (instanceLabels.some((label) => GROUP.test(label))) {
    return { type: 'Artist', via: 'P31', detail: `instance of ${instanceLabels.join(', ')}.` };
  }
  const human = instanceLabels.some((label) => /^human$/i.test(label));
  if (human) {
    const job = jobLabels.find((label) => ARTIST_JOB.test(label));
    if (job) return { type: 'Artist', via: 'P106', detail: `occupation ${jobLabels.join(', ')}.` };
    return {
      type: null,
      via: 'P106',
      detail: jobLabels.length
        ? `Human whose occupations (${jobLabels.join(', ')}) are not a mapped music role.`
        : 'Human with no occupation statements.',
    };
  }
  if (instanceLabels.some((label) => BRAND.test(label))) {
    return { type: 'Brand', via: 'P31', detail: `instance of ${instanceLabels.join(', ')}.` };
  }
  if (!instanceLabels.length) {
    return { type: null, via: 'P31', detail: 'Entity has no instance-of labels.' };
  }
  return {
    type: null,
    via: 'P31',
    detail: `instance of ${instanceLabels.join(', ')}, which is outside Brand, Artist, Film, and Place.`,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
