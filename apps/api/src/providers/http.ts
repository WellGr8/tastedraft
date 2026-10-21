import { TtlCache } from './cache.js';

export const USER_AGENT = 'TasteDraft/0.1 (Qloo Agentic Hackathon 2026; cultural evidence research)';

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

export interface JsonSuccess {
  ok: true;
  status: number;
  body: unknown;
  url: string;
}

export interface JsonFailure {
  ok: false;
  status?: number;
  url: string;
  timedOut: boolean;
  message: string;
}

export type JsonResult = JsonSuccess | JsonFailure;

export interface GetJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpClient {
  getJson(url: string, options?: GetJsonOptions): Promise<JsonResult>;
}

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  cache?: TtlCache;
  timeoutMs?: number;
  /** Minimum gap between requests to one host. MusicBrainz asks for about 1s. */
  minIntervalByHost?: Record<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const hostQueues = new WeakMap<HttpClient, Map<string, Promise<void>>>();

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function waitTurn(
  client: HttpClient,
  host: string,
  gapMs: number,
  lastAt: Map<string, number>,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (gapMs <= 0 || !host) return;
  let queues = hostQueues.get(client);
  if (!queues) {
    queues = new Map();
    hostQueues.set(client, queues);
  }
  const previous = queues.get(host) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(host, gate);
  await previous;
  const previousAt = lastAt.get(host);
  if (previousAt !== undefined) {
    const wait = gapMs - (now() - previousAt);
    if (wait > 0) await sleep(wait);
  }
  lastAt.set(host, now());
  release();
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const cache = options.cache;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const gaps = options.minIntervalByHost ?? { 'musicbrainz.org': 1100 };
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const lastAt = new Map<string, number>();
  const client: HttpClient = {
    async getJson(url, init) {
      const headers = init?.headers ?? {};
      const apiKey = headers['X-Api-Key'] ?? headers['x-api-key'] ?? '';
      const cacheKey = `${url}\n${apiKey}`;
      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== undefined) {
          return { ok: true, status: 200, body: cached, url };
        }
      }
      const host = hostnameOf(url);
      await waitTurn(client, host, gaps[host] ?? 0, lastAt, now, sleep);
      const limit = init?.timeoutMs ?? timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limit);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await response.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          return {
            ok: false,
            status: response.status,
            url,
            timedOut: false,
            message: `Response from ${host || url} was not JSON (HTTP ${response.status})`,
          };
        }
        if (response.status === 200 && cache) cache.set(cacheKey, body);
        return { ok: true, status: response.status, body, url };
      } catch (error) {
        clearTimeout(timer);
        const timedOut = controller.signal.aborted;
        const message = error instanceof Error ? error.message : 'Request failed';
        return {
          ok: false,
          status: undefined,
          url,
          timedOut,
          message: timedOut ? `Timed out after ${limit}ms calling ${host || url}` : message,
        };
      }
    },
  };
  return client;
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}
