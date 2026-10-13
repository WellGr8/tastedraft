import { join } from 'node:path';

function readPort(): number {
  const raw = process.env.PORT ?? '8787';
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return value;
}

export const config = {
  /** Render and other hosts require 0.0.0.0, not localhost. */
  host: process.env.HOST ?? '0.0.0.0',
  port: readPort(),
  databasePath: process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'tastedraft.sqlite'),
};
