/**
 * One door in front of Qloo for a run.
 * Caps concurrency, shares in-flight duplicates, backs off on 429/5xx,
 * and counts every attempt against the run budget.
 */
import type { QlooCallOptions, QlooInsightsParams, QlooResult, QlooSearchParams, QlooTagsParams } from '../providers/qloo/client.ts';
import { QlooClient } from '../providers/qloo/client.ts';

export interface GatewayOptions {
  budget: number;
  /** Calls already spent on this run before this gateway was built. */
  already?: number;
  concurrency?: number;
  /** First retry wait. Later waits double. */
  backoffMs?: number;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Caller = {
  readonly mode: 'live' | 'mock';
  insights(params: QlooInsightsParams, init?: QlooCallOptions): Promise<QlooResult>;
  search(params: QlooSearchParams, init?: QlooCallOptions): Promise<QlooResult>;
  tags(params: QlooTagsParams, init?: QlooCallOptions): Promise<QlooResult>;
};

export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          const next = waiting.shift();
          if (next) next();
        });
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function retryable(result: QlooResult): boolean {
  if (result.ok) return false;
  if (result.timedOut || result.status === undefined) return true;
  return result.status === 429 || result.status >= 500;
}

export class QlooGateway implements Caller {
  readonly mode: 'live' | 'mock';
  calls: number;
  private readonly budget: number;
  private readonly backoffMs: number;
  private readonly attempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly inflight = new Map<string, Promise<QlooResult>>();

  constructor(
    private readonly client: QlooClient,
    options: GatewayOptions,
  ) {
    this.mode = client.mode;
    this.budget = options.budget;
    this.calls = options.already ?? 0;
    this.backoffMs = options.backoffMs ?? 200;
    this.attempts = options.attempts ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limit = pLimit(options.concurrency ?? 4);
  }

  insights(params: QlooInsightsParams, init?: QlooCallOptions): Promise<QlooResult> {
    return this.call(`insights:${stable(params)}`, () => this.client.insights(params, init));
  }

  search(params: QlooSearchParams, init?: QlooCallOptions): Promise<QlooResult> {
    return this.call(`search:${stable(params)}`, () => this.client.search(params, init));
  }

  tags(params: QlooTagsParams, init?: QlooCallOptions): Promise<QlooResult> {
    return this.call(`tags:${stable(params)}`, () => this.client.tags(params, init));
  }

  private call(key: string, fn: () => Promise<QlooResult>): Promise<QlooResult> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.limit(() => this.attempt(fn));
    this.inflight.set(key, promise);
    void promise.finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    return promise;
  }

  private async attempt(fn: () => Promise<QlooResult>): Promise<QlooResult> {
    let last = this.exhausted();
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      if (this.calls >= this.budget) return this.exhausted();
      if (attempt > 0) await this.sleep(this.backoffMs * 2 ** (attempt - 1));
      if (this.calls >= this.budget) return this.exhausted();
      this.calls += 1;
      last = await fn();
      if (!retryable(last)) return last;
    }
    return last;
  }

  private exhausted(): QlooResult {
    return {
      ok: false,
      mode: this.mode,
      url: 'budget',
      timedOut: false,
      message: 'Qloo call budget exhausted',
    };
  }
}
