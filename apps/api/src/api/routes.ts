import type { Context } from 'hono';
import { Hono } from 'hono';
import type { BriefV2 } from '@tastedraft/contracts';
import { DEFAULT_BRIEF, isAgeBand, isPositioning } from '../engine/index.ts';
import type { Brief } from '../engine/types.ts';
import { badRequest } from '../errors.ts';
import { assertPlaylist } from '../orchestrator/brief.ts';
import type { Orchestrator } from '../orchestrator/orchestrator.ts';
import { encodeChatLine, planChat } from '../agent/chat.ts';
import { createLlmClient } from '../llm/client.ts';
import { loadMapLayers } from '../providers/qloo/heatmap.ts';
import { createSearchRoutes } from './search.ts';
import { createPersonaRoutes } from './persona.ts';
import { createFeatureRoutes } from '../features/routes.ts';
import { engineBackend } from '../engine/engine-mode.ts';
import { describeLlm } from '../llm/client.ts';
import type { DailyQlooBudget } from '../ops/qloo-budget.ts';
import { CreateBody, PatchBody, SimulationBody } from './schemas.ts';
import { BriefV2Schema } from '@tastedraft/contracts';
import { z } from 'zod';

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('Request body must be JSON');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Accept the screen's flat body (`positioning`, `references`) and the nested `brief.pos` / `brief.refs` shape. */
function normalizeBriefFields(input: Record<string, unknown>): Record<string, unknown> {
  const brief: Record<string, unknown> = {};
  const pos = input.pos ?? input.positioning;
  const refs = input.refs ?? input.references;
  if (input.idea !== undefined) brief.idea = input.idea;
  if (input.age !== undefined) brief.age = input.age;
  if (input.city !== undefined) brief.city = input.city;
  if (pos !== undefined) brief.pos = pos;
  if (refs !== undefined) brief.refs = refs;
  if (input.muted !== undefined) brief.muted = input.muted;
  if (input.interests !== undefined) brief.interests = input.interests;
  return brief;
}

function normalizeCreate(input: unknown): unknown {
  const body = asRecord(input);
  if (!body) return input;
  if (body.brief !== undefined) {
    const brief = asRecord(body.brief);
    return brief ? { ...body, brief: normalizeBriefFields(brief) } : body;
  }
  const flat = normalizeBriefFields(body);
  const briefV2 = body.briefV2;
  if (Object.keys(flat).length === 0) {
    return briefV2 === undefined ? body : { ...body, briefV2 };
  }
  const next = body.name === undefined ? { brief: flat } : { name: body.name, brief: flat };
  return briefV2 === undefined ? next : { ...next, briefV2 };
}

function briefFromV2(v2: BriefV2): Brief {
  const brief: Brief = {
    idea: v2.idea,
    age: isAgeBand(v2.age) ? v2.age : DEFAULT_BRIEF.age,
    city: v2.city,
    pos: isPositioning(v2.positioning) ? v2.positioning : DEFAULT_BRIEF.pos,
    refs: v2.references.map((reference) => reference.name),
    muted: [],
    interests: v2.interests.map((tag) => tag.name).join(', '),
    briefV2: v2,
  };
  assertPlaylist(brief.refs, brief.muted ?? []);
  return brief;
}

function briefFromCreate(input: zBrief | undefined, briefV2?: BriefV2): Brief {
  if (briefV2) return briefFromV2(briefV2);
  const brief: Brief = {
    idea: input?.idea ?? DEFAULT_BRIEF.idea,
    age: input?.age ?? DEFAULT_BRIEF.age,
    city: input?.city ?? DEFAULT_BRIEF.city,
    pos: input?.pos ?? DEFAULT_BRIEF.pos,
    refs: input?.refs ? [...input.refs] : [...DEFAULT_BRIEF.refs],
    muted: input?.muted ? [...input.muted] : [],
  };
  if (input?.interests !== undefined) brief.interests = input.interests;
  assertPlaylist(brief.refs, brief.muted ?? []);
  return brief;
}

type zBrief = Partial<{
  idea: string;
  age: string;
  city: string;
  pos: string;
  refs: string[];
  muted: string[];
  interests: string;
}>;

export function createRoutes(orchestrator: Orchestrator, options: { budget?: DailyQlooBudget | null; admitLive?: () => boolean } = {}): Hono {
  const api = new Hono();
  api.route('/', createSearchRoutes());
  api.route('/', createPersonaRoutes());
  api.route('/', createFeatureRoutes(options.admitLive ? { admitLive: options.admitLive } : {}));

  api.get('/api/health', (c) => {
    const budget = options.budget ?? null;
    const used = budget ? budget.used() : 0;
    const limit = budget ? budget.limit : null;
    const llm = describeLlm();
    return c.json({
      ok: true,
      service: 'tastedraft',
      engine: engineBackend(),
      qloo: process.env.QLOO_API_KEY?.trim() ? 'configured' : 'missing',
      llm: llm.mode === 'live' ? llm.provider : 'off',
      qlooBudget: {
        used,
        limit,
        remaining: limit == null ? null : Math.max(0, limit - used),
        fallback: budget?.exhausted() ? 'recorded' : 'live',
      },
    });
  });

  api.post('/api/projects', async (c) => {
    const body = CreateBody.parse(normalizeCreate(await readJson(c)));
    const created = orchestrator.createProject({
      name: body.name,
      brief: briefFromCreate(body.brief, body.briefV2),
    });
    return c.json({ ...created.project, version: created.version }, 201);
  });

  api.patch('/api/projects/:id/brief', async (c) => {
    const patch = PatchBody.parse(await readJson(c));
    const saved = orchestrator.updateBrief(c.req.param('id'), patch);
    return c.json(saved);
  });

  api.post('/api/simulations', async (c) => {
    const body = SimulationBody.parse(await readJson(c));
    const simulation = await orchestrator.runSimulation(body.projectId, body.conceptVersionId);
    return c.json(simulation, simulation.status === 'failed' ? 422 : 201);
  });

  api.get('/api/simulations/:id', (c) => c.json(orchestrator.getSimulation(c.req.param('id'))));

  api.post('/api/recommendations/:id/apply', async (c) => {
    const result = await orchestrator.applyRecommendation(c.req.param('id'));
    return c.json(result, result.simulation.status === 'failed' ? 422 : 201);
  });

  api.post('/api/recommendations/:id/dismiss', (c) => {
    return c.json(orchestrator.dismissRecommendation(c.req.param('id')));
  });

  api.get('/api/projects/:id/versions', (c) => c.json(orchestrator.listVersions(c.req.param('id'))));

  api.post('/api/chat', async (c) => {
    const ChatBody = z.object({
      message: z.string().max(500),
      brief: BriefV2Schema,
      provenance: z.array(z.object({
        id: z.string(),
        label: z.string(),
        points: z.number().nullable(),
        detail: z.string(),
      })).optional(),
      proposals: z.array(z.object({
        id: z.string(),
        param: z.string().nullable().optional(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        why: z.string().optional(),
        predictedDelta: z.number().nullable().optional(),
      })).optional(),
      considered: z.number().int().positive().max(24).optional(),
    });
    const body = ChatBody.parse(await readJson(c));
    const plan = await planChat(body, createLlmClient());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: unknown) => controller.enqueue(encoder.encode(encodeChatLine(event)));
        for (const label of plan.steps) send({ type: 'step', label });
        for (const part of plan.message.split(/(\s+)/)) {
          if (part) send({ type: 'token', text: part });
        }
        for (const tool of plan.tools) send({ type: 'tool', title: tool.title, detail: tool.detail });
        for (const proposal of plan.proposals) send({ type: 'proposal', ...proposal });
        if (plan.confirm) send({ type: 'confirm', ...plan.confirm });
        send({ type: 'done' });
        controller.close();
      },
    });
    return c.body(stream, 200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
  });

  api.get('/api/map', async (c) => c.json(await loadMapLayers(c.req.query())));
  api.post('/api/map', async (c) => c.json(await loadMapLayers(await readJson(c))));

  return api;
}
