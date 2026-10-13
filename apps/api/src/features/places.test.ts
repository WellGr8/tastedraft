import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaLabel, cityBox, insideCity } from './places.ts';

describe('city boxes', () => {
  it('keeps Shimokitazawa and drops a point south of Tokyo', () => {
    const tokyo = cityBox('Tokyo');
    assert.equal(insideCity(35.661, 139.668, tokyo), true);
    assert.equal(insideCity(33.16, 139.9, tokyo), false);
    assert.equal(insideCity(34.09, -118.27, cityBox('Los Angeles')), true);
    assert.equal(insideCity(33.16, 139.9, null), true);
  });

  it('names a Tokyo cell from the gazetteer and never returns coordinates', () => {
    const label = areaLabel({
      lat: 35.661,
      lng: 139.668,
      city: 'Tokyo',
      neighborhoods: ['33.16, 139.90'],
      nearbyNames: [],
    });
    assert.equal(label, 'Shimokitazawa');
    assert.equal(
      areaLabel({
        lat: 34.09,
        lng: -118.27,
        city: 'Los Angeles',
        neighborhoods: ['Silver Lake'],
        nearbyNames: ['Counter'],
      }),
      'Silver Lake',
    );
    const near = areaLabel({
      lat: 48.1,
      lng: 11.5,
      city: 'Munich',
      neighborhoods: [],
      nearbyNames: ['Viktualienmarkt'],
    });
    assert.equal(near, 'Near Viktualienmarkt');
    assert.doesNotMatch(near, /area\s+\d/i);
  });

  it('groups a chome label to the nearest named district', () => {
    assert.equal(
      areaLabel({
        lat: 35.6598,
        lng: 139.7006,
        city: 'Tokyo',
        neighborhoods: ['Shibuya 1-chome'],
        nearbyNames: ['NEWoMan Shinjuku'],
      }),
      'Shibuya',
    );
  });
});
