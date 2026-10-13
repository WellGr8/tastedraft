interface CacheEntry {
  expiresAt: number;
  body: unknown;
}

/** In-memory GET cache. Failures are not stored. */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

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
