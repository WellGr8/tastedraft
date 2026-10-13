import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { config } from './config.ts';
import type { EvidenceProvider } from './domain/evidence-provider.ts';
import type { LlmClient } from './domain/llm.ts';
import type { ProjectRepository } from './domain/repository.ts';
import { AppError } from './errors.ts';
import { createRoutes } from './api/routes.ts';
import { mountAgent } from './agent/http.ts';
import { createOrchestrator } from './orchestrator/index.ts';
import { openRepository } from './persistence/sqlite-repository.ts';
import { createEngineLlm } from './wiring/llm.ts';
import { createConfiguredProvider } from './wiring/provider.ts';

export interface AppOptions {
  repository?: ProjectRepository;
  /** Real provider. Defaults to sample, fallback, or qloo from the environment. */
  provider?: EvidenceProvider;
  /** Score-free interpreter. Defaults to server/src/llm (offline without LLM_API_KEY). */
  llm?: LlmClient;
  databasePath?: string;
  env?: { EVIDENCE_PROVIDER?: string; QLOO_API_KEY?: string; LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string };
}

function screenHtml(): string | null {
  const page = join(dirname(fileURLToPath(import.meta.url)), '../../dist/TasteDraft.dc.html');
  if (!existsSync(page)) return null;
  let html = readFileSync(page, 'utf8');
  // The shell unpacks an embedded page and replaceWith()s documentElement, which
  // drops attributes on the outer <html>. Mark both roots, and set a window global
  // before that swap so the screen still sees the API origin.
  html = html.replace('<html>', '<html data-tastedraft-api="same-origin">');
  html = html.replace(
    '<html lang=\\"th\\">',
    '<html lang=\\"th\\" data-tastedraft-api=\\"same-origin\\">',
  );
  const boot = '<script>window.__TASTEDRAFT_API_BASE__=location.origin;</script>';
  // The client source mentions this name, so match the boot tag itself.
  if (!html.includes(boot)) html = html.replace('<head>', '<head>' + boot);
  return html;
}

export function createApp(options: AppOptions = {}): Hono {
  const env = options.env ?? process.env;
  const repository = options.repository ?? openRepository(options.databasePath ?? config.databasePath);
  const orchestrator = createOrchestrator({
    repository,
    provider: options.provider ?? createConfiguredProvider(env),
    llm: options.llm ?? createEngineLlm(env),
  });
  const app = new Hono();
  app.use('*', cors());
  app.route('/', createRoutes(orchestrator));
  // Team D wiring: agent routes and the results demo. Owned code lives in server/src/agent and split/results*.
  mountAgent(app);
  const splitDir = join(dirname(fileURLToPath(import.meta.url)), '../../split');
  const asset = (name: string, type: string) => {
    app.get(`/assets/${name}`, (c) => {
      const file = join(splitDir, name);
      if (!existsSync(file)) return c.text('Missing asset', 404);
      return c.text(readFileSync(file, 'utf8'), 200, { 'Content-Type': type });
    });
  };
  asset('map.js', 'text/javascript; charset=utf-8');
  asset('map.css', 'text/css; charset=utf-8');
  app.get('/', (c) => {
    const html = screenHtml();
    if (!html) {
      return c.text('Build the screen first: npm run build:web', 503);
    }
    return c.html(html);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      return c.json({ error: { code: 'bad_request', message } }, 400);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });
  return app;
}
