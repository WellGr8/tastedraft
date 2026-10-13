import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Hono } from 'hono';
import { DEFAULT_BRIEF } from '../engine/index.ts';
import { FallbackProvider } from '../providers/fallback.ts';
import { BANGKOK_SNACK_BRIEF } from '../providers/qloo/insights-mock.ts';
import { createHttpClient } from '../providers/http.ts';
import { MusicBrainzProvider } from '../providers/musicbrainz.ts';
import { OSM_CENTER_RADIUS_M, OsmProvider } from '../providers/osm.ts';
import { jsonResponse, loadFixture, mockFetch } from '../providers/test-support.ts';
import { WikidataProvider } from '../providers/wikidata.ts';
import { createApp } from '../app.ts';
import { openRepository } from '../persistence/sqlite-repository.ts';
import { adaptEvidenceProvider, createConfiguredProvider } from '../wiring/provider.ts';

interface SimulationBody {
  id: string;
  status: string;
  provider: string | null;
  score: number | null;
  evidenceStrength: string | null;
  ledger: {
    anchor: number | null;
    cross: number | null;
    local: number | null;
    audience: number | null;
    friction: number | null;
  } | null;
  proposals: Array<{ id: string; before: string; after: string; predictedDelta: number | null; param: string | null; change: { kind: string } }>;
}

interface VersionBody {
  id: string;
  number: number;
  origin: string;
  brief: { posture?: string; scarcity?: string };
}

function app(options?: Parameters<typeof createApp>[0]) {
  return createApp({ repository: openRepository(':memory:'), env: {}, ...options });
}

async function send(api: Hono, method: string, path: string, body?: unknown) {
  const res = await api.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function openDataFetch(): typeof fetch {
  const entities = loadFixture('wikidata-entities.json') as { entities: Record<string, unknown> };
  const labels = loadFixture('wikidata-labels.json') as { entities: Record<string, unknown> };
  const searches: Record<string, string> = {
    'aphex twin': 'wikidata-search-aphex-twin.json',
    'comme des garçons': 'wikidata-search-comme-des-garcons.json',
    muji: 'wikidata-search-muji.json',
    'lost in translation': 'wikidata-search-lost-in-translation.json',
    'silver lake': 'wikidata-search-silver-lake.json',
  };
  return mockFetch(async (url) => {
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
        return jsonResponse(loadFixture('musicbrainz-search-unknown.json'));
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
}

describe('integrated loop', () => {
  test('provider selection keeps sample as the demo default', () => {
    assert.equal(createConfiguredProvider({}).id, 'sample');
    assert.equal(createConfiguredProvider({ QLOO_API_KEY: 'present', EVIDENCE_PROVIDER: 'sample' }).id, 'sample');
    assert.equal(createConfiguredProvider({ QLOO_API_KEY: 'present' }).id, 'qloo');
    assert.equal(createConfiguredProvider({ EVIDENCE_PROVIDER: 'fallback', QLOO_API_KEY: 'present' }).id, 'open-data');
    assert.throws(() => createConfiguredProvider({ EVIDENCE_PROVIDER: 'qloo' }), /QLOO_API_KEY/);
  });

  test('frontend project body scores 71, the agent price diff reaches 80, and versions stay listed', async () => {
    const api = app();
    const created = await send(api, 'POST', '/api/projects', {
      idea: DEFAULT_BRIEF.idea,
      age: DEFAULT_BRIEF.age,
      city: DEFAULT_BRIEF.city,
      interests: '',
      positioning: 'Premium',
      references: [...DEFAULT_BRIEF.refs],
    });
    assert.equal(created.status, 201);
    const project = created.json as { id: string; version: VersionBody };
    assert.equal(project.version.number, 1);

    const first = await send(api, 'POST', '/api/simulations', {
      projectId: project.id,
      applied: false,
      idea: DEFAULT_BRIEF.idea,
      positioning: 'Premium',
      references: [...DEFAULT_BRIEF.refs],
    });
    assert.equal(first.status, 201);
    const v1 = first.json as unknown as SimulationBody;
    assert.equal(v1.score, 71);
    assert.equal(v1.provider, 'sample');
    assert.equal(v1.evidenceStrength, 'HIGH');
    assert.deepEqual(v1.ledger, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5 });
    assert.equal(v1.proposals.length, 3);
    assert.deepEqual(
      v1.proposals.map((proposal) => proposal.predictedDelta),
      [9, 5, 3],
    );

    const price = v1.proposals.find((proposal) => proposal.change.kind === 'qloo' && proposal.param === 'filter.price_level.max');
    assert.ok(price);
    assert.equal(price.before, 'Price level 3');
    assert.equal(price.after, 'Price level 2');
    const stepped = await send(api, 'POST', `/api/recommendations/${price.id}/apply`);
    assert.equal(stepped.status, 201);
    const done = stepped.json as { version: VersionBody; simulation: SimulationBody };
    assert.equal(done.version.number, 2);
    assert.equal(done.version.brief.posture, 'accessible');
    assert.equal(done.version.brief.scarcity, undefined);
    assert.equal(done.simulation.score, 80);

    const versions = await send(api, 'GET', `/api/projects/${project.id}/versions`);
    const listed = versions.json as { currentVersionId: string; versions: VersionBody[] };
    assert.equal(listed.versions.length, 2);
    assert.equal(listed.currentVersionId, done.version.id);
    assert.equal(listed.versions[0]?.number, 1);
    assert.equal(listed.versions[0]?.origin, 'initial');
    assert.equal(listed.versions[0]?.brief.posture, undefined);
    const stored = (await send(api, 'GET', `/api/simulations/${v1.id}`)).json as unknown as SimulationBody;
    assert.equal(stored.score, 71);
  });

  test('fallback fixtures keep null signals as gaps and label the provider open-data', async () => {
    const http = createHttpClient({ fetchImpl: openDataFetch(), minIntervalByHost: {} });
    const provider = adaptEvidenceProvider(
      new FallbackProvider(new WikidataProvider({ http }), new MusicBrainzProvider(http), new OsmProvider(http)),
    );
    const api = app({ provider });
    const created = await send(api, 'POST', '/api/projects', {});
    assert.equal(created.status, 201);
    const projectId = (created.json as { id: string }).id;
    const run = await send(api, 'POST', '/api/simulations', { projectId });
    assert.equal(run.status, 201);
    const sim = run.json as unknown as SimulationBody;
    assert.equal(sim.status, 'complete');
    assert.equal(sim.provider, 'open-data');
    assert.equal(sim.evidenceStrength, 'LIMITED');
    assert.ok(sim.ledger);
    assert.equal(sim.ledger.anchor, null);
    assert.equal(sim.ledger.cross, null);
    assert.equal(sim.ledger.local, null);
    assert.equal(sim.ledger.audience, null);
    assert.equal(sim.ledger.friction, null);
    assert.equal(sim.score, null);
    assert.equal(sim.proposals.length, 0);
  });

  test('a Bangkok night-market BriefV2 is scored by insights, not the streetwear sample', async () => {
    const api = app();
    const created = await send(api, 'POST', '/api/projects', { briefV2: BANGKOK_SNACK_BRIEF });
    assert.equal(created.status, 201);
    const projectId = (created.json as { id: string }).id;
    const run = await send(api, 'POST', '/api/simulations', { projectId });
    assert.equal(run.status, 201);
    const sim = run.json as unknown as SimulationBody & {
      story: { mode: string; captions: string[] } | null;
      ledger: { local: number | null } | null;
    };
    assert.equal(sim.score, 69);
    assert.equal(sim.provider, 'qloo');
    assert.equal(sim.evidenceStrength, 'MEDIUM');
    assert.equal(sim.ledger?.local, 18);
    assert.equal(sim.story?.mode, 'insights');
    assert.match(sim.story?.captions.join(' ') ?? '', /69/);
    assert.match(sim.story?.captions.join(' ') ?? '', /91/);
    assert.equal(sim.proposals.some((proposal) => proposal.change.kind === 'posture'), false);
  });
});
