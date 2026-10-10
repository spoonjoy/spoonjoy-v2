import Database from "better-sqlite3";
import { workerDbPath } from "../support/worker-db";

// A fake D1 binding over the real unit-test database (prisma/test.db), so raw D1 read
// paths run their exact SQL against the real schema without Prisma. It implements the
// slice of D1 the app uses: prepare/bind, first/all/run, and batch. Every executed
// statement is recorded so tests can assert round trips and that Prisma was not used.

export interface RecordedStatement {
  sql: string;
  params: unknown[];
}

interface FakeStatement {
  sql: string;
  params: unknown[];
  bind(...values: unknown[]): FakeStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }>;
  run(): Promise<{ results: []; success: true; meta: { changes: number } }>;
}

export interface SqliteD1 {
  binding: {
    prepare(sql: string): FakeStatement;
    batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[]; success: true; meta: { changes: number } }>>;
  };
  /** Every statement run, in order. */
  statements: RecordedStatement[];
  /** Number of round trips: one per `first`/`all`/`run`, one per `batch`. */
  roundTrips: () => number;
  close(): void;
}

export function sqliteD1(source: string | Database.Database = workerDbPath()): SqliteD1 {
  const sqlite = typeof source === "string" ? new Database(source) : source;
  const statements: RecordedStatement[] = [];
  let roundTrips = 0;

  function executeWithChanges(statement: FakeStatement): { rows: unknown[]; changes: number } {
    statements.push({ sql: statement.sql, params: statement.params });
    const prepared = sqlite.prepare(statement.sql);
    if (prepared.reader) {
      const rows = prepared.all(...statement.params) as unknown[];
      // A write with RETURNING changes the rows it returns; a plain read changes none.
      return { rows, changes: prepared.readonly ? 0 : rows.length };
    }
    return { rows: [], changes: prepared.run(...statement.params).changes };
  }

  function execute(statement: FakeStatement): unknown[] {
    return executeWithChanges(statement).rows;
  }

  function makeStatement(sql: string, params: unknown[] = []): FakeStatement {
    const statement: FakeStatement = {
      sql,
      params,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      first: async <T>() => {
        roundTrips += 1;
        return ((execute(statement)[0] as T | undefined) ?? null);
      },
      all: async <T>() => {
        roundTrips += 1;
        return { results: execute(statement) as T[], success: true as const, meta: {} };
      },
      run: async () => {
        roundTrips += 1;
        const changes = sqlite.prepare(sql).run(...params).changes;
        statements.push({ sql, params });
        return { results: [] as [], success: true as const, meta: { changes } };
      },
    };
    return statement;
  }

  const binding = {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (batchStatements: FakeStatement[]) => {
      roundTrips += 1;
      // One SQLite transaction, as a D1 batch is: a failing statement rolls back the rest.
      return sqlite.transaction(() =>
        batchStatements.map((statement) => {
          const { rows, changes } = executeWithChanges(statement);
          return { results: rows, success: true as const, meta: { changes } };
        }),
      )();
    },
  };

  return { binding, statements, roundTrips: () => roundTrips, close: () => sqlite.close() };
}
