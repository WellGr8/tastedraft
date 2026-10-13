/**
 * Load a local .env for `npm run dev` / `npm start`.
 * Existing process env wins, so tests that set keys are left alone.
 * This module is imported only from the server entry, not from the test graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
  join(process.cwd(), '.env.local'),
  join(process.cwd(), '.env'),
  join(process.cwd(), '..', '..', '.env.local'),
  join(process.cwd(), '..', '..', '.env'),
  join(here, '..', '.env.local'),
  join(here, '..', '.env'),
  join(here, '..', '..', '..', '.env.local'),
  join(here, '..', '..', '..', '.env'),
];

function applyFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const path of candidates) applyFile(path);
