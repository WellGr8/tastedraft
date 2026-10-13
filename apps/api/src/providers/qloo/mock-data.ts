/**
 * Authored stand-in used only when the API key is unset.
 * These bodies are written for TasteDraft tests and offline insights.
 * They are not Qloo responses. Search does not use this catalog.
 * Every envelope sets `mock: true`. Ids start with `td-mock-`.
 */

export interface MockEnvelope {
  success: true;
  mock: true;
  results: Record<string, unknown>;
}

interface MockEntity {
  entity_id: string;
  name: string;
  type: 'urn:entity';
  subtype: string;
  properties: {
    description: string;
    image: { url: string };
    location?: { lat: number; lon: number; city: string };
  };
}

interface MockTag {
  id: string;
  name: string;
  type: string;
}

const ENTITIES: readonly MockEntity[] = [
  {
    entity_id: 'td-mock-entity-velvet-circuit',
    name: 'Velvet Circuit',
    type: 'urn:entity',
    subtype: 'urn:entity:brand',
    properties: {
      description: 'Authored TasteDraft mock brand. Not a Qloo entity.',
      image: { url: 'https://example.invalid/tastedraft-mock/velvet-circuit.png' },
    },
  },
  {
    entity_id: 'td-mock-entity-northwind-audio',
    name: 'Northwind Audio',
    type: 'urn:entity',
    subtype: 'urn:entity:artist',
    properties: {
      description: 'Authored TasteDraft mock artist. Not a Qloo entity.',
      image: { url: 'https://example.invalid/tastedraft-mock/northwind-audio.png' },
    },
  },
  {
    entity_id: 'td-mock-entity-glass-hours',
    name: 'Glass Hours',
    type: 'urn:entity',
    subtype: 'urn:entity:movie',
    properties: {
      description: 'Authored TasteDraft mock film. Not a Qloo entity.',
      image: { url: 'https://example.invalid/tastedraft-mock/glass-hours.png' },
    },
  },
  {
    entity_id: 'td-mock-entity-lantern-row',
    name: 'Lantern Row',
    type: 'urn:entity',
    subtype: 'urn:entity:place',
    properties: {
      description: 'Authored TasteDraft mock place in a fictional block. Not a Qloo entity.',
      image: { url: 'https://example.invalid/tastedraft-mock/lantern-row.png' },
    },
  },
];

const TAGS: readonly MockTag[] = [
  { id: 'td-mock-tag-paper-cut', name: 'paper-cut minimal', type: 'urn:tag:td-mock' },
  { id: 'td-mock-tag-night-grid', name: 'night-grid electronic', type: 'urn:tag:td-mock' },
  { id: 'tag-japanese', name: 'Japanese', type: 'urn:tag' },
  { id: 'tag-minimal', name: 'Minimal', type: 'urn:tag' },
  { id: 'tag-streetwear', name: 'Streetwear', type: 'urn:tag' },
  { id: 'tag-electronic', name: 'Electronic', type: 'urn:tag' },
  { id: 'td-mock-tag-night-market', name: 'night market snack', type: 'urn:tag:td-mock' },
];

function authoredUnit(parts: readonly string[]): number {
  let hash = 2166136261;
  const text = parts.join('|');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (hash >>> 0) % 1000;
  return Math.round((0.2 + (unit / 1000) * 0.6) * 100) / 100;
}

function takeLimit(params: URLSearchParams, fallback: number): number {
  const raw = params.get('take');
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function includesQuery(name: string, query: string | null): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

function explain(params: URLSearchParams, target: string): Array<{ input: string; weight: number; target: string }> | undefined {
  if (params.get('feature.explainability') !== 'true') return undefined;
  const listed = params.get('signal.interests.entities')?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  let input = listed[0] ?? 'td-mock-entity-northwind-audio';
  if (input === target) input = 'td-mock-entity-velvet-circuit';
  return [{ input, weight: authoredUnit(['explain', input, target]), target }];
}

function withQuery<T extends { entity_id: string } | MockTag>(
  row: T,
  params: URLSearchParams,
  target: string,
): T & { query: { affinity: number; explainability?: Array<{ input: string; weight: number; target: string }> } } {
  const contribution = explain(params, target);
  return {
    ...row,
    query: {
      affinity: authoredUnit(['affinity', target, params.get('signal.demographics.age') ?? '', params.get('filter.location.query') ?? '']),
      ...(contribution ? { explainability: contribution } : {}),
    },
  };
}

function searchBody(params: URLSearchParams): MockEnvelope {
  const query = params.get('query');
  const types = params.get('types');
  const entities = ENTITIES.filter((entity) => {
    if (!includesQuery(entity.name, query)) return false;
    if (!types) return true;
    return types.split(',').some((type) => entity.subtype === type.trim());
  }).slice(0, takeLimit(params, ENTITIES.length));
  return { success: true, mock: true, results: { entities } };
}

function tagsBody(params: URLSearchParams): MockEnvelope {
  const query = params.get('filter.query');
  const tags = TAGS.filter((tag) => includesQuery(tag.name, query)).slice(0, takeLimit(params, TAGS.length));
  return { success: true, mock: true, results: { tags } };
}

function heatmapBody(params: URLSearchParams): MockEnvelope {
  const city = params.get('filter.location.query') ?? 'authored';
  const cells = [
    { id: 'td-mock-cell-lantern-row', label: 'Lantern Row', location: { lat: 34.0912, lon: -118.2718 } },
    { id: 'td-mock-cell-kiln-yard', label: 'Kiln Yard', location: { lat: 34.1024, lon: -118.2561 } },
  ].map((cell) => ({
    ...cell,
    affinity: authoredUnit(['heatmap', cell.id, city]),
  }));
  return { success: true, mock: true, results: { heatmap: cells } };
}

function insightsBody(params: URLSearchParams): MockEnvelope {
  const filterType = params.get('filter.type');
  if (filterType === 'urn:heatmap') return heatmapBody(params);
  if (filterType === 'urn:tag') {
    const wanted = params.get('filter.results.tags');
    const tags = TAGS.filter((tag) => !wanted || wanted.split(',').includes(tag.id))
      .slice(0, takeLimit(params, TAGS.length))
      .map((tag) => withQuery(tag, params, tag.id));
    return { success: true, mock: true, results: { tags } };
  }
  const entities = ENTITIES.filter((entity) => !filterType || entity.subtype === filterType)
    .slice(0, takeLimit(params, ENTITIES.length))
    .map((entity) => withQuery(entity, params, entity.entity_id));
  return { success: true, mock: true, results: { entities } };
}

/** `path` is `/search`, `/v2/tags`, or `/v2/insights`. */
export function mockQlooBody(path: string, params: URLSearchParams): MockEnvelope {
  if (path === '/search') return searchBody(params);
  if (path === '/v2/tags') return tagsBody(params);
  if (path === '/v2/insights') return insightsBody(params);
  return { success: true, mock: true, results: { entities: [] } };
}
