/**
 * One live pass of a pre-launch brief through city-rank-2.
 * Prints and returns derived numbers only. Response bodies stay in the cache.
 */
import { heatPoints, inCity, pickEntity, type NamedEntity } from '../backtest/cases.ts';
import { parseDemographics, parseEntities, parseHeatmap } from '../features/parse.ts';
import type { QlooInsightsParams, QlooResult, QlooSearchParams } from '../providers/qloo/client.ts';
import {
  RANK_RULE,
  leadingAudience,
  panelConfidence,
  rankOptions,
  realCityHit,
  type PanelConfidence,
  type RankOptionInput,
} from '../engine/rank-options.ts';
import { citiesFor, polarityOf, type LaunchCase, type LaunchDomain, type PublicOutcome } from './cases.ts';

/** The calls a launch probe makes. A test can pass a stand-in. */
export interface LaunchProbeClient {
  search(params: QlooSearchParams): Promise<QlooResult>;
  insights(params: QlooInsightsParams): Promise<QlooResult>;
}

export interface CityRankRow {
  city: string;
  score: number | null;
  rank: number | null;
  local: number | null;
  heatmap: number | null;
  popularity: number | null;
}

export interface LaunchStudy {
  id: string;
  title: string;
  domain: LaunchDomain;
  domainLabel: string;
  market: string;
  launch: string;
  outcome: PublicOutcome;
  outcomeSummary: string;
  prelaunch: string;
  sources: string[];
  /** False when the subject or the real city never received a score. */
  scored: boolean;
  subject: { query: string; resolvedName: string | null; resolvedType: string | null };
  audience: { age: string | null; gender: string | null; location: string | null };
  confidence: PanelConfidence | null;
  referenceCount: number;
  /** Names only. Entity ids stay out of the fixture. */
  references: string[];
  realRank: number | null;
  realScore: number | null;
  cities: CityRankRow[];
  derived: { qlooCalls: number; failures: string[] };
  matched: boolean | null;
}

const SEARCH_TYPES = {
  artist: 'urn:entity:artist',
  brand: 'urn:entity:brand',
  movie: 'urn:entity:movie',
  tv_show: 'urn:entity:tv_show',
  videogame: 'urn:entity:videogame',
} as const;

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  const raw = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(raw * 100) / 100;
}

function failureLabel(ok: boolean, status: number | undefined, timedOut: boolean): string | null {
  if (ok) return null;
  if (timedOut) return 'timeout';
  return String(status ?? 'network');
}

export async function probeLaunch(client: LaunchProbeClient, row: LaunchCase): Promise<LaunchStudy> {
  const failures: string[] = [];
  let calls = 0;
  const note = (name: string, result: { ok: boolean; status?: number; timedOut?: boolean }) => {
    calls += 1;
    const label = failureLabel(result.ok, result.status, Boolean(result.timedOut));
    if (label) failures.push(`${name}:${label}`);
  };

  const search = await client.search({ query: row.query, types: SEARCH_TYPES[row.searchType], take: 5 });
  note('search', search);
  const found: NamedEntity | null = search.ok ? pickTyped(search.body, row.query, row.searchType) : null;
  const options = citiesFor(row.region);
  const shell = emptyStudy(row, calls, failures, found, options.map((option) => option.city));
  if (!found) return shell;

  const related = await callInsights(client, 'related', {
    filter: { type: row.anchorType },
    signal: { interests: { entities: found.id } },
    take: 8,
    extra: { 'bias.trends': RANK_RULE.trends },
  }, note);
  const neighbors = related.ok ? closestNeighbors(related.body, found.id) : [];
  const references = [{ id: found.id, name: found.name }, ...neighbors].slice(0, 1 + RANK_RULE.maxRelated);
  const confidence = panelConfidence(references.length);
  const interestIds = references.map((item) => item.id).join(',');

  const audienceCity = options[0]?.city ?? row.city;
  const demo = await callInsights(client, 'demographics', {
    filter: { type: 'urn:demographics' },
    signal: { interests: { entities: found.id }, location: { query: audienceCity } },
    take: 5,
  }, note);
  const audience = leadingAudience(demo.ok ? parseDemographics(demo.body).map((item) => ({
    dimension: item.dimension,
    bucket: item.bucket,
    value: item.value,
  })) : []);
  const demographics = {
    ...(audience.age ? { age: audience.age } : {}),
    ...(audience.gender ? { gender: audience.gender } : {}),
  };

  const measurements: RankOptionInput[] = [];
  const readings: Array<{ local: number | null; heatmap: number | null; popularity: number | null }> = [];
  for (const option of options) {
    const signal = {
      interests: { entities: interestIds },
      ...(Object.keys(demographics).length ? { demographics } : {}),
    };
    const places = await callInsights(client, `places:${option.city}`, {
      filter: {
        type: 'urn:entity:place',
        location: { query: option.city },
        price_level: { max: row.priceLevel },
      },
      signal,
      take: 8,
      extra: { 'bias.trends': RANK_RULE.trends },
    }, note);
    const placeRows = places.ok ? parseEntities(places.body, 'urn:entity:place').filter((item) => item.affinity != null) : [];
    const local = mean(placeRows.map((item) => item.affinity as number));
    const placePopularity = mean(placeRows.map((item) => item.popularity).filter((value): value is number => value != null));

    const heat = await callInsights(client, `heatmap:${option.city}`, {
      filter: { type: 'urn:heatmap', location: { query: option.city } },
      signal: { interests: { entities: interestIds } },
      take: 8,
      extra: { 'bias.trends': RANK_RULE.trends },
    }, note);
    const cells = heat.ok ? heatCells(heat.body).filter((cell) => inCity(cell.lat, cell.lng, option.box)) : [];
    const heatmap = mean(cells.map((cell) => cell.weight));
    const heatPopularity = mean(cells.map((cell) => cell.popularity).filter((value): value is number => value != null));
    readings.push({
      local,
      heatmap,
      popularity: heatPopularity ?? placePopularity,
    });
    measurements.push({
      id: option.city,
      label: option.city,
      local,
      heatmap,
      popularity: heatPopularity ?? placePopularity,
    });
  }

  const ranked = rankOptions(measurements);
  const cities: CityRankRow[] = ranked.map((item) => {
    const reading = readings[options.findIndex((option) => option.city === item.id)] ?? { local: null, heatmap: null, popularity: null };
    return {
      city: item.label,
      score: item.score,
      rank: item.rank,
      local: reading.local,
      heatmap: reading.heatmap,
      popularity: reading.popularity,
    };
  });
  const real = cities.find((item) => item.city === row.city) ?? null;
  const matched = realCityHit(real?.rank ?? null, options.length, polarityOf(row.outcome));
  return {
    ...shell,
    scored: matched != null,
    subject: { query: row.query, resolvedName: found.name, resolvedType: found.type },
    audience: { age: audience.age, gender: audience.gender, location: audienceCity },
    confidence,
    referenceCount: references.length,
    references: references.map((item) => item.name),
    realRank: real?.rank ?? null,
    realScore: real?.score ?? null,
    cities,
    derived: { qlooCalls: calls, failures },
    matched,
  };
}

async function callInsights(
  client: LaunchProbeClient,
  name: string,
  params: QlooInsightsParams,
  note: (name: string, result: { ok: boolean; status?: number; timedOut?: boolean }) => void,
): Promise<QlooResult> {
  const first = await client.insights(params);
  note(name, first);
  if (first.ok || first.status !== 400 || !params.extra?.['bias.trends']) return first;
  const extra = { ...params.extra };
  delete extra['bias.trends'];
  const retry = await client.insights({ ...params, extra });
  note(`${name}-retry`, retry);
  return retry;
}

function closestNeighbors(body: unknown, primaryId: string): Array<{ id: string; name: string }> {
  const rows = parseEntities(body, 'urn:entity')
    .filter((row) => row.id !== primaryId && row.affinity != null && row.name !== row.id);
  rows.sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0) || a.name.localeCompare(b.name));
  return rows.slice(0, RANK_RULE.maxRelated).map((row) => ({ id: row.id, name: row.name }));
}

function heatCells(body: unknown): Array<{ lat: number; lng: number; weight: number; popularity: number | null }> {
  const parsed = parseHeatmap(body);
  if (parsed.length) {
    return parsed.map((cell) => ({ lat: cell.lat, lng: cell.lng, weight: cell.affinity, popularity: cell.popularityAffinity }));
  }
  return heatPoints(body).map((cell) => ({ lat: cell.lat, lng: cell.lng, weight: cell.weight, popularity: null }));
}

function pickTyped(body: unknown, query: string, type: string): NamedEntity | null {
  const rows = entitiesFromSearch(body).filter((entity) => entity.type.includes(type));
  return pickEntity(rows.length ? rows : entitiesFromSearch(body), query);
}

function entitiesFromSearch(body: unknown): NamedEntity[] {
  return parseEntities(body, 'urn:entity').map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

function emptyStudy(row: LaunchCase, calls: number, failures: string[], found: NamedEntity | null, cities: string[]): LaunchStudy {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    domainLabel: row.domainLabel,
    market: row.city,
    launch: row.launch,
    outcome: row.outcome,
    outcomeSummary: row.outcomeSummary,
    prelaunch: row.prelaunch,
    sources: [...row.sources],
    scored: false,
    subject: { query: row.query, resolvedName: found?.name ?? null, resolvedType: found?.type ?? null },
    audience: { age: null, gender: null, location: null },
    confidence: null,
    referenceCount: 0,
    references: [],
    realRank: null,
    realScore: null,
    cities: cities.map((city) => ({ city, score: null, rank: null, local: null, heatmap: null, popularity: null })),
    derived: { qlooCalls: calls, failures },
    matched: null,
  };
}

const BANNED = /hack_|X-Api-Key|"results"|"entity_id"|"explainability"|"image"/;

export function assertDerivedFixture(text: string): void {
  if (BANNED.test(text)) throw new Error('Case-study fixture contains a raw Qloo field or a secret');
}
