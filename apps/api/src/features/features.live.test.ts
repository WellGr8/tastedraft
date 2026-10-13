/**
 * Live checks for the eight feature endpoints.
 * Skipped unless QLOO_API_KEY is set or a gitignored .env provides it.
 * The key is never printed. Assertions use the derived API body, not the Qloo envelope.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import {
  ActivationPlanResultSchema,
  CompetitorBenchmarkResultSchema,
  DemographicFitResultSchema,
  ImpactResultSchema,
  NeighborhoodFitResultSchema,
  NicheFinderResultSchema,
  PersonaChatResultSchema,
  ReinterviewResultSchema,
} from '@tastedraft/contracts';
import { AppError } from '../errors.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { createFeatureRoutes } from './routes.ts';

function loadKey(): boolean {
  if (process.env.QLOO_API_KEY?.trim()) return true;
  const path = join(process.cwd(), '.env');
  const root = join(process.cwd(), '..', '..', '.env');
  for (const file of [path, root]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('QLOO_API_KEY=')) continue;
      const value = trimmed.slice('QLOO_API_KEY='.length).trim();
      if (value) process.env.QLOO_API_KEY = value;
    }
  }
  return Boolean(process.env.QLOO_API_KEY?.trim());
}

const live = loadKey();

function api(cacheDir: string) {
  const client = new QlooClient({ cacheDir, minIntervalMs: 250, timeoutMs: 25_000, retries: 1 });
  const app = new Hono();
  app.route('/', createFeatureRoutes({
    client,
    llm: { mode: 'offline', async complete() { throw new Error('offline'); } },
  }));
  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { message: err.message } }, 400);
    if (err instanceof ZodError) return c.json({ error: { message: 'invalid' } }, 400);
    return c.json({ error: { message: 'error' } }, 500);
  });
  return app;
}

async function post(app: Hono, path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as Record<string, unknown>;
  assert.equal(res.status, 200, JSON.stringify(json.warnings ?? json.error ?? res.status));
  return json;
}

describe('live feature endpoints', { skip: live ? false : 'QLOO_API_KEY is not set', timeout: 180_000 }, () => {
  it('runs each feature against the hackathon host', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'td-features-'));
    const app = api(cacheDir);
    const samples: Record<string, unknown> = {};
    try {
      const demographic = DemographicFitResultSchema.parse(await post(app, '/api/features/demographic-fit', {
        references: [{ id: 'Glossier', name: 'Glossier', type: 'brand' }],
        audience: { age: '36–45', gender: 'female', location: 'Los Angeles' },
        budget: 4,
      }));
      assert.ok(demographic.references[0]?.skew.some((row) => row.dimension === 'age'));
      assert.equal(typeof demographic.mismatch, 'number');
      assert.ok((demographic.references[0]?.evidence.length ?? 0) > 0);
      const anchor = demographic.references[0];
      assert.ok(anchor);

      const competitors = CompetitorBenchmarkResultSchema.parse(await post(app, '/api/features/competitors', {
        competitors: [{ id: 'Summer Fridays', name: 'Summer Fridays', type: 'brand' }],
        personas: [{ id: 'fans', label: 'Fans', location: 'Los Angeles', age: '25_to_29', gender: 'female', anchors: [{ id: anchor.id, name: anchor.name, type: anchor.type }] }],
        budget: 4,
      }));
      assert.equal(competitors.personas.length, 1);
      assert.equal(typeof competitors.personas[0]?.competitors[0]?.affinity, 'number');

      const neighborhood = NeighborhoodFitResultSchema.parse(await post(app, '/api/features/neighborhood', {
        location: 'Los Angeles',
        anchors: [{ id: anchor.id, name: anchor.name, type: anchor.type }],
        budget: 4,
      }));
      assert.ok(neighborhood.cellCount > 0);
      assert.ok(neighborhood.areas.length > 0 && neighborhood.areas.length <= 5);
      assert.ok(neighborhood.priceRecommendation.length > 0);

      const niche = NicheFinderResultSchema.parse(await post(app, '/api/features/niche', {
        anchors: [{ id: anchor.id, name: anchor.name, type: anchor.type }],
        type: 'brand',
        popularityMax: 0.4,
        trends: 'high',
        take: 5,
        budget: 2,
      }));
      assert.equal(niche.type, 'urn:entity:brand');
      assert.ok(niche.references.length > 0);
      assert.ok(niche.references.every((row) => row.popularity == null || row.popularity <= 0.401));

      const games = NicheFinderResultSchema.parse(await post(app, '/api/features/niche', {
        query: 'Minecraft',
        type: 'video_game',
        popularityMax: 0.95,
        trends: 'high',
        take: 2,
        budget: 4,
      }));
      assert.equal(games.type, 'urn:entity:videogame');
      assert.ok(games.references.length > 0, games.warnings.join(' | '));

      const activation = ActivationPlanResultSchema.parse(await post(app, '/api/features/activation', {
        location: 'Los Angeles',
        priceLevel: 3,
        personas: [{ id: 'fans', label: 'Fans', location: 'Los Angeles', age: '25_to_29', gender: 'female', anchors: [{ id: anchor.id, name: anchor.name }] }],
        budget: 6,
      }));
      const persona = activation.personas[0];
      assert.ok(persona);
      assert.ok(persona.places.length > 0);
      assert.ok(persona.podcasts.length > 0);
      assert.ok(persona.partners.length > 0);

      const impact = ImpactResultSchema.parse(await post(app, '/api/features/impact', {
        pilotCost: 8000,
        focusGroupCost: 150,
        sampleSize: 12,
        roundsAvoided: 2,
      }));
      assert.equal(impact.label, 'estimate');
      assert.equal(impact.disclaimer, 'Not a sales forecast');
      assert.equal(impact.costAvoided, 19600);
      assert.equal(impact.qlooCalls, 0);

      const rival = competitors.personas[0]?.competitors[0];
      assert.ok(rival);
      const reinterview = ReinterviewResultSchema.parse(await post(app, '/api/features/reinterview', {
        personas: [{ id: 'fans', label: 'Fans', location: 'Los Angeles', age: '25_to_29', gender: 'female' }],
        before: { references: [{ id: anchor.id, name: anchor.name, type: 'brand' }] },
        after: { references: [{ id: rival.id, name: rival.name, type: 'brand' }] },
        budget: 4,
      }));
      assert.equal(typeof reinterview.personas[0]?.changedMind, 'boolean');
      assert.ok(reinterview.personas[0]?.reason.includes(rival.id) || reinterview.personas[0]?.reason.includes('threshold'));

      const chat = PersonaChatResultSchema.parse(await post(app, '/api/features/persona-chat', {
        persona: {
          id: 'fans',
          label: 'Fans',
          location: 'Los Angeles',
          anchors: [{ id: anchor.id, name: anchor.name, type: anchor.type, affinity: 0.8 }],
        },
        message: 'Would this reference fit a 35 to 44 launch?',
      }));
      assert.equal(chat.label, 'Simulated persona response');
      assert.equal(chat.source, 'template');
      assert.ok(chat.citations.some((citation) => citation.id === anchor.id));

      const stream = await app.request('/api/features/impact/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pilotCost: 8000, focusGroupCost: 150, sampleSize: 12, roundsAvoided: 2 }),
      });
      const sse = await stream.text();
      assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
      assert.match(sse, /event: result/);
      assert.match(sse, /event: done/);

      samples.demographic = demographic;
      samples.competitors = competitors;
      samples.neighborhood = neighborhood;
      samples.niche = niche;
      samples.videogame = games;
      samples.activation = activation;
      samples.impact = impact;
      samples.reinterview = reinterview;
      samples.chat = chat;
      writeFileSync('/tmp/feature-samples.json', JSON.stringify(samples, null, 2));
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
