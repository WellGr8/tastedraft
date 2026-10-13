import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FallbackProvider } from './fallback.js';
import { createHttpClient } from './http.js';
import { MusicBrainzProvider } from './musicbrainz.js';
import { OSM_CENTER_RADIUS_M, OsmProvider } from './osm.js';
import { toSamplePacket, walkSignals } from './packet.js';
import { jsonResponse, loadFixture, mockFetch } from './test-support.js';
import { WikidataProvider } from './wikidata.js';

const BRIEF = {
  idea: 'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs',
  age: '18–25',
  city: 'Los Angeles',
  pos: 'Premium',
  refs: ['Aphex Twin', 'Comme des Garçons', 'Muji', 'Lost in Translation', 'Silver Lake', 'Totallymadeupbrandxyz'],
};

function openDataFetch(): { fetchImpl: typeof fetch; calls: URL[] } {
  const calls: URL[] = [];
  const entities = loadFixture('wikidata-entities.json') as { entities: Record<string, unknown> };
  const labels = loadFixture('wikidata-labels.json') as { entities: Record<string, unknown> };
  const searches: Record<string, string> = {
    'aphex twin': 'wikidata-search-aphex-twin.json',
    'comme des garçons': 'wikidata-search-comme-des-garcons.json',
    muji: 'wikidata-search-muji.json',
    'lost in translation': 'wikidata-search-lost-in-translation.json',
    'silver lake': 'wikidata-search-silver-lake.json',
    totallymadeupbrandxyz: 'wikidata-search-unknown.json',
  };
  const fetchImpl = mockFetch(async (url) => {
    calls.push(url);
    if (url.hostname === 'www.wikidata.org') {
      const action = url.searchParams.get('action');
      if (action === 'wbsearchentities') {
        const file = searches[(url.searchParams.get('search') ?? '').toLowerCase()];
        if (!file) throw new Error(`unexpected search ${url.searchParams.get('search')}`);
        return jsonResponse(loadFixture(file));
      }
      if (action === 'wbgetentities') {
        const ids = (url.searchParams.get('ids') ?? '').split('|').filter(Boolean);
        const source = (url.searchParams.get('props') ?? '').includes('claims') ? entities.entities : labels.entities;
        const picked: Record<string, unknown> = {};
        for (const id of ids) {
          if (!source[id]) throw new Error(`missing ${id}`);
          picked[id] = source[id];
        }
        return jsonResponse({ entities: picked });
      }
    }
    if (url.hostname === 'musicbrainz.org') {
      const query = (url.searchParams.get('query') ?? '').toLowerCase();
      if (url.pathname === '/ws/2/artist/') {
        if (query.includes('aphex')) return jsonResponse(loadFixture('musicbrainz-search-aphex-twin.json'));
        if (query.includes('totallymadeup')) return jsonResponse(loadFixture('musicbrainz-search-unknown.json'));
        throw new Error(`MusicBrainz should not have been asked about ${query}`);
      }
      if (url.pathname.includes('f22942a1-6f70-4f48-866e-238cb2308fbd')) {
        return jsonResponse(loadFixture('musicbrainz-artist-aphex-twin.json'));
      }
      throw new Error(`unexpected MusicBrainz path ${url.pathname}`);
    }
    if (url.hostname === 'nominatim.openstreetmap.org') {
      return jsonResponse(loadFixture('nominatim-los-angeles.json'));
    }
    if (url.hostname === 'overpass-api.de') {
      const data = url.searchParams.get('data') ?? '';
      assert.match(data, new RegExp(`around:${OSM_CENTER_RADIUS_M},34\\.0536923,-118\\.2427676`));
      if (data.includes('jewelry')) return jsonResponse(loadFixture('overpass-los-angeles-luxury.json'));
      return jsonResponse(loadFixture('overpass-los-angeles-indie.json'));
    }
    throw new Error(`live host blocked: ${url.hostname}`);
  });
  return { fetchImpl, calls };
}

describe('FallbackProvider', () => {
  it('merges recorded open-data facts and leaves unknown entities empty', async () => {
    const { fetchImpl, calls } = openDataFetch();
    const http = createHttpClient({ fetchImpl, minIntervalByHost: {} });
    const fallback = new FallbackProvider(
      new WikidataProvider({ http }),
      new MusicBrainzProvider(http),
      new OsmProvider(http),
    );
    const packet = await fallback.getEvidence(BRIEF);
    const byName = new Map(packet.refs.map((ref) => [ref.name, ref]));
    const aphex = byName.get('Aphex Twin');
    const cdg = byName.get('Comme des Garçons');
    const silver = byName.get('Silver Lake');
    const unknown = byName.get('Totallymadeupbrandxyz');
    assert.equal(packet.sourceId, 'open-data');
    assert.equal(aphex?.type.value, 'Artist');
    assert.equal(aphex?.status, 'found');
    assert.equal(aphex?.affinity.value, null);
    assert.match(aphex?.electronic.detail ?? '', /does not publish a 0–100 affinity|categorical/i);
    assert.equal(aphex?.entity.measurements.electronic, 34);
    assert.equal(cdg?.status, 'ambiguous');
    assert.equal(cdg?.entity.id, null);
    assert.equal(cdg?.entity.candidates.some((candidate) => candidate.id === 'Q1115170'), true);
    assert.equal(cdg?.affinity.value, null);
    assert.equal(byName.get('Muji')?.status, 'ambiguous');
    assert.equal(byName.get('Lost in Translation')?.status, 'ambiguous');
    assert.equal(silver?.type.value, 'Place');
    assert.equal(silver?.inBriefCity.value, true);
    assert.equal(unknown?.status, 'ambiguous');
    assert.equal(unknown?.entity.resolution, 'none');
    assert.equal(unknown?.affinity.value, null);
    assert.deepEqual(unknown?.entity.labels, []);
    assert.equal(packet.local.base.value, null);
    assert.equal(packet.audience.base.value, null);
    assert.equal(packet.friction.value, null);
    assert.equal(packet.crossAdjust.value, null);
    assert.equal(packet.signal.fashion.value, null);
    assert.equal(packet.local.signals.find((signal) => signal.id === 'osm.poi.indie')?.value, 61);
    assert.equal(packet.local.signals.find((signal) => signal.id === 'osm.poi.indie-share')?.status, 'limited');
    assert.equal(packet.mixed, true);
    const sample = toSamplePacket(packet);
    assert.equal(sample.refs.every((ref) => ref.affinity == null), true);
    assert.equal(sample.local.base, null);
    assert.equal(sample.audience.base, null);
    assert.equal(sample.friction, null);
    for (const signal of walkSignals(packet)) {
      assert.equal(typeof signal.source, 'string');
      assert.ok(signal.source.length > 0);
      assert.ok(signal.detail.length > 0);
      if (signal.status === 'ambiguous' || signal.status === 'failed') assert.equal(signal.value, null);
      assert.equal(signal.value === 71 || signal.value === 82 || signal.value === 86, false);
    }
    assert.equal(calls.every((url) => [
      'www.wikidata.org',
      'musicbrainz.org',
      'nominatim.openstreetmap.org',
      'overpass-api.de',
    ].includes(url.hostname)), true);
  });
});
