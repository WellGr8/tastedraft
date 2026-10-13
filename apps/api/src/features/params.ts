/**
 * Qloo ignores unknown parameters instead of returning an error.
 * Every insights call from the feature routes is checked against this allowlist
 * before it is sent. `urn:entity:video_game` is rewritten to `urn:entity:videogame`.
 * Age or gender without a location is rejected here. The host returns HTTP 400 for that pair.
 */
import { badRequest } from '../errors.ts';
import { appendQlooParams, type QlooInsightsParams, type QlooSearchParams } from '../providers/qloo/client.ts';

export const BIAS_TRENDS = new Set(['off', 'very_low', 'low', 'mid', 'medium', 'high', 'very_high']);

const INSIGHT_PARAMS = new Set([
  'filter.type',
  'filter.location.query',
  'filter.results.entities',
  'filter.popularity.min',
  'filter.popularity.max',
  'filter.price_level.min',
  'filter.price_level.max',
  'filter.tags',
  'signal.interests.entities',
  'signal.interests.tags',
  'signal.demographics.age',
  'signal.demographics.gender',
  'signal.demographics.audiences',
  'signal.location.query',
  'feature.explainability',
  'heatmap.dimensions',
  'bias.trends',
  'sort_by',
  'take',
  'page',
  'offset',
]);

const SEARCH_PARAMS = new Set(['query', 'types', 'take', 'page']);

const ENTITY_TYPES: Record<string, string> = {
  actor: 'urn:entity:actor',
  album: 'urn:entity:album',
  artist: 'urn:entity:artist',
  author: 'urn:entity:author',
  book: 'urn:entity:book',
  brand: 'urn:entity:brand',
  destination: 'urn:entity:destination',
  director: 'urn:entity:director',
  locality: 'urn:entity:locality',
  movie: 'urn:entity:movie',
  film: 'urn:entity:movie',
  person: 'urn:entity:person',
  place: 'urn:entity:place',
  restaurant: 'urn:entity:place',
  podcast: 'urn:entity:podcast',
  tv_show: 'urn:entity:tv_show',
  'tv show': 'urn:entity:tv_show',
  videogame: 'urn:entity:videogame',
  video_game: 'urn:entity:videogame',
  'urn:entity:video_game': 'urn:entity:videogame',
};

const KNOWN_URNS = new Set(Object.values(ENTITY_TYPES));

export function entityTypeUrn(type: string | undefined, fallback = 'urn:entity:brand'): string {
  if (!type || !type.trim()) return fallback;
  const raw = type.trim();
  const mapped = ENTITY_TYPES[raw] ?? ENTITY_TYPES[raw.toLowerCase()];
  if (mapped) return mapped;
  if (raw.startsWith('urn:entity:') && KNOWN_URNS.has(raw)) return raw;
  throw badRequest(`Unsupported entity type "${raw}". Videogame requests must use urn:entity:videogame.`);
}

export function dottedParams(params: QlooInsightsParams): Record<string, string> {
  const { extra, ...rest } = params;
  const search = new URLSearchParams();
  appendQlooParams(search, { ...(extra ?? {}), ...rest });
  const out: Record<string, string> = {};
  for (const [key, value] of search.entries()) out[key] = value;
  return out;
}

export function assertInsightParams(params: QlooInsightsParams): Record<string, string> {
  const flat = dottedParams(params);
  for (const key of Object.keys(flat)) {
    if (!INSIGHT_PARAMS.has(key)) {
      throw badRequest(`Unsupported Qloo parameter "${key}". It would be ignored by the host, so it is not sent.`);
    }
  }
  if (flat['filter.type'] === 'urn:entity:video_game') {
    throw badRequest('filter.type urn:entity:video_game is rejected by Qloo. Use urn:entity:videogame.');
  }
  if (flat['output.heatmap.boundary']) {
    throw badRequest('output.heatmap.boundary is not sent. A locality boundary returns HTTP 500.');
  }
  const age = flat['signal.demographics.age'];
  const gender = flat['signal.demographics.gender'];
  const location = flat['signal.location.query'] || flat['filter.location.query'];
  if ((age || gender) && !location) {
    throw badRequest('signal.demographics.age and signal.demographics.gender require a location. Qloo returns HTTP 400 without one.');
  }
  if (age && !/^(24_and_younger|25_to_29|30_to_34|35_and_younger|35_to_44|36_to_55|45_to_54|55_and_older)$/.test(age)) {
    throw badRequest(`Unsupported demographic age "${age}".`);
  }
  if (gender && gender !== 'male' && gender !== 'female') {
    throw badRequest(`Unsupported demographic gender "${gender}".`);
  }
  if (flat['bias.trends'] && !BIAS_TRENDS.has(flat['bias.trends'])) {
    throw badRequest('bias.trends must be one of off, very_low, low, mid, medium, high, very_high.');
  }
  if (flat['heatmap.dimensions']) {
    const parts = flat['heatmap.dimensions'].split(',').filter(Boolean);
    if (parts.some((part) => part !== 'price_level' && part !== 'popularity')) {
      throw badRequest('heatmap.dimensions only accepts price_level and popularity.');
    }
  }
  if (flat['sort_by'] && flat['sort_by'] !== 'quality') {
    throw badRequest('sort_by only accepts quality.');
  }
  return flat;
}

export function assertSearchParams(params: QlooSearchParams): void {
  const flat = dottedParams(params as QlooInsightsParams);
  for (const key of Object.keys(flat)) {
    if (!SEARCH_PARAMS.has(key)) throw badRequest(`Unsupported Qloo search parameter "${key}".`);
  }
  if (flat.types) entityTypeUrn(flat.types);
}
