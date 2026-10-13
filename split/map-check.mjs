import assert from 'node:assert/strict';
import { boundsFor, cardsFor, chosenPins, compareRows, selectLayers, toFeatureCollection } from './map.js';

const heat = (id, cells) => ({ kind: 'heatmap', id, name: id, cells });
const payload = {
  center: { lat: 34.0522, lng: -118.2437 },
  fits: {
    v1: heat('fits-v1', [{ id: 'a', lat: 34.0869, lng: -118.2702, weight: 0.5, label: 'Silver Lake' }]),
    v2: heat('fits-v2', [{ id: 'a', lat: 34.0869, lng: -118.2702, weight: 0.68, label: 'Silver Lake' }]),
  },
  friction: {
    v1: heat('friction-v1', [{ id: 'b', lat: 34.0736, lng: -118.4004, weight: 0.4, label: 'Beverly Hills' }]),
    v2: null,
  },
};

assert.equal(selectLayers(payload, { district: 'fits', version: 'both' }).length, 2);
assert.equal(selectLayers(payload, { district: 'friction', version: 'both' }).length, 1);
assert.equal(selectLayers(payload, { district: 'friction', version: 'v2' }).length, 0);
assert.equal(selectLayers(payload, { district: 'friction', version: 'v1' })[0].layer.cells[0].label, 'Beverly Hills');

const fc = toFeatureCollection(payload.fits.v1, 'heat', 'v1');
assert.deepEqual(fc.features[0].geometry.coordinates, [-118.2702, 34.0869]);
assert.equal(fc.features[0].properties.draw, 'heat');

const bounds = boundsFor(payload.center, [payload.fits.v1, payload.friction.v1]);
assert.ok(bounds[0][0] < -118.4);
assert.ok(bounds[1][0] > -118.24);

const pins = chosenPins(cardsFor('Los Angeles'));
assert.deepEqual(pins.map((pin) => pin.name), ['Silver Lake', 'Echo Park']);
assert.ok(pins[0].image.startsWith('data:image/svg+xml'));

const rows = compareRows(payload, 'fits');
assert.equal(rows[0].name, 'Silver Lake');
assert.equal(rows[0].v1, 0.5);
assert.equal(rows[0].v2, 0.68);

console.log('map-check ok');
