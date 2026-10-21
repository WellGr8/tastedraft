/**
 * Cloudflare Workers entry. One Durable Object ("main") hosts the Hono app so
 * the synchronous SQLite repositories, run store, and daily Qloo budget share
 * one strongly consistent database. The Qloo response cache lives in KV.
 */
import './engine.ts';
import { DurableObject } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { installSqlStorage, type SqlStorageLike } from './sqlite-shim.ts';
import { MIGRATIONS } from './migrations.generated.ts';

export interface Env {
  TASTEDRAFT: DurableObjectNamespace<TasteDraftApi>;
  QLOO_CACHE?: KVNamespace;
  [key: string]: unknown;
}

function stringEnv(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') out[name] = value;
  // Every SQLite file maps onto the Durable Object database.
  out.DATABASE_PATH = ':memory:';
  out.RUNS_PATH = ':memory:';
  out.QLOO_BUDGET_PATH = ':memory:';
  return out;
}

export class TasteDraftApi extends DurableObject<Env> {
  private app: Hono | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    installSqlStorage(ctx.storage.sql as unknown as SqlStorageLike);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      for (const [name, text] of MIGRATIONS) {
        if (sql.exec('SELECT name FROM _migrations WHERE name = ?', name).toArray().length) continue;
        for (const statement of text.split(';').map((s) => s.trim()).filter((s) => s && !/^PRAGMA/i.test(s))) {
          sql.exec(statement);
        }
        sql.exec('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', name, new Date().toISOString());
      }
    });
  }

  private async load(): Promise<Hono> {
    if (this.app) return this.app;
    const env = stringEnv(this.env);
    // Modules that read process.env directly (Qloo key, LLM key) see the same values.
    for (const [name, value] of Object.entries(env)) if (value !== undefined) process.env[name] = value;
    if (this.env.QLOO_CACHE) (globalThis as { __TD_QLOO_KV__?: unknown }).__TD_QLOO_KV__ = this.env.QLOO_CACHE;
    const { createApp } = await import('../app.ts');
    this.app = createApp({ env });
    return this.app;
  }

  override async fetch(request: Request): Promise<Response> {
    const app = await this.load();
    return app.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = new Headers(request.headers);
    // ops/rate-limit.ts keys on X-Forwarded-For.
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    const stub = env.TASTEDRAFT.get(env.TASTEDRAFT.idFromName('main'));
    return stub.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
