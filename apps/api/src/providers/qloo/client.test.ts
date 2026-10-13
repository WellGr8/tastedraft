import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { jsonResponse, mockFetch } from '../test-support.js';
import { QLOO_API_KEY_HEADER, QLOO_HACKATHON_BASE_URL, QlooClient } from './client.js';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

function tempCache(): string {
  return mkdtempSync(join(tmpdir(), 'tastedraft-qloo-'));
}

describe('QlooClient', () => {
  it('uses mock mode without a key and does not call the network', async () => {
    const previous = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    const cacheDir = tempCache();
    let calls = 0;
    try {
      const client = new QlooClient({
        cacheDir,
        fetchImpl: () => {
          calls += 1;
          throw new Error('network');
        },
      });
      assert.equal(client.mode, 'mock');
      const result = await client.search({ query: 'Velvet', types: 'urn:entity:brand', take: 5 });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.mode, 'mock');
      assert.equal(result.cached, false);
      assert.equal(result.body.mock, true);
      assert.equal(calls, 0);
      assert.equal(readdirSync(cacheDir).length, 0);
      const url = new URL(result.url);
      assert.equal(url.origin, QLOO_HACKATHON_BASE_URL);
      assert.equal(url.pathname, '/search');
      assert.equal(url.searchParams.get('query'), 'Velvet');
      const entities = (result.body.results as { entities: Array<{ entity_id: string; name: string }> }).entities;
      assert.equal(entities.length, 1);
      assert.equal(entities[0]?.name, 'Velvet Circuit');
      assert.ok(entities[0]?.entity_id.startsWith('td-mock-'));
      const text = JSON.stringify(result.body);
      assert.equal(text.includes('Aphex'), false);
      assert.equal(text.includes('Comme'), false);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.QLOO_API_KEY;
      else process.env.QLOO_API_KEY = previous;
    }
  });

  it('sends GET insights with signal, filter, and feature.explainability', async () => {
    const cacheDir = tempCache();
    let seenUrl = '';
    let header = '';
    const fetchImpl = mockFetch(async (url, init) => {
      seenUrl = url.href;
      header = new Headers(init?.headers).get(QLOO_API_KEY_HEADER) ?? '';
      assert.equal(init?.method ?? 'GET', 'GET');
      return jsonResponse({ success: true, results: { entities: [] } });
    });
    try {
      const client = new QlooClient({ apiKey: 'test-key', cacheDir, fetchImpl, minIntervalMs: 0, retries: 0 });
      assert.equal(client.mode, 'live');
      const result = await client.insights({
        filter: { type: 'urn:entity:place', location: { query: 'Los Angeles' }, price_level: { min: 2, max: 4 } },
        signal: {
          interests: { entities: 'td-mock-entity-velvet-circuit' },
          'interests.entities.weight': 0.8,
          demographics: { age: '24_and_younger', gender: 'female' },
        },
        feature: { explainability: true },
        output: { heatmap: { boundary: 'urn:entity:locality' } },
        extra: { 'heatmap.dimensions': 'price_level' },
        take: 5,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(header, 'test-key');
      assert.equal(result.url.includes('test-key'), false);
      const url = new URL(seenUrl);
      assert.equal(url.origin, QLOO_HACKATHON_BASE_URL);
      assert.equal(url.pathname, '/v2/insights');
      assert.equal(url.searchParams.get('feature.explainability'), 'true');
      assert.equal(url.searchParams.get('filter.type'), 'urn:entity:place');
      assert.equal(url.searchParams.get('filter.location.query'), 'Los Angeles');
      assert.equal(url.searchParams.get('filter.price_level.min'), '2');
      assert.equal(url.searchParams.get('filter.price_level.max'), '4');
      assert.equal(url.searchParams.get('signal.interests.entities'), 'td-mock-entity-velvet-circuit');
      assert.equal(url.searchParams.get('signal.interests.entities.weight'), '0.8');
      assert.equal(url.searchParams.get('signal.demographics.age'), '24_and_younger');
      assert.equal(url.searchParams.get('signal.demographics.gender'), 'female');
      assert.equal(url.searchParams.get('output.heatmap.boundary'), 'urn:entity:locality');
      assert.equal(url.searchParams.get('heatmap.dimensions'), 'price_level');
      assert.equal(url.searchParams.get('take'), '5');
      assert.equal(result.body.mock, undefined);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('asks tags with filter.query and feature.semantic_search', async () => {
    const cacheDir = tempCache();
    const fetchImpl = mockFetch(async (url) => {
      assert.equal(url.pathname, '/v2/tags');
      assert.equal(url.searchParams.get('filter.query'), 'paper');
      assert.equal(url.searchParams.get('feature.semantic_search'), 'true');
      return jsonResponse({ success: true, results: { tags: [] } });
    });
    try {
      const client = new QlooClient({ apiKey: 'test-key', cacheDir, fetchImpl, minIntervalMs: 0, retries: 0 });
      const result = await client.tags({ filter: { query: 'paper' }, feature: { semantic_search: true } });
      assert.equal(result.ok, true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('caches a live 200 on disk and does not cache a failure', async () => {
    const cacheDir = tempCache();
    let now = 1_000;
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ success: true, results: { entities: [{ name: 'first' }] } });
      return jsonResponse({ success: false }, 500);
    });
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        cacheTtlMs: 1_000,
        minIntervalMs: 0,
        retries: 0,
        now: () => now,
        fetchImpl,
      });
      const first = await client.search({ query: 'Velvet Circuit' });
      const second = await client.search({ query: 'Velvet Circuit' });
      assert.equal(first.ok && first.cached, false);
      assert.equal(second.ok && second.cached, true);
      assert.equal(calls, 1);
      const files = readdirSync(cacheDir);
      assert.equal(files.length, 1);
      const cached = JSON.parse(readFileSync(join(cacheDir, files[0] ?? ''), 'utf8')) as { body: unknown };
      assert.equal(JSON.stringify(cached.body).includes('test-key'), false);
      now = 2_000;
      const third = await client.search({ query: 'Velvet Circuit' });
      assert.equal(third.ok, false);
      if (!third.ok) assert.equal(third.status, 500);
      assert.equal(calls, 2);
      const fourth = await client.search({ query: 'Velvet Circuit' });
      assert.equal(fourth.ok, false);
      if (!fourth.ok) assert.equal(fourth.status, 500);
      assert.equal(calls, 3);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('reports a timeout', async () => {
    const cacheDir = tempCache();
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        timeoutMs: 20,
        minIntervalMs: 0,
        retries: 0,
        fetchImpl: mockFetch((_url, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const reason = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          });
        })),
      });
      const result = await client.search({ query: 'Velvet Circuit' });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.timedOut, true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('mock insights honor explainability and heatmap without leaving the process', async () => {
    const client = new QlooClient({ apiKey: '' });
    const explained = await client.insights({
      filter: { type: 'urn:entity:brand' },
      signal: { interests: { entities: 'td-mock-entity-northwind-audio' } },
      feature: { explainability: true },
    });
    assert.equal(explained.ok, true);
    if (!explained.ok) return;
    const entities = (explained.body.results as {
      entities: Array<{ query?: { explainability?: Array<{ input: string; weight: number; target: string }> } }>;
    }).entities;
    const contribution = entities[0]?.query?.explainability?.[0];
    assert.ok(contribution);
    assert.equal(contribution?.target.startsWith('td-mock-'), true);
    assert.equal(contribution?.input.startsWith('td-mock-'), true);
    assert.ok((contribution?.weight ?? -1) >= 0 && (contribution?.weight ?? 2) <= 1);
    const heat = await client.insights({
      filter: { type: 'urn:heatmap', location: { query: 'Los Angeles' } },
      feature: { explainability: false },
    });
    assert.equal(heat.ok && heat.body.mock, true);
    if (!heat.ok) return;
    const cells = (heat.body.results as { heatmap: Array<{ id: string }> }).heatmap;
    assert.equal(cells[0]?.id, 'td-mock-cell-lantern-row');
    const tags = await client.tags({ filter: { query: 'paper' }, feature: { semantic_search: true } });
    assert.equal(tags.ok && tags.body.mock, true);
    if (!tags.ok) return;
    const rows = (tags.body.results as { tags: Array<{ id: string }> }).tags;
    assert.equal(rows[0]?.id, 'td-mock-tag-paper-cut');
    assert.equal(new URL(tags.url).searchParams.get('feature.semantic_search'), 'true');
  });

  it('keeps the cache directory gitignored', () => {
    execFileSync('git', ['check-ignore', '-q', 'apps/api/data/qloo-cache/example.json'], { cwd: repoRoot });
    execFileSync('git', ['check-ignore', '-q', 'server/data/qloo-cache/example.json'], { cwd: repoRoot });
    execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: repoRoot });
    execFileSync('git', ['check-ignore', '-q', '.qloo-cache/example.json'], { cwd: repoRoot });
  });

  it('retries a 503 and then returns the successful body', async () => {
    const cacheDir = tempCache();
    let calls = 0;
    const waits: number[] = [];
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        minIntervalMs: 0,
        retries: 2,
        retryDelayMs: 5,
        sleep: async (ms) => {
          waits.push(ms);
        },
        fetchImpl: mockFetch(async () => {
          calls += 1;
          if (calls < 3) return jsonResponse({ success: false }, 503);
          return jsonResponse({ success: true, results: { entities: [{ name: 'kept' }] } });
        }),
      });
      const result = await client.search({ query: 'kept' });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(calls, 3);
      assert.deepEqual(waits, [5, 10]);
      const entities = (result.body.results as { entities: Array<{ name: string }> }).entities;
      assert.equal(entities[0]?.name, 'kept');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('does not retry a 400', async () => {
    const cacheDir = tempCache();
    let calls = 0;
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        minIntervalMs: 0,
        retries: 2,
        fetchImpl: mockFetch(async () => {
          calls += 1;
          return jsonResponse({ success: false, error: [{ message: 'at least one valid signal or filter is required' }] }, 400);
        }),
      });
      const result = await client.search({ query: 'nope' });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /valid signal/);
      assert.equal(calls, 1);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('paces live calls', async () => {
    const cacheDir = tempCache();
    const waits: number[] = [];
    let now = 1_000;
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        minIntervalMs: 100,
        retries: 0,
        now: () => now,
        sleep: async (ms) => {
          waits.push(ms);
          now += ms;
        },
        fetchImpl: mockFetch(async () => jsonResponse({ success: true, results: { entities: [] } })),
      });
      await client.search({ query: 'one' });
      await client.search({ query: 'two' });
      assert.deepEqual(waits, [100]);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
