import { Hono } from 'hono';
import { QlooClient } from '../providers/qloo/client.ts';
import { searchEntities, searchTags } from '../providers/qloo/search.ts';
import type { OpenCatalog } from '../providers/qloo/open-search.ts';
import { badRequest } from '../errors.ts';

export interface SearchRouteOptions {
  client?: QlooClient;
  openData?: OpenCatalog;
}

function queryParam(value: string | undefined, name: string, max: number): string {
  const text = (value ?? '').trim();
  if (text.length > max) throw badRequest(`Query parameter ${name} is too long`);
  return text;
}

/** GET /api/search and GET /api/tags. Handlers stay thin; ranking lives in search.ts. */
export function createSearchRoutes(options: SearchRouteOptions = {}): Hono {
  const api = new Hono();

  api.get('/api/search', async (c) => {
    const q = queryParam(c.req.query('q'), 'q', 200);
    if (!q) throw badRequest('Query parameter q is required');
    const type = queryParam(c.req.query('type'), 'type', 80);
    const city = queryParam(c.req.query('city'), 'city', 80);
    const result = await searchEntities({
      client: options.client ?? new QlooClient(),
      openData: options.openData,
      q,
      type: type || undefined,
      city: city || undefined,
    });
    return c.json(result);
  });

  api.get('/api/tags', async (c) => {
    const q = queryParam(c.req.query('q'), 'q', 200);
    if (!q) throw badRequest('Query parameter q is required');
    const result = await searchTags(options.client ?? new QlooClient(), q);
    return c.json(result);
  });

  return api;
}
