/**
 * Worker stand-in for `node:sqlite` (aliased at build time, see scripts/build-worker.mjs).
 * Every DatabaseSync opened inside the Worker writes to the Durable Object's
 * SQLite storage, which keeps the synchronous API the repositories were written
 * against. BEGIN/COMMIT/ROLLBACK and PRAGMA are dropped: a Durable Object runs
 * one synchronous block at a time and commits it atomically.
 */
interface SqlCursor {
  toArray(): Record<string, unknown>[];
  readonly rowsWritten: number;
}
export interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}

let storage: SqlStorageLike | null = null;

export function installSqlStorage(sql: SqlStorageLike): void {
  storage = sql;
}

function sql(): SqlStorageLike {
  if (!storage) throw new Error('Durable Object SQL storage is not installed');
  return storage;
}

const SKIP = /^\s*(PRAGMA|BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i;

function statements(text: string): string[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !SKIP.test(part));
}

function bind(args: unknown[]): unknown[] {
  return args.map((value) => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value));
}

class StatementSync {
  constructor(private readonly text: string) {}
  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    if (SKIP.test(this.text)) return { changes: 0, lastInsertRowid: 0 };
    const cursor = sql().exec(this.text, ...bind(args));
    cursor.toArray();
    return { changes: cursor.rowsWritten, lastInsertRowid: 0 };
  }
  get(...args: unknown[]): Record<string, unknown> | undefined {
    if (SKIP.test(this.text)) return undefined;
    return sql().exec(this.text, ...bind(args)).toArray()[0];
  }
  all(...args: unknown[]): Record<string, unknown>[] {
    if (SKIP.test(this.text)) return [];
    return sql().exec(this.text, ...bind(args)).toArray();
  }
}

export class DatabaseSync {
  constructor(_path?: string) {}
  exec(text: string): void {
    for (const statement of statements(text)) sql().exec(statement);
  }
  prepare(text: string): StatementSync {
    return new StatementSync(text);
  }
  close(): void {}
}
