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
import { disambiguateEntities, searchEntities, searchTags, type ImageFallback } from './search.ts';

function tempCache(): string {
  return mkdtempSync(join(tmpdir(), 'tastedraft-search-'));
}

function liveClient(body: unknown, cacheDir: string): QlooClient {
  return new QlooClient({
    apiKey: 'test-key',
    cacheDir,
    fetchImpl: mockFetch(async () => jsonResponse(body)),
  });
}

function images(lookup: ImageFallback['lookup']): ImageFallback {
  return { lookup };
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
  it('uses mock mode without a key and does not ask Wikidata for an image Qloo already has', async () => {
    let lookups = 0;
    const client = new QlooClient({
      apiKey: '',
      fetchImpl: () => {
        throw new Error('network');
      },
    });
      const result = await searchEntities({
        client,
        q: 'Velvet',
        type: 'brand',
        images: images(async () => {
          lookups += 1;
          return 'https://example.invalid/should-not-be-used.png';
        }),
      });
      assert.equal(result.source, 'mock');
      assert.equal(result.query, 'Velvet');
      assert.equal(result.entities.length, 1);
      assert.equal(result.entities[0]?.name, 'Velvet Circuit');
      assert.equal(result.entities[0]?.type, 'urn:entity:brand');
      assert.match(result.entities[0]?.image ?? '', /velvet-circuit/);
    assert.equal(lookups, 0);
    SearchResultSchema.parse(result);
  });

  it('resolves Muji to the brand and fills a missing image from the fallback', async () => {
    const cacheDir = tempCache();
    let lookups = 0;
    try {
      const client = liveClient(
        {
          success: true,
          results: {
            entities: [
              { entity_id: 'person-muji', name: 'Muji', subtype: 'urn:entity:person' },
              {
                entity_id: 'brand-muji',
                name: 'Muji',
                subtype: 'urn:entity:brand',
                properties: { description: 'Japanese retailer' },
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
        images: images(async (name) => {
          lookups += 1;
          assert.equal(name, 'Muji');
          return 'https://commons.wikimedia.org/wiki/Special:FilePath/MUJI_logo.svg';
        }),
      });
      assert.equal(result.source, 'qloo');
      assert.equal(result.entities.length, 1);
      assert.equal(result.entities[0]?.id, 'brand-muji');
      assert.equal(result.entities[0]?.type, 'urn:entity:brand');
      assert.match(result.entities[0]?.image ?? '', /MUJI_logo/);
      assert.equal(lookups, 1);
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
        images: images(async () => {
          throw new Error('wikidata should not run');
        }),
      });
      assert.equal(result.entities[0]?.city, 'Los Angeles');
      assert.deepEqual(result.entities[0]?.geo, { lat: 34.09, lng: -118.26 });
      assert.match(result.entities[0]?.image ?? '', /silver-lake/);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('keeps a mock hit and does not call open data', async () => {
    let calls = 0;
    const client = new QlooClient({ apiKey: '' });
    const result = await searchEntities({
      client,
      q: 'Muji',
      openData: {
        async search() {
          calls += 1;
          return [];
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.source, 'mock');
    assert.equal(result.entities[0]?.name, 'Muji');
  });

  it('falls back to open data when the mock catalog misses, and mock stays last', async () => {
    const client = new QlooClient({ apiKey: '' });
    const hit = {
      id: 'Q123',
      name: 'NewJeans',
      type: 'urn:entity:artist',
      source: 'wikidata',
      image: 'https://commons.wikimedia.org/wiki/Special:FilePath/NewJeans.jpg',
    };
    const found = await searchEntities({
      client,
      q: 'NewJeans',
      openData: { async search() { return [hit]; } },
    });
    assert.equal(found.source, 'open-data');
    assert.equal(found.entities[0]?.name, 'NewJeans');
    assert.match(found.entities[0]?.image ?? '', /NewJeans/);

    const missed = await searchEntities({
      client,
      q: 'NewJeans',
      openData: { async search() { return []; } },
    });
    assert.equal(missed.source, 'mock');
    assert.deepEqual(missed.entities, []);
  });

  it('returns an empty SearchResult when Qloo fails', async () => {
    const cacheDir = tempCache();
    try {
      const client = new QlooClient({
        apiKey: 'test-key',
        cacheDir,
        fetchImpl: mockFetch(async () => {
          throw new Error('down');
        }),
      });
      const result = await searchEntities({ client, q: 'Muji', type: 'brand' });
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
  it('returns a SearchResult and tags, and rejects a missing query', async () => {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
      }
      if (err instanceof ZodError) return c.json({ error: { message: err.message } }, 400);
      throw err;
    });
    app.route(
      '/',
      createSearchRoutes({
        client: new QlooClient({ apiKey: '' }),
        images: images(async () => {
          throw new Error('wikidata should not run');
        }),
      }),
    );
    const found = await app.request('/api/search?q=Velvet&type=brand');
    assert.equal(found.status, 200);
    const body = SearchResultSchema.parse(await found.json());
    assert.equal(body.source, 'mock');
    assert.equal(body.entities[0]?.name, 'Velvet Circuit');

    const place = await app.request('/api/search?q=Lantern&type=place&city=Los%20Angeles');
    assert.equal(place.status, 200);
    const places = SearchResultSchema.parse(await place.json());
    assert.equal(places.entities[0]?.name, 'Lantern Row');
    assert.equal(places.entities[0]?.city, 'Los Angeles');

    const tags = await app.request('/api/tags?q=night');
    assert.equal(tags.status, 200);
    const tagBody = (await tags.json()) as { source: string; tags: Array<{ name: string }> };
    assert.equal(tagBody.source, 'mock');
    assert.equal(tagBody.tags[0]?.name, 'night-grid electronic');

    const muji = await app.request('/api/search?q=Muji');
    assert.equal(muji.status, 200);
    const mujiBody = SearchResultSchema.parse(await muji.json());
    assert.equal(mujiBody.entities[0]?.name, 'Muji');
    assert.equal(mujiBody.entities[0]?.type, 'urn:entity:brand');

    const lake = await app.request('/api/search?q=Silver%20Lake&type=place&city=Los%20Angeles');
    assert.equal(lake.status, 200);
    const lakeBody = SearchResultSchema.parse(await lake.json());
    assert.equal(lakeBody.entities[0]?.name, 'Silver Lake');
    assert.equal(lakeBody.entities[0]?.city, 'Los Angeles');
    assert.deepEqual(lakeBody.entities[0]?.geo, { lat: 34.0869, lng: -118.2702 });

    const missing = await app.request('/api/search');
    assert.equal(missing.status, 400);
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
    api.route('/', createSearchRoutes({ images: images(async () => undefined) }));
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
