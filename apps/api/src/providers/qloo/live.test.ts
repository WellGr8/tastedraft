/**
 * One live search and one live insights call.
 * Skipped unless QLOO_API_KEY is set in the environment. The key is not printed.
 * Responses stay in a temp cache and are not written into the repo.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { QlooClient } from './client.ts';

const live = Boolean(process.env.QLOO_API_KEY?.trim());

describe('Qloo live API', { skip: live ? false : 'QLOO_API_KEY is not set' }, () => {
  it('search and brand insights return entities', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'td-qloo-live-'));
    const client = new QlooClient({ cacheDir, minIntervalMs: 0, retries: 1, timeoutMs: 20_000 });
    try {
      const search = await client.search({ query: 'Muji', types: 'urn:entity:brand', take: 1 });
      assert.equal(search.ok, true);
      if (!search.ok) return;
      assert.equal(search.status, 200);
      const rows = Array.isArray(search.body.results)
        ? search.body.results
        : (search.body.results as { entities?: unknown[] } | undefined)?.entities;
      assert.ok(Array.isArray(rows) && rows.length > 0);
      const insights = await client.insights({
        filter: { type: 'urn:entity:brand' },
        signal: { location: { query: 'Tokyo' } },
        feature: { explainability: true },
        take: 1,
      });
      assert.equal(insights.ok, true);
      if (!insights.ok) return;
      const entities = (insights.body.results as { entities?: Array<{ name?: string; query?: { affinity?: number } }> }).entities;
      assert.ok(entities && entities.length > 0);
      assert.equal(typeof entities[0]?.query?.affinity, 'number');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
