import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpClient } from './http.js';
import { QLOO_API_HEADER, QLOO_BASE_URL, QlooProvider } from './qloo.js';
import { walkSignals } from './packet.js';
import { jsonResponse, loadFixture, mockFetch } from './test-support.js';
import { createEvidenceProvider } from './create.js';

const BRIEF = {
  idea: 'underground electronic',
  age: '18–25',
  city: 'Los Angeles',
  pos: 'Premium',
  refs: ['Aphex Twin'],
};

function qlooFetch(insightsForEntity: unknown): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = mockFetch(async (url, init) => {
    urls.push(`${url.pathname}?${url.searchParams.toString()}`);
    if (url.origin !== QLOO_BASE_URL) throw new Error(`unexpected origin ${url.origin}`);
    const headers = new Headers(init?.headers);
    if (headers.get(QLOO_API_HEADER) !== 'test-key') throw new Error('missing X-Api-Key');
    if (url.pathname === '/search') return jsonResponse(loadFixture('qloo-search.synthetic.json'));
    if (url.pathname === '/v2/tags') return jsonResponse(loadFixture('qloo-tags.synthetic.json'));
    if (url.pathname === '/v2/insights') {
      const type = url.searchParams.get('filter.type');
      if (type === 'urn:entity:place') return jsonResponse(loadFixture('qloo-insights-places.synthetic.json'));
      if (type === 'urn:entity:brand') return jsonResponse(loadFixture('qloo-insights-no-affinity.synthetic.json'));
      if (url.searchParams.get('filter.results.entities')) return jsonResponse(insightsForEntity);
      throw new Error(`unexpected insights ${url.searchParams.toString()}`);
    }
    throw new Error(`unexpected path ${url.pathname}`);
  });
  return { fetchImpl, urls };
}

function provider(fetchImpl: typeof fetch): QlooProvider {
  return new QlooProvider({
    apiKey: 'test-key',
    http: createHttpClient({ fetchImpl, minIntervalByHost: {} }),
  });
}

describe('QlooProvider', () => {
  it('stays disabled and does not call the network without a key', async () => {
    let calls = 0;
    const qloo = new QlooProvider({
      http: createHttpClient({
        minIntervalByHost: {},
        fetchImpl: mockFetch(async () => {
          calls += 1;
          throw new Error('network');
        }),
      }),
    });
    const packet = await qloo.getEvidence(BRIEF);
    assert.equal(qloo.isEnabled(), false);
    assert.equal(calls, 0);
    assert.equal(packet.sourceId, 'none');
    assert.equal(packet.refs[0]?.status, 'failed');
    assert.match(packet.refs[0]?.type.detail ?? '', /QLOO_API_KEY/);
    assert.equal(packet.refs[0]?.affinity.value, null);
  });

  it('scales an unverified query.affinity and ignores popularity', async () => {
    const { fetchImpl, urls } = qlooFetch(loadFixture('qloo-insights-affinity.synthetic.json'));
    const packet = await provider(fetchImpl).getEvidence(BRIEF);
    const ref = packet.refs[0];
    assert.equal(packet.sourceId, 'qloo');
    assert.equal(ref?.type.value, 'Artist');
    assert.equal(ref?.entity.id, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
    assert.equal(ref?.electronic.value, 82);
    assert.equal(ref?.electronic.status, 'found');
    assert.equal(ref?.electronic.unverifiedField, true);
    assert.equal(ref?.affinity.value, 82);
    assert.equal(packet.local.base.value, null);
    assert.equal(packet.audience.base.value, null);
    assert.equal(packet.audience.base.status, 'limited');
    const place = packet.local.signals.find((signal) => signal.name === 'Silver Lake');
    assert.equal(place?.status, 'found');
    assert.equal(packet.signals.some((signal) => signal.value === 0.99 || signal.value === 0.5), false);
    assert.ok(urls.some((url) => url.startsWith('/search?')));
    assert.ok(urls.some((url) => url.startsWith('/v2/tags?')));
    assert.ok(urls.some((url) => url.includes('filter.type=urn%3Aentity%3Aartist') || url.includes('filter.type=urn:entity:artist')));
    assert.ok(urls.some((url) => url.includes('24_and_younger')));
    assert.equal(urls.some((url) => url.includes('heatmap') || url.includes('recommendation')), false);
    for (const signal of walkSignals(packet)) {
      if (signal.status === 'ambiguous' || signal.status === 'failed') assert.equal(signal.value, null);
    }
  });

  it('does not turn properties.popularity into an affinity when query.affinity is missing', async () => {
    const { fetchImpl } = qlooFetch(loadFixture('qloo-insights-no-affinity.synthetic.json'));
    const packet = await provider(fetchImpl).getEvidence(BRIEF);
    const facet = packet.refs[0]?.electronic;
    assert.equal(facet?.value, null);
    assert.equal(facet?.status, 'ambiguous');
    assert.match(facet?.detail ?? '', /popularity/);
    assert.equal(facet?.unverifiedField, true);
    assert.equal(packet.refs[0]?.affinity.value, null);
  });

  it('rejects an affinity outside 0–1 and 0–100', async () => {
    const body = loadFixture('qloo-insights-affinity.synthetic.json') as {
      results: { entities: Array<{ query: { affinity: number } }> };
    };
    const entity = body.results.entities[0];
    assert.ok(entity);
    entity.query.affinity = 150;
    const packet = await provider(qlooFetch(body).fetchImpl).getEvidence(BRIEF);
    assert.equal(packet.refs[0]?.electronic.value, null);
    assert.equal(packet.refs[0]?.electronic.status, 'ambiguous');
  });

  it('treats search HTTP 404 as an unknown entity', async () => {
    const urls: string[] = [];
    const fetchImpl = mockFetch(async (url, init) => {
      urls.push(url.pathname);
      if (new Headers(init?.headers).get(QLOO_API_HEADER) !== 'test-key') throw new Error('key');
      if (url.pathname === '/search') return jsonResponse({ success: false }, 404);
      if (url.pathname === '/v2/tags') return jsonResponse(loadFixture('qloo-tags.synthetic.json'));
      if (url.pathname === '/v2/insights') return jsonResponse({ success: true, results: { entities: [] } });
      throw new Error(url.pathname);
    });
    const packet = await provider(fetchImpl).getEvidence(BRIEF);
    assert.equal(packet.refs[0]?.status, 'ambiguous');
    assert.equal(packet.refs[0]?.affinity.value, null);
    assert.equal(urls.filter((path) => path === '/v2/insights').length > 0, true);
    assert.equal(urls.some((path) => path.includes('heatmap')), false);
  });
});

describe('createEvidenceProvider', () => {
  it('uses Qloo only when a key is set', () => {
    assert.equal(createEvidenceProvider({ env: {} }).id, 'open-data');
    assert.equal(createEvidenceProvider({ env: { QLOO_API_KEY: '  ' } }).id, 'open-data');
    assert.equal(createEvidenceProvider({ env: { QLOO_API_KEY: 'test-key' } }).id, 'qloo');
  });
});
