import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpClient } from './http.js';
import { MusicBrainzProvider } from './musicbrainz.js';
import { jsonResponse, loadFixture, mockFetch } from './test-support.js';

function musicBrainzFetch(bodyFor?: (url: URL) => unknown): typeof fetch {
  return mockFetch(async (url) => {
    if (url.hostname !== 'musicbrainz.org') throw new Error(`live host blocked: ${url.hostname}`);
    if (bodyFor) return jsonResponse(bodyFor(url));
    if (url.pathname === '/ws/2/artist/') {
      const query = (url.searchParams.get('query') ?? '').toLowerCase();
      if (query.includes('aphex')) return jsonResponse(loadFixture('musicbrainz-search-aphex-twin.json'));
      if (query.includes('comme')) return jsonResponse(loadFixture('musicbrainz-search-comme-des-garcons.json'));
      if (query.includes('totallymadeup')) return jsonResponse(loadFixture('musicbrainz-search-unknown.json'));
      throw new Error(`unexpected MusicBrainz search: ${query}`);
    }
    if (url.pathname.includes('/ws/2/artist/f22942a1-6f70-4f48-866e-238cb2308fbd')) {
      return jsonResponse(loadFixture('musicbrainz-artist-aphex-twin.json'));
    }
    throw new Error(`unexpected MusicBrainz url ${url.pathname}`);
  });
}

function provider(fetchImpl: typeof fetch): MusicBrainzProvider {
  return new MusicBrainzProvider(createHttpClient({ fetchImpl, minIntervalByHost: {} }));
}

describe('MusicBrainzProvider', () => {
  it('records genre tag votes and does not treat the search score as affinity', async () => {
    const mb = provider(musicBrainzFetch());
    const packet = await mb.getEvidence({
      idea: 'underground electronic',
      age: '18–25',
      city: 'Los Angeles',
      pos: 'Premium',
      refs: ['Aphex Twin'],
    });
    const ref = packet.refs[0];
    assert.ok(ref);
    assert.equal(ref.status, 'found');
    assert.equal(ref.type.value, 'Artist');
    assert.equal(ref.entity.id, 'f22942a1-6f70-4f48-866e-238cb2308fbd');
    assert.equal(ref.affinity.value, null);
    assert.equal(ref.affinity.status, 'limited');
    assert.equal(ref.electronic.value, null);
    assert.equal(ref.entity.measurements.electronic, 34);
    const votes = packet.signals.find((signal) => signal.id.startsWith('musicbrainz.tag.'));
    assert.equal(votes?.value, 34);
    assert.equal(votes?.status, 'found');
    assert.match(votes?.detail ?? '', /not a 0–100 taste affinity/);
    assert.equal(packet.signals.some((signal) => signal.value === 100), false);
    assert.equal(packet.audience.base.value, null);
  });

  it('does not invent an artist when the search is empty', async () => {
    const mb = provider(musicBrainzFetch());
    const [entity] = await mb.resolveEntities(['Totallymadeupbrandxyz']);
    assert.equal(entity?.status, 'ambiguous');
    assert.equal(entity?.resolution, 'none');
    assert.equal(entity?.id, null);
    assert.deepEqual(entity?.labels, []);
  });

  it('stays ambiguous when two exact names have close search scores', async () => {
    const recorded = loadFixture('musicbrainz-search-aphex-twin.json') as {
      artists: Array<{ score?: number; name?: string }>;
    };
    const artists = recorded.artists.map((artist, index) => (
      index === 1 ? { ...artist, score: 90 } : artist
    ));
    const mb = provider(musicBrainzFetch((url) => {
      if (url.pathname === '/ws/2/artist/') return { ...recorded, artists };
      throw new Error('lookup should not run when the name is ambiguous');
    }));
    const [entity] = await mb.resolveEntities(['Aphex Twin']);
    assert.equal(entity?.status, 'ambiguous');
    assert.equal(entity?.resolution, 'collision');
    assert.equal(entity?.id, null);
  });
});
