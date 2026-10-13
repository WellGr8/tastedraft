import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpClient } from './http.js';
import { jsonResponse, loadFixture, mockFetch } from './test-support.js';
import { walkSignals } from './packet.js';
import { WikidataProvider } from './wikidata.js';

function wikidataFetch(overrides?: { status?: number }): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
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
    calls.push(url.toString());
    if (url.hostname !== 'www.wikidata.org') throw new Error(`live host blocked: ${url.hostname}`);
    if (overrides?.status) return jsonResponse({ error: 'no' }, overrides.status);
    const action = url.searchParams.get('action');
    if (action === 'wbsearchentities') {
      const query = (url.searchParams.get('search') ?? '').toLowerCase();
      const file = searches[query];
      if (!file) throw new Error(`unexpected Wikidata search: ${query}`);
      return jsonResponse(loadFixture(file));
    }
    if (action === 'wbgetentities') {
      const ids = (url.searchParams.get('ids') ?? '').split('|').filter(Boolean);
      const props = url.searchParams.get('props') ?? '';
      const source = props.includes('claims') ? entities.entities : labels.entities;
      const picked: Record<string, unknown> = {};
      for (const id of ids) {
        const row = source[id];
        if (!row) throw new Error(`fixture has no ${id} for props=${props}`);
        picked[id] = row;
      }
      return jsonResponse({ entities: picked });
    }
    throw new Error(`unexpected Wikidata action ${action}`);
  });
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch): WikidataProvider {
  return new WikidataProvider({
    http: createHttpClient({ fetchImpl, minIntervalByHost: {}, cache: undefined }),
  });
}

describe('WikidataProvider', () => {
  it('resolves an exact label and keeps genre matches categorical', async () => {
    const { fetchImpl } = wikidataFetch();
    const [entity] = await provider(fetchImpl).resolveEntities(['Aphex Twin']);
    assert.ok(entity);
    assert.equal(entity.status, 'found');
    assert.equal(entity.id, 'Q223161');
    assert.equal(entity.type.value, 'Artist');
    assert.equal(entity.type.status, 'found');
    assert.ok(entity.labels.includes('electronic music'));
    assert.match(entity.image ?? '', /Aphextwin1\.jpg/);
    const packet = await provider(fetchImpl).getEvidence({
      idea: 'underground electronic',
      age: '18–25',
      city: 'Los Angeles',
      pos: 'Premium',
      refs: ['Aphex Twin'],
    });
    const ref = packet.refs[0];
    assert.ok(ref);
    assert.equal(ref.affinity.value, null);
    assert.equal(ref.affinity.status, 'limited');
    assert.equal(ref.electronic.value, null);
    assert.equal(ref.facets[0]?.matchedLabel, 'electronic music');
    assert.equal(packet.audience.base.value, null);
    assert.equal(packet.local.base.value, null);
  });

  it('does not pick Rei Kawakubo, and does not guess between the brand and the song', async () => {
    const { fetchImpl } = wikidataFetch();
    const [entity] = await provider(fetchImpl).resolveEntities(['Comme des Garçons']);
    assert.ok(entity);
    assert.equal(entity.status, 'ambiguous');
    assert.equal(entity.id, null);
    assert.equal(entity.candidates.some((candidate) => candidate.id === 'Q1115170'), true);
    assert.equal(entity.candidates.some((candidate) => candidate.name === 'Rei Kawakubo'), false);
  });

  it('leaves colliding and unknown names unresolved', async () => {
    const { fetchImpl } = wikidataFetch();
    const [muji, lost, silver, unknown] = await provider(fetchImpl).resolveEntities([
      'Muji',
      'Lost in Translation',
      'Silver Lake',
      'Totallymadeupbrandxyz',
    ]);
    assert.equal(muji?.status, 'ambiguous');
    assert.equal(muji?.resolution, 'collision');
    assert.equal(muji?.id, null);
    assert.equal(lost?.status, 'ambiguous');
    assert.ok((lost?.candidates.length ?? 0) > 1);
    assert.equal(silver?.status, 'ambiguous');
    assert.equal(unknown?.status, 'ambiguous');
    assert.equal(unknown?.resolution, 'none');
    assert.deepEqual(unknown?.labels, []);
    const packet = await provider(fetchImpl).getEvidence({
      idea: 'japanese minimal streetwear electronic',
      age: '18–25',
      city: 'Los Angeles',
      pos: 'Premium',
      refs: ['Totallymadeupbrandxyz'],
    });
    for (const signal of walkSignals(packet)) {
      if (signal.status === 'ambiguous' || signal.status === 'failed') assert.equal(signal.value, null);
    }
    assert.equal(packet.refs[0]?.affinity.value, null);
  });

  it('uses the brief city to separate Silver Lake, Los Angeles from other Silver Lakes', async () => {
    const { fetchImpl } = wikidataFetch();
    const [entity] = await provider(fetchImpl).resolveEntities(['Silver Lake'], { city: 'Los Angeles' });
    assert.equal(entity?.id, 'Q1143552');
    assert.equal(entity?.type.value, 'Place');
    assert.ok(entity?.locatedIn.includes('Los Angeles'));
    const packet = await provider(fetchImpl).getEvidence({
      idea: 'streetwear',
      age: '18–25',
      city: 'Los Angeles',
      pos: 'Premium',
      refs: ['Silver Lake'],
    });
    assert.equal(packet.refs[0]?.inBriefCity.value, true);
    assert.equal(packet.refs[0]?.inBriefCity.status, 'found');
    assert.equal(packet.local.base.value, null);
  });

  it('marks an HTTP failure as failed and does not invent an entity', async () => {
    const { fetchImpl, calls } = wikidataFetch({ status: 503 });
    const [entity] = await provider(fetchImpl).resolveEntities(['Aphex Twin']);
    assert.equal(entity?.status, 'failed');
    assert.equal(entity?.id, null);
    assert.equal(calls.length, 1);
  });
});
