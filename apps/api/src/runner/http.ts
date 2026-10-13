/**
 * Run HTTP. POST returns as soon as the row exists so the client can open
 * the SSE stream. Reconnect with Last-Event-ID replays later steps, then
 * the closing state frame.
 */
import { join } from 'node:path';
import { BriefV2Schema, SseEventSchema } from '@tastedraft/contracts';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { createLlmClient } from '../llm/client.ts';
import { notFound } from '../errors.ts';
import { AgentRunner, liveProgress } from './runner.ts';
import { RunStore } from './store.ts';

const CreateBody = z.object({
  brief: BriefV2Schema,
  target: z.number().optional(),
  grounding: z.enum(['qloo', 'llm-only']).optional(),
}).strict();
const ProposalBody = z.object({ proposalId: z.string().min(1) }).strict();
const CommandBody = z.object({ message: z.string().min(1) }).strict();

export interface RunHttpOptions {
  runner?: AgentRunner;
  env?: { QLOO_API_KEY?: string; LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string };
  databasePath?: string;
}

export function createRunner(options: RunHttpOptions = {}): AgentRunner {
  if (options.runner) return options.runner;
  const env = options.env ?? process.env;
  const store = new RunStore(options.databasePath ?? join(process.cwd(), 'data', 'runs.sqlite'));
  return new AgentRunner({
    store,
    env,
    llm: createLlmClient(env),
  });
}

export function mountRuns(app: Hono, options: RunHttpOptions = {}): AgentRunner {
  const runner = createRunner(options);
  const store = runner.store;

  app.post('/api/runs', async (c) => {
    const body = CreateBody.parse(await c.req.json());
    const id = runner.create(body.brief, { target: body.target, ...(body.grounding ? { grounding: body.grounding } : {}) });
    void runner.kick(id).catch((error: unknown) => {
      console.error(error);
    });
    return c.json({ id }, 201);
  });

  app.get('/api/runs/:id', (c) => {
    const snapshot = store.snapshot(c.req.param('id'));
    if (!snapshot) throw notFound('Run not found');
    return c.json(snapshot);
  });

  app.get('/api/runs/:id/events', (c) => {
    const id = c.req.param('id');
    if (!store.snapshot(id)) throw notFound('Run not found');
    const header = c.req.header('Last-Event-ID');
    const parsed = header == null || header === '' ? -1 : Number(header);
    let cursor = Number.isFinite(parsed) ? parsed : -1;
    let announced = -1;
    return streamSSE(c, async (stream) => {
      const started = Date.now();
      while (Date.now() - started < 90_000) {
        const steps = store.listSteps(id, cursor);
        for (const step of steps) {
          const payload = SseEventSchema.parse({ type: 'step', step });
          await stream.writeSSE({ id: String(step.seq), event: 'step', data: JSON.stringify(payload) });
          cursor = step.seq;
        }
        const record = store.read(id);
        if (record && record.snapshot.status === 'running') {
          const progress = liveProgress(record);
          if (progress.calls !== announced) {
            announced = progress.calls;
            const payload = SseEventSchema.parse({ type: 'progress', ...progress });
            await stream.writeSSE({ event: 'progress', data: JSON.stringify(payload) });
          }
        }
        const run = record?.snapshot;
        if (!run || run.status !== 'running') {
          if (run) {
            const payload = SseEventSchema.parse({ type: 'state', run: store.snapshot(id) ?? run });
            await stream.writeSSE({ event: 'state', data: JSON.stringify(payload) });
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    });
  });

  app.post('/api/runs/:id/approve', async (c) => {
    const body = ProposalBody.parse(await c.req.json());
    return c.json(await runner.approve(c.req.param('id'), body.proposalId));
  });

  app.post('/api/runs/:id/dismiss', async (c) => {
    const body = ProposalBody.parse(await c.req.json());
    return c.json(await runner.dismiss(c.req.param('id'), body.proposalId));
  });

  app.post('/api/runs/:id/command', async (c) => {
    const body = CommandBody.parse(await c.req.json());
    return c.json(await runner.command(c.req.param('id'), body.message));
  });

  return runner;
}
