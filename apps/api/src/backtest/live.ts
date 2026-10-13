/**
 * One live Qloo probe per sourced city entry.
 * The city string is sent as written. Nothing here calls the sample engine.
 */
import type { QlooClient } from '../providers/qloo/client.ts';
import {
  affinitiesFrom,
  entitiesFrom,
  heatPoints,
  inCity,
  median,
  pickEntity,
  type BacktestCase,
  type ProbeResult,
} from './cases.ts';

function statusOf(result: { ok: boolean; status?: number }): boolean {
  return result.ok && (result.status === undefined || result.status === 200);
}

export async function probeCase(client: QlooClient, row: BacktestCase): Promise<ProbeResult> {
  const search = await client.search({ query: row.query, take: 5 });
  const entity = search.ok ? pickEntity(entitiesFrom(search.body), row.query) : null;
  const base: ProbeResult = {
    brand: row.brand,
    query: row.query,
    city: row.city,
    outcome: row.outcome,
    resolvedName: entity?.name ?? null,
    resolvedType: entity?.type ?? null,
    searchOk: statusOf(search),
    placesOk: false,
    placeCount: 0,
    placeAffinity: null,
    heatmapOk: false,
    heatmapError: '',
    cellCount: 0,
    cellsInCity: 0,
    heatAffinity: null,
    demographicsOk: false,
  };
  if (!entity) return base;
  const signal = { interests: { entities: entity.id }, location: { query: row.city } };
  const places = await client.insights({
    filter: { type: 'urn:entity:place', location: { query: row.city } },
    signal,
    take: 8,
  });
  const placeAffinity = places.ok ? affinitiesFrom(places.body) : [];
  const heat = await client.insights({
    filter: { type: 'urn:heatmap', location: { query: row.city } },
    signal: { interests: { entities: entity.id } },
    take: 8,
  });
  const points = heat.ok ? heatPoints(heat.body) : [];
  const inside = points.filter((point) => inCity(point.lat, point.lng, row.box));
  const heatmapError = heat.ok ? '' : heat.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
  const demo = await client.insights({
    filter: { type: 'urn:entity:place', location: { query: row.city } },
    signal: { ...signal, demographics: { age: '25_to_29' } },
    take: 5,
  });
  return {
    ...base,
    placesOk: statusOf(places),
    placeCount: placeAffinity.length,
    placeAffinity: median(placeAffinity),
    heatmapOk: statusOf(heat),
    heatmapError,
    cellCount: points.length,
    cellsInCity: inside.length,
    heatAffinity: median(inside.map((point) => point.weight)),
    demographicsOk: statusOf(demo),
  };
}

export function formatProbe(row: ProbeResult): string {
  const affinity = row.placeAffinity == null ? '—' : row.placeAffinity.toFixed(2);
  const heat = row.heatAffinity == null ? '—' : row.heatAffinity.toFixed(2);
  const heatmap = row.heatmapOk ? `${row.cellsInCity}/${row.cellCount}` : `failed: ${row.heatmapError || 'no message'}`;
  return [
    row.brand,
    row.city,
    row.outcome,
    row.resolvedName ?? 'not found',
    row.placesOk ? String(row.placeCount) : 'failed',
    affinity,
    heatmap,
    heat,
    row.demographicsOk ? 'ok' : 'failed',
  ].join('\t');
}
