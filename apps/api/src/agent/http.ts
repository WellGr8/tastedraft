/**
 * HTTP surface for the agent. Mounted from server/src/app.ts.
 * The results page is served from split/results* so the demo does not
 * go through the prototype bundle.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BriefV2Schema } from '@tastedraft/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { notFound } from '../errors.ts';
import type { AgentRun } from './loop.ts';
import { approve, buildDemo, runAgent } from './loop.ts';

const runs = new Map<string, AgentRun>();

const RunBody = z.object({ brief: BriefV2Schema }).strict();
const ApproveBody = z.object({ runId: z.string().min(1), proposalId: z.string().min(1) }).strict();

function resultsFile(name: string): string {
  return fileURLToPath(new URL(`../../../../split/${name}`, import.meta.url));
}

function readResults(name: string): string {
  return readFileSync(resultsFile(name), 'utf8');
}

export function mountAgent(app: Hono): void {
  app.get('/api/agent/demo', async (c) => c.json(await buildDemo()));
  app.post('/api/agent/run', async (c) => {
    const body = RunBody.parse(await c.req.json());
    const run = await runAgent({ brief: body.brief });
    runs.set(run.id, run);
    return c.json(run, 201);
  });
  app.post('/api/agent/approve', async (c) => {
    const body = ApproveBody.parse(await c.req.json());
    const run = runs.get(body.runId);
    if (!run) throw notFound('Agent run not found');
    return c.json(approve(run, body.proposalId));
  });
  app.get('/results', (c) => c.redirect('/results/'));
  app.get('/results/', (c) => c.html(readResults('results.html')));
  app.get('/results/results.css', (c) => c.text(readResults('results.css'), 200, { 'Content-Type': 'text/css; charset=utf-8' }));
  app.get('/results/results.js', (c) =>
    c.text(readResults('results.js'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' }),
  );
  app.get('/results/results-demo.json', (c) =>
    c.text(readResults('results-demo.json'), 200, { 'Content-Type': 'application/json; charset=utf-8' }),
  );
}

export function clearRuns(): void {
  runs.clear();
}
