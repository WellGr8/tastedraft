import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SearchResultSchema, type Entity } from '@tastedraft/contracts';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { createSearchRoutes } from '../../api/search.ts';
import { createApp } from '../../app.ts';
import { AppError } from '../../errors.ts';
import { openRepository } from '../../persistence/sqlite-repository.ts';
import { jsonResponse, mockFetch } from '../test-support.ts';
import { QlooClient } from './client.ts';
import { disambiguateEntities, searchEntities, searchTags } from './search.ts';

function tempCache(): string {
  return mkdtempSync(join(tmpdir(), 'tastedraft-search-'));
}

function liveClient(body: unknown, cacheDir: string): QlooClient {
  return new QlooClient({
    apiKey: 'test-key',
    cacheDir,
    minIntervalMs: 0,
    retries: 0,
    fetchImpl: mockFetch(async () => jsonResponse(body)),
  });
}

const muji: Entity[] = [
  { id: 'person-muji', name: 'Muji', type: 'urn:entity:person', source: 'qloo' },
  {
    id: 'brand-muji',
    name: 'Muji',
    type: 'urn:entity:brand',
    source: 'qloo',
    image: 'https://example.invalid/muji.png',
  },
  { id: 'place-muji', name: 'Muji', type: 'urn:entity:place', city: 'Tokyo', source: 'qloo' },
];

describe('search disambiguation', () => {
  it('ranks the brand ahead of another type with the same name', () => {
    const ranked = disambiguateEntities(muji, { query: 'Muji' });
    assert.equal(ranked[0]?.id, 'brand-muji');
    assert.equal(ranked[1]?.id, 'person-muji');
  });

  it('keeps only the brand when type is brand', () => {
    const ranked = disambiguateEntities(muji, { query: 'Muji', type: 'brand' });
    assert.deepEqual(ranked.map((row) => row.id), ['brand-muji']);
  });

  it('filters places to the chosen city and stamps a city onto places that have none', () => {
    const ranked = disambiguateEntities(
      [
        { id: 'lantern', name: 'Lantern Row', type: 'urn:entity:place', source: 'mock' },
        { id: 'tokyo', name: 'Lantern Tokyo', type: 'urn:entity:place', city: 'Tokyo', source: 'mock' },
        { id: 'lake', name: 'Silver Lake', type: 'Place', city: 'Los Angeles', source: 'mock' },
      ],
      { query: 'Lantern', type: 'urn:entity:place', city: 'Los Angeles' },
    );
    assert.equal(ranked[0]?.id, 'lantern');
    assert.equal(ranked[0]?.city, 'Los Angeles');
    assert.equal(ranked.some((row) => row.id === 'tokyo'), false);
    assert.equal(ranked.find((row) => row.id === 'lake')?.city, 'Los Angeles');
  });
});

describe('searchEntities', () => {
  it('falls back to open data when no key is set and does not return the mock catalog', async () => {
    const client = new QlooClient({ apiKey: '', fetchImpl: () => { throw new Error('network'); } });
    const hit = {
      id: 'Q1',
      name: 'NewJeans',
      type: 'urn:entity:brand',
      source: 'wikidata',
      image: 'https://example.invalid/newjeans.png',
    };
    const result = await searchEntities({
      client,
      q: 'Velvet',
      type: 'brand',
      openData: { async search() { return [hit]; } },
    });
    assert.equal(result.source, 'open-data');
    assert.equal(result.entities[0]?.name, 'NewJeans');
    assert.equal(result.entities.some((entity) => entity.name === 'Velvet Circuit'), false);
    SearchResultSchema.parse(result);
  });

  it('keeps a Qloo image and does not call open data on success', async () => {
    const cacheDir = tempCache();
    let calls = 0;
    try {
      const client = liveClient(
        {
          success: true,
          results: {
            entities: [
              { entity_id: 'person-muji', name: 'Muji', types: ['urn:entity:person'] },
              {
                entity_id: 'brand-muji',
                name: 'Muji',
                types: ['urn:entity:brand'],
                properties: { image: { url: 'https://example.invalid/muji.png' } },
              },
            ],
          },
        },
        cacheDir,
      );
      const result = await searchEntities({
        client,
        q: 'Muji',
        type: 'urn:entity:brand',
        openData: {
          async search() {
            calls += 1;
            return [];
          },
        },
      });
      assert.equal(calls, 0);
      assert.equal(result.source, 'qloo');
      assert.equal(result.entities.length, 1);
      assert.equal(result.entities[0]?.id, 'brand-muji');
      assert.equal(result.entities[0]?.image, 'https://example.invalid/muji.png');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('maps lon to lng and keeps a Qloo image', async () => {
    const cacheDir = tempCache();
    try {
      const client = liveClient(
        {
          success: true,
          results: [
            {
              entity_id: 'lake',
              name: 'Silver Lake',
              subtype: 'urn:entity:place',
              properties: {
                image: { url: 'https://example.invalid/silver-lake.jpg' },
                location: { lat: 34.09, lon: -118.26, city: 'Los Angeles' },
              },
            },
          ],
        },
        cacheDir,
      );
      const result = await searchEntities({
        client,
        q: 'Silver',
        type: 'place',
        city: 'Los Angeles',
      });
      assert.equal(result.entities[0]?.city, 'Los Angeles');
      assert.deepEqual(result.entities[0]?.geo, { lat: 34.09, lng: -118.26 });
      assert.match(result.entities[0]?.image ?? '', /silver-lake/);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('falls back to open data when Qloo fails, and an open-data error stays empty', async () => {
    const cacheDir = tempCache();
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        minIntervalMs: 0,
        retries: 0,
        fetchImpl: mockFetch(async () => {
          throw new Error('down');
        }),
      });
      const hit = {
        id: 'Q123',
        name: 'NewJeans',
        type: 'urn:entity:artist',
        source: 'wikidata',
        image: 'https://example.invalid/newjeans.png',
      };
      const found = await searchEntities({
        client,
        q: 'NewJeans',
        openData: { async search() { return [hit]; } },
      });
      assert.equal(found.source, 'open-data');
      assert.equal(found.entities[0]?.name, 'NewJeans');

      const missed = await searchEntities({
        client,
        q: 'NewJeans',
        openData: {
          async search() {
            throw new Error('wikidata down');
          },
        },
      });
      assert.equal(missed.source, 'open-data');
      assert.deepEqual(missed.entities, []);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('returns an empty Qloo result when the live search succeeds with no entities', async () => {
    const cacheDir = tempCache();
    let calls = 0;
    try {
      const client = liveClient({ success: true, results: { entities: [] } }, cacheDir);
      const result = await searchEntities({
        client,
        q: 'Muji',
        type: 'brand',
        openData: {
          async search() {
            calls += 1;
            return [{ id: 'Q1', name: 'Muji', type: 'urn:entity:brand', source: 'wikidata' }];
          },
        },
      });
      assert.equal(calls, 0);
      assert.equal(result.source, 'qloo');
      assert.deepEqual(result.entities, []);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('searchTags', () => {
  it('returns mock tags from /v2/tags when no key is set', async () => {
    const client = new QlooClient({ apiKey: '' });
    const result = await searchTags(client, 'paper');
    assert.equal(result.source, 'mock');
    assert.equal(result.tags.length, 1);
    assert.equal(result.tags[0]?.name, 'paper-cut minimal');
    assert.equal(result.tags[0]?.id, 'td-mock-tag-paper-cut');
  });
});

describe('GET /api/search', () => {
  it('returns a Qloo SearchResult from a synthetic body and rejects a missing query', async () => {
    const cacheDir = tempCache();
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
      }
      if (err instanceof ZodError) return c.json({ error: { message: err.message } }, 400);
      throw err;
    });
    try {
      app.route(
        '/',
        createSearchRoutes({
          client: new QlooClient({
            apiKey: 'test-key',
            cacheDir,
            minIntervalMs: 0,
            retries: 0,
            fetchImpl: mockFetch(async (url) => {
              const query = (url.searchParams.get('query') ?? '').toLowerCase();
              if (url.pathname === '/v2/tags') {
                return jsonResponse({
                  success: true,
                  results: { tags: [{ id: 'fixture-tag-night', name: 'night-grid electronic', type: 'urn:tag' }] },
                });
              }
              if (query.includes('lantern')) {
                return jsonResponse({
                  success: true,
                  results: {
                    entities: [{
                      entity_id: 'fixture-lantern',
                      name: 'Lantern Row',
                      types: ['urn:entity:place'],
                      properties: { image: { url: 'https://example.invalid/lantern.png' } },
                    }],
                  },
                });
              }
              if (query.includes('silver')) {
                return jsonResponse({
                  success: true,
                  results: {
                    entities: [{
                      entity_id: 'fixture-lake',
                      name: 'Silver Lake',
                      types: ['urn:entity:place'],
                      properties: {
                        image: { url: 'https://example.invalid/lake.png' },
                        location: { lat: 34.0869, lon: -118.2702, city: 'Los Angeles' },
                      },
                    }],
                  },
                });
              }
              return jsonResponse({
                success: true,
                results: {
                  entities: [
                    { entity_id: 'fixture-person', name: 'Muji', types: ['urn:entity:person'] },
                    {
                      entity_id: 'fixture-brand',
                      name: 'Muji',
                      types: ['urn:entity:brand'],
                      properties: { image: { url: 'https://example.invalid/muji.png' } },
                    },
                  ],
                },
              });
            }),
          }),
        }),
      );
      const found = await app.request('/api/search?q=Muji&type=brand');
      assert.equal(found.status, 200);
      const body = SearchResultSchema.parse(await found.json());
      assert.equal(body.source, 'qloo');
      assert.equal(body.entities[0]?.id, 'fixture-brand');
      assert.equal(body.entities[0]?.image, 'https://example.invalid/muji.png');

      const place = await app.request('/api/search?q=Lantern&type=place&city=Los%20Angeles');
      assert.equal(place.status, 200);
      const places = SearchResultSchema.parse(await place.json());
      assert.equal(places.entities[0]?.name, 'Lantern Row');
      assert.equal(places.entities[0]?.city, 'Los Angeles');

      const tags = await app.request('/api/tags?q=night');
      assert.equal(tags.status, 200);
      const tagBody = (await tags.json()) as { source: string; tags: Array<{ name: string }> };
      assert.equal(tagBody.source, 'qloo');
      assert.equal(tagBody.tags[0]?.name, 'night-grid electronic');

      const lake = await app.request('/api/search?q=Silver%20Lake&type=place&city=Los%20Angeles');
      assert.equal(lake.status, 200);
      const lakeBody = SearchResultSchema.parse(await lake.json());
      assert.equal(lakeBody.entities[0]?.name, 'Silver Lake');
      assert.equal(lakeBody.entities[0]?.city, 'Los Angeles');
      assert.deepEqual(lakeBody.entities[0]?.geo, { lat: 34.0869, lng: -118.2702 });

      const missing = await app.request('/api/search');
      assert.equal(missing.status, 400);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('uses open data when the route has no Qloo key', async () => {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
      }
      throw err;
    });
    app.route('/', createSearchRoutes({
      client: new QlooClient({ apiKey: '' }),
      openData: {
        async search() {
          return [{
            id: 'Q9',
            name: 'NewJeans',
            type: 'urn:entity:artist',
            source: 'wikidata',
            image: 'https://example.invalid/newjeans.png',
          }];
        },
      },
    }));
    const found = await app.request('/api/search?q=NewJeans');
    assert.equal(found.status, 200);
    const body = SearchResultSchema.parse(await found.json());
    assert.equal(body.source, 'open-data');
    assert.equal(body.entities[0]?.name, 'NewJeans');
    assert.equal(body.entities.some((entity) => entity.id.startsWith('td-mock-')), false);
  });

  it('is mounted on the app and rejects a missing query before calling Qloo', async () => {
    const app = createApp({ repository: openRepository(':memory:') });
    const missing = await app.request('/api/search');
    assert.equal(missing.status, 400);
    const body = (await missing.json()) as { error: { message: string } };
    assert.match(body.error.message, /q is required/);
  });

  it('formats a missing query from the mounted route', async () => {
    const api = new Hono();
    api.route('/', createSearchRoutes());
    api.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
      }
      if (err instanceof ZodError) return c.json({ error: { message: err.message } }, 400);
      throw err;
    });
    const res = await api.request('/api/tags');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /q is required/);
  });
});
