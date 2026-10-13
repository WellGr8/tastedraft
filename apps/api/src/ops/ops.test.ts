import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { createApp } from '../app.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { AgentRunner } from '../runner/runner.ts';
import { RunStore } from '../runner/store.ts';
import { defaultBriefV2 } from '../agent/model.ts';
import { DailyQlooBudget } from './qloo-budget.ts';
import { clientAddress, rateLimit } from './rate-limit.ts';

describe('daily Qloo budget', () => {
  it('stops at the cap and does not call the network', async () => {
    const budget = new DailyQlooBudget(new DatabaseSync(':memory:'), 1);
    assert.equal(budget.tryTake(), true);
    assert.equal(budget.exhausted(), true);
    assert.equal(budget.tryTake(), false);
    let called = 0;
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(mkdtempSync(join(tmpdir(), 'qloo-budget-')), 'cache'),
      admitLive: () => budget.tryTake(),
      fetchImpl: async () => {
        called += 1;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const result = await client.search({ query: 'Billie Eilish', take: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.equal(called, 0);
    assert.doesNotMatch(JSON.stringify(result), /test-key/);
  });

  it('plays a recorded run when every live call is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qloo-recorded-'));
    let called = 0;
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(dir, 'cache'),
      admitLive: () => false,
      fetchImpl: async () => {
        called += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const agent = new AgentRunner({
      store: new RunStore(join(dir, 'runs.sqlite')),
      client,
      recordingsDir: join(dir, 'recordings'),
      llm: { mode: 'offline', async complete() { throw new Error('offline'); } },
    });
    const run = await agent.start(defaultBriefV2());
    assert.equal(called, 0);
    assert.equal(run.grounding, 'recorded');
    assert.match(run.report, /Recorded run/);
  });
});

describe('per-address limit', () => {
  it('reads the first forwarded address', () => {
    assert.equal(clientAddress((name) => (name === 'x-forwarded-for' ? '203.0.113.5, 10.0.0.1' : undefined)), '203.0.113.5');
  });

  it('limits one address and leaves health open', async () => {
    let clock = 1_000;
    const app = new Hono();
    app.use('*', rateLimit({ limit: 2, windowMs: 60_000, now: () => clock }));
    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/api/ping', (c) => c.json({ ok: true }));
    const headers = { 'x-forwarded-for': '198.51.100.9' };
    for (let i = 0; i < 4; i += 1) {
      const health = await app.request('/api/health', { headers });
      assert.equal(health.status, 200);
    }
    assert.equal((await app.request('/api/ping', { headers })).status, 200);
    assert.equal((await app.request('/api/ping', { headers })).status, 200);
    const blocked = await app.request('/api/ping', { headers });
    assert.equal(blocked.status, 429);
    const other = await app.request('/api/ping', { headers: { 'x-forwarded-for': '198.51.100.10' } });
    assert.equal(other.status, 200);
    clock += 60_000;
    assert.equal((await app.request('/api/ping', { headers })).status, 200);
  });

  it('allowlists browser origins on the app', async () => {
    const app = createApp({
      repository: undefined,
      qlooBudget: false,
      rateLimitPerMinute: false,
      corsOrigins: ['https://tastedraft.pages.dev'],
      databasePath: ':memory:',
    });
    const allowed = await app.request('/api/health', { headers: { Origin: 'https://tastedraft.pages.dev' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://tastedraft.pages.dev');
    const blocked = await app.request('/api/health', { headers: { Origin: 'https://evil.test' } });
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    const health = await app.request('/api/health');
    assert.equal(health.status, 200);
    const body = await health.json() as { ok: boolean; qloo: string; qlooBudget: { fallback: string } };
    assert.equal(body.ok, true);
    assert.equal(body.qloo === 'configured' || body.qloo === 'missing', true);
    assert.equal(body.qlooBudget.fallback === 'live' || body.qlooBudget.fallback === 'recorded', true);
    assert.doesNotMatch(JSON.stringify(body), /hack_|sk-/);
  });
});
