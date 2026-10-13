import { createHash } from 'node:crypto';

interface Entry {
  expiresAt: number;
  body: unknown;
}

/** In-memory feature cache. Keys are a hash of the request. The API key is not part of the key or the body. */
export class FeatureCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static key(feature: string, body: unknown): string {
    return createHash('sha256').update(`${feature}\n${stable(body)}`).digest('hex');
  }

  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.body;
  }

  set(key: string, body: unknown): void {
    this.entries.set(key, { body, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
