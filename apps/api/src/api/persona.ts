import { PersonaRequestSchema } from '@tastedraft/contracts';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { badRequest } from '../errors.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { buildPersona } from '../providers/qloo/persona.ts';

export interface PersonaRouteOptions {
  client?: QlooClient;
}

/** POST /api/persona. Brief, location, and 3–4 audience buckets. */
export function createPersonaRoutes(options: PersonaRouteOptions = {}): Hono {
  const api = new Hono();

  api.post('/api/persona', async (c) => {
    const text = await c.req.text();
    let json: unknown;
    try {
      json = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw badRequest('Request body must be JSON');
    }
    const parsed = PersonaRequestSchema.safeParse(json);
    if (!parsed.success) throw new ZodError(parsed.error.issues);
    const result = await buildPersona(options.client ?? new QlooClient(), parsed.data);
    return c.json(result);
  });

  return api;
}
