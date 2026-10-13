import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MapLayerSchema } from '@tastedraft/contracts';
import { ZodError } from 'zod';
import { createApp } from '../../app.ts';
import { openRepository } from '../../persistence/sqlite-repository.ts';
import { jsonResponse, mockFetch } from '../test-support.ts';
import { QlooClient, type QlooInsightsParams } from './client.ts';
import { geohashCenter, loadMapLayers } from './heatmap.ts';

function liveClient(fetchImpl: typeof fetch): { client: QlooClient; cleanup: () => void } {
  const cacheDir = mkdtempSync(join(tmpdir(), 'td-heat-'));
  const client = new QlooClient({ apiKey: 'test-key', fetchImpl, cacheDir, minIntervalMs: 0, retries: 0 });
  return { client, cleanup: () => rmSync(cacheDir, { recursive: true, force: true }) };
}

class RecordingClient extends QlooClient {
  readonly seen: QlooInsightsParams[] = [];

  override insights(params: QlooInsightsParams, init?: Parameters<QlooClient['insights']>[1]): ReturnType<QlooClient['insights']> {
    this.seen.push(params);
    return super.insights(params, init);
  }
}

describe('geohashCenter', () => {
  it('decodes the documented Wikipedia geohash', () => {
    const point = geohashCenter('u4pruydqqvj');
    assert.ok(point);
    assert.ok(Math.abs((point?.lat ?? 0) - 57.64911) < 0.0001);
    assert.ok(Math.abs((point?.lng ?? 0) - 10.40744) < 0.0001);
    assert.equal(geohashCenter(''), null);
    assert.equal(geohashCenter('bad!'), null);
  });
});

describe('loadMapLayers', () => {
  it('uses mock heatmap cells on the brief city when no key is set', async () => {
    const client = new RecordingClient({ apiKey: '' });
    const payload = await loadMapLayers(
      {
        city: ' Los Angeles ',
        interests: { entities: ['td-mock-entity-velvet-circuit'], tags: ['td-mock-tag-paper-cut'] },
        locations: [
          {
            id: 'loc-silver-lake',
            name: 'Silver Lake',
            lat: 34.0869,
            lng: -118.2702,
            image: 'https://example.invalid/sl.jpg',
            entityId: 'td-mock-entity-lantern-row',
          },
        ],
        v2: { interests: { entities: ['td-mock-entity-northwind-audio'] } },
      },
      client,
    );
    assert.equal(payload.city, 'Los Angeles');
    assert.equal(payload.mode, 'mock');
    assert.equal(payload.basis, 'heatmap');
    assert.deepEqual(payload.center, { lat: 34.0522, lng: -118.2437 });
    assert.equal(payload.fits.v1.kind, 'heatmap');
    assert.equal(payload.friction.v1.kind, 'heatmap');
    assert.equal(payload.fits.v2?.kind, 'heatmap');
    if (payload.fits.v1.kind !== 'heatmap' || payload.fits.v2?.kind !== 'heatmap' || payload.friction.v1.kind !== 'heatmap' || payload.friction.v2?.kind !== 'heatmap') {
      return;
    }
    assert.deepEqual(payload.fits.v1.cells.map((cell) => cell.label), ['Silver Lake', 'Echo Park']);
    assert.deepEqual(payload.friction.v1.cells.map((cell) => cell.label), ['Beverly Hills', 'West Hollywood']);
    assert.ok((payload.fits.v2.cells[0]?.weight ?? 0) > (payload.fits.v1.cells[0]?.weight ?? 1));
    assert.ok((payload.friction.v2.cells[0]?.weight ?? 1) < (payload.friction.v1.cells[0]?.weight ?? 0));
    MapLayerSchema.parse(payload.fits.v1);
    MapLayerSchema.parse(payload.friction.v1);
    assert.equal(payload.locations.kind, 'pins');
    if (payload.locations.kind === 'pins') {
      assert.equal(payload.locations.pins[0]?.name, 'Silver Lake');
      assert.equal(payload.locations.pins[0]?.entityId, 'td-mock-entity-lantern-row');
      assert.equal('image' in payload.locations.pins[0]!, false);
    }
    assert.equal(payload.cards[0]?.image, 'https://example.invalid/sl.jpg');
    const heat = client.seen.filter((params) => params.filter?.type === 'urn:heatmap');
    assert.equal(heat.length, 4);
    assert.ok(heat.every((params) => (params.filter?.location as { query?: string } | undefined)?.query === 'Los Angeles'));
    assert.ok(heat.every((params) => params.output?.heatmap === undefined));
    assert.ok(heat.some((params) => params.signal?.interests && JSON.stringify(params.signal.interests).includes('td-mock-entity-velvet-circuit')));
    assert.ok(heat.some((params) => params.extra?.['heatmap.dimensions'] === 'price_level'));
    assert.ok(heat.some((params) => !params.extra));
    assert.equal(client.seen.some((params) => params.filter?.type === 'urn:entity:place'), false);
  });

  it('keeps live heatmap coordinates and does not invent districts', async () => {
    const urls: string[] = [];
    const { client, cleanup } = liveClient(mockFetch(async (url) => {
      urls.push(url.toString());
      if (url.searchParams.get('filter.type') !== 'urn:heatmap') {
        throw new Error(`unexpected fallback ${url.pathname}`);
      }
      return jsonResponse({
        success: true,
        results: {
          heatmap: [
            { id: 'loc-1', label: 'Shibuya', location: { lat: 35.66, lon: 139.7 }, query: { affinity: 0.81 } },
            { geohash: 'u4pruydqqvj', name: 'Wiki', query: { affinity: 80 } },
          ],
        },
      });
    }));
    try {
      const payload = await loadMapLayers({ city: 'Los Angeles', interests: { tags: ['night-grid'] } }, client);
      assert.equal(payload.mode, 'live');
      assert.equal(payload.basis, 'heatmap');
      assert.deepEqual(payload.center, { lat: 34.0522, lng: -118.2437 });
      assert.equal(payload.fits.v2, null);
      if (payload.fits.v1.kind !== 'heatmap') return;
      assert.equal(payload.fits.v1.cells[0]?.label, 'Shibuya');
      assert.equal(payload.fits.v1.cells[0]?.weight, 0.81);
      assert.equal(payload.fits.v1.cells[0]?.lng, 139.7);
      assert.equal(payload.fits.v1.cells[1]?.label, 'Wiki');
      assert.equal(payload.fits.v1.cells[1]?.weight, 0.8);
      assert.ok(Math.abs((payload.fits.v1.cells[1]?.lat ?? 0) - 57.64911) < 0.001);
      const decoded = urls.map((url) => decodeURIComponent(url));
      assert.ok(decoded.every((url) => url.includes('filter.type=urn:heatmap')));
      assert.ok(decoded.every((url) => !url.includes('output.heatmap.boundary')));
      assert.ok(decoded.some((url) => url.includes('signal.interests.tags=night-grid')));
      assert.ok(decoded.some((url) => url.includes('heatmap.dimensions=price_level')));
    } finally {
      cleanup();
    }
  });

  it('falls back to place pins when the heatmap has no coordinates', async () => {
    const { client, cleanup } = liveClient(mockFetch(async (url) => {
      const type = url.searchParams.get('filter.type');
      if (type === 'urn:heatmap') return jsonResponse({ success: true, results: { heatmap: [] } });
      if (type === 'urn:entity:place') {
        return jsonResponse({
          success: true,
          results: {
            entities: [
              { entity_id: 'p1', name: 'Wynwood', location: { lat: 25.801, lon: -80.199 } },
              { name: 'No coordinates' },
            ],
          },
        });
      }
      return jsonResponse({ success: true, results: {} });
    }));
    try {
      const payload = await loadMapLayers({ city: 'Miami' }, client);
      assert.equal(payload.basis, 'places');
      assert.equal(payload.mode, 'live');
      assert.deepEqual(payload.center, { lat: 25.7617, lng: -80.1918 });
      assert.equal(payload.fits.v1.kind, 'pins');
      assert.equal(payload.friction.v1.kind, 'pins');
      if (payload.fits.v1.kind !== 'pins') return;
      assert.equal(payload.fits.v1.pins.length, 1);
      assert.equal(payload.fits.v1.pins[0]?.name, 'Wynwood');
      assert.equal(payload.fits.v1.pins[0]?.lng, -80.199);
      assert.equal(payload.fits.v1.pins[0]?.entityId, 'p1');
      MapLayerSchema.parse(payload.fits.v1);
    } finally {
      cleanup();
    }
  });

  it('rejects a location card outside WGS84', async () => {
    await assert.rejects(
      () => loadMapLayers({ city: 'Los Angeles', locations: [{ id: 'a', name: 'A', lat: 999, lng: 0 }] }),
      (error: unknown) => error instanceof ZodError,
    );
  });
});

describe('GET /api/map', () => {
  it('returns contract layers centred on the requested city', async () => {
    const app = createApp({ repository: openRepository(':memory:') });
    const res = await app.request('/api/map?city=Austin&entities=td-mock-entity-velvet-circuit');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      city: string;
      center: { lat: number; lng: number };
      mode: string;
      fits: { v1: unknown; v2: unknown };
      friction: { v1: unknown };
      locations: unknown;
    };
    assert.equal(body.city, 'Austin');
    assert.equal(body.mode, 'mock');
    assert.ok(Math.abs(body.center.lat - 30.2672) < 0.001);
    assert.ok(Math.abs(body.center.lng - -97.7431) < 0.001);
    const fits = MapLayerSchema.parse(body.fits.v1);
    const friction = MapLayerSchema.parse(body.friction.v1);
    MapLayerSchema.parse(body.locations);
    assert.equal(body.fits.v2, null);
    assert.equal(fits.kind, 'heatmap');
    assert.equal(friction.kind, 'heatmap');
    if (fits.kind === 'heatmap') assert.deepEqual(fits.cells.map((cell) => cell.label), ['East Austin', 'South Congress']);
  });

  it('accepts a POST brief with a second version', async () => {
    const app = createApp({ repository: openRepository(':memory:') });
    const res = await app.request('/api/map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: 'Seattle', v2: {} }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { fits: { v2: { kind: string } | null }; center: { lat: number } };
    assert.equal(body.fits.v2?.kind, 'heatmap');
    assert.ok(Math.abs(body.center.lat - 47.6062) < 0.001);
  });
});
