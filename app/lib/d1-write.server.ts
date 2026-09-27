import type { D1Query, D1ReadDatabase, D1Row } from "~/lib/d1-read.server";

// Prisma's D1 adapter ignores transactions: `$transaction([...])`, interactive transactions
// and nested writes all run as separate queries, so a failure part way leaves the earlier
// writes applied. A D1 `batch` is one SQLite transaction: every statement applies, or none
// does. Multi-statement writes that must be atomic therefore go to the request's D1 binding
// as one batch; Prisma remains the path where there is no binding (unit tests, scripts).

/** One statement's outcome in a write batch: the rows it returned and the rows it changed. */
export interface D1WriteResult {
  rows: D1Row[];
  changes: number;
}

/**
 * Runs statements as one atomic D1 batch. Any statement error rejects the batch and D1
 * rolls back every statement in it. A result without a rows array or a change count is
 * treated as an error.
 */
export async function d1WriteBatch(db: D1ReadDatabase, queries: readonly D1Query[]): Promise<D1WriteResult[]> {
  const results = await db.batch(queries.map(([sql, ...values]) => db.prepare(sql).bind(...values)));
  if (results.length !== queries.length) {
    throw new Error(`D1 batch returned ${results.length} results for ${queries.length} statements`);
  }
  return results.map((result, index) => {
    const changes = (result as { meta?: { changes?: unknown } } | undefined)?.meta?.changes;
    if (!Array.isArray(result?.results) || typeof changes !== "number") {
      throw new Error(`D1 batch statement ${index} returned no result`);
    }
    return { rows: result.results as D1Row[], changes };
  });
}

const GUARD_FAILURE = "malformed JSON";

/**
 * A batch statement that fails the whole batch, so nothing in it applies, unless
 * `condition` (an SQL boolean expression over the bound values) holds when the batch runs.
 * SQLite only has RAISE inside triggers, so the guard asks `json()` to parse text that is
 * not JSON when the condition is false; the text depends on the condition, so SQLite cannot
 * evaluate it ahead of time. Use it where a write was decided from rows read earlier, to
 * stop the batch if those rows changed in between.
 */
export function d1Guard(condition: string, ...values: unknown[]): D1Query {
  return [
    `SELECT json(CASE WHEN ${condition} THEN '0' ELSE 'batch precondition failed' END) AS "guard"`,
    ...values,
  ];
}

/** Whether a batch was rejected by a `d1Guard` statement. */
export function isD1GuardFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(GUARD_FAILURE);
}

/** A DateTime value as the D1 write paths store it (ISO 8601, UTC). */
export function d1Timestamp(value: Date): string {
  return value.toISOString();
}
