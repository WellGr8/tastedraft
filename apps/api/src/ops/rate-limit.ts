/**
 * Fixed-window limit per client address.
 * Caddy overwrites X-Forwarded-For, so the first hop is the visitor.
 * /api/health stays open for the platform probe.
 */
import type { MiddlewareHandler } from 'hono';

interface Bucket {
  count: number;
  reset: number;
}

export function clientAddress(header: (name: string) => string | undefined): string {
  const forwarded = header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = header('x-real-ip')?.trim();
  return real || 'local';
}

export function rateLimitPerMinute(env: Record<string, string | undefined>): number {
  const raw = env.RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return 60;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error('Invalid RATE_LIMIT_PER_MINUTE');
  }
  return value;
}

export function rateLimit(options: { limit: number; windowMs: number; now?: () => number }): MiddlewareHandler {
  const hits = new Map<string, Bucket>();
  const now = options.now ?? (() => Date.now());
  return async (c, next) => {
    if (c.req.path === '/api/health') {
      await next();
      return;
    }
    const clock = now();
    const ip = clientAddress((name) => c.req.header(name));
    const row = hits.get(ip);
    if (!row || clock >= row.reset) {
      hits.set(ip, { count: 1, reset: clock + options.windowMs });
      await next();
      return;
    }
    if (row.count >= options.limit) {
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests from this address.' } }, 429);
    }
    row.count += 1;
    await next();
  };
}
