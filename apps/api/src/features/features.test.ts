import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { PERSONA_RESPONSE_LABEL } from '@tastedraft/contracts';
import { demographicMismatch, estimateAvoidedCost, personaMindChange } from '../engine/features.ts';
import { AppError } from '../errors.ts';
import { toEntityUrn, readContributions } from '../providers/qloo/insights.ts';
import type { QlooInsightsParams, QlooResult, QlooSearchParams } from '../providers/qloo/client.ts';
import { createFeatureRoutes, type FeatureCaller } from './routes.ts';
import { assertInsightParams } from './params.ts';
import { FeatureCache } from './cache.ts';

const REF = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';

const SKEW = [
  { dimension: 'age' as const, bucket: '24_and_younger', value: 0.4 },
  { dimension: 'age' as const, bucket: '25_to_29', value: 0.38 },
  { dimension: 'age' as const, bucket: '30_to_34', value: 0.31 },
  { dimension: 'age' as const, bucket: '35_to_44', value: -0.68 },
  { dimension: 'age' as const, bucket: '45_to_54', value: -0.45 },
  { dimension: 'age' as const, bucket: '55_and_older', value: -0.51 },
  { dimension: 'gender' as const, bucket: 'female', value: 0.2 },
  { dimension: 'gender' as const, bucket: 'male', value: -0.2 },
];

function envelope(results: unknown): QlooResult {
  return { ok: true, status: 200, mode: 'mock', url: 'test', cached: false, body: { success: true, results } };
}

class FakeCaller implements FeatureCaller {
  mode = 'mock' as const;
  calls = 0;
  budget = 12;
  readonly insightsCalls: QlooInsightsParams[] = [];
  readonly searchCalls: QlooSearchParams[] = [];

  async search(params: QlooSearchParams): Promise<QlooResult> {
    this.calls += 1;
    this.searchCalls.push(params);
    return envelope([{ entity_id: REF, name: params.query, types: [params.types ?? 'urn:entity:brand'] }]);
  }

  async insights(params: QlooInsightsParams): Promise<QlooResult> {
    this.calls += 1;
    this.insightsCalls.push(params);
    const type = String(params.filter?.type ?? '');
    if (type === 'urn:demographics') {
      const age = Object.fromEntries(SKEW.filter((row) => row.dimension === 'age').map((row) => [row.bucket, row.value]));
      return envelope({ demographics: [{ entity_id: REF, query: { age, gender: { female: 0.2, male: -0.2 } } }] });
    }
    if (type === 'urn:heatmap') {
      return envelope({
        heatmap: [
          { location: { latitude: 34.09, longitude: -118.27, geohash: '9q5cu1' }, query: { affinity: 0.91, popularity_affinity: 0.8, price_level_affinity: 0.7 } },
          { location: { latitude: 34.091, longitude: -118.271, geohash: '9q5cu2' }, query: { affinity: 0.88, popularity_affinity: 0.77, price_level_affinity: 0.66 } },
          { location: { latitude: 34.07, longitude: -118.4, geohash: '9q5cm1' }, query: { affinity: 0.2, popularity_affinity: 0.1, price_level_affinity: 0.4 } },
        ],
      });
    }
    if (type === 'urn:entity:place') {
      return envelope({
        entities: [{
          entity_id: 'place-1',
          name: 'Counter',
          subtype: 'urn:entity:place',
          query: { affinity: 0.8 },
          properties: {
            price_level: 2,
            locality: { neighborhood: { name: 'Silver Lake' } },
            geocode: { latitude: 34.09, longitude: -118.27 },
          },
        }],
      });
    }
    if (type === 'urn:entity:podcast') {
      return envelope({ entities: [{ entity_id: 'pod-1', name: 'Night Desk', subtype: 'urn:entity:podcast', query: { affinity: 0.64 } }] });
    }
    if (type === 'urn:entity:videogame') {
      return envelope({
        entities: [{
          entity_id: 'game-1',
          name: 'Signal Garden',
          subtype: 'urn:entity:videogame',
          popularity: 0.22,
          query: { affinity: 0.7, measurements: { audience_growth: 0.3 } },
        }],
      });
    }
    const requested = String(params.filter?.results && typeof params.filter.results === 'object' && 'entities' in params.filter.results ? params.filter.results.entities : '');
    if (requested.includes(NEXT)) {
      return envelope({
        entities: [{
          entity_id: NEXT,
          name: 'After Brand',
          subtype: 'urn:entity:brand',
          query: { affinity: 0.8, explainability: [{ entity_id: REF, score: 0.8 }] },
        }],
      });
    }
    if (requested.includes(REF) && !requested.includes(RIVAL)) {
      return envelope({
        entities: [{
          entity_id: REF,
          name: 'Glossier',
          subtype: 'urn:entity:brand',
          query: { affinity: 0.2, explainability: { 'signal.interests.entities': [{ entity_id: RIVAL, score: 0.2 }] } },
        }],
      });
    }
    return envelope({
      entities: [
        {
          entity_id: RIVAL,
          name: 'The Ordinary',
          subtype: type || 'urn:entity:brand',
          popularity: 0.31,
          query: {
            affinity: 0.42,
            measurements: { audience_growth: 0 },
            explainability: [{ entity_id: REF, score: 0.42 }],
          },
        },
        {
          entity_id: 'low-1',
          name: 'Quiet Label',
          subtype: type || 'urn:entity:brand',
          popularity: 0.9,
          query: { affinity: 0.5, measurements: { audience_growth: 0 } },
        },
      ],
    });
  }
}

function app(caller: FakeCaller, cache = new FeatureCache(60_000, () => 1_000)) {
  const api = new Hono();
  api.route('/', createFeatureRoutes({
    caller,
    cache,
    llm: { mode: 'offline', async complete() { throw new Error('offline'); } },
    sleep: async () => {},
  }));
  api.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { message: err.message } }, 400);
    if (err instanceof ZodError) return c.json({ error: { message: err.issues.map((issue) => issue.message).join('; ') } }, 400);
    return c.json({ error: { message: err instanceof Error ? err.message : 'error' } }, 500);
  });
  return api;
}

async function post(api: Hono, path: string, body: unknown) {
  const res = await api.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) as Record<string, unknown> : {};
  return { status: res.status, json, text, type: res.headers.get('content-type') };
}

describe('feature scores', () => {
  it('scores a young skew against a 35–44 target as a mismatch', () => {
    assert.equal(demographicMismatch(SKEW, '35_to_44', 'female').mismatch, 63);
    assert.equal(demographicMismatch(SKEW, '35_to_44', null).mismatch, 71);
    const cost = estimateAvoidedCost({ pilotCost: 8000, focusGroupCost: 150, sampleSize: 12, roundsAvoided: 2 });
    assert.equal(cost.perRound, 9800);
    assert.equal(cost.costAvoided, 19600);
    assert.equal(personaMindChange(40, 44, []).changedMind, false);
    assert.equal(personaMindChange(40, 45, []).changedMind, true);
  });

  it('rejects demographics without a location, video_game, and unknown params', () => {
    assert.throws(() => assertInsightParams({ signal: { demographics: { age: '35_to_44' } } }), /location/);
    assert.throws(() => assertInsightParams({ filter: { type: 'urn:entity:video_game' }, signal: { location: { query: 'Los Angeles' } } }), /videogame/);
    assert.throws(() => assertInsightParams({ extra: { 'filter.not_a_param': '1' }, signal: { location: { query: 'Los Angeles' } } }), /not_a_param/);
    assert.equal(toEntityUrn('video_game'), 'urn:entity:videogame');
    assert.equal(toEntityUrn('urn:entity:video_game'), 'urn:entity:videogame');
    const array = readContributions({ query: { explainability: [{ entity_id: 'a', score: 0.4 }] } }, 'target');
    const object = readContributions({ query: { explainability: { 'signal.interests.entities': [{ entity_id: 'b', score: 0.6 }] } } }, 'target');
    assert.equal(array[0]?.input, 'a');
    assert.equal(array[0]?.weight, 0.4);
    assert.equal(object[0]?.input, 'b');
    assert.equal(object[0]?.weight, 0.6);
  });
});

describe('feature routes', () => {
  it('returns demographic skew, mismatch, and evidence', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/demographic-fit', {
      references: [{ id: REF, name: 'Glossier', type: 'brand' }],
      audience: { age: '36–45', gender: 'female', location: 'Los Angeles' },
    });
    assert.equal(res.status, 200);
    const body = res.json as { mismatch: number; references: Array<{ mismatch: number; peak: { bucket: string }; evidence: unknown[] }>; qlooCalls: number };
    assert.equal(body.mismatch, 63);
    assert.equal(body.references[0]?.peak.bucket, '24_and_younger');
    assert.ok(body.references[0]?.evidence.length);
    assert.equal(body.qlooCalls, 1);
    const flat = new URLSearchParams();
    const params = caller.insightsCalls[0];
    assert.equal(params?.filter?.type, 'urn:demographics');
    assert.equal((params?.signal?.location as { query?: string } | undefined)?.query, 'Los Angeles');
    assert.equal(params?.signal?.demographics, undefined);
    void flat;
  });

  it('stops at the budget and caches the next identical request', async () => {
    const caller = new FakeCaller();
    const cache = new FeatureCache(60_000, () => 1_000);
    const api = app(caller, cache);
    const payload = {
      references: [
        { id: REF, name: 'Glossier', type: 'brand' },
        { id: RIVAL, name: 'Other', type: 'brand' },
      ],
      audience: { age: '36–45', location: 'Los Angeles' },
      budget: 1,
    };
    const first = await post(api, '/api/features/demographic-fit', payload);
    assert.equal(first.status, 200);
    assert.equal(caller.insightsCalls.length, 1);
    assert.ok((first.json.warnings as string[]).some((warning) => /budget/i.test(warning)));
    const second = await post(api, '/api/features/demographic-fit', payload);
    assert.equal(second.json.cached, true);
    assert.equal(second.json.qlooCalls, 0);
    assert.equal(caller.insightsCalls.length, 1);
  });

  it('scores competitors per persona and keeps array explainability', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/competitors', {
      competitors: [{ id: RIVAL, name: 'The Ordinary', type: 'brand' }],
      personas: [{ id: 'p1', label: 'Fans', location: 'Los Angeles', age: '25_to_29', gender: 'female' }],
    });
    assert.equal(res.status, 200);
    const row = (res.json.personas as Array<{ competitors: Array<{ affinity: number; explainability: Array<{ input: string }> }> }>)[0];
    assert.equal(row?.competitors[0]?.affinity, 0.42);
    assert.equal(row?.competitors[0]?.explainability[0]?.input, REF);
    const params = caller.insightsCalls[0];
    const results = params?.filter?.results;
    const entities = results && typeof results === 'object' && !Array.isArray(results) ? results.entities : '';
    assert.equal(entities, RIVAL);
    assert.equal((params?.signal?.location as { query?: string }).query, 'Los Angeles');
  });

  it('returns five or fewer areas and a price level from nearby places', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/neighborhood', {
      location: 'Los Angeles',
      anchors: [{ id: REF, name: 'Glossier', type: 'brand' }],
    });
    assert.equal(res.status, 200);
    const areas = res.json.areas as Array<{ label: string; priceLevel: number; priceRecommendation: string }>;
    assert.ok(areas.length > 0 && areas.length <= 5);
    assert.equal(areas[0]?.label, 'Silver Lake');
    assert.equal(areas[0]?.priceLevel, 2);
    assert.match(areas[0]?.priceRecommendation ?? '', /price level 2/);
    assert.equal(caller.insightsCalls[0]?.extra?.['heatmap.dimensions'], 'price_level,popularity');
    assert.equal(caller.insightsCalls[0]?.output, undefined);
  });

  it('asks for videogame, popularity.max, and bias.trends, and drops mainstream rows', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/niche', {
      anchors: [{ id: REF, name: 'Glossier', type: 'brand' }],
      type: 'video_game',
      popularityMax: 0.4,
      trends: 'high',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.type, 'urn:entity:videogame');
    const refs = res.json.references as Array<{ kind: string; popularity: number }>;
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.kind, 'rising');
    assert.ok((refs[0]?.popularity ?? 1) <= 0.4);
    assert.equal(caller.insightsCalls[0]?.filter?.type, 'urn:entity:videogame');
    assert.equal(caller.insightsCalls[0]?.extra?.['bias.trends'], 'high');
    assert.equal((caller.insightsCalls[0]?.filter?.popularity as { max?: number }).max, 0.4);
  });

  it('returns places, podcasts, and partner brands for each persona', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/activation', {
      location: 'Los Angeles',
      priceLevel: 3,
      personas: [{ id: 'p1', label: 'Fans', location: 'Los Angeles', age: '25_to_29', gender: 'female' }],
    });
    assert.equal(res.status, 200);
    const persona = (res.json.personas as Array<{ places: unknown[]; podcasts: Array<{ name: string }>; partners: unknown[] }>)[0];
    assert.equal(persona?.places.length, 1);
    assert.equal(persona?.podcasts[0]?.name, 'Night Desk');
    assert.ok((persona?.partners.length ?? 0) >= 1);
    assert.equal(caller.insightsCalls[0]?.extra?.sort_by, 'quality');
    assert.equal((caller.insightsCalls[0]?.signal?.demographics as { age?: string }).age, '25_to_29');
  });

  it('labels avoided market-test cost as an estimate', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/impact', {
      pilotCost: 8000,
      focusGroupCost: 150,
      sampleSize: 12,
      roundsAvoided: 2,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.label, 'estimate');
    assert.equal(res.json.disclaimer, 'Not a sales forecast');
    assert.equal(res.json.costAvoided, 19600);
    assert.equal(res.json.qlooCalls, 0);
    assert.equal(caller.insightsCalls.length, 0);
  });

  it('re-scores each persona and flags a changed mind from the engine', async () => {
    const caller = new FakeCaller();
    const res = await post(app(caller), '/api/features/reinterview', {
      personas: [{ id: 'p1', label: 'Fans', location: 'Los Angeles', age: '25_to_29' }],
      before: { references: [{ id: REF, name: 'Glossier', type: 'brand' }] },
      after: { references: [{ id: NEXT, name: 'After Brand', type: 'brand' }] },
    });
    assert.equal(res.status, 200);
    const persona = (res.json.personas as Array<{ before: { score: number }; after: { score: number }; changedMind: boolean; reason: string; delta: number }>)[0];
    assert.equal(persona?.before.score, 20);
    assert.equal(persona?.after.score, 80);
    assert.equal(persona?.changedMind, true);
    assert.equal(persona?.delta, 60);
    assert.match(persona?.reason ?? '', /After Brand/);
    assert.match(persona?.reason ?? '', new RegExp(NEXT));
  });

  it('resolves a slug reference before scoring both versions', async () => {
    const caller = new FakeCaller();
    caller.budget = 20;
    const res = await post(app(caller), '/api/features/reinterview', {
      personas: [{ id: 'p1', label: 'Tokyo 18–25', location: 'Tokyo', age: '18–25', anchors: [{ id: 'sleepy-jones', name: 'Sleepy Jones', type: 'brand' }] }],
      before: { references: [{ id: 'aphex-twin', name: 'Aphex Twin', type: 'artist' }] },
      after: { references: [{ id: NEXT, name: 'After Brand', type: 'brand' }] },
    });
    assert.equal(res.status, 200);
    const persona = (res.json.personas as Array<{ before: { score: number | null }; after: { score: number | null }; changedMind: boolean; reason: string }>)[0];
    assert.notEqual(persona?.before.score, null);
    assert.notEqual(persona?.after.score, null);
    assert.equal(persona?.changedMind, true);
    assert.doesNotMatch(persona?.reason ?? '', /could not score both versions/);
    assert.ok(caller.searchCalls.some((call) => call.query === 'Aphex Twin'));
  });

  it('answers as a simulated persona and cites anchor ids without an LLM key', async () => {
    const caller = new FakeCaller();
    const api = app(caller);
    const res = await post(api, '/api/features/persona-chat', {
      persona: {
        id: 'p1',
        label: 'Fans',
        location: 'Los Angeles',
        anchors: [{ id: REF, name: 'Glossier', type: 'brand', affinity: 0.83 }],
      },
      message: 'Would you visit a pop-up?',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.label, PERSONA_RESPONSE_LABEL);
    assert.equal(res.json.source, 'template');
    assert.match(String(res.json.message), /Simulated persona response/);
    assert.match(String(res.json.message), new RegExp(REF));
    const stream = await api.request('/api/features/persona-chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        persona: {
          id: 'p1',
          label: 'Fans',
          location: 'Los Angeles',
          anchors: [{ id: REF, name: 'Glossier', type: 'brand', affinity: 0.83 }],
        },
        message: 'Would you visit a pop-up?',
      }),
    });
    const text = await stream.text();
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(text, /event: token/);
    assert.match(text, /event: citation/);
    assert.match(text, /event: done/);
    assert.equal(caller.insightsCalls.length, 0);
  });

  it('rejects a heatmap with no signal and a cost with no assumption', async () => {
    const caller = new FakeCaller();
    const api = app(caller);
    const heat = await post(api, '/api/features/neighborhood', { location: 'Los Angeles' });
    assert.equal(heat.status, 400);
    const impact = await post(api, '/api/features/impact', { sampleSize: 10, roundsAvoided: 1 });
    assert.equal(impact.status, 400);
  });
});
