import type { AppLoadContext } from "react-router";

// Hot read paths (home kitchen, search, recipe detail, account settings) query the
// request's D1 binding with raw prepared statements instead of Prisma. On the Worker,
// constructing a PrismaClient and running each query through its WASM engine costs far
// more CPU than the queries themselves, and Prisma issues nested reads one round trip at
// a time. These helpers send a page's independent reads as one `batch`: one round trip,
// no engine. Without a binding (unit tests, local scripts) callers keep using Prisma.

/** The slice of a D1 prepared statement the read paths use. */
export interface D1ReadStatement {
  bind(...values: unknown[]): D1ReadStatement;
}

/** The slice of a D1 binding the read paths use. */
export interface D1ReadDatabase {
  prepare(query: string): D1ReadStatement;
  batch(statements: D1ReadStatement[]): Promise<Array<{ results?: unknown[] }>>;
}

export type D1Row = Record<string, unknown>;

/** One statement of a read batch: its SQL and bound values. */
export type D1Query = readonly [sql: string, ...values: unknown[]];

/** The request's D1 binding, or null when there is none (unit tests, scripts). */
export function requestD1(context: AppLoadContext | null | undefined): D1ReadDatabase | null {
  const candidate = (context?.cloudflare?.env as { DB?: unknown } | undefined)?.DB;
  if (!candidate || typeof candidate !== "object") return null;
  const binding = candidate as Partial<D1ReadDatabase>;
  return typeof binding.prepare === "function" && typeof binding.batch === "function"
    ? (binding as D1ReadDatabase)
    : null;
}

/**
 * Runs read statements as one D1 batch (one round trip) and returns each statement's
 * rows in order. Any statement error rejects the whole batch; a result without a rows
 * array is treated as an error rather than as "no rows".
 */
export async function d1ReadBatch(db: D1ReadDatabase, queries: readonly D1Query[]): Promise<D1Row[][]> {
  const results = await db.batch(queries.map(([sql, ...values]) => db.prepare(sql).bind(...values)));
  if (results.length !== queries.length) {
    throw new Error(`D1 batch returned ${results.length} results for ${queries.length} statements`);
  }
  return results.map((result, index) => {
    if (!Array.isArray(result?.results)) {
      throw new Error(`D1 batch statement ${index} returned no result rows`);
    }
    return result.results as D1Row[];
  });
}

// SQLite's CURRENT_TIMESTAMP and other zone-less timestamps. Prisma reads them as UTC.
const ZONELESS_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * Converts a DateTime column the way Prisma does: ISO strings with a zone as written,
 * zone-less SQLite timestamps as UTC, and integer milliseconds (Prisma's native SQLite
 * storage). Anything else, or an unparseable value, is an error: a corrupt row must not
 * silently become "now" or null.
 */
export function d1DateTime(value: unknown, column: string): Date {
  let date: Date | null = null;
  if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    const zoneless = ZONELESS_TIMESTAMP.exec(value);
    date = new Date(zoneless ? `${zoneless[1]}T${zoneless[2]}Z` : value);
  }
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`D1 column ${column} is not a valid DateTime`);
  }
  return date;
}

/** A nullable DateTime column: SQL NULL is null, anything else must be a valid DateTime. */
export function d1NullableDateTime(value: unknown, column: string): Date | null {
  return value === null ? null : d1DateTime(value, column);
}

/** A Boolean column (SQLite stores 0 or 1). */
export function d1Boolean(value: unknown, column: string): boolean {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new Error(`D1 column ${column} is not a Boolean`);
}

/** A COUNT(*) or other integer aggregate. */
export function d1Count(value: unknown, column: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`D1 column ${column} is not a count`);
}

/** Groups rows by a key, keeping each group in row order. */
export function groupRows<T>(rows: readonly T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
