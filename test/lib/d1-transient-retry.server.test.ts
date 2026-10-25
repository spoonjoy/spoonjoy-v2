// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectConsoleWarning } from "../warning-policy";
import {
  d1TransientKind,
  DEFAULT_D1_RETRY_DELAYS_MS,
  isReadOnlySql,
  withD1TransientRetry,
  withTransientD1Retry,
  type D1TransientErrorReport,
  type RetryableD1Database,
  type RetryableD1Statement,
} from "~/lib/d1-transient-retry.server";
import type { SlowCallReport } from "~/lib/slow-call.server";

const NETWORK_LOST = new Error("D1_ERROR: Network connection lost.");
const STARTUP_FAILED = new Error("D1_ERROR: Internal error while starting up D1 DB storage.");
const UNIQUE = new Error("D1_ERROR: UNIQUE constraint failed: Recipe.id: SQLITE_CONSTRAINT");

/** A fake binding whose calls fail with the queued errors, in order, then succeed. */
function fakeD1(failures: unknown[] = []) {
  const calls: Array<{ call: string; sql: string | string[]; values: unknown[] }> = [];
  const queue = [...failures];
  const settle = (result: unknown) => {
    const failure = queue.shift();
    return failure === undefined ? Promise.resolve(result) : Promise.reject(failure);
  };
  const statement = (sql: string, values: unknown[] = []): RetryableD1Statement & { sql: string; values: unknown[] } => ({
    sql,
    values,
    bind: (...next: unknown[]) => statement(sql, next),
    first: (...args: unknown[]) => {
      calls.push({ call: "first", sql, values: [...values, ...args] });
      return settle({ ok: 1 });
    },
    all: () => {
      calls.push({ call: "all", sql, values });
      return settle({ results: [{ ok: 1 }] });
    },
    raw: (...args: unknown[]) => {
      calls.push({ call: "raw", sql, values: [...values, ...args] });
      return settle([["ok"], [1]]);
    },
    run: () => {
      calls.push({ call: "run", sql, values });
      return settle({ meta: { changes: 1 } });
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: (statements: Array<{ sql: string; values: unknown[] }>) => {
      calls.push({ call: "batch", sql: statements.map((s) => s.sql), values: statements.map((s) => s.values) });
      return settle(statements.map(() => ({ results: [], meta: { changes: 0 } })));
    },
    exec(this: unknown, sql: string) {
      calls.push({ call: "exec", sql, values: [] });
      return Promise.resolve({ count: 1, self: this });
    },
    marker: "binding",
  };
  return { db: db as unknown as RetryableD1Database & typeof db, calls };
}

function harness(failures: unknown[] = [], delaysMs: number[] = [1, 2, 3]) {
  const { db, calls } = fakeD1(failures);
  const reports: D1TransientErrorReport[] = [];
  const sleeps: number[] = [];
  const wrapped = withD1TransientRetry(db, {
    delaysMs,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onTransientError: (report) => reports.push(report),
  });
  return { db, wrapped, calls, reports, sleeps };
}

describe("d1TransientKind", () => {
  it("names each transient D1 error Cloudflare says to retry, and nothing else", () => {
    expect(d1TransientKind(NETWORK_LOST)).toBe("network_connection_lost");
    expect(d1TransientKind(new Error("D1_ERROR: Internal error in D1 DB storage caused object to be reset."))).toBe("storage_reset");
    expect(d1TransientKind(new Error("D1_ERROR: D1 DB reset because its code was updated."))).toBe("code_updated_reset");
    expect(d1TransientKind(new Error("D1_ERROR: Internal error while starting up D1 DB storage"))).toBe("storage_startup_failed");
    expect(d1TransientKind(new Error("D1_ERROR: internal error; reference = abc123"))).toBe("internal_error");
    expect(d1TransientKind("D1_ERROR: Network connection lost.")).toBe("network_connection_lost");
    expect(d1TransientKind(UNIQUE)).toBeNull();
    expect(d1TransientKind({ message: "Network connection lost" })).toBeNull();
    expect(d1TransientKind(undefined)).toBeNull();
  });
});

describe("isReadOnlySql", () => {
  it("treats SELECT, and WITH or VALUES without a write keyword, as reads", () => {
    expect(isReadOnlySql("SELECT 1")).toBe(true);
    expect(isReadOnlySql("  -- note\n /* c */ select * from Recipe")).toBe(true);
    expect(isReadOnlySql("WITH r AS (SELECT 1) SELECT * FROM r")).toBe(true);
    expect(isReadOnlySql("VALUES (1)")).toBe(true);
  });

  it("treats every write, and any WITH that mentions a write keyword, as a write", () => {
    expect(isReadOnlySql("INSERT INTO Recipe (id) VALUES (?)")).toBe(false);
    expect(isReadOnlySql("UPDATE Recipe SET title = ?")).toBe(false);
    expect(isReadOnlySql("DELETE FROM Recipe")).toBe(false);
    expect(isReadOnlySql("WITH r AS (SELECT 1) DELETE FROM Recipe")).toBe(false);
    expect(isReadOnlySql("WITH r AS (SELECT 'update') SELECT * FROM r")).toBe(false);
    expect(isReadOnlySql("PRAGMA foreign_keys = ON")).toBe(false);
    expect(isReadOnlySql("")).toBe(false);
  });
});

describe("withD1TransientRetry", () => {
  it("retries a read after each transient error, with the configured backoff, and returns its result", async () => {
    const { wrapped, calls, reports, sleeps } = harness([NETWORK_LOST, NETWORK_LOST]);
    await expect(wrapped.prepare("SELECT * FROM Recipe WHERE id = ?").bind("r1").all()).resolves.toEqual({ results: [{ ok: 1 }] });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.call === "all" && c.values[0] === "r1")).toBe(true);
    expect(sleeps).toEqual([1, 2]);
    expect(reports).toEqual([
      { event: "d1_transient_error", operation: "read", call: "all", attempt: 1, willRetry: true, kind: "network_connection_lost" },
      { event: "d1_transient_error", operation: "read", call: "all", attempt: 2, willRetry: true, kind: "network_connection_lost" },
    ]);
  });

  it("forwards first, raw and run with their arguments", async () => {
    const first = harness([NETWORK_LOST]);
    await expect(first.wrapped.prepare("SELECT 1").first("ok")).resolves.toEqual({ ok: 1 });
    expect(first.calls.map((c) => [c.call, c.values])).toEqual([["first", ["ok"]], ["first", ["ok"]]]);
    const raw = harness([NETWORK_LOST]);
    await expect(raw.wrapped.prepare("SELECT 1").raw({ columnNames: true })).resolves.toEqual([["ok"], [1]]);
    expect(raw.calls.map((c) => [c.call, c.values])).toEqual([["raw", [{ columnNames: true }]], ["raw", [{ columnNames: true }]]]);
    const run = harness([NETWORK_LOST]);
    await expect(run.wrapped.prepare("SELECT 1").run()).resolves.toEqual({ meta: { changes: 1 } });
    expect(run.calls.map((c) => c.call)).toEqual(["run", "run"]);
  });

  it("gives up after the last retry and rethrows the D1 error unchanged", async () => {
    const { wrapped, calls, reports } = harness([NETWORK_LOST, NETWORK_LOST, NETWORK_LOST, NETWORK_LOST]);
    await expect(wrapped.prepare("SELECT 1").all()).rejects.toBe(NETWORK_LOST);
    expect(calls).toHaveLength(4);
    expect(reports.map((r) => [r.attempt, r.willRetry])).toEqual([[1, true], [2, true], [3, true], [4, false]]);
  });

  it("never retries a write on an error that leaves unknown whether it was applied", async () => {
    const { wrapped, calls, reports, sleeps } = harness([NETWORK_LOST]);
    await expect(wrapped.prepare("INSERT INTO Recipe (id) VALUES (?)").bind("r1").run()).rejects.toBe(NETWORK_LOST);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(reports).toEqual([
      { event: "d1_transient_error", operation: "write", call: "run", attempt: 1, willRetry: false, kind: "network_connection_lost" },
    ]);
  });

  it("retries a write when D1 storage failed to start, because the statement never ran", async () => {
    const { wrapped, calls } = harness([STARTUP_FAILED]);
    await expect(wrapped.prepare("UPDATE Recipe SET title = ?").bind("t").run()).resolves.toEqual({ meta: { changes: 1 } });
    expect(calls).toHaveLength(2);
  });

  it("does not retry or report an error that is not transient", async () => {
    const { wrapped, calls, reports } = harness([UNIQUE]);
    await expect(wrapped.prepare("SELECT 1").all()).rejects.toBe(UNIQUE);
    expect(calls).toHaveLength(1);
    expect(reports).toEqual([]);
  });

  it("retries a batch of reads, sending the original statements with their bound values", async () => {
    const { wrapped, calls, reports } = harness([NETWORK_LOST]);
    const results = await wrapped.batch([
      wrapped.prepare("SELECT * FROM Recipe WHERE id = ?").bind("r1"),
      wrapped.prepare("WITH x AS (SELECT 1) SELECT * FROM x"),
    ]);
    expect(results).toHaveLength(2);
    expect(calls).toEqual([
      { call: "batch", sql: ["SELECT * FROM Recipe WHERE id = ?", "WITH x AS (SELECT 1) SELECT * FROM x"], values: [["r1"], []] },
      { call: "batch", sql: ["SELECT * FROM Recipe WHERE id = ?", "WITH x AS (SELECT 1) SELECT * FROM x"], values: [["r1"], []] },
    ]);
    expect(reports[0]).toMatchObject({ operation: "read", call: "batch", willRetry: true });
  });

  it("treats a batch with any write, or with a statement it did not prepare, as a write", async () => {
    const mixed = harness([NETWORK_LOST]);
    await expect(mixed.wrapped.batch([
      mixed.wrapped.prepare("SELECT 1"),
      mixed.wrapped.prepare("DELETE FROM Recipe WHERE id = ?").bind("r1"),
    ])).rejects.toBe(NETWORK_LOST);
    expect(mixed.calls).toHaveLength(1);
    expect(mixed.reports[0]).toMatchObject({ operation: "write", willRetry: false });

    const foreign = harness([NETWORK_LOST]);
    await expect(foreign.wrapped.batch([foreign.db.prepare("SELECT 1")])).rejects.toBe(NETWORK_LOST);
    expect(foreign.calls).toHaveLength(1);
  });

  it("passes every other member through, bound to the real binding", async () => {
    const { db, wrapped, calls } = harness();
    await expect(wrapped.exec("SELECT 1")).resolves.toMatchObject({ count: 1, self: db });
    expect(wrapped.marker).toBe("binding");
    expect(calls.map((c) => c.call)).toEqual(["exec"]);
  });

  it("leaves anything that is not a binding as it is", () => {
    const notBindings = [null, undefined, {}, { prepare: () => undefined }, { batch: () => undefined, prepare: "x" }];
    for (const candidate of notBindings) expect(withD1TransientRetry(candidate)).toBe(candidate);
  });

  it("wraps a binding once, so a second wrap adds no second retry loop", () => {
    const { wrapped } = harness();
    expect(withD1TransientRetry(wrapped)).toBe(wrapped);
  });

  it("keeps the query's outcome when the reporter itself throws", async () => {
    const { db } = fakeD1([NETWORK_LOST]);
    const wrapped = withD1TransientRetry(db, {
      delaysMs: [0],
      onTransientError: () => {
        throw new Error("reporter broke");
      },
    });
    await expect(wrapped.prepare("SELECT 1").all()).resolves.toEqual({ results: [{ ok: 1 }] });
  });

  it("waits the default backoff with a real timer when no sleep is given", async () => {
    vi.useFakeTimers();
    try {
      const { db, calls } = fakeD1([NETWORK_LOST]);
      const pending = withD1TransientRetry(db).prepare("SELECT 1").all();
      await vi.advanceTimersByTimeAsync(DEFAULT_D1_RETRY_DELAYS_MS[0] - 1);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ results: [{ ok: 1 }] });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTransientD1Retry", () => {
  it("returns an environment without a DB binding as it is", () => {
    const env = { OTHER: "x" } as { DB?: unknown; OTHER: string };
    expect(withTransientD1Retry(env)).toBe(env);
    const fake = { DB: { marker: "not a binding" } };
    expect(withTransientD1Retry(fake)).toBe(fake);
  });

  it("wraps DB, keeps every other binding, and leaves the original environment untouched", async () => {
    const { db, calls } = fakeD1([NETWORK_LOST]);
    const env = { DB: db, OTHER: "x" };
    const wrapped = withTransientD1Retry(env, { delaysMs: [0] });
    expect(wrapped).not.toBe(env);
    expect(env.DB).toBe(db);
    expect(wrapped.OTHER).toBe("x");
    await expect(wrapped.DB.prepare("SELECT 1").all()).resolves.toEqual({ results: [{ ok: 1 }] });
    expect(calls).toHaveLength(2);
  });

  it("logs each transient failure as one JSON line, with no SQL or values, on a per-run QA Worker only", async () => {
    // Without the QA switch nothing is logged: the warning policy fails the test on any stray line.
    const quiet = fakeD1([NETWORK_LOST]);
    await withTransientD1Retry({ DB: quiet.db }, { delaysMs: [0] }).DB.prepare("SELECT 1").all();

    expectConsoleWarning(JSON.stringify({
      event: "d1_transient_error",
      operation: "read",
      call: "all",
      attempt: 1,
      willRetry: true,
      kind: "network_connection_lost",
    }));
    const qa = fakeD1([NETWORK_LOST]);
    await withTransientD1Retry({ DB: qa.db, SPOONJOY_QA_ERROR_LOGS: "1" }, { delaysMs: [0] })
      .DB.prepare("SELECT secret FROM T WHERE v = ?").bind("value").all();
  });
});

describe("D1 tries that wait over a second", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A binding whose calls wait until the test settles them, one by one, in order. */
  function pendingD1() {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
    const wait = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    const statement = (): RetryableD1Statement => ({
      bind: () => statement(),
      first: wait,
      all: wait,
      raw: wait,
      run: wait,
    });
    const db: RetryableD1Database = { prepare: () => statement(), batch: wait as RetryableD1Database["batch"] };
    return { db, pending };
  }

  it("reports each try that is still waiting after a second, naming the call and table, then how it ended", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { db, pending } = pendingD1();
    const slow: SlowCallReport[] = [];
    const wrapped = withD1TransientRetry(db, { delaysMs: [0], sleep: async () => {}, onSlowCall: (report) => slow.push(report) });

    const read = wrapped.prepare('SELECT "sessionVersion" FROM "User" WHERE "id" = ?').bind("user-1").first();
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow).toEqual([
      { event: "slow_call", call: "d1.first", operation: "read", table: "User", attempt: 1, waitedMs: 1000, settled: false, outcome: null },
    ]);

    // The first try fails with a transient error after 1.5 s; the retry answers at once.
    await vi.advanceTimersByTimeAsync(500);
    pending[0].reject(NETWORK_LOST);
    await vi.advanceTimersByTimeAsync(0);
    pending[1].resolve({ sessionVersion: 1 });
    await expect(read).resolves.toEqual({ sessionVersion: 1 });
    expect(slow.slice(1)).toEqual([
      { event: "slow_call", call: "d1.first", operation: "read", table: "User", attempt: 1, waitedMs: 1500, settled: true, outcome: "error" },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names a batch by its first statement's table and a write as a write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { db, pending } = pendingD1();
    const slow: SlowCallReport[] = [];
    const wrapped = withD1TransientRetry(db, { onSlowCall: (report) => slow.push(report) });

    void wrapped.batch([wrapped.prepare('SELECT id FROM "Cookbook" WHERE id = ?'), wrapped.prepare('SELECT 1 FROM "Recipe"')]);
    void wrapped.prepare('UPDATE "User" SET name = ?').bind("x").run();
    void wrapped.batch([db.prepare("SELECT 1")]);
    void wrapped.batch([]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(slow.map(({ call, operation, table }) => ({ call, operation, table }))).toEqual([
      { call: "d1.batch", operation: "read", table: "Cookbook" },
      { call: "d1.run", operation: "write", table: "User" },
      { call: "d1.batch", operation: "write", table: null },
      { call: "d1.batch", operation: "read", table: null },
    ]);
    expect(pending).toHaveLength(4);
  });

  it("logs a waiting try as one JSON line on a per-run QA Worker only, and runs no timer elsewhere", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const quiet = pendingD1();
    void withTransientD1Retry({ DB: quiet.db }).DB.prepare("SELECT 1 FROM T").all();
    expect(vi.getTimerCount()).toBe(0);

    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "d1.all", operation: "read", table: "T", attempt: 1, waitedMs: 1000, settled: false, outcome: null,
    }));
    const qa = pendingD1();
    void withTransientD1Retry({ DB: qa.db, SPOONJOY_QA_ERROR_LOGS: "1" }).DB.prepare("SELECT secret FROM T WHERE v = ?").bind("value").all();
    await vi.advanceTimersByTimeAsync(1000);
  });
});
