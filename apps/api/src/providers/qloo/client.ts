/**
 * Hackathon Qloo client.
 *
 * Base URL: https://hackathon.api.qloo.com
 * Auth header: X-Api-Key
 * Calls: GET /search, GET /v2/tags, GET /v2/insights
 *
 * Nested `signal`, `filter`, `feature`, and `output` objects become dotted
 * query keys (`signal.interests.entities`, `feature.explainability`).
 * A sibling dotted key sets a weight the same object cannot hold twice:
 * `{ interests: { entities: 'id' }, 'interests.entities.weight': 0.8 }`.
 * The hackathon guide says POST JSON fails, so this client only sends GET.
 *
 * Mock mode (no API key): no network call. Bodies come from `mock-data.ts`,
 * a small authored stand-in for insights and heatmap tests. Search does not
 * use that catalog. Live 200 bodies are stored under `server/data/qloo-cache`,
 * which is gitignored. The API key is a cache-key hash only. It is never
 * written into a file, a log line, or an error message.
 *
 * Live calls are paced, timed out, and retried on 429, 5xx, and network
 * errors. A non-2xx response is a failure. Callers keep going.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_CACHE_TTL_MS, DEFAULT_TIMEOUT_MS, USER_AGENT } from '../http.js';
import { mockQlooBody } from './mock-data.js';

export const QLOO_HACKATHON_BASE_URL = 'https://hackathon.api.qloo.com';
export const QLOO_API_KEY_HEADER = 'X-Api-Key';

const QlooEnvelopeSchema = z
  .object({
    success: z.boolean().optional(),
    duration: z.number().optional(),
    results: z.unknown().optional(),
    mock: z.literal(true).optional(),
  })
  .passthrough();

export type QlooEnvelope = z.infer<typeof QlooEnvelopeSchema>;

export type QlooMode = 'live' | 'mock';

export type QlooParamValue = string | number | boolean | QlooParamValue[] | { [key: string]: QlooParamValue | undefined };

export interface QlooSearchParams {
  query: string;
  types?: string;
  take?: number;
  page?: number;
}

export interface QlooTagsParams {
  filter?: { [key: string]: QlooParamValue | undefined };
  feature?: {
    semantic_search?: boolean;
    [key: string]: QlooParamValue | undefined;
  };
  take?: number;
  page?: number;
}

export interface QlooInsightsParams {
  filter?: { [key: string]: QlooParamValue | undefined };
  signal?: { [key: string]: QlooParamValue | undefined };
  feature?: {
    explainability?: boolean;
    [key: string]: QlooParamValue | undefined;
  };
  output?: { [key: string]: QlooParamValue | undefined };
  take?: number;
  page?: number;
  /** Dotted keys that are not nested above, such as `heatmap.dimensions`. */
  extra?: Record<string, string | number | boolean>;
}

export interface QlooCallOptions {
  timeoutMs?: number;
  /** Live 200 responses are cached unless this is false. Mock calls never touch the cache. */
  cache?: boolean;
}

export interface QlooSuccess {
  ok: true;
  status: number;
  mode: QlooMode;
  url: string;
  cached: boolean;
  body: QlooEnvelope;
}

export interface QlooFailure {
  ok: false;
  status?: number;
  mode: QlooMode;
  url: string;
  timedOut: boolean;
  message: string;
}

export type QlooResult = QlooSuccess | QlooFailure;

export interface QlooClientOptions {
  /** Defaults to `QLOO_API_KEY`. Blank or omitted with no env key selects mock mode. */
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheDir?: string;
  cacheTtlMs?: number;
  now?: () => number;
  /** Extra attempts after the first live call. 4xx other than 429 are not retried. */
  retries?: number;
  /** Base backoff before the first retry. Later retries double it. */
  retryDelayMs?: number;
  /** Minimum gap between live calls on this client. `0` turns pacing off. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Live network admission. Return false to skip the request.
   * Cache hits do not ask. Mock mode does not ask.
   */
  admitLive?: () => boolean;
}

interface CacheFile {
  v: 1;
  storedAt: number;
  body: unknown;
}

export function defaultQlooCacheDir(): string {
  return fileURLToPath(new URL('../../../../../server/data/qloo-cache/', import.meta.url));
}

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MIN_INTERVAL_MS = 200;

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten nested params into dotted query keys. Null and undefined are omitted. */
export function appendQlooParams(params: URLSearchParams, input: Record<string, unknown>): void {
  const flat = new Map<string, string>();
  const visit = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      if (prefix) flat.set(prefix, String(value));
      return;
    }
    if (Array.isArray(value)) {
      if (!prefix) return;
      const parts = value.filter((item) => item !== undefined && item !== null).map((item) => String(item));
      flat.set(prefix, parts.join(','));
      return;
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value).sort()) {
        visit(prefix ? `${prefix}.${key}` : key, value[key]);
      }
    }
  };
  visit('', input);
  for (const key of [...flat.keys()].sort()) {
    params.set(key, flat.get(key) ?? '');
  }
}

function readKey(options: QlooClientOptions): string {
  const fromOptions = options.apiKey;
  const raw = fromOptions !== undefined ? fromOptions : (process.env.QLOO_API_KEY ?? '');
  return raw.trim();
}

function sanitizeMessage(message: string): string {
  return message.replace(/hack_[a-z0-9]+/gi, '[redacted]').slice(0, 240);
}

function failureMessage(body: QlooEnvelope, status: number): string {
  const record = body as { error?: unknown; message?: unknown };
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return sanitizeMessage(error.trim());
  if (Array.isArray(error)) {
    const first = error.find((item) => item && typeof item === 'object' && 'message' in item) as { message?: unknown } | undefined;
    if (typeof first?.message === 'string' && first.message.trim()) return sanitizeMessage(first.message.trim());
  }
  if (typeof record.message === 'string' && record.message.trim()) return sanitizeMessage(record.message.trim());
  if (body.success === false) return `Qloo returned success: false (HTTP ${status})`;
  return `Qloo returned HTTP ${status}`;
}

function retryable(result: QlooResult): boolean {
  if (result.ok) return false;
  if (result.timedOut || result.status === undefined) return true;
  return result.status === 429 || result.status === 500 || result.status === 502 || result.status === 503 || result.status === 504;
}

export class QlooClient {
  readonly mode: QlooMode;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheDir: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly admitLive: (() => boolean) | null;
  private tail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: QlooClientOptions = {}) {
    this.apiKey = readKey(options);
    this.mode = this.apiKey ? 'live' : 'mock';
    this.baseUrl = (options.baseUrl ?? QLOO_HACKATHON_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = positive(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.cacheDir = options.cacheDir ?? process.env.QLOO_CACHE_DIR ?? defaultQlooCacheDir();
    this.admitLive = options.admitLive ?? null;
    this.cacheTtlMs = positive(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.now = options.now ?? (() => Date.now());
    this.retries = Math.min(4, Math.floor(nonNegative(options.retries, DEFAULT_RETRIES)));
    this.retryDelayMs = nonNegative(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
    this.minIntervalMs = nonNegative(options.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  search(params: QlooSearchParams, init?: QlooCallOptions): Promise<QlooResult> {
    return this.get('/search', { ...params }, init);
  }

  tags(params: QlooTagsParams, init?: QlooCallOptions): Promise<QlooResult> {
    return this.get('/v2/tags', { ...params }, init);
  }

  insights(params: QlooInsightsParams, init?: QlooCallOptions): Promise<QlooResult> {
    const { extra, ...rest } = params;
    return this.get('/v2/insights', { ...(extra ?? {}), ...rest }, init);
  }

  private async get(path: string, input: Record<string, unknown>, init?: QlooCallOptions): Promise<QlooResult> {
    const params = new URLSearchParams();
    appendQlooParams(params, input);
    const url = `${this.baseUrl}${path}?${params.toString()}`;
    if (this.mode === 'mock') {
      return {
        ok: true,
        status: 200,
        mode: 'mock',
        url,
        cached: false,
        body: QlooEnvelopeSchema.parse(mockQlooBody(path, params)),
      };
    }

    const useCache = init?.cache !== false;
    if (useCache) {
      const cached = this.readCache(url);
      if (cached) {
        return { ok: true, status: 200, mode: 'live', url, cached: true, body: cached };
      }
    }

    if (this.admitLive && !this.admitLive()) {
      return {
        ok: false,
        status: 403,
        mode: 'live',
        url: path,
        timedOut: false,
        message: 'Daily Qloo budget reached',
      };
    }

    const timeoutMs = positive(init?.timeoutMs, this.timeoutMs);
    let last: QlooResult = {
      ok: false,
      mode: 'live',
      url,
      timedOut: false,
      message: 'Request failed',
    };
    const attempts = this.retries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
      await this.pace();
      last = await this.once(url, timeoutMs, useCache);
      if (last.ok || !retryable(last)) break;
    }
    return last;
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const previous = this.tail;
    let release: () => void = () => {};
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.lastRequestAt > 0) {
        const wait = this.lastRequestAt + this.minIntervalMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastRequestAt = this.now();
    } finally {
      release();
    }
  }

  private async once(url: string, timeoutMs: number, useCache: boolean): Promise<QlooResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          [QLOO_API_KEY_HEADER]: this.apiKey,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        return {
          ok: false,
          status: response.status,
          mode: 'live',
          url,
          timedOut: false,
          message: `Response was not JSON (HTTP ${response.status})`,
        };
      }
      const body = QlooEnvelopeSchema.safeParse(parsed);
      if (!body.success) {
        return {
          ok: false,
          status: response.status,
          mode: 'live',
          url,
          timedOut: false,
          message: `Response was not a Qloo JSON object (HTTP ${response.status})`,
        };
      }
      if (response.status < 200 || response.status >= 300 || body.data.success === false) {
        return {
          ok: false,
          status: response.status,
          mode: 'live',
          url,
          timedOut: false,
          message: failureMessage(body.data, response.status),
        };
      }
      if (useCache) {
        try {
          this.writeCache(url, body.data);
        } catch {
          // A full disk must not turn a successful response into a failure.
        }
      }
      return { ok: true, status: response.status, mode: 'live', url, cached: false, body: body.data };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const raw = error instanceof Error ? error.message : 'Request failed';
      return {
        ok: false,
        mode: 'live',
        url,
        timedOut,
        message: timedOut ? `Timed out after ${timeoutMs}ms calling ${this.baseUrl}` : sanitizeMessage(raw),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private cachePath(url: string): string {
    const keyHash = createHash('sha256').update(this.apiKey).digest('hex').slice(0, 12);
    const file = createHash('sha256').update(`${keyHash}\n${url}`).digest('hex');
    return join(this.cacheDir, `${file}.json`);
  }

  private readCache(url: string): QlooEnvelope | undefined {
    try {
      const raw = JSON.parse(readFileSync(this.cachePath(url), 'utf8')) as CacheFile;
      if (raw.v !== 1 || typeof raw.storedAt !== 'number') return undefined;
      if (raw.storedAt + this.cacheTtlMs <= this.now()) return undefined;
      const body = QlooEnvelopeSchema.safeParse(raw.body);
      return body.success ? body.data : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(url: string, body: QlooEnvelope): void {
    const file: CacheFile = { v: 1, storedAt: this.now(), body };
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(this.cachePath(url), JSON.stringify(file));
  }
}
