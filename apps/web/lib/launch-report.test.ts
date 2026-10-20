import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLaunchReport, neighborhoodBars, personaMoves } from './launch-report.ts';

describe('launch report', () => {
  it('labels the least crowded bar as the best bet and the strongest other crowded bar as the safe market', () => {
    const bars = neighborhoodBars([
      { label: 'Shimokitazawa', weight: 0.84 },
      { label: 'Koenji', weight: 0.71 },
      { label: 'Shibuya', weight: 0.66 },
    ]);
    assert.deepEqual(
      bars.map((bar) => [bar.label, bar.value, bar.badge]),
      [
        ['Shimokitazawa', 84, 'safe-market'],
        ['Koenji', 71, null],
        ['Shibuya', 66, 'best-bet'],
      ],
    );
    assert.equal(bars.some((bar) => bar.label === bar.label.toUpperCase() && bar.label.length > 3), false);
  });

  it('counts a flip only when fit crosses 70', () => {
    const moves = personaMoves([
      { label: 'Tokyo 18–25', before: 48, after: 70, anchors: [{ name: 'Aphex Twin' }, { name: 'Boards of Canada' }] },
      { label: 'Tokyo 26–35', before: 47, after: 57, anchors: [{ name: 'Boards of Canada' }, { name: 'Shimokitazawa' }] },
      { label: 'Tokyo 36–45', before: 52, after: 54, anchors: [{ name: 'Muji' }] },
    ]);
    assert.equal(moves.filter((move) => move.flipped).length, 1);
    assert.equal(moves.some((move) => move.label === 'Tokyo 36–45'), false);
    const report = buildLaunchReport({
      before: 52,
      after: 79,
      plan: null,
      people: [
        { label: 'Tokyo 18–25', before: 48, after: 70, anchors: [{ name: 'Aphex Twin' }, { name: 'Boards of Canada' }] },
      ],
      areas: [{ label: 'Shimokitazawa', weight: 0.84 }],
      costLabel: '$10,400',
    });
    assert.equal(report.flipCount, 1);
    assert.equal(report.delta, 27);
    assert.doesNotMatch(report.action, /Round \d/);
    assert.match(report.method.join(' '), /Not a sales forecast/);
    assert.match(report.method.join(' '), /\$10,400/);
  });
});
