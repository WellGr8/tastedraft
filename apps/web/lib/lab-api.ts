import {
  ActivationPlanResultSchema,
  CompetitorBenchmarkResultSchema,
  DemographicFitResultSchema,
  FeatureSseEventSchema,
  ImpactResultSchema,
  NeighborhoodFitResultSchema,
  NicheFinderResultSchema,
  PersonaChatResultSchema,
  ReinterviewResultSchema,
  type BriefV2,
  type FeatureEntity,
  type FeatureSseEvent,
  type ImpactRequest,
  type PersonaChatRequest,
  type ReinterviewRequest,
} from '@tastedraft/contracts';

/**
 * Client for POST /api/features/* and the matching /stream routes.
 * Numbers on the screen come from a parsed response. A miss stays empty.
 */

export interface LabSkew {
  name: string;
  bucket: string;
  skew: number;
}

export interface LabCompetitor {
  persona: string;
  name: string;
  affinity: number | null;
}

export interface LabNeighborhood {
  label: string;
  weight: number;
  price: number | null;
  popularity: number | null;
  lat?: number;
  lng?: number;
  tier?: number | null;
}

export interface LabNiche {
  id: string;
  name: string;
  type: string;
  image?: string | null;
  affinity: number | null;
}

export interface LabActivation {
  places: string[];
  podcasts: string[];
  brands: string[];
}

export interface LabExplain {
  name: string;
  before: number | null;
  after: number | null;
}

export interface LabReinterview {
  id: string;
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  changedMind: boolean;
  reason: string;
}

export interface LabFeatures {
  source: 'api' | 'stub';
  demographicLine: string;
  skews: LabSkew[];
  competitors: LabCompetitor[];
  neighborhoods: LabNeighborhood[];
  niches: LabNiche[];
  activation: LabActivation;
  explain: LabExplain[];
  warnings: string[];
  mismatch: number | null;
  priceLine: string | null;
  reinterview: LabReinterview[];
}

export function stubLabFeatures(input: { city: string; age: string }): LabFeatures {
  return {
    source: 'stub',
    demographicLine: `Target is ${input.age} in ${input.city}. Demographic skew loads from Qloo.`,
    skews: [],
    competitors: [],
    neighborhoods: [],
    niches: [],
    activation: { places: [], podcasts: [], brands: [] },
    explain: [],
    warnings: [],
    mismatch: null,
    priceLine: null,
    reinterview: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const next = value > 1 && value <= 100 ? value / 100 : value;
  if (next < 0 || next > 1) return null;
  return Math.round(next * 100) / 100;
}

function skew(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) return null;
  return Math.round(value * 100) / 100;
}

function readList<T>(value: unknown, map: (row: Record<string, unknown>) => T | null, limit: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const next = map(item);
    if (next) out.push(next);
    if (out.length === limit) break;
  }
  return out;
}

/** Accept the features payload, or `{ features: ... }`, without requiring every array. */
export function parseLabFeatures(body: unknown, fallback: LabFeatures): LabFeatures {
  if (!isRecord(body)) return fallback;
  const source = isRecord(body.features) ? body.features : body;
  const activation = isRecord(source.activation) ? source.activation : {};
  const names = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4) : [];
  const parsed: LabFeatures = {
    source: 'api',
    demographicLine: text(source.demographicLine) ?? text(source.line) ?? fallback.demographicLine,
    skews: readList(
      source.skews,
      (row) => {
        const name = text(row.name);
        const bucket = text(row.bucket);
        const value = skew(row.skew);
        if (!name || !bucket || value == null) return null;
        return { name, bucket, skew: value };
      },
      8,
    ),
    competitors: readList(
      source.competitors,
      (row) => {
        const persona = text(row.persona) ?? text(row.label);
        const name = text(row.name);
        if (!persona || !name) return null;
        return { persona, name, affinity: unit(row.affinity) };
      },
      12,
    ),
    neighborhoods: readList(
      source.neighborhoods,
      (row) => {
        const label = text(row.label) ?? text(row.name);
        const weight = unit(row.weight);
        if (!label || weight == null) return null;
        const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined;
        const lng = typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : undefined;
        const tier = row.tier === 1 || row.tier === 2 || row.tier === 3 || row.tier === 4 ? row.tier : undefined;
        return {
          label,
          weight,
          price: unit(row.price),
          popularity: unit(row.popularity),
          ...(lat != null ? { lat } : {}),
          ...(lng != null ? { lng } : {}),
          ...(tier != null ? { tier } : {}),
        };
      },
      5,
    ),
    niches: readList(
      source.niches,
      (row) => {
        const name = text(row.name);
        const id = text(row.id) ?? name;
        if (!name || !id) return null;
        const image = text(row.image);
        return {
          id,
          name,
          type: text(row.type) ?? 'urn:entity',
          affinity: unit(row.affinity),
          ...(image ? { image } : {}),
        };
      },
      6,
    ),
    activation: {
      places: names(activation.places),
      podcasts: names(activation.podcasts),
      brands: names(activation.brands),
    },
    explain: readList(
      source.explain,
      (row) => {
        const name = text(row.name);
        if (!name) return null;
        return { name, before: unit(row.before), after: unit(row.after) };
      },
      4,
    ),
    warnings: Array.isArray(source.warnings) ? source.warnings.filter((item): item is string => typeof item === 'string').slice(0, 6) : [],
    mismatch: typeof source.mismatch === 'number' && Number.isFinite(source.mismatch) ? source.mismatch : null,
    priceLine: text(source.priceLine),
    reinterview: [],
  };
  const empty =
    !parsed.skews.length &&
    !parsed.competitors.length &&
    !parsed.neighborhoods.length &&
    !parsed.niches.length &&
    !parsed.activation.places.length &&
    !parsed.activation.podcasts.length &&
    !parsed.activation.brands.length &&
    !parsed.explain.length &&
    parsed.demographicLine === fallback.demographicLine;
  return empty ? fallback : parsed;
}

export function featureEntity(entity: { id: string; name: string; type?: string; affinity?: number | null }): FeatureEntity {
  return {
    id: entity.id,
    name: entity.name,
    ...(entity.type ? { type: entity.type } : {}),
    ...(typeof entity.affinity === 'number' ? { affinity: entity.affinity } : {}),
  };
}

function roundUnit(value: number): number {
  return Math.round(value * 100) / 100;
}

function pushWarning(bag: string[], warnings: readonly string[]) {
  for (const warning of warnings) {
    if (!warning.trim() || bag.includes(warning)) continue;
    bag.push(warning);
    if (bag.length === 6) return;
  }
}

/** Fold parsed feature results into the lab card. Unparsed bodies are dropped. */
export function projectFeatures(
  parts: {
    demographic?: unknown;
    competitors?: unknown;
    neighborhood?: unknown;
    niche?: unknown;
    activation?: unknown;
  },
  fallback: LabFeatures,
): LabFeatures {
  const demographic = DemographicFitResultSchema.safeParse(parts.demographic);
  const competitors = CompetitorBenchmarkResultSchema.safeParse(parts.competitors);
  const neighborhood = NeighborhoodFitResultSchema.safeParse(parts.neighborhood);
  const niche = NicheFinderResultSchema.safeParse(parts.niche);
  const activation = ActivationPlanResultSchema.safeParse(parts.activation);
  if (!demographic.success && !competitors.success && !neighborhood.success && !niche.success && !activation.success) {
    return fallback;
  }
  const warnings: string[] = [];
  const skews: LabSkew[] = [];
  let demographicLine = fallback.demographicLine;
  let mismatch: number | null = null;
  if (demographic.success) {
    pushWarning(warnings, demographic.data.warnings);
    mismatch = demographic.data.mismatch;
    const where = demographic.data.audience;
    demographicLine = `Target is ${where.age} in ${where.location}.`;
    for (const reference of demographic.data.references) {
      for (const row of reference.skew) {
        if (skews.length === 8) break;
        skews.push({ name: reference.name, bucket: row.bucket, skew: roundUnit(row.value) });
      }
    }
  }
  const competitorRows: LabCompetitor[] = [];
  const explain: LabExplain[] = [];
  if (competitors.success) {
    pushWarning(warnings, competitors.data.warnings);
    for (const persona of competitors.data.personas) {
      for (const row of persona.competitors) {
        if (row.affinity == null) continue;
        if (competitorRows.length < 12) {
          competitorRows.push({ persona: persona.label, name: row.name, affinity: roundUnit(row.affinity) });
        }
        for (const contribution of row.explainability) {
          if (explain.length === 4) break;
          explain.push({ name: `${row.name} · ${contribution.target}`, before: null, after: roundUnit(contribution.weight) });
        }
      }
    }
  }
  const neighborhoods: LabNeighborhood[] = [];
  let priceLine: string | null = null;
  if (neighborhood.success) {
    pushWarning(warnings, neighborhood.data.warnings);
    priceLine = neighborhood.data.priceRecommendation;
    for (const area of neighborhood.data.areas) {
      neighborhoods.push({
        label: area.label,
        weight: roundUnit(area.affinity),
        price: area.priceLevelAffinity == null ? null : roundUnit(area.priceLevelAffinity),
        popularity: area.popularityAffinity == null ? null : roundUnit(area.popularityAffinity),
        lat: area.lat,
        lng: area.lng,
        tier: area.priceLevel,
      });
    }
  }
  const niches: LabNiche[] = [];
  if (niche.success) {
    pushWarning(warnings, niche.data.warnings);
    for (const reference of niche.data.references) {
      if (niches.length === 6) break;
      niches.push({
        id: reference.id,
        name: reference.name,
        type: reference.type,
        affinity: reference.affinity == null ? null : roundUnit(reference.affinity),
      });
    }
  }
  const places: string[] = [];
  const podcasts: string[] = [];
  const brands: string[] = [];
  if (activation.success) {
    pushWarning(warnings, activation.data.warnings);
    for (const persona of activation.data.personas) {
      for (const place of persona.places) if (places.length < 4 && !places.includes(place.name)) places.push(place.name);
      for (const podcast of persona.podcasts) if (podcasts.length < 4 && !podcasts.includes(podcast.name)) podcasts.push(podcast.name);
      for (const partner of persona.partners) if (brands.length < 4 && !brands.includes(partner.name)) brands.push(partner.name);
    }
  }
  return {
    source: 'api',
    demographicLine,
    skews,
    competitors: competitorRows,
    neighborhoods,
    niches,
    activation: { places, podcasts, brands },
    explain,
    warnings,
    mismatch,
    priceLine,
    reinterview: fallback.reinterview,
  };
}

export function mergeFeatures(current: LabFeatures, incoming: LabFeatures): LabFeatures {
  if (incoming.source !== 'api') {
    return current.source === 'api' || current.neighborhoods.length || current.skews.length ? current : incoming;
  }
  const recorded = current.demographicLine.startsWith('Recorded run');
  return {
    ...incoming,
    neighborhoods: incoming.neighborhoods.length ? incoming.neighborhoods : current.neighborhoods,
    demographicLine: incoming.skews.length || incoming.mismatch != null || !recorded ? incoming.demographicLine : current.demographicLine,
    reinterview: incoming.reinterview.length ? incoming.reinterview : current.reinterview,
  };
}

const BENCHMARKS: FeatureEntity[] = [
  { id: 'radiohead', name: 'Radiohead', type: 'urn:entity:artist' },
  { id: 'uniqlo', name: 'Uniqlo', type: 'urn:entity:brand' },
];

function audiencePersona(brief: BriefV2) {
  return {
    id: 'audience',
    label: `${brief.city} ${brief.age}`,
    location: brief.city,
    age: brief.age,
    anchors: brief.references.slice(0, 3).map((entity) => featureEntity(entity)),
  };
}

function nicheType(brief: BriefV2): string {
  const raw = brief.references[0]?.type ?? 'brand';
  if (/video_game/i.test(raw)) return 'videogame';
  if (/artist/i.test(raw)) return 'artist';
  if (/place/i.test(raw)) return 'place';
  return 'brand';
}

async function readFeatureEvents(response: Response, onEvent?: (event: FeatureSseEvent) => void): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data) {
        try {
          const parsed = FeatureSseEventSchema.safeParse(JSON.parse(data));
          if (parsed.success) {
            onEvent?.(parsed.data);
            if (parsed.data.type === 'result') result = parsed.data.result;
          }
        } catch {
          // A bad frame is skipped. It does not become a number on screen.
        }
      }
      split = buffer.indexOf('\n\n');
    }
  }
  return result;
}

async function postFeature(
  name: string,
  body: unknown,
  fetchImpl: typeof fetch,
  base: string,
  signal: AbortSignal | undefined,
  stream: boolean,
  onEvent?: (event: FeatureSseEvent) => void,
): Promise<unknown> {
  const root = base.replace(/\/$/, '');
  const payload = JSON.stringify(body);
  try {
    if (stream) {
      const streamed = await fetchImpl(`${root}/api/features/${name}/stream`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: payload,
        signal,
      });
      if (streamed.ok) return await readFeatureEvents(streamed, onEvent);
    }
    const response = await fetchImpl(`${root}/api/features/${name}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload,
      signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export interface FeatureLoadOptions {
  fetchImpl?: typeof fetch;
  base?: string;
  signal?: AbortSignal;
  onStep?: (label: string) => void;
}

export async function loadImpact(
  body: ImpactRequest,
  fetchImpl: typeof fetch = fetch,
  base = '',
  signal?: AbortSignal,
): Promise<{ costAvoided: number; label: string; disclaimer: string } | null> {
  const payload = await postFeature('impact', body, fetchImpl, base, signal, false);
  const parsed = ImpactResultSchema.safeParse(payload);
  if (!parsed.success) return null;
  return { costAvoided: parsed.data.costAvoided, label: parsed.data.label, disclaimer: parsed.data.disclaimer };
}

export async function loadPersonaChat(
  body: PersonaChatRequest,
  fetchImpl: typeof fetch = fetch,
  base = '',
  signal?: AbortSignal,
  onToken?: (text: string) => void,
): Promise<{ label: string; message: string; source: 'llm' | 'template' } | null> {
  const payload = await postFeature('persona-chat', body, fetchImpl, base, signal, true, (event) => {
    if (event.type === 'token') onToken?.(event.text);
  });
  const parsed = PersonaChatResultSchema.safeParse(payload);
  if (!parsed.success) return null;
  return { label: parsed.data.label, message: parsed.data.message, source: parsed.data.source };
}

export interface NeighborhoodSignal {
  heatmap: number | null;
  popularity: number | null;
  saturation: number | null;
  qlooCalls: number;
}

/** One cached neighborhood read. Mean affinity is the saturation signal. */
export async function loadNeighborhoodSignal(
  body: { location: string; anchors?: FeatureEntity[]; age?: string; budget?: number },
  fetchImpl: typeof fetch = fetch,
  base = '',
  signal?: AbortSignal,
): Promise<NeighborhoodSignal | null> {
  const payload = await postFeature('neighborhood', { ...body, budget: body.budget ?? 2 }, fetchImpl, base, signal, false);
  const parsed = NeighborhoodFitResultSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.areas.length) return null;
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const heatmap = mean(parsed.data.areas.map((area) => area.affinity));
  const popularity = mean(parsed.data.areas.flatMap((area) => (area.popularityAffinity == null ? [] : [area.popularityAffinity])));
  return {
    heatmap,
    popularity,
    saturation: heatmap,
    qlooCalls: parsed.data.qlooCalls,
  };
}

export async function loadReinterview(
  body: ReinterviewRequest,
  fetchImpl: typeof fetch = fetch,
  base = '',
  signal?: AbortSignal,
): Promise<{ warnings: string[]; personas: LabReinterview[] } | null> {
  const payload = await postFeature('reinterview', body, fetchImpl, base, signal, false);
  const parsed = ReinterviewResultSchema.safeParse(payload);
  if (!parsed.success) return null;
  return {
    warnings: parsed.data.warnings,
    personas: parsed.data.personas.map((persona) => ({
      id: persona.id,
      label: persona.label,
      before: persona.before.score,
      after: persona.after.score,
      delta: persona.delta,
      changedMind: persona.changedMind,
      reason: persona.reason,
    })),
  };
}

export async function loadLabFeatures(brief: BriefV2, options: FeatureLoadOptions = {}): Promise<LabFeatures> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.base ?? '';
  const fallback = stubLabFeatures({ city: brief.city, age: brief.age });
  const references = brief.references.slice(0, 6).map((entity) => featureEntity(entity));
  const persona = audiencePersona(brief);
  const onEvent = (event: FeatureSseEvent) => {
    if (event.type === 'step' && !/budget exhausted/i.test(event.label)) options.onStep?.(event.label);
    if (event.type === 'warning' && !/budget exhausted|No Qloo entity for/i.test(event.message)) options.onStep?.(event.message);
  };
  const [demographic, competitors, neighborhood, niche, activation] = await Promise.all([
    references.length
      ? postFeature(
          'demographic-fit',
          { references, audience: { age: brief.age, location: brief.city }, budget: 10 },
          fetchImpl,
          base,
          options.signal,
          true,
          onEvent,
        )
      : Promise.resolve(null),
    postFeature(
      'competitors',
      { competitors: BENCHMARKS, personas: [persona], budget: 8 },
      fetchImpl,
      base,
      options.signal,
      false,
    ),
    postFeature(
      'neighborhood',
      {
        location: brief.city,
        anchors: references.slice(0, 4),
        age: brief.age,
        budget: 10,
      },
      fetchImpl,
      base,
      options.signal,
      true,
      onEvent,
    ),
    postFeature(
      'niche',
      {
        anchors: references.slice(0, 4),
        query: /tour|merch|music/i.test(brief.idea) ? 'live music' : brief.interests[0]?.name ?? brief.city,
        type: nicheType(brief),
        location: brief.city,
        popularityMax: 0.4,
        trends: 'high',
        take: 6,
        budget: 8,
      },
      fetchImpl,
      base,
      options.signal,
      false,
    ),
    postFeature(
      'activation',
      {
        location: brief.city,
        ...(brief.priceLevel ? { priceLevel: brief.priceLevel } : {}),
        personas: [persona],
        budget: 10,
      },
      fetchImpl,
      base,
      options.signal,
      false,
    ),
  ]);
  return projectFeatures({ demographic, competitors, neighborhood, niche, activation }, fallback);
}
