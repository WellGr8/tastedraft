/**
 * Nightly copy of the SQLite files on the data volume.
 * Checkpoints WAL first so the copy is a single consistent file.
 * Keeps about two weeks. Does not print database contents.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = process.env.BACKUP_DIR || '/data/backups';
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || '14');
const sources = [
  process.env.DATABASE_PATH,
  process.env.RUNS_PATH,
  process.env.QLOO_BUDGET_PATH,
].filter((path) => typeof path === 'string' && path.length > 0);

function checkpoint(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function backupOnce() {
  mkdirSync(dir, { recursive: true });
  const day = stamp();
  for (const path of sources) {
    if (!existsSync(path)) continue;
    checkpoint(path);
    const base = path.split('/').pop();
    copyFileSync(path, join(dir, `${base}.${day}`));
  }
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
  }
  console.log(`backup ${day} files=${sources.length}`);
}

const once = process.argv.includes('--once');
if (once) {
  backupOnce();
} else {
  const waitMs = 24 * 60 * 60 * 1000;
  const loop = async () => {
    for (;;) {
      try {
        backupOnce();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'backup failed';
        console.error(message.replace(/hack_[a-z0-9]+/gi, '[redacted]').slice(0, 200));
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
  await loop();
}
