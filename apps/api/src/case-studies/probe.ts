/**
 * One live pass of a pre-launch brief through the insight ledger.
 * Prints and returns derived numbers only. Response bodies stay in memory.
 */
import type { InsightScoreInput, MeasuredGroup } from '../engine/insights-score.ts';
import { scoreInsightMeasurements } from '../engine/wasm-adapter.ts';
import { affinitiesFrom, entitiesFrom, heatPoints, inCity, median, pickEntity, type NamedEntity } from '../backtest/cases.ts';
import { parseDemographics, parseEntities } from '../features/parse.ts';
import type { QlooInsightsParams, QlooResult, QlooSearchParams } from '../providers/qloo/client.ts';
import {
  launchVerdict,
  verdictMatched,
  type LaunchCase,
  type PublicOutcome,
} from './cases.ts';

/** The two calls a launch probe makes. A test can pass a stand-in. */
export interface LaunchProbeClient {
  search(params: QlooSearchParams): Promise<QlooResult>;
  insights(params: QlooInsightsParams): Promise<QlooResult>;
}

export interface CrossReading {
  type: string;
  count: number;
  medianAffinity: number | null;
}

export interface LaunchStudy {
  id: string;
  title: string;
  market: string;
  launch: string;
  outcome: PublicOutcome;
  outcomeSummary: string;
  prelaunch: string;
  sources: string[];
  subject: { query: string; resolvedName: string | null; resolvedType: string | null };
  inputs: { ageBucket: string; priceLevel: 1 | 2 | 3 | 4; city: string };
  engine: {
    total: number | null;
    anchor: number | null;
    cross: number | null;
    local: number | null;
    audience: number | null;
    friction: number | null;
    evidenceStrength: string;
    gaps: string[];
    verdict: 'encourage' | 'caution';
  };
  derived: {
    anchorAffinity: number | null;
    placeCount: number;
    placeAffinityMedian: number | null;
    heatmapCells: number;
    heatmapInCity: number;
    heatmapMedian: number | null;
    audienceSkew: number | null;
    cross: CrossReading[];
    qlooCalls: number;
    failures: string[];
  };
  matched: boolean;
}

function round2(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}

function failureLabel(ok: boolean, status: number | undefined, timedOut: boolean): string | null {
  if (ok) return null;
  if (timedOut) return 'timeout';
  return String(status ?? 'network');
}

function rowsOf(body: unknown, id?: string): number[] {
  const rows = parseEntities(body, 'urn:entity');
  const picked = id ? rows.filter((row) => row.id === id && row.affinity != null) : rows.filter((row) => row.affinity != null);
  return picked.map((row) => row.affinity as number);
}

function dimension(values: readonly number[], source: string, label?: string): InsightScoreInput['anchor'] {
  if (!values.length) return { source, groups: [] };
  return {
    source,
    groups: [{
      ...(label ? { label } : {}),
      rows: values.map((affinity) => ({ affinity, contributions: [], evidenceRefs: [] })),
    }],
  };
}

export async function probeLaunch(client: LaunchProbeClient, row: LaunchCase): Promise<LaunchStudy> {
  const failures: string[] = [];
  let calls = 0;
  const note = (name: string, result: { ok: boolean; status?: number; timedOut?: boolean }) => {
    calls += 1;
    const label = failureLabel(result.ok, result.status, Boolean(result.timedOut));
    if (label) failures.push(`${name}:${label}`);
  };

  const searchTypes = { artist: 'urn:entity:artist', brand: 'urn:entity:brand' } as const;
  const search = await client.search({ query: row.query, types: searchTypes[row.searchType], take: 5 });
  note('search', search);
  const found: NamedEntity | null = search.ok ? pickTyped(search.body, row.query, row.searchType) : null;
  const empty = emptyStudy(row, calls, failures, found);
  if (!found) return empty;

  const signal = {
    interests: { entities: found.id },
    location: { query: row.city },
    demographics: { age: row.ageBucket },
  };
  const anchor = await client.insights({
    filter: { type: row.anchorType, results: { entities: found.id } },
    signal,
    feature: { explainability: true },
    take: 5,
  });
  note('anchor', anchor);
  const anchorValues = anchor.ok ? rowsOf(anchor.body, found.id) : [];

  const places = await client.insights({
    filter: {
      type: 'urn:entity:place',
      location: { query: row.city },
      price_level: { max: row.priceLevel },
    },
    signal,
    take: 8,
  });
  note('places', places);
  const placeValues = places.ok ? (rowsOf(places.body).length ? rowsOf(places.body) : affinitiesFrom(places.body)) : [];

  const heat = await client.insights({
    filter: { type: 'urn:heatmap', location: { query: row.city } },
    signal: { interests: { entities: found.id } },
    take: 8,
  });
  note('heatmap', heat);
  const points = heat.ok ? heatPoints(heat.body) : [];
  const inside = points.filter((point) => inCity(point.lat, point.lng, row.box));

  const cross: CrossReading[] = [];
  const crossGroups: MeasuredGroup[] = [];
  for (const type of row.crossTypes) {
    const result = await client.insights({
      filter: { type },
      signal,
      take: 5,
    });
    note(type, result);
    const values = result.ok ? rowsOf(result.body) : [];
    cross.push({ type, count: values.length, medianAffinity: median(values) });
    if (values.length) {
      crossGroups.push({
        label: type.replace('urn:entity:', ''),
        rows: values.map((affinity) => ({ affinity, contributions: [], evidenceRefs: [] })),
      });
    }
  }

  const demo = await client.insights({
    filter: { type: 'urn:demographics' },
    signal: { interests: { entities: found.id }, location: { query: row.city } },
    take: 5,
  });
  note('demographics', demo);
  const skews = demo.ok ? parseDemographics(demo.body) : [];
  const bucket = skews.find((item) => item.dimension === 'age' && item.bucket === row.ageBucket);
  const audienceAffinity = bucket && bucket.value > 0 ? bucket.value : bucket ? 0 : null;

  const source = 'qloo:/v2/insights';
  const scored = scoreInsightMeasurements({
    anchor: dimension(anchorValues, source),
    cross: { source, groups: crossGroups },
    local: dimension(placeValues, source),
    audience: audienceAffinity == null ? { source, groups: [] } : dimension([audienceAffinity], source),
    activeRefCount: 1,
  });
  const subs = scored.subscores;
  const verdict = launchVerdict(scored.ledger.total, subs.local);
  return {
    ...empty,
    subject: { query: row.query, resolvedName: found.name, resolvedType: found.type },
    engine: {
      total: scored.ledger.total,
      anchor: subs.anchor,
      cross: subs.cross,
      local: subs.local,
      audience: subs.audience,
      friction: subs.friction,
      evidenceStrength: scored.evidenceStrength,
      gaps: [...scored.gaps],
      verdict,
    },
    derived: {
      anchorAffinity: round2(anchorValues[0] ?? null),
      placeCount: placeValues.length,
      placeAffinityMedian: median(placeValues),
      heatmapCells: points.length,
      heatmapInCity: inside.length,
      heatmapMedian: median(inside.map((point) => point.weight)),
      audienceSkew: bucket ? bucket.value : null,
      cross,
      qlooCalls: calls,
      failures,
    },
    matched: verdictMatched(verdict, row.outcome),
  };
}

function pickTyped(body: unknown, query: string, type: string): NamedEntity | null {
  const rows = entitiesFrom(body).filter((entity) => entity.type.includes(type));
  return pickEntity(rows.length ? rows : entitiesFrom(body), query);
}

function emptyStudy(row: LaunchCase, calls: number, failures: string[], found: NamedEntity | null): LaunchStudy {
  return {
    id: row.id,
    title: row.title,
    market: row.city,
    launch: row.launch,
    outcome: row.outcome,
    outcomeSummary: row.outcomeSummary,
    prelaunch: row.prelaunch,
    sources: [...row.sources],
    subject: { query: row.query, resolvedName: found?.name ?? null, resolvedType: found?.type ?? null },
    inputs: { ageBucket: row.ageBucket, priceLevel: row.priceLevel, city: row.city },
    engine: {
      total: null,
      anchor: null,
      cross: null,
      local: null,
      audience: null,
      friction: null,
      evidenceStrength: 'LIMITED',
      gaps: ['anchor', 'cross', 'local', 'audience', 'friction'],
      verdict: 'caution',
    },
    derived: {
      anchorAffinity: null,
      placeCount: 0,
      placeAffinityMedian: null,
      heatmapCells: 0,
      heatmapInCity: 0,
      heatmapMedian: null,
      audienceSkew: null,
      cross: [],
      qlooCalls: calls,
      failures,
    },
    matched: verdictMatched('caution', row.outcome),
  };
}

const BANNED = /hack_|X-Api-Key|"results"|"entity_id"|"explainability"|"image"/;

export function assertDerivedFixture(text: string): void {
  if (BANNED.test(text)) throw new Error('Case-study fixture contains a raw Qloo field or a secret');
}
