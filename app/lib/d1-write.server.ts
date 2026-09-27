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
  let results: Array<{ results?: unknown[] }>;
  try {
    results = await db.batch(queries.map(([sql, ...values]) => db.prepare(sql).bind(...values)));
  } catch (error) {
    throw isGuardFailureMessage(error) ? new D1GuardFailure(error) : error;
  }
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
 * A batch was stopped by one of its `d1Guard` statements: nothing in it applied. The
 * callers map this to the answer their own checks give (not found, a title conflict, a
 * changed step), usually by running those checks again.
 */
export class D1GuardFailure extends Error {
  constructor(cause: unknown) {
    super("A D1 batch precondition no longer held, so nothing in the batch was applied", { cause });
    this.name = "D1GuardFailure";
  }
}

function isGuardFailureMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(GUARD_FAILURE);
}

/**
 * A batch statement that fails the whole batch, so nothing in it applies, unless
 * `condition` (an SQL boolean expression over the bound values) holds when the batch runs.
 * SQLite only has RAISE inside triggers, so the guard asks `json()` to parse text that is
 * not JSON when the condition is false; the text depends on the condition, so SQLite cannot
 * evaluate it ahead of time. Use it where a write was decided from rows read earlier, to
 * stop the batch if those rows changed in between. `d1WriteBatch` turns the failure into a
 * `D1GuardFailure`. The failure does not say which guard fired, so a caller that needs to
 * tell guards apart re-runs its checks; and no batch statement may parse other JSON with
 * `json()`, whose "malformed JSON" error would look the same.
 */
export function d1Guard(condition: string, ...values: unknown[]): D1Query {
  return [
    `SELECT json(CASE WHEN ${condition} THEN '0' ELSE 'batch precondition failed' END) AS "guard"`,
    ...values,
  ];
}

/** Whether a batch was stopped by a `d1Guard` statement. */
export function isD1GuardFailure(error: unknown): error is D1GuardFailure {
  return error instanceof D1GuardFailure;
}

/**
 * Runs `attempt` again, up to `attempts` times in all, while its batch is stopped by a guard:
 * each run re-reads and re-checks, so it either writes against the current rows or returns
 * the answer its checks now give. `exhausted` answers if every run lost a race.
 */
export async function retryOnD1GuardFailure<T>(
  attempt: () => Promise<T>,
  exhausted: () => T,
  attempts = 3,
): Promise<T> {
  for (let run = 1; run <= attempts; run++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isD1GuardFailure(error)) throw error;
    }
  }
  return exhausted();
}

/**
 * A DateTime value as the D1 write paths store it (ISO 8601, UTC, with `Z`). Prisma's D1
 * adapter writes `+00:00` instead. Both read back as the same instant, and native sync's
 * `updatedAt >= cursor` comparison still includes every row, but a new raw SQL equality or
 * `<`/`<=` comparison on these text columns must not assume one format.
 */
export function d1Timestamp(value: Date): string {
  return value.toISOString();
}
