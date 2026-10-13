import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpClient } from './http.js';
import { OSM_CENTER_RADIUS_M, OsmProvider } from './osm.js';
import { jsonResponse, loadFixture, mockFetch } from './test-support.js';

function osmFetch(options?: { luxuryStatus?: number }): { fetchImpl: typeof fetch; calls: URL[] } {
  const calls: URL[] = [];
  const fetchImpl = mockFetch(async (url) => {
    calls.push(url);
    if (url.hostname === 'nominatim.openstreetmap.org') {
      const query = url.searchParams.get('q');
      if (query === 'Los Angeles') return jsonResponse(loadFixture('nominatim-los-angeles.json'));
      if (query === 'Notarealcityxyz') return jsonResponse(loadFixture('nominatim-unknown.json'));
      throw new Error(`unexpected Nominatim query ${query}`);
    }
    if (url.hostname === 'overpass-api.de') {
      const data = url.searchParams.get('data') ?? '';
      assert.match(data, new RegExp(`around:${OSM_CENTER_RADIUS_M},34\\.0536923,-118\\.2427676`));
      if (data.includes('shop"="jewelry')) {
        if (options?.luxuryStatus) return jsonResponse({ error: true }, options.luxuryStatus);
        return jsonResponse(loadFixture('overpass-los-angeles-luxury.json'));
      }
      if (data.includes('shop"="music')) return jsonResponse(loadFixture('overpass-los-angeles-indie.json'));
      throw new Error(`unexpected Overpass query: ${data}`);
    }
    throw new Error(`live host blocked: ${url.hostname}`);
  });
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch): OsmProvider {
  return new OsmProvider(createHttpClient({ fetchImpl, minIntervalByHost: {} }));
}

describe('OsmProvider', () => {
  it('returns recorded POI counts and does not pretend they are a taste score', async () => {
    const { fetchImpl } = osmFetch();
    const packet = await provider(fetchImpl).getEvidence({
      idea: 'streetwear',
      age: '18–25',
      city: 'Los Angeles',
      pos: 'Premium',
      refs: ['Silver Lake'],
    });
    assert.equal(packet.local.base.value, null);
    assert.equal(packet.local.base.status, 'limited');
    assert.equal(packet.audience.base.value, null);
    const indie = packet.local.signals.find((signal) => signal.id === 'osm.poi.indie');
    const luxury = packet.local.signals.find((signal) => signal.id === 'osm.poi.luxury');
    const share = packet.local.signals.find((signal) => signal.id === 'osm.poi.indie-share');
    assert.equal(indie?.value, 61);
    assert.equal(indie?.status, 'found');
    assert.equal(luxury?.value, 29);
    assert.equal(luxury?.status, 'found');
    assert.equal(share?.value, 68);
    assert.equal(share?.status, 'limited');
    assert.match(share?.detail ?? '', /Proxy only/);
    assert.equal(packet.refs[0]?.status, 'ambiguous');
  });

  it('does not call Overpass when the city is unknown', async () => {
    const { fetchImpl, calls } = osmFetch();
    const { signals } = await provider(fetchImpl).localSignals('Notarealcityxyz');
    assert.equal(signals[0]?.status, 'ambiguous');
    assert.equal(signals[0]?.value, null);
    assert.equal(calls.some((url) => url.hostname === 'overpass-api.de'), false);
  });

  it('does not build the proxy share when a count request fails', async () => {
    const { fetchImpl } = osmFetch({ luxuryStatus: 504 });
    const { signals } = await provider(fetchImpl).localSignals('Los Angeles');
    const luxury = signals.find((signal) => signal.id === 'osm.poi.luxury');
    const share = signals.find((signal) => signal.id === 'osm.poi.indie-share');
    assert.equal(luxury?.status, 'failed');
    assert.equal(luxury?.value, null);
    assert.equal(share, undefined);
  });
});
