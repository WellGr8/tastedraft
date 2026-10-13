import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TtlCache } from './cache.js';
import { createHttpClient } from './http.js';
import { jsonResponse, mockFetch } from './test-support.js';

describe('http client', () => {
  it('caches a 200 and does not cache a failure', async () => {
    let now = 0;
    let calls = 0;
    const cache = new TtlCache(1000, () => now);
    const http = createHttpClient({
      cache,
      minIntervalByHost: {},
      fetchImpl: mockFetch(async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ ok: true });
        return jsonResponse({ error: true }, 500);
      }),
    });
    const first = await http.getJson('https://example.test/a');
    const second = await http.getJson('https://example.test/a');
    assert.equal(first.ok && first.body && (first.body as { ok: boolean }).ok, true);
    assert.equal(second.ok && (second.body as { ok: boolean }).ok, true);
    assert.equal(calls, 1);
    now = 1000;
    const third = await http.getJson('https://example.test/a');
    assert.equal(third.ok && third.status, 500);
    assert.equal(calls, 2);
    const fourth = await http.getJson('https://example.test/a');
    assert.equal(fourth.ok && fourth.status, 500);
    assert.equal(calls, 3);
  });

  it('spaces requests to MusicBrainz and lets the first one through', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const http = createHttpClient({
      minIntervalByHost: { 'musicbrainz.org': 1000 },
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetchImpl: mockFetch(async () => jsonResponse({ artists: [] })),
    });
    await Promise.all([
      http.getJson('https://musicbrainz.org/ws/2/artist/?query=a'),
      http.getJson('https://musicbrainz.org/ws/2/artist/?query=b'),
    ]);
    assert.deepEqual(sleeps, [1000]);
  });

  it('reports a timeout instead of hanging', async () => {
    const http = createHttpClient({
      timeoutMs: 20,
      minIntervalByHost: {},
      fetchImpl: mockFetch((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        });
      })),
    });
    const result = await http.getJson('https://example.test/slow');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.timedOut, true);
  });
});
