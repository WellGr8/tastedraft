import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseBenchmark } from './benchmark.ts';

describe('parseBenchmark', () => {
  it('reads the published headline and both arms', () => {
    const body = JSON.parse(readFileSync(new URL('./fixtures/benchmark.recorded.json', import.meta.url), 'utf8'));
    const view = parseBenchmark(body);
    assert.ok(view);
    assert.equal(view.source, 'recorded');
    assert.equal(view.arms.qloo.headline, '16 of 36');
    assert.equal(view.arms.llm.headline, '0 of 36');
    assert.equal(view.arms.qloo.outcome, null);
    assert.equal(view.arms.qloo.unverifiableNames, 10);
    assert.equal(view.rows.length, 9);
    assert.equal(view.rows[0]?.title, 'Tokyo tour + merch');
    assert.equal(view.rows.find((row) => row.id === 'olivia-rodrigo-tokyo-2024')?.outcome, 'Sold out');
    assert.equal(parseBenchmark({ source: 'recorded' }), null);
  });
});
