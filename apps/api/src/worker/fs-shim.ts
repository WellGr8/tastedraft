/**
 * Worker stand-in for `node:fs` (aliased at build time).
 * Reads come from files bundled by scripts/build-worker.mjs (split/ assets,
 * run recordings, case studies). Writes stay in memory for the isolate's life;
 * durable data lives in Durable Object SQLite and the Qloo cache in KV.
 */
import { files } from './vfs.generated.ts';

const memory = new Map<string, string>(Object.entries(files));

function key(path: unknown): string {
  const text = String(path instanceof URL ? path.pathname : path);
  return text.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function enoent(path: string): Error {
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code: string };
  error.code = 'ENOENT';
  return error;
}

export function existsSync(path: unknown): boolean {
  const k = key(path);
  if (memory.has(k)) return true;
  const dir = k.endsWith('/') ? k : `${k}/`;
  for (const name of memory.keys()) if (name.startsWith(dir)) return true;
  return false;
}

export function readFileSync(path: unknown, _encoding?: unknown): string {
  const k = key(path);
  const value = memory.get(k);
  if (value === undefined) throw enoent(k);
  return value;
}

export function writeFileSync(path: unknown, data: unknown): void {
  memory.set(key(path), typeof data === 'string' ? data : String(data));
}

export function mkdirSync(_path: unknown, _options?: unknown): undefined {
  return undefined;
}

export function readdirSync(path: unknown): string[] {
  const dir = `${key(path).replace(/\/$/, '')}/`;
  const names = new Set<string>();
  for (const name of memory.keys()) {
    if (name.startsWith(dir)) names.add(name.slice(dir.length).split('/')[0]!);
  }
  return [...names];
}

export default { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync };
