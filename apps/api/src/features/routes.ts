import type { FeatureName, FeatureSseEvent } from '@tastedraft/contracts';
import {
  ActivationPlanRequestSchema,
  CompetitorBenchmarkRequestSchema,
  DEFAULT_FEATURE_BUDGET,
  DemographicFitRequestSchema,
  FeatureSseEventSchema,
  ImpactRequestSchema,
  NeighborhoodFitRequestSchema,
  NicheFinderRequestSchema,
  PersonaChatRequestSchema,
  ReinterviewRequestSchema,
} from '@tastedraft/contracts';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ZodType } from 'zod';
import { badRequest } from '../errors.ts';
import { createLlmClient, type LlmClient } from '../llm/client.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { FeatureCache } from './cache.ts';
import { openCaller, type FeatureCaller, type FeatureRun } from './caller.ts';

export type { FeatureCaller };
import {
  activationPlan,
  businessImpact,
  competitorBenchmark,
  demographicFit,
  neighborhoodFit,
  nicheFinder,
  personaChat,
  reinterview,
} from './handlers.ts';

export interface FeatureRouteOptions {
  client?: QlooClient;
  /** Test double. When set, the route does not wrap it in another gateway. */
  caller?: FeatureCaller;
  cache?: FeatureCache;
  llm?: LlmClient;
  /** False skips a live Qloo call after the daily cap. */
  admitLive?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  cacheTtlMs?: number;
}

const FEATURES: FeatureName[] = [
  'demographic-fit',
  'competitors',
  'neighborhood',
  'niche',
  'activation',
  'impact',
  'reinterview',
  'persona-chat',
];

function isFeature(value: string): value is FeatureName {
  return (FEATURES as string[]).includes(value);
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('Request body must be JSON');
  }
}

function budgetOf(body: { budget?: number }): number {
  return body.budget ?? DEFAULT_FEATURE_BUDGET;
}

export function createFeatureRoutes(options: FeatureRouteOptions = {}): Hono {
  const cache = options.cache ?? new FeatureCache(options.cacheTtlMs ?? 10 * 60 * 1000, options.now);
  const llm = options.llm ?? createLlmClient();
  const api = new Hono();

  const runFeature = async (feature: FeatureName, body: { budget?: number }, events: FeatureSseEvent[]): Promise<unknown> => {
    const budget = budgetOf(body);
    const caller = options.caller ?? openCaller(options.client ?? new QlooClient({
      minIntervalMs: 250,
      timeoutMs: 25_000,
      retries: 2,
      ...(options.admitLive ? { admitLive: options.admitLive } : {}),
    }), budget, options.sleep);
    if (options.caller) {
      caller.budget = budget;
      caller.calls = 0;
    }
    const run: FeatureRun = {
      caller,
      budget,
      warnings: [],
      emit: (event) => events.push(FeatureSseEventSchema.parse(event)),
    };
    switch (feature) {
      case 'demographic-fit':
        return demographicFit(run, DemographicFitRequestSchema.parse(body));
      case 'competitors':
        return competitorBenchmark(run, CompetitorBenchmarkRequestSchema.parse(body));
      case 'neighborhood':
        return neighborhoodFit(run, NeighborhoodFitRequestSchema.parse(body));
      case 'niche':
        return nicheFinder(run, NicheFinderRequestSchema.parse(body));
      case 'activation':
        return activationPlan(run, ActivationPlanRequestSchema.parse(body));
      case 'impact':
        return businessImpact(run, ImpactRequestSchema.parse(body));
      case 'reinterview':
        return reinterview(run, ReinterviewRequestSchema.parse(body));
      case 'persona-chat':
        return personaChat(run, PersonaChatRequestSchema.parse(body), llm);
      default:
        throw badRequest(`Unknown feature "${feature}".`);
    }
  };

  const respond = (feature: FeatureName, schema: ZodType) => {
    api.post(`/api/features/${feature}`, async (c) => {
      const body = schema.parse(await readJson(c)) as { budget?: number };
      const key = FeatureCache.key(feature, body);
      const hit = cache.get(key);
      if (hit && typeof hit === 'object') return c.json({ ...hit, cached: true, qlooCalls: 0 });
      const events: FeatureSseEvent[] = [];
      const result = await runFeature(feature, body, events);
      cache.set(key, result);
      return c.json(result);
    });

    api.post(`/api/features/${feature}/stream`, async (c) => {
      const body = schema.parse(await readJson(c)) as { budget?: number };
      const key = FeatureCache.key(feature, body);
      const hit = cache.get(key);
      const events: FeatureSseEvent[] = [];
      const result = hit && typeof hit === 'object' ? { ...hit, cached: true, qlooCalls: 0 } : await runFeature(feature, body, events);
      if (!hit) cache.set(key, result);
      const payload = result as { qlooCalls?: number; budget?: number; cached?: boolean; warnings?: string[] };
      if (hit) {
        for (const warning of payload.warnings ?? []) {
          events.push({ type: 'warning', feature, message: warning });
        }
        if (feature === 'persona-chat' && result && typeof result === 'object' && 'message' in result && typeof result.message === 'string') {
          for (const part of result.message.split(/(\s+)/)) {
            if (part) events.push({ type: 'token', feature, text: part });
          }
          const citations = 'citations' in result && Array.isArray(result.citations) ? result.citations : [];
          for (const citation of citations) {
            if (!citation || typeof citation !== 'object' || !('id' in citation) || !('name' in citation)) continue;
            events.push({ type: 'citation', feature, id: String(citation.id), name: String(citation.name) });
          }
        }
      }
      events.push(FeatureSseEventSchema.parse({ type: 'result', feature, result }));
      events.push(FeatureSseEventSchema.parse({
        type: 'done',
        feature,
        qlooCalls: payload.qlooCalls ?? 0,
        budget: payload.budget ?? budgetOf(body),
        cached: Boolean(payload.cached),
      }));
      return streamSSE(c, async (stream) => {
        for (const event of events) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      });
    });
  };

  respond('demographic-fit', DemographicFitRequestSchema);
  respond('competitors', CompetitorBenchmarkRequestSchema);
  respond('neighborhood', NeighborhoodFitRequestSchema);
  respond('niche', NicheFinderRequestSchema);
  respond('activation', ActivationPlanRequestSchema);
  respond('impact', ImpactRequestSchema);
  respond('reinterview', ReinterviewRequestSchema);
  respond('persona-chat', PersonaChatRequestSchema);

  api.all('/api/features/:name', (c) => {
    const name = c.req.param('name');
    if (!isFeature(name)) throw badRequest(`Unknown feature "${name}".`);
    throw badRequest(`Use POST /api/features/${name}.`);
  });

  return api;
}
