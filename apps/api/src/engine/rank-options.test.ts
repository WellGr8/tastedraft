import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankOptions as fromContracts } from '@tastedraft/contracts';
import { evidenceKey } from './score.ts';
import {
  RANK_RULE,
  caseStudyCallEstimate,
  leadingAudience,
  meanRank,
  optionScore,
  panelConfidence,
  rankOptions,
  realCityHit,
} from './rank-options.ts';

describe('rankOptions', () => {
  it('is the shared contracts function', () => {
    assert.equal(rankOptions, fromContracts);
    assert.equal(RANK_RULE.version, 'city-rank-2');
    assert.equal(RANK_RULE.lockedOn, '2026-10-14');
    assert.deepEqual(RANK_RULE.weights, { local: 60, heatmap: 35, popularity: 5 });
    assert.ok(RANK_RULE.weights.popularity < RANK_RULE.weights.local);
    assert.ok(RANK_RULE.weights.popularity < RANK_RULE.weights.heatmap);
  });

  it('keeps a missing part null and does not treat an empty option as zero', () => {
    assert.deepEqual(optionScore({ local: 1, heatmap: null, popularity: null }), {
      score: 60,
      parts: { local: 60, heatmap: null, popularity: null },
    });
    assert.equal(optionScore({ local: null, heatmap: null, popularity: null }).score, null);
    assert.equal(optionScore({ local: 1.2, heatmap: -0.1, popularity: Number.NaN }).score, null);
    const ranked = rankOptions([
      { id: 'empty', label: 'Empty', local: null, heatmap: null, popularity: null },
      { id: 'zero', label: 'Zero', local: 0, heatmap: 0, popularity: 0 },
    ]);
    assert.equal(ranked[0]?.id, 'zero');
    assert.equal(ranked[0]?.score, 0);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.rank, null);
    assert.equal(ranked[1]?.score, null);
  });

  it('shares a rank on a tie and keeps the caller order inside that tie', () => {
    const ranked = rankOptions([
      { id: 'a', label: 'A', local: 1, heatmap: null, popularity: null },
      { id: 'b', label: 'B', local: 1, heatmap: null, popularity: null },
      { id: 'c', label: 'C', local: 0.5, heatmap: null, popularity: null },
    ]);
    assert.deepEqual(ranked.map((item) => [item.id, item.rank, item.score]), [
      ['a', 1, 60],
      ['b', 1, 60],
      ['c', 3, 30],
    ]);
  });

  it('hits the top 2 for a success and the bottom 2 for a failure', () => {
    assert.equal(realCityHit(1, 5, 'positive'), true);
    assert.equal(realCityHit(2, 5, 'positive'), true);
    assert.equal(realCityHit(3, 5, 'positive'), false);
    assert.equal(realCityHit(3, 5, 'negative'), false);
    assert.equal(realCityHit(4, 5, 'negative'), true);
    assert.equal(realCityHit(5, 5, 'negative'), true);
    assert.equal(realCityHit(null, 5, 'positive'), null);
    assert.equal(realCityHit(0, 5, 'positive'), null);
    assert.equal(meanRank([1, 2, 5]), 2.67);
    assert.equal(meanRank([]), null);
  });

  it('uses the same evidence bands as the product scorer', () => {
    for (const count of [0, 1, 2, 3, 4, 5, 9]) {
      assert.equal(panelConfidence(count), evidenceKey(count));
    }
  });

  it('picks the strongest positive audience bucket and breaks ties by name', () => {
    const leading = leadingAudience([
      { dimension: 'age', bucket: '24_and_younger', value: 0.4 },
      { dimension: 'age', bucket: '25_to_29', value: 0.8 },
      { dimension: 'age', bucket: '35_to_44', value: 0.2 },
      { dimension: 'age', bucket: 'not_a_bucket', value: 0.99 },
      { dimension: 'gender', bucket: 'female', value: 0.2 },
      { dimension: 'gender', bucket: 'male', value: 0.2 },
    ]);
    assert.equal(leading.age, '25_to_29');
    assert.equal(leading.gender, 'female');
    const tied = leadingAudience([
      { dimension: 'age', bucket: '35_to_44', value: 0.5 },
      { dimension: 'age', bucket: '30_to_34', value: 0.5 },
      { dimension: 'gender', bucket: 'male', value: 0 },
    ]);
    assert.equal(tied.age, '30_to_34');
    assert.equal(tied.gender, null);
  });

  it('does not crown a large market over a smaller one with a stronger taste lift', () => {
    const ranked = rankOptions([
      { id: 'tokyo', label: 'Tokyo', local: 0.7, heatmap: 0.8, popularity: 0.95 },
      { id: 'osaka', label: 'Osaka', local: 0.55, heatmap: 0.5, popularity: 0.3 },
      { id: 'sapporo', label: 'Sapporo', local: 0.2, heatmap: 0.15, popularity: 0.7 },
    ]);
    assert.equal(ranked[0]?.id, 'osaka');
    assert.notEqual(ranked[0]?.id, 'tokyo');
    assert.equal(ranked[ranked.length - 1]?.id, 'sapporo');
    assert.ok((ranked.find((item) => item.id === 'osaka')?.score ?? 0) > (ranked.find((item) => item.id === 'tokyo')?.score ?? 0));
  });

  it('estimates 104 calls for eight briefs and five cities', () => {
    assert.equal(caseStudyCallEstimate(8, 5), 104);
    assert.equal(caseStudyCallEstimate(8, 4), 88);
    assert.equal(104 < 1000, true);
  });
});
