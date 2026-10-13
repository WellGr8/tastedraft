/**
 * Runs and steps on their own SQLite file so the project database stays put.
 * WAL lets a reconnecting SSE reader see steps the runner just wrote.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RunSnapshotSchema, StepSchema, type RunSnapshot, type Step } from '@tastedraft/contracts';
import type { BriefV2 } from '@tastedraft/contracts';

export type RunPhase = 'personas' | 'interview' | 'frictions' | 'evidence' | 'gate' | 'simulate' | 'reinterview' | 'done';

export interface RunRecord {
  brief: BriefV2;
  target: number | null;
  applied: string[];
  forced: boolean;
  phase: RunPhase;
  snapshot: RunSnapshot;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (run_id, seq)
);
`;

export class RunStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 3000');
    this.db.exec(SCHEMA);
  }

  create(record: RunRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO runs (id, status, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(record.snapshot.id, record.snapshot.status, JSON.stringify(record), now, now);
  }

  save(record: RunRecord, step?: Step): void {
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      if (step) {
        this.db
          .prepare(`INSERT INTO steps (id, run_id, seq, kind, label, detail) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(step.id, record.snapshot.id, step.seq, step.kind, step.label, step.detail);
      }
      this.db
        .prepare(`UPDATE runs SET status = ?, state_json = ?, updated_at = ? WHERE id = ?`)
        .run(record.snapshot.status, JSON.stringify(record), now, record.snapshot.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  read(id: string): RunRecord | null {
    const row = this.db.prepare(`SELECT state_json FROM runs WHERE id = ?`).get(id) as { state_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.state_json) as RunRecord;
  }

  snapshot(id: string): RunSnapshot | null {
    const record = this.read(id);
    if (!record) return null;
    return RunSnapshotSchema.parse(record.snapshot);
  }

  /** Steps with seq greater than `afterSeq`, in order. */
  listSteps(runId: string, afterSeq: number): Step[] {
    const rows = this.db
      .prepare(`SELECT id, seq, kind, label, detail FROM steps WHERE run_id = ? AND seq > ? ORDER BY seq ASC`)
      .all(runId, afterSeq) as Array<{ id: string; seq: number; kind: string; label: string; detail: string }>;
    return rows.map((row) => StepSchema.parse(row));
  }

  close(): void {
    this.db.close();
  }
}
