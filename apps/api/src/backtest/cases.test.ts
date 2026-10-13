import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACKTEST_CASES, affinitiesFrom, entitiesFrom, heatPoints, inCity, median, pickEntity } from './cases.ts';

describe('city-entry backtest', () => {
  it('sends the real cities and does not score the sample graph', () => {
    assert.deepEqual(
      BACKTEST_CASES.map((row) => row.city),
      ['New York', 'Tokyo', 'Tokyo', 'Reading, United Kingdom', 'Los Angeles'],
    );
    assert.deepEqual(
      BACKTEST_CASES.map((row) => row.outcome),
      ['stayed', 'stayed', 'stayed', 'left', 'left'],
    );
    for (const row of BACKTEST_CASES) {
      assert.ok(row.sources.length >= 2);
      assert.ok(row.sources.every((url) => url.startsWith('https://')));
      assert.equal(JSON.stringify(row).includes('sample'), false);
    }
    const reading = BACKTEST_CASES.find((row) => row.brand === 'Chick-fil-A');
    const losAngeles = BACKTEST_CASES.find((row) => row.brand === 'Fresh & Easy');
    assert.ok(reading && losAngeles);
    assert.equal(inCity(51.45, -0.97, reading.box), true);
    assert.equal(inCity(51.45, -0.97, losAngeles.box), false);
    assert.equal(inCity(34.05, -118.25, reading.box), false);
  });

  it('keeps derived names and city coordinates, not a fallback score', () => {
    const entity = pickEntity(
      entitiesFrom({
        results: [
          { entity_id: 'place-1', name: 'Reading', types: ['urn:entity:place'] },
          { entity_id: 'brand-1', name: 'Chick-fil-A', types: ['urn:entity:brand'] },
        ],
      }),
      'Chick-fil-A',
    );
    assert.equal(entity?.id, 'brand-1');
    assert.equal(median(affinitiesFrom({ results: { entities: [{ query: { affinity: 0.2 } }, { query: { affinity: 0.8 } }] } })), 0.5);
    const points = heatPoints({
      results: {
        heatmap: [
          { location: { latitude: 51.45, longitude: -0.97 }, query: { affinity: 0.4 } },
          { location: { latitude: 34.05, longitude: -118.24 }, query: { affinity: 0.9 } },
        ],
      },
    });
    const reading = BACKTEST_CASES.find((row) => row.brand === 'Chick-fil-A')!;
    const inside = points.filter((point) => inCity(point.lat, point.lng, reading.box));
    assert.equal(inside.length, 1);
    assert.equal(inside[0]?.weight, 0.4);
  });
});
