import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { QlooEnvelope, QlooInsightsParams, QlooResult, QlooSearchParams } from '../providers/qloo/client.ts';
import { JAPAN_CITIES, LAUNCH_CASES, US_CITIES, citiesFor } from './cases.ts';
import { callEstimate, needsLiveFixture } from './fixture.ts';
import { RANK_RULE } from '../engine/rank-options.ts';
import { assertDerivedFixture, probeLaunch, type LaunchProbeClient } from './probe.ts';

function ok(body: unknown): QlooResult {
  return { ok: true, status: 200, mode: 'mock', url: '/mock', cached: false, body: body as QlooEnvelope };
}

function fail(status: number): QlooResult {
  return { ok: false, status, mode: 'live', url: '/mock', timedOut: false, message: 'secret body' };
}

function entity(id: string, name: string, type: string, affinity?: number, popularity?: number): Record<string, unknown> {
  const row: Record<string, unknown> = { name, types: [type] };
  row.entity_id = id;
  if (affinity != null) row.query = { affinity };
  if (popularity != null) row.popularity = popularity;
  return row;
}

const CENTERS: Record<string, { lat: number; lng: number }> = {
  Tokyo: { lat: 35.68, lng: 139.76 },
  Osaka: { lat: 34.68, lng: 135.5 },
  Kyoto: { lat: 35.01, lng: 135.75 },
  Fukuoka: { lat: 33.59, lng: 130.4 },
  Sapporo: { lat: 43.06, lng: 141.35 },
  'New York': { lat: 40.75, lng: -73.98 },
  'Los Angeles': { lat: 34.05, lng: -118.25 },
  Chicago: { lat: 41.88, lng: -87.63 },
  Miami: { lat: 25.77, lng: -80.19 },
  Boston: { lat: 42.36, lng: -71.06 },
};

type Mode = 'boost-real' | 'bury-real' | 'middle' | 'no-neighbors';

function affinityFor(city: string, real: string, mode: Mode): number {
  if (mode === 'boost-real' || mode === 'no-neighbors') return city === real ? 0.9 : 0.2;
  if (mode === 'bury-real') return city === real ? 0.1 : 0.8;
  const order = ['Tokyo', 'Osaka', 'Kyoto', 'Fukuoka', 'Sapporo'];
  return [0.5, 0.9, 0.8, 0.2, 0.1][order.indexOf(city)] ?? 0.2;
}

function standIn(mode: Mode, options?: { rejectTrendsOnce?: boolean }): LaunchProbeClient & { insightsSeen: QlooInsightsParams[] } {
  const insightsSeen: QlooInsightsParams[] = [];
  let rejected = false;
  return {
    insightsSeen,
    async search(params: QlooSearchParams) {
      return ok({
        success: true,
        results: { entities: [entity('subject-1', String(params.query), String(params.types))] },
      });
    },
    async insights(params: QlooInsightsParams) {
      insightsSeen.push(params);
      const type = String(params.filter?.type ?? '');
      if (options?.rejectTrendsOnce && !rejected && params.extra?.['bias.trends'] && type === 'urn:entity:place') {
        rejected = true;
        return fail(400);
      }
      if (type === 'urn:demographics') {
        return ok({
          success: true,
          results: {
            demographics: [{
              query: {
                age: { '24_and_younger': 0.2, '25_to_29': 0.8 },
                gender: { female: 0.7, male: 0.3 },
              },
            }],
          },
        });
      }
      const city = params.filter?.location && typeof params.filter.location === 'object' && 'query' in params.filter.location
        ? String(params.filter.location.query)
        : '';
      if (type === 'urn:heatmap') {
        const center = CENTERS[city] ?? { lat: 0, lng: 0 };
        const affinity = affinityFor(city, '', mode);
        return ok({
          success: true,
          results: {
            heatmap: [{
              location: { latitude: center.lat, longitude: center.lng },
              query: { affinity, popularity_affinity: affinity },
            }],
          },
        });
      }
      if (type === 'urn:entity:place') {
        const affinity = affinityFor(city, '', mode);
        return ok({
          success: true,
          results: { entities: [entity('place-1', `Place ${city}`, 'urn:entity:place', affinity, affinity)] },
        });
      }
      const neighbors = mode === 'no-neighbors'
        ? []
        : [
          entity('n1', 'Neighbor One', type, 0.8),
          entity('n2', 'Neighbor Two', type, 0.7),
          entity('n3', 'Neighbor Three', type, 0.6),
          entity('n4', 'Neighbor Four', type, 0.5),
          entity('n5', 'Neighbor Five', type, 0.1),
        ];
      return ok({
        success: true,
        results: { entities: [entity('subject-1', 'Subject', type, 0.99), ...neighbors] },
      });
    },
  };
}

function withReal(mode: Mode, real: string, options?: { rejectTrendsOnce?: boolean }) {
  const client = standIn(mode, options);
  const original = client.insights.bind(client);
  client.insights = async (params) => {
    const type = String(params.filter?.type ?? '');
    if (type === 'urn:heatmap' || type === 'urn:entity:place') {
      const city = params.filter?.location && typeof params.filter.location === 'object' && 'query' in params.filter.location
        ? String(params.filter.location.query)
        : '';
      const affinity = affinityFor(city, real, mode);
      if (options?.rejectTrendsOnce && type === 'urn:entity:place' && params.extra?.['bias.trends'] && !(client as { rejected?: boolean }).rejected) {
        (client as { rejected?: boolean }).rejected = true;
        client.insightsSeen.push(params);
        return fail(400);
      }
      client.insightsSeen.push(params);
      if (type === 'urn:heatmap') {
        const center = CENTERS[city] ?? { lat: 0, lng: 0 };
        return ok({
          success: true,
          results: {
            heatmap: [{
              location: { latitude: center.lat, longitude: center.lng },
              query: { affinity, popularity_affinity: affinity },
            }],
          },
        });
      }
      return ok({
        success: true,
        results: { entities: [entity('place-1', `Place ${city}`, 'urn:entity:place', affinity, affinity)] },
      });
    }
    return original(params);
  };
  return client;
}

const soldOut = LAUNCH_CASES[0]!;
const left = LAUNCH_CASES.find((row) => row.id === 'forever-21-tokyo-2009')!;
const film = LAUNCH_CASES.find((row) => row.searchType === 'movie')!;

describe('locked city lists', () => {
  it('keeps five cities per region and puts the real city on that list', () => {
    assert.equal(JAPAN_CITIES.length, 5);
    assert.equal(US_CITIES.length, 5);
    assert.deepEqual(JAPAN_CITIES.map((option) => option.city), ['Tokyo', 'Osaka', 'Kyoto', 'Fukuoka', 'Sapporo']);
    assert.deepEqual(US_CITIES.map((option) => option.city), ['New York', 'Los Angeles', 'Chicago', 'Miami', 'Boston']);
    assert.equal(LAUNCH_CASES.length, 8);
    assert.equal(callEstimate(), 104);
    const domains = new Set(LAUNCH_CASES.map((row) => row.domain));
    for (const domain of ['music', 'fashion', 'food', 'beauty', 'games', 'film']) {
      assert.equal(domains.has(domain as 'music'), true);
    }
    for (const row of LAUNCH_CASES) {
      assert.equal(citiesFor(row.region).some((option) => option.city === row.city), true);
      assert.equal(row.priceLevel === 1 || row.priceLevel === 3, true);
      assert.equal(row.sources.length >= 2, true);
    }
  });
});

describe('probeLaunch', () => {
  it('ranks the real city first when that city is the strongest taste fit', async () => {
    const client = withReal('boost-real', soldOut.city);
    const study = await probeLaunch(client, soldOut);
    assert.equal(study.realRank, 1);
    assert.equal(study.realScore, 53);
    assert.equal(study.matched, true);
    assert.equal(study.scored, true);
    assert.equal(study.confidence, 'HIGH');
    assert.equal(study.referenceCount, 5);
    assert.deepEqual(study.references, [soldOut.query, 'Neighbor One', 'Neighbor Two', 'Neighbor Three', 'Neighbor Four']);
    assert.equal(study.audience.age, '25_to_29');
    assert.equal(study.audience.gender, 'female');
    assert.equal(study.audience.location, 'Tokyo');
    assert.equal(study.derived.qlooCalls, 13);
    assert.equal(study.cities[0]?.city, 'Tokyo');
    assert.equal(study.cities.filter((city) => city.rank === 2).length, 4);
    const placeCalls = client.insightsSeen.filter((params) => params.filter?.type === 'urn:entity:place');
    assert.equal(placeCalls.length, 5);
    for (const params of placeCalls) {
      const price = params.filter?.price_level;
      assert.equal(price && typeof price === 'object' && 'max' in price ? price.max : null, soldOut.priceLevel);
      assert.equal(params.extra?.['bias.trends'], RANK_RULE.trends);
      const demo = params.signal?.demographics;
      assert.equal(demo && typeof demo === 'object' && 'age' in demo ? demo.age : null, '25_to_29');
      const entities = JSON.stringify(params.signal ?? null);
      assert.equal(entities.includes('subject-1'), true);
      assert.equal(entities.includes('n5'), false);
    }
    const text = JSON.stringify(study);
    assertDerivedFixture(text);
    assert.equal(text.includes('subject-1'), false);
    assert.equal(text.includes('place-1'), false);
  });

  it('ranks a later exit last when the launch city is the weakest fit', async () => {
    const study = await probeLaunch(withReal('bury-real', left.city), left);
    assert.equal(study.realRank, 5);
    assert.equal(study.realScore, 49);
    assert.equal(study.matched, true);
    assert.equal(study.cities.at(-1)?.city, 'Tokyo');
    const prices = withReal('bury-real', left.city);
    await probeLaunch(prices, left);
    for (const params of prices.insightsSeen.filter((item) => item.filter?.type === 'urn:entity:place')) {
      const price = params.filter?.price_level;
      assert.equal(price && typeof price === 'object' && 'max' in price ? price.max : null, 1);
    }
  });

  it('counts a middle rank as a miss for a sellout', async () => {
    const study = await probeLaunch(withReal('middle', soldOut.city), soldOut);
    assert.equal(study.realRank, 3);
    assert.equal(study.matched, false);
  });

  it('stays LIMITED when only the subject resolves', async () => {
    const study = await probeLaunch(withReal('no-neighbors', soldOut.city), soldOut);
    assert.equal(study.referenceCount, 1);
    assert.equal(study.confidence, 'LIMITED');
    assert.equal(study.realRank, 1);
    assert.equal(study.matched, true);
  });

  it('retries a trends 400 once and still ranks the city', async () => {
    const client = withReal('boost-real', soldOut.city, { rejectTrendsOnce: true });
    const study = await probeLaunch(client, soldOut);
    assert.equal(study.realRank, 1);
    assert.equal(study.derived.qlooCalls, 14);
    assert.deepEqual(study.derived.failures, ['places:Tokyo:400']);
    const tokyoPlaces = client.insightsSeen.filter((params) => {
      const location = params.filter?.location;
      const city = location && typeof location === 'object' && 'query' in location ? location.query : '';
      return params.filter?.type === 'urn:entity:place' && city === 'Tokyo';
    });
    assert.equal(tokyoPlaces.length, 2);
    assert.equal(tokyoPlaces[1]?.extra?.['bias.trends'], undefined);
  });

  it('records a failed search as unscored and does not invent a rank', async () => {
    const client: LaunchProbeClient = {
      async search() {
        return fail(403);
      },
      async insights() {
        throw new Error('insights should not run');
      },
    };
    const study = await probeLaunch(client, soldOut);
    assert.equal(study.scored, false);
    assert.equal(study.matched, null);
    assert.equal(study.realRank, null);
    assert.equal(study.cities.length, 5);
    assert.ok(study.cities.every((city) => city.rank == null && city.score == null));
    assert.deepEqual(study.derived.failures, ['search:403']);
    assert.equal(JSON.stringify(study).includes('secret'), false);
  });

  it('scores a film brief on the same city list', async () => {
    const study = await probeLaunch(withReal('boost-real', film.city), film);
    assert.equal(study.scored, true);
    assert.equal(study.realRank, 1);
    assert.equal(study.matched, true);
    assert.equal(study.derived.qlooCalls, 13);
    assert.deepEqual(study.cities.map((city) => city.city).sort(), ['Fukuoka', 'Kyoto', 'Osaka', 'Sapporo', 'Tokyo']);
  });

  it('asks for the US audience in the first locked US city', async () => {
    const innisfree = LAUNCH_CASES.find((row) => row.region === 'us')!;
    const client = withReal('bury-real', innisfree.city);
    const study = await probeLaunch(client, innisfree);
    assert.equal(study.audience.location, 'New York');
    assert.equal(study.realRank, 5);
    assert.equal(study.matched, true);
    const demo = client.insightsSeen.find((params) => params.filter?.type === 'urn:demographics');
    const location = demo?.signal?.location;
    assert.equal(location && typeof location === 'object' && 'query' in location ? location.query : null, 'New York');
  });
});

describe('published fixture', () => {
  it('lists every brief as needs-live under city-rank-2', () => {
    const body = JSON.parse(readFileSync(new URL('../../../web/public/case-studies.json', import.meta.url), 'utf8'));
    assert.deepEqual(body, needsLiveFixture());
    assert.equal(body.rule.version, 'city-rank-2');
    assert.equal(body.rule.lockedOn, '2026-10-14');
    assert.equal(body.callEstimate, 104);
    assert.equal(body.hitRate.label, 'No live ranks yet');
    assert.equal(body.hitRate.scored, 0);
    assert.equal(JSON.stringify(body).includes('encourageTotal'), false);
    assert.equal(body.studies.length, 8);
    for (const row of body.studies) {
      assert.equal(row.grounding, 'needs-live');
      assert.equal(row.scored, false);
      assert.equal(row.matched, null);
      assert.equal(row.realRank, null);
      assert.equal(row.cities.length, 5);
    }
    assertDerivedFixture(JSON.stringify(body));
  });

  it('refuses a fixture that carries a raw field or a key', () => {
    assert.doesNotThrow(() => assertDerivedFixture(JSON.stringify({ total: 1 })));
    assert.throws(() => assertDerivedFixture('{"entity_id":"x"}'), /raw Qloo/);
    assert.throws(() => assertDerivedFixture('hack_secret'), /raw Qloo/);
    assert.throws(() => assertDerivedFixture('{"results":[]}'), /raw Qloo/);
  });
});
