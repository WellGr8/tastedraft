import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyDiffsToEngine, defaultBriefV2, scoreEngine } from '../../../apps/api/src/agent/model.ts';
import {
  DEFAULT_BRIEF,
  deriveSubs,
  displayScore,
  ledgerPoints,
  provideEvidence,
} from '../../../apps/api/src/engine/index.ts';
import { scoreInsightMeasurements } from '../../../apps/api/src/engine/insights-score.ts';
import {
  engineBackend,
  rescoreParamDiffs,
  scoreMockBrief as adapterScoreMock,
  scoreSampleBrief as adapterScoreSample,
} from '../../../apps/api/src/engine/wasm-adapter.ts';
import { scorePacket } from '../../../apps/api/src/wiring/gaps.ts';
import { QlooClient } from '../../../apps/api/src/providers/qloo/client.ts';
import {
  BANGKOK_SNACK_BRIEF,
  BERLIN_SNEAKER_BRIEF,
  TOKYO_VENUE_BRIEF,
} from '../../../apps/api/src/providers/qloo/insights-mock.ts';
import { runInsights } from '../../../apps/api/src/providers/qloo/insights.ts';
import * as wasm from './index.ts';

/** The API defaults to wasm. These oracles are the TypeScript engine. */
async function withTs<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.ENGINE;
  process.env.ENGINE = 'ts';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ENGINE;
    else process.env.ENGINE = previous;
  }
}

const PRICE = [{ param: 'filter.price_level.max', from: '3', to: '2' }];

function tsSample(brief: typeof DEFAULT_BRIEF) {
  const packet = provideEvidence(brief);
  const subs = deriveSubs(packet);
  return { packet, subs, points: ledgerPoints(subs) };
}

describe('wasm parity with the TypeScript engine', { concurrency: false }, () => {
  test('default brief is 71 with ledger 24/20/15/17/-5', () => {
    const ts = tsSample(DEFAULT_BRIEF);
    const scored = wasm.scoreSampleBrief(DEFAULT_BRIEF);
    assert.deepEqual(scored.subscores, ts.subs);
    assert.deepEqual(scored.points, ts.points);
    assert.deepEqual(scored.packet, ts.packet);
    assert.deepEqual(scored.points, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 });
    assert.deepEqual(wasm.deriveSubs(ts.packet), ts.subs);
    assert.deepEqual(wasm.ledgerPoints(ts.subs), ts.points);
    assert.deepEqual(wasm.displayScore(71, 5), displayScore(71, 5));
    assert.equal(wasm.engineConstants().frictionFactor, 0.4);
    assert.deepEqual(wasm.engineConstants().weights, { anchor: 30, cross: 25, local: 20, audience: 25 });
  });

  test('agent price diff re-scores 71 to 80', async () => {
    const brief = defaultBriefV2();
    const ts = await withTs(() => scoreEngine(applyDiffsToEngine(brief, PRICE)));
    const scored = wasm.rescoreParamDiffs(brief, PRICE);
    assert.equal(scored.baseline, 71);
    assert.equal(scored.total, 80);
    assert.equal(scored.predictedDelta, 9);
    assert.deepEqual(scored.points, ts.points);
    assert.equal(ts.total, 80);
  });

  test('Bangkok, Tokyo, and Berlin mock briefs match', async () => {
    const client = new QlooClient({ apiKey: '' });
    const cases = [
      [BANGKOK_SNACK_BRIEF, 69],
      [TOKYO_VENUE_BRIEF, 65],
      [BERLIN_SNEAKER_BRIEF, 37],
    ] as const;
    for (const [brief, total] of cases) {
      const ts = await withTs(() => runInsights(client, brief));
      const scored = wasm.scoreMockBrief(brief);
      assert.equal(scored.ledger.total, total);
      assert.deepEqual(scored.subscores, ts.subscores);
      assert.deepEqual(scored.ledger, ts.ledger);
      assert.deepEqual(scored.gaps, ts.gaps);
      assert.equal(scored.evidenceStrength, ts.evidenceStrength);
    }
  });

  test('null measurements stay gaps and LIMITED display rounds to 5', async () => {
    const input = {
      anchor: { source: 'mock:/v2/insights', groups: [{ rows: [{ affinity: null, contributions: [], evidenceRefs: ['target-0'] }] }] },
      cross: { source: 'mock:/v2/insights', groups: [] },
      local: { source: 'mock:/v2/insights', groups: [] },
      audience: {
        source: 'mock:/v2/insights',
        groups: [{ rows: [{ affinity: 0.5, contributions: [{ input: 'input-0', weight: 0.5, target: 'target-0' }], evidenceRefs: ['target-0'] }] }],
      },
      activeRefCount: 4,
    };
    const ts = scoreInsightMeasurements(input);
    const scored = wasm.scoreInsights(input);
    assert.deepEqual(scored, ts);
    assert.equal(scored.ledger.total, 13);
    assert.equal(scored.evidenceStrength, 'LIMITED');
    assert.equal(scored.subscores.anchor, null);

    const packet = provideEvidence(DEFAULT_BRIEF);
    packet.friction = null;
    assert.throws(() => deriveSubs(packet), /null signal/);
    assert.throws(() => wasm.deriveSubs(packet), /null signal/);
    assert.deepEqual(wasm.scorePacket(packet), await withTs(() => scorePacket(packet)));
    assert.deepEqual(wasm.displayScore(71, 1), displayScore(71, 1));
    assert.equal(displayScore(71, 1).text, '\u2248 70');
  });

  test('ENGINE=wasm is the default and ENGINE=ts matches it', async () => {
    const previous = process.env.ENGINE;
    try {
      delete process.env.ENGINE;
      assert.equal(engineBackend(), 'wasm');
      assert.deepEqual(adapterScoreSample(DEFAULT_BRIEF).points, {
        anchor: 24,
        cross: 20,
        local: 15,
        audience: 17,
        friction: -5,
        total: 71,
      });
      process.env.ENGINE = 'ts';
      assert.equal(engineBackend(), 'ts');
      assert.equal(adapterScoreSample(DEFAULT_BRIEF).points.total, 71);
      process.env.ENGINE = 'wasm';
      assert.equal(engineBackend(), 'wasm');
      const sample = adapterScoreSample(DEFAULT_BRIEF);
      assert.deepEqual(sample.points, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 });
      const price = rescoreParamDiffs(defaultBriefV2(), PRICE);
      assert.equal(price.baseline, 71);
      assert.equal(price.total, 80);
      assert.equal(price.predictedDelta, 9);
      const bangkok = await adapterScoreMock(BANGKOK_SNACK_BRIEF);
      const tokyo = await adapterScoreMock(TOKYO_VENUE_BRIEF);
      const berlin = await adapterScoreMock(BERLIN_SNEAKER_BRIEF);
      assert.deepEqual(
        [bangkok.ledger.total, tokyo.ledger.total, berlin.ledger.total],
        [69, 65, 37],
      );
    } finally {
      if (previous === undefined) delete process.env.ENGINE;
      else process.env.ENGINE = previous;
    }
  });
});
