import type { FeatureName } from '@tastedraft/contracts';
import type {
  ActivationPlanRequest,
  ActivationPlanResult,
  CompetitorBenchmarkRequest,
  CompetitorBenchmarkResult,
  DemographicFitRequest,
  DemographicFitResult,
  ExplainabilityContribution,
  FeatureEntity,
  FeaturePersona,
  ImpactRequest,
  ImpactResult,
  NeighborhoodFitRequest,
  NeighborhoodFitResult,
  NicheFinderRequest,
  NicheFinderResult,
  PersonaChatRequest,
  PersonaChatResult,
  ReinterviewRequest,
  ReinterviewResult,
} from '@tastedraft/contracts';
import {
  ActivationPlanResultSchema,
  CompetitorBenchmarkResultSchema,
  DemographicFitResultSchema,
  ESTIMATE_LABEL,
  IMPACT_DISCLAIMER,
  ImpactResultSchema,
  NeighborhoodFitResultSchema,
  NicheFinderResultSchema,
  PersonaChatResultSchema,
  ReinterviewResultSchema,
} from '@tastedraft/contracts';
import {
  demographicAgeBucket,
  demographicGender,
  demographicMismatch,
  estimateAvoidedCost,
  personaMindChange,
} from '../engine/features.ts';
import { scoreInsightMeasurements } from '../engine/wasm-adapter.ts';
import type { QlooInsightsParams } from '../providers/qloo/client.ts';
import { createLlmClient, type LlmClient } from '../llm/client.ts';
import type { FeatureRun } from './caller.ts';
import { callInsights, callSearch, metaOf } from './caller.ts';
import { entityTypeUrn } from './params.ts';
import { parseDemographics, parseEntities, parseHeatmap, searchHits, type ParsedEntity } from './parse.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isQlooId(id: string): boolean {
  return UUID.test(id) || id.startsWith('urn:');
}

function dollars(level: 1 | 2 | 3 | 4): string {
  return '$'.repeat(level);
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const south = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(south)));
}

async function resolveOne(run: FeatureRun, entity: FeatureEntity, feature: FeatureName): Promise<FeatureEntity | null> {
  if (isQlooId(entity.id)) return entity;
  const type = entity.type ? entityTypeUrn(entity.type) : undefined;
  const found = await callSearch(run, feature, 'Resolve entity', entity.name, {
    query: entity.name,
    ...(type ? { types: type } : {}),
    take: 1,
  });
  if (!found?.ok) return null;
  const hit = searchHits(found.body)[0];
  if (!hit) {
    run.warnings.push(`No Qloo entity for "${entity.name}".`);
    return null;
  }
  return { id: hit.id, name: hit.name, ...(hit.type ? { type: hit.type } : {}) };
}

function personaSignal(persona: FeaturePersona, warnings: string[]): NonNullable<QlooInsightsParams['signal']> {
  const age = persona.age ? demographicAgeBucket(persona.age) : null;
  const gender = demographicGender(persona.gender);
  if (persona.age && !age) warnings.push(`Age "${persona.age}" is not a Qloo bucket, so it was not sent.`);
  if (persona.gender && !gender) warnings.push(`Gender "${persona.gender}" is not male or female, so it was not sent.`);
  const anchors = (persona.anchors ?? []).map((anchor) => anchor.id).filter(isQlooId);
  const signal: NonNullable<QlooInsightsParams['signal']> = { location: { query: persona.location } };
  if (age || gender) {
    signal.demographics = {
      ...(age ? { age } : {}),
      ...(gender ? { gender } : {}),
    };
  }
  if (anchors.length) signal.interests = { entities: anchors.join(',') };
  return signal;
}

function groupByType(entities: readonly FeatureEntity[]): Map<string, FeatureEntity[]> {
  const groups = new Map<string, FeatureEntity[]>();
  for (const entity of entities) {
    const type = entityTypeUrn(entity.type);
    const list = groups.get(type) ?? [];
    list.push(entity);
    groups.set(type, list);
  }
  return groups;
}

export async function demographicFit(run: FeatureRun, request: DemographicFitRequest): Promise<DemographicFitResult> {
  const bucket = demographicAgeBucket(request.audience.age);
  const gender = demographicGender(request.audience.gender);
  if (!bucket) run.warnings.push(`Age "${request.audience.age}" is not a known bucket. Mismatch treats the target age as unmeasured.`);
  if (request.audience.gender && !gender) run.warnings.push(`Gender "${request.audience.gender}" was not sent.`);
  const references = [];
  for (const reference of request.references) {
    const resolved = await resolveOne(run, reference, 'demographic-fit');
    if (!resolved) {
      references.push({
        id: reference.id,
        name: reference.name,
        type: entityTypeUrn(reference.type),
        skew: [],
        peak: null,
        targetBucket: bucket,
        targetValue: null,
        mismatch: 100,
        evidence: [{ id: reference.id, detail: `No demographic skew was measured for ${reference.name}.` }],
      });
      continue;
    }
    const result = await callInsights(run, 'demographic-fit', 'Demographic skew', resolved.name, {
      filter: { type: 'urn:demographics' },
      signal: {
        interests: { entities: resolved.id },
        location: { query: request.audience.location },
      },
      take: 1,
    });
    const skew = result?.ok ? parseDemographics(result.body) : [];
    const scored = demographicMismatch(skew, bucket, gender);
    const evidence = [
      {
        id: resolved.id,
        detail: scored.peak
          ? `${resolved.name} peaks at ${scored.peak.bucket} (${scored.peak.value.toFixed(2)}). Target ${bucket ?? 'unmapped'} is ${scored.targetValue == null ? 'unmeasured' : scored.targetValue.toFixed(2)}.`
          : `${resolved.name} returned no age skew.`,
      },
      ...skew.map((row) => ({
        id: `${resolved.id}:${row.dimension}:${row.bucket}`,
        detail: `${row.dimension} ${row.bucket} skew ${row.value.toFixed(2)}.`,
      })),
    ];
    references.push({
      id: resolved.id,
      name: resolved.name,
      type: resolved.type ?? entityTypeUrn(reference.type),
      skew,
      peak: scored.peak,
      targetBucket: bucket,
      targetValue: scored.targetValue,
      mismatch: scored.mismatch,
      evidence,
    });
  }
  const measured = references.map((row) => row.mismatch);
  const mismatch = measured.length ? Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length) : null;
  return DemographicFitResultSchema.parse({
    ...metaOf(run),
    audience: {
      age: request.audience.age,
      ageBucket: bucket,
      gender,
      location: request.audience.location,
    },
    references,
    mismatch,
  });
}

export async function competitorBenchmark(run: FeatureRun, request: CompetitorBenchmarkRequest): Promise<CompetitorBenchmarkResult> {
  const competitors = [];
  for (const competitor of request.competitors) {
    const resolved = await resolveOne(run, competitor, 'competitors');
    if (resolved) competitors.push(resolved);
    else run.warnings.push(`Competitor "${competitor.name}" was not resolved.`);
  }
  const personas = [];
  for (const persona of request.personas) {
    const scored = [];
    for (const [type, group] of groupByType(competitors)) {
      const ids = group.map((item) => item.id).filter(isQlooId);
      if (!ids.length) continue;
      const withAnchors = personaSignal(persona, run.warnings);
      let result = await callInsights(run, 'competitors', 'Score competitors', persona.label, {
        filter: { type, results: { entities: ids.join(',') } },
        signal: withAnchors,
        feature: { explainability: true },
        take: ids.length,
      });
      let rows = result?.ok ? parseEntities(result.body, type) : [];
      if (!rows.length && withAnchors?.interests) {
        const retrySignal: QlooInsightsParams['signal'] = {
          location: withAnchors.location,
          ...(withAnchors.demographics ? { demographics: withAnchors.demographics } : {}),
        };
        result = await callInsights(run, 'competitors', 'Score competitors without anchors', persona.label, {
          filter: { type, results: { entities: ids.join(',') } },
          signal: retrySignal,
          feature: { explainability: true },
          take: ids.length,
        });
        rows = result?.ok ? parseEntities(result.body, type) : [];
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const competitor of group) {
        const row = byId.get(competitor.id);
        scored.push({
          id: competitor.id,
          name: row?.name ?? competitor.name,
          type,
          affinity: row?.affinity ?? null,
          explainability: row?.explainability ?? [],
        });
        if (!row) run.warnings.push(`${persona.label} received no affinity for ${competitor.name}.`);
      }
    }
    personas.push({ id: persona.id, label: persona.label, competitors: scored });
  }
  return CompetitorBenchmarkResultSchema.parse({ ...metaOf(run), personas });
}

function tasteSignal(request: NeighborhoodFitRequest, warnings: string[]): NonNullable<QlooInsightsParams['signal']> {
  const age = request.age ? demographicAgeBucket(request.age) : null;
  const gender = demographicGender(request.gender);
  if (request.age && !age) warnings.push(`Age "${request.age}" is not a Qloo bucket, so it was not sent.`);
  if (request.gender && !gender) warnings.push(`Gender "${request.gender}" was not sent.`);
  const entities = (request.anchors ?? []).map((anchor) => anchor.id).filter(isQlooId);
  const tags = (request.tags ?? []).filter((tag) => tag.startsWith('urn:tag:') || isQlooId(tag));
  const signal: NonNullable<QlooInsightsParams['signal']> = { location: { query: request.location } };
  if (age || gender) signal.demographics = { ...(age ? { age } : {}), ...(gender ? { gender } : {}) };
  if (entities.length || tags.length) {
    signal.interests = {
      ...(entities.length ? { entities: entities.join(',') } : {}),
      ...(tags.length ? { tags: tags.join(',') } : {}),
    };
  }
  return signal;
}

export async function neighborhoodFit(run: FeatureRun, request: NeighborhoodFitRequest): Promise<NeighborhoodFitResult> {
  const signal = tasteSignal(request, run.warnings);
  const heat = await callInsights(run, 'neighborhood', 'Heatmap', request.location, {
    filter: { type: 'urn:heatmap', location: { query: request.location } },
    signal,
    extra: { 'heatmap.dimensions': 'price_level,popularity' },
  });
  const cells = heat?.ok ? parseHeatmap(heat.body) : [];
  const placesResult = await callInsights(run, 'neighborhood', 'Places', request.location, {
    filter: { type: 'urn:entity:place', location: { query: request.location } },
    signal,
    extra: { sort_by: 'quality' },
    take: 20,
  });
  const places = placesResult?.ok ? parseEntities(placesResult.body, 'urn:entity:place') : [];
  const groups = new Map<string, typeof cells>();
  for (const cell of cells) {
    const key = cell.geohash.slice(0, 5) || `${cell.lat.toFixed(2)},${cell.lng.toFixed(2)}`;
    const list = groups.get(key) ?? [];
    list.push(cell);
    groups.set(key, list);
  }
  const clusters = [...groups.entries()].map(([id, members]) => {
    const affinity = members.reduce((sum, cell) => sum + cell.affinity, 0) / members.length;
    const popularityValues = members.map((cell) => cell.popularityAffinity).filter((value): value is number => value != null);
    const priceValues = members.map((cell) => cell.priceLevelAffinity).filter((value): value is number => value != null);
    const popularityAffinity = popularityValues.length ? popularityValues.reduce((sum, value) => sum + value, 0) / popularityValues.length : null;
    const priceLevelAffinity = priceValues.length ? priceValues.reduce((sum, value) => sum + value, 0) / priceValues.length : null;
    const lat = members.reduce((sum, cell) => sum + cell.lat, 0) / members.length;
    const lng = members.reduce((sum, cell) => sum + cell.lng, 0) / members.length;
    const score = 0.6 * affinity + 0.25 * (popularityAffinity ?? affinity) + 0.15 * (priceLevelAffinity ?? affinity);
    return { id, lat, lng, affinity, popularityAffinity, priceLevelAffinity, score };
  });
  clusters.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const areas = clusters.slice(0, 5).map((cluster) => {
    const nearby = places.filter((place) => place.lat != null && place.lng != null && km(cluster, { lat: place.lat, lng: place.lng }) <= 4);
    const labels = nearby.map((place) => place.neighborhood).filter((label): label is string => Boolean(label));
    const label = mode(labels) ?? `Area ${cluster.lat.toFixed(2)}, ${cluster.lng.toFixed(2)}`;
    const priced = nearby.filter((place) => place.priceLevel != null).sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
    const priceLevel = priced[0]?.priceLevel ?? null;
    const priceRecommendation = priceLevel
      ? `Recommend price level ${priceLevel} (${dollars(priceLevel)}).`
      : cluster.priceLevelAffinity != null
        ? `No priced place in this area. Heatmap price affinity is ${cluster.priceLevelAffinity.toFixed(2)}, which is not a price tier.`
        : 'No price recommendation. This area had no priced places.';
    return {
      id: cluster.id,
      label,
      lat: Math.round(cluster.lat * 1e6) / 1e6,
      lng: Math.round(cluster.lng * 1e6) / 1e6,
      affinity: round4(cluster.affinity),
      popularityAffinity: cluster.popularityAffinity == null ? null : round4(cluster.popularityAffinity),
      priceLevelAffinity: cluster.priceLevelAffinity == null ? null : round4(cluster.priceLevelAffinity),
      priceLevel,
      priceRecommendation,
      evidenceRefs: nearby.map((place) => place.id).slice(0, 8),
    };
  });
  const levels = areas.map((area) => area.priceLevel).filter((level): level is 1 | 2 | 3 | 4 => level != null);
  const chosen = mode(levels.map(String));
  const priceRecommendation = chosen
    ? `Recommend price level ${chosen} (${dollars(Number(chosen) as 1 | 2 | 3 | 4)}) across the top areas.`
    : areas[0]?.priceRecommendation ?? 'No heatmap cells came back, so there is no price recommendation.';
  return NeighborhoodFitResultSchema.parse({
    ...metaOf(run),
    location: request.location,
    cellCount: cells.length,
    areas,
    priceRecommendation,
  });
}

export async function nicheFinder(run: FeatureRun, request: NicheFinderRequest): Promise<NicheFinderResult> {
  const type = entityTypeUrn(request.type);
  const popularityMax = request.popularityMax ?? 0.4;
  const trends = request.trends ?? 'high';
  const anchors = [];
  for (const anchor of request.anchors ?? []) {
    const resolved = await resolveOne(run, anchor, 'niche');
    if (resolved) anchors.push(resolved);
  }
  if (!anchors.length && request.query) {
    const found = await callSearch(run, 'niche', 'Resolve taste', request.query, { query: request.query, types: type, take: 1 });
    const hit = found?.ok ? searchHits(found.body)[0] : undefined;
    if (hit) anchors.push({ id: hit.id, name: hit.name, type: hit.type });
    else run.warnings.push(`No entity matched "${request.query}".`);
  }
  const entities = anchors.map((anchor) => anchor.id).filter(isQlooId);
  const tags = (request.tags ?? []).filter((tag) => tag.startsWith('urn:tag:') || isQlooId(tag));
  const signal: NonNullable<QlooInsightsParams['signal']> = {};
  if (entities.length || tags.length) {
    signal.interests = {
      ...(entities.length ? { entities: entities.join(',') } : {}),
      ...(tags.length ? { tags: tags.join(',') } : {}),
    };
  }
  if (request.location) signal.location = { query: request.location };
  let result: Awaited<ReturnType<typeof callInsights>> = null;
  if (!Object.keys(signal).length) {
    run.warnings.push('Niche finder had no resolved signal, so Qloo was not called.');
  } else {
    const params = {
      filter: { type, popularity: { max: popularityMax } },
      signal,
      take: request.take ?? 8,
    };
    result = await callInsights(run, 'niche', 'Niche references', type, {
      ...params,
      extra: { 'bias.trends': trends },
    });
    if (result && !result.ok && !/budget exhausted/i.test(result.message)) {
      run.warnings.push(`${type} does not accept bias.trends, so the retry omitted it.`);
      result = await callInsights(run, 'niche', 'Niche references without trends', type, params);
    }
  }
  const rows = result?.ok ? parseEntities(result.body, type) : [];
  const kept = rows.filter((row) => row.popularity == null || row.popularity <= popularityMax + 0.001);
  if (kept.length !== rows.length) run.warnings.push('Dropped results above popularity.max.');
  const references = kept.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    affinity: row.affinity,
    popularity: row.popularity,
    audienceGrowth: row.audienceGrowth,
    kind: row.audienceGrowth != null && row.audienceGrowth > 0.05 ? 'rising' as const : 'under-the-radar' as const,
  }));
  return NicheFinderResultSchema.parse({
    ...metaOf(run),
    type,
    popularityMax,
    trends,
    references,
  });
}

export async function activationPlan(run: FeatureRun, request: ActivationPlanRequest): Promise<ActivationPlanResult> {
  const personas = [];
  for (const persona of request.personas) {
    const located = { ...persona, location: persona.location || request.location };
    const signal = personaSignal(located, run.warnings);
    const placeFilter: NonNullable<QlooInsightsParams['filter']> = {
      type: 'urn:entity:place',
      location: { query: request.location },
    };
    if (request.priceLevel) placeFilter.price_level = { max: request.priceLevel };
    const places = await activationCall(run, 'Places', { filter: placeFilter, signal, extra: { sort_by: 'quality' }, take: 4 }, 'urn:entity:place');
    const podcasts = await activationCall(run, 'Podcasts', { filter: { type: 'urn:entity:podcast' }, signal, take: 4 }, 'urn:entity:podcast');
    const partners = await activationCall(run, 'Partner brands', { filter: { type: 'urn:entity:brand' }, signal, take: 4 }, 'urn:entity:brand');
    personas.push({ id: persona.id, label: persona.label, places, podcasts, partners });
  }
  return ActivationPlanResultSchema.parse({ ...metaOf(run), location: request.location, personas });
}

async function activationCall(
  run: FeatureRun,
  label: string,
  params: QlooInsightsParams,
  type: string,
): Promise<ActivationPlanResult['personas'][number]['places']> {
  const result = await callInsights(run, 'activation', label, label, params);
  const rows = result?.ok ? parseEntities(result.body, type) : [];
  return rows.slice(0, 4).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    affinity: row.affinity,
    priceLevel: row.priceLevel,
  }));
}

export async function businessImpact(run: FeatureRun, request: ImpactRequest): Promise<ImpactResult> {
  const assumptions = {
    pilotCost: request.pilotCost ?? null,
    focusGroupCost: request.focusGroupCost ?? null,
    sampleSize: request.sampleSize,
    roundsAvoided: request.roundsAvoided,
  };
  const estimated = estimateAvoidedCost(assumptions);
  run.emit({ type: 'step', feature: 'impact', label: 'Estimate avoided cost', detail: estimated.formula });
  return ImpactResultSchema.parse({
    ...metaOf(run),
    label: ESTIMATE_LABEL,
    disclaimer: IMPACT_DISCLAIMER,
    currency: request.currency ?? 'USD',
    assumptions,
    perRound: estimated.perRound,
    costAvoided: estimated.costAvoided,
    formula: estimated.formula,
  });
}

async function affinitiesFor(
  run: FeatureRun,
  persona: FeaturePersona,
  references: readonly FeatureEntity[],
  label: string,
): Promise<Map<string, ParsedEntity>> {
  const found = new Map<string, ParsedEntity>();
  const signal = personaSignal({ ...persona, anchors: (persona.anchors ?? []).filter((anchor) => !references.some((reference) => reference.id === anchor.id)) }, run.warnings);
  for (const [type, group] of groupByType(references)) {
    const ids = group.map((item) => item.id).filter(isQlooId);
    if (!ids.length) continue;
    const result = await callInsights(run, 'reinterview', label, persona.label, {
      filter: { type, results: { entities: ids.join(',') } },
      signal,
      feature: { explainability: true },
      take: ids.length,
    });
    for (const row of result?.ok ? parseEntities(result.body, type) : []) found.set(row.id, row);
  }
  return found;
}

function versionScore(rows: Array<{ id: string; affinity: number | null; explainability: ExplainabilityContribution[] }>, source: string) {
  const measured = rows.map((row) => ({
    affinity: row.affinity,
    contributions: row.explainability,
    evidenceRefs: [row.id],
  }));
  const dimension = { source, groups: [{ label: 'references', rows: measured }] };
  const empty = { source, groups: [] };
  const scored = scoreInsightMeasurements({
    anchor: dimension,
    cross: empty,
    local: empty,
    audience: dimension,
    activeRefCount: rows.filter((row) => row.affinity != null).length,
  });
  return {
    score: scored.subscores.anchor,
    total: scored.ledger.total,
    ledger: scored.ledger,
  };
}

function knownType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  try {
    return entityTypeUrn(type);
  } catch {
    return undefined;
  }
}

async function resolveReinterviewEntity(run: FeatureRun, entity: FeatureEntity): Promise<FeatureEntity | null> {
  if (isQlooId(entity.id)) {
    const type = knownType(entity.type);
    return type ? { ...entity, type } : { id: entity.id, name: entity.name };
  }
  const type = knownType(entity.type);
  const probe: FeatureEntity = type ? { ...entity, type } : { id: entity.id, name: entity.name };
  const resolved = await resolveOne(run, probe, 'reinterview');
  if (!resolved || !isQlooId(resolved.id)) return null;
  const resolvedType = knownType(resolved.type);
  return { id: resolved.id, name: resolved.name || entity.name, ...(resolvedType ? { type: resolvedType } : {}) };
}

async function resolveReinterviewList(
  run: FeatureRun,
  entities: readonly FeatureEntity[],
  cache: Map<string, FeatureEntity | null>,
): Promise<FeatureEntity[]> {
  const resolved: FeatureEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.id}|${entity.name}`.toLowerCase();
    if (!cache.has(key)) cache.set(key, await resolveReinterviewEntity(run, entity));
    const hit = cache.get(key);
    if (hit) resolved.push(hit);
  }
  return resolved;
}

export async function reinterview(run: FeatureRun, request: ReinterviewRequest): Promise<ReinterviewResult> {
  const cache = new Map<string, FeatureEntity | null>();
  const beforeRefs = await resolveReinterviewList(run, request.before.references, cache);
  const afterRefs = await resolveReinterviewList(run, request.after.references, cache);
  const personas = [];
  for (const persona of request.personas) {
    const anchors: FeatureEntity[] = [];
    for (const anchor of persona.anchors ?? []) {
      if (run.caller.calls + 4 >= run.budget) break;
      const key = `${anchor.id}|${anchor.name}`.toLowerCase();
      if (!cache.has(key)) cache.set(key, await resolveReinterviewEntity(run, anchor));
      const hit = cache.get(key);
      if (hit) anchors.push(hit);
    }
    const scoredPersona = { ...persona, anchors };
    const beforeRows = await affinitiesFor(run, scoredPersona, beforeRefs, 'Score V1');
    const afterRows = await affinitiesFor(run, scoredPersona, afterRefs, 'Score V2');
    const beforeList = beforeRefs.map((reference) => ({
      id: reference.id,
      affinity: beforeRows.get(reference.id)?.affinity ?? null,
      explainability: beforeRows.get(reference.id)?.explainability ?? [],
    }));
    const afterList = afterRefs.map((reference) => ({
      id: reference.id,
      affinity: afterRows.get(reference.id)?.affinity ?? null,
      explainability: afterRows.get(reference.id)?.explainability ?? [],
    }));
    const before = versionScore(beforeList, run.caller.mode === 'live' ? 'qloo:/v2/insights' : 'mock:/v2/insights');
    const after = versionScore(afterList, run.caller.mode === 'live' ? 'qloo:/v2/insights' : 'mock:/v2/insights');
    const names = new Map<string, string>();
    for (const reference of [...beforeRefs, ...afterRefs]) names.set(reference.id, reference.name);
    const ids = [...names.keys()];
    const moves = ids.map((id) => ({
      id,
      name: names.get(id) ?? id,
      before: beforeRows.get(id)?.affinity ?? null,
      after: afterRows.get(id)?.affinity ?? null,
    }));
    const mind = personaMindChange(before.score, after.score, moves);
    personas.push({
      id: persona.id,
      label: persona.label,
      before,
      after,
      delta: mind.delta,
      changedMind: mind.changedMind,
      reason: mind.reason,
    });
  }
  return ReinterviewResultSchema.parse({ ...metaOf(run), personas });
}

function templateChat(request: PersonaChatRequest): { message: string; citations: PersonaChatResult['citations'] } {
  const anchors = [...request.persona.anchors].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, 3);
  const cited = anchors.map((anchor) => {
    const affinity = anchor.affinity == null ? '' : `, affinity ${anchor.affinity.toFixed(2)}`;
    return `${anchor.name} (${anchor.id}${affinity})`;
  });
  const message = [
    'Simulated persona response.',
    `I'm ${request.persona.label} in ${request.persona.location}.`,
    `You asked: ${request.message.trim()}`,
    cited.length
      ? `I would answer from the Qloo anchors I actually have: ${cited.join('; ')}.`
      : 'I have no Qloo anchors, so I cannot ground an answer.',
    'Those anchors are the only evidence for this reply.',
  ].join(' ');
  return {
    message,
    citations: anchors.map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      affinity: anchor.affinity ?? null,
    })),
  };
}

export async function personaChat(run: FeatureRun, request: PersonaChatRequest, llm: LlmClient = createLlmClient()): Promise<PersonaChatResult> {
  run.emit({ type: 'step', feature: 'persona-chat', label: 'Ground the reply', detail: request.persona.label });
  let source: 'llm' | 'template' = 'template';
  let drafted = templateChat(request);
  if (llm.mode === 'live') {
    try {
      const raw = await llm.complete([
        {
          role: 'system',
          content: 'You speak as a simulated persona. Return JSON {"message":"...","citationIds":["..."]}. The message must start with "Simulated persona response." Cite only the provided Qloo anchor ids. Do not invent entities, scores, or forecasts.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            persona: {
              label: request.persona.label,
              location: request.persona.location,
              age: request.persona.age ?? null,
              gender: request.persona.gender ?? null,
            },
            anchors: request.persona.anchors.map((anchor) => ({
              id: anchor.id,
              name: anchor.name,
              affinity: anchor.affinity ?? null,
            })),
            history: request.history ?? [],
            message: request.message,
          }),
        },
      ]);
      const parsed = JSON.parse(raw) as { message?: unknown; citationIds?: unknown };
      const text = typeof parsed.message === 'string' ? parsed.message.trim() : '';
      const ids = Array.isArray(parsed.citationIds) ? parsed.citationIds.filter((id): id is string => typeof id === 'string') : [];
      const known = new Map(request.persona.anchors.map((anchor) => [anchor.id, anchor]));
      const citations = ids.filter((id) => known.has(id)).map((id) => {
        const anchor = known.get(id)!;
        return { id, name: anchor.name, affinity: anchor.affinity ?? null };
      });
      if (text && citations.length) {
        source = 'llm';
        drafted = {
          message: text.startsWith('Simulated persona response') ? text : `Simulated persona response. ${text}`,
          citations,
        };
      }
    } catch {
      run.warnings.push('The language model was unavailable. The reply is the template fallback.');
    }
  }
  for (const part of drafted.message.split(/(\s+)/)) {
    if (part) run.emit({ type: 'token', feature: 'persona-chat', text: part });
  }
  for (const citation of drafted.citations) {
    run.emit({ type: 'citation', feature: 'persona-chat', id: citation.id, name: citation.name });
  }
  return PersonaChatResultSchema.parse({
    ...metaOf(run),
    label: 'Simulated persona response',
    source,
    message: drafted.message,
    citations: drafted.citations,
  });
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function mode(values: string[]): string | undefined {
  if (!values.length) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
