/**
 * Process-wide daily cap on live Qloo calls.
 * A refused call does not touch the network. The agent runner then plays a Recorded run.
 * The counter lives in SQLite so a restart on the same volume does not reset the day.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const pools = new Map<string, DailyQlooBudget>();

export class DailyQlooBudget {
  constructor(
    private readonly db: DatabaseSync,
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS qloo_daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL)`);
  }

  day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  used(): number {
    const row = this.db.prepare(`SELECT used FROM qloo_daily WHERE day = ?`).get(this.day()) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  exhausted(): boolean {
    return this.used() >= this.limit;
  }

  /** Reserve one live call. False when the day is already at the cap. */
  tryTake(): boolean {
    if (this.limit <= 0) return false;
    const day = this.day();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT used FROM qloo_daily WHERE day = ?`).get(day) as { used: number } | undefined;
      const used = row?.used ?? 0;
      if (used >= this.limit) {
        this.db.exec('COMMIT');
        return false;
      }
      if (row) this.db.prepare(`UPDATE qloo_daily SET used = ? WHERE day = ?`).run(used + 1, day);
      else this.db.prepare(`INSERT INTO qloo_daily (day, used) VALUES (?, 1)`).run(day);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Default live Qloo calls per UTC day when QLOO_DAILY_BUDGET is unset. */
export const DEFAULT_DAILY_BUDGET = 1000;

export function budgetLimit(env: Record<string, string | undefined>): number {
  const raw = env.QLOO_DAILY_BUDGET?.trim();
  if (!raw) return DEFAULT_DAILY_BUDGET;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new Error('Invalid QLOO_DAILY_BUDGET');
  }
  return value;
}

export function openDailyQlooBudget(env: Record<string, string | undefined> = process.env, path?: string): DailyQlooBudget {
  const limit = budgetLimit(env);
  const file = path ?? env.QLOO_BUDGET_PATH ?? 'data/qloo-budget.sqlite';
  const key = `${file}:${limit}`;
  const existing = pools.get(key);
  if (existing) return existing;
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  const budget = new DailyQlooBudget(db, limit);
  pools.set(key, budget);
  return budget;
}
