import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PersonaResultSchema, type BriefV2, type PersonaRequest } from '@tastedraft/contracts';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { createPersonaRoutes } from '../../api/persona.ts';
import { AppError } from '../../errors.ts';
import { jsonResponse, mockFetch } from '../test-support.ts';
import { QlooClient } from './client.ts';
import { buildPersona } from './persona.ts';

const BRIEF: BriefV2 = {
  idea: 'A listening bar',
  interests: [{ id: 'urn:tag:genre:music:electronic', name: 'electronic' }],
  references: [{
    id: 'E12201A5-CC50-40AF-97AE-C54A2CA303F7',
    name: 'Fixture Brand',
    type: 'urn:entity:brand',
    source: 'qloo',
    image: 'https://example.invalid/brand.png',
  }],
  locations: [],
  city: 'Tokyo',
  age: '18–25',
  priceLevel: 3,
  positioning: 'premium',
  constraints: ['quiet'],
};

const REQUEST: PersonaRequest = {
  brief: BRIEF,
  location: 'Tokyo',
  audiences: [
    { id: 'young', label: 'Under 25', age: '18–25', gender: 'female' },
    { id: 'thirties', label: 'Thirties', age: '30_to_34' },
    { id: 'older', label: '45 plus', age: '45_to_54', gender: 'male' },
  ],
};

function entity(name: string, type: string) {
  return {
    entity_id: `fixture-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    subtype: type,
    properties: { image: { url: `https://example.invalid/${name}.png` } },
    query: { affinity: 0.81 },
  };
}

describe('buildPersona', () => {
  it('asks Qloo for five categories per audience and keeps ids, images, and affinity', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'td-persona-'));
    const urls: string[] = [];
    const client = new QlooClient({
      apiKey: 'test-key',
      cacheDir,
      minIntervalMs: 0,
      retries: 0,
      fetchImpl: mockFetch(async (url) => {
        urls.push(url.toString());
        const type = url.searchParams.get('filter.type');
        if (type === 'urn:entity:movie') return jsonResponse({ success: false, error: [{ message: 'film unavailable' }] }, 400);
        const subtype = type === 'urn:entity:artist'
          ? 'urn:entity:artist'
          : type === 'urn:entity:brand'
            ? 'urn:entity:brand'
            : 'urn:entity:place';
        return jsonResponse({
          success: true,
          results: { entities: [entity(subtype.endsWith('artist') ? 'Fixture Artist' : subtype.endsWith('brand') ? 'Fixture Brand' : 'Fixture Place', subtype)] },
        });
      }),
    });
    try {
      const result = await buildPersona(client, REQUEST);
      PersonaResultSchema.parse(result);
      assert.equal(result.mode, 'live');
      assert.equal(result.location, 'Tokyo');
      assert.equal(result.segments.length, 3);
      assert.equal(result.segments[0]?.insights.artists[0]?.name, 'Fixture Artist');
      assert.equal(result.segments[0]?.insights.artists[0]?.affinity, 0.81);
      assert.match(result.segments[0]?.insights.brands[0]?.image ?? '', /example\.invalid/);
      assert.deepEqual(result.segments[0]?.insights.film, []);
      assert.ok(result.warnings.some((warning) => warning.includes('film') && warning.includes('film unavailable')));
      const decoded = urls.map((url) => decodeURIComponent(url));
      assert.equal(decoded.length, 15);
      assert.ok(decoded.some((url) => url.includes('filter.type=urn:entity:artist') && url.includes('signal.demographics.age=24_and_younger') && url.includes('signal.demographics.gender=female')));
      assert.ok(decoded.some((url) => url.includes('signal.interests.entities=E12201A5-CC50-40AF-97AE-C54A2CA303F7')));
      assert.ok(decoded.some((url) => url.includes('signal.interests.tags=urn:tag:genre:music:electronic')));
      assert.ok(decoded.some((url) => url.includes('signal.location.query=Tokyo') && url.includes('feature.explainability=true')));
      assert.ok(decoded.some((url) => url.includes('filter.location.query=Tokyo') && url.includes('filter.price_level.max=3') && url.includes('filter.tags=urn:tag:genre:place:restaurant')));
      assert.ok(decoded.every((url) => !url.includes('td-mock-')));
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('rejects a persona body with fewer than three audiences', async () => {
    const api = new Hono();
    api.route('/', createPersonaRoutes({ client: new QlooClient({ apiKey: '' }) }));
    api.onError((err, c) => {
      if (err instanceof AppError) return c.json({ error: { message: err.message } }, err.status as ContentfulStatusCode);
      if (err instanceof ZodError) return c.json({ error: { message: 'invalid' } }, 400);
      throw err;
    });
    const res = await api.request('/api/persona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...REQUEST, audiences: REQUEST.audiences.slice(0, 2) }),
    });
    assert.equal(res.status, 400);
  });
});
