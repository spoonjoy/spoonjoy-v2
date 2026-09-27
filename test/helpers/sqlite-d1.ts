import { resolve } from "node:path";
import Database from "better-sqlite3";

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
    batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[]; success: true; meta: Record<string, unknown> }>>;
  };
  /** Every statement run, in order. */
  statements: RecordedStatement[];
  /** Number of round trips: one per `first`/`all`/`run`, one per `batch`. */
  roundTrips: () => number;
  close(): void;
}

export function sqliteD1(path = resolve(__dirname, "../../prisma/test.db")): SqliteD1 {
  const sqlite = new Database(path);
  const statements: RecordedStatement[] = [];
  let roundTrips = 0;

  function execute(statement: FakeStatement): unknown[] {
    statements.push({ sql: statement.sql, params: statement.params });
    const prepared = sqlite.prepare(statement.sql);
    if (prepared.reader) return prepared.all(...statement.params) as unknown[];
    prepared.run(...statement.params);
    return [];
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
      return sqlite.transaction(() =>
        batchStatements.map((statement) => ({ results: execute(statement), success: true as const, meta: {} })),
      )();
    },
  };

  return { binding, statements, roundTrips: () => roundTrips, close: () => sqlite.close() };
}
