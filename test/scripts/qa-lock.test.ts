// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  CREATE_TABLE_SQL,
  DEFAULT_MAX_WAIT_MS,
  INITIAL_DELAY_MS,
  LOCK_TTL_MINUTES,
  MAX_DELAY_MS,
  RELEASE_ATTEMPTS,
  acquireQaLock,
  buildAcquireSql,
  buildReleaseSql,
  defaultCliErrorHandler,
  isCliEntry,
  lockIdentity,
  main,
  parseQaLockArgs,
  releaseQaLock,
  runCliIfEntry,
  runQaSql,
} from "../../scripts/qa-lock.mjs";
import { expectConsoleError } from "../warning-policy";

const RUN_A = { GITHUB_RUN_ID: "1001", GITHUB_RUN_ATTEMPT: "1" };
const RUN_B = { GITHUB_RUN_ID: "1002", GITHUB_RUN_ATTEMPT: "1" };

// A fake `pnpm exec wrangler d1 execute DB --remote --env qa --json --command <sql>` backed by a
// real SQLite database, so the lock's SQL runs with SQLite's real conflict semantics.
function fakeQaD1() {
  const db = new Database(":memory:");
  const calls: string[][] = [];
  const exec = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    const sql = args[args.indexOf("--command") + 1];
    const results = sql
      .split(/;\n/)
      .map((statement) => statement.trim().replace(/;$/, ""))
      .filter(Boolean)
      .map((statement) => {
        if (/^select/i.test(statement)) {
          return { results: db.prepare(statement).all(), success: true, meta: { changes: 0 } };
        }
        const info = db.prepare(statement).run();
        return { results: [], success: true, meta: { changes: info.changes } };
      });
    return { stdout: JSON.stringify(results) };
  });
  const holder = () => db.prepare('SELECT "runId", "attempt", "expiresAt" FROM "QaRunLock" WHERE "id" = 1').get() as
    | { runId: string; attempt: number; expiresAt: string }
    | undefined;
  return { db, exec, calls, holder };
}

function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
}

describe("arguments and identity", () => {
  it("accepts acquire and release against QA only", () => {
    expect(parseQaLockArgs(["acquire", "--target-env", "qa"])).toEqual({ action: "acquire", targetEnv: "qa" });
    expect(parseQaLockArgs(["release", "--target-env", "qa"])).toEqual({ action: "release", targetEnv: "qa" });
    for (const argv of [["acquire"], ["acquire", "--target-env", "production"], ["release", "--target-env"]]) {
      expect(() => parseQaLockArgs(argv)).toThrow("qa-lock refuses non-QA targets; run with `--target-env qa`.");
    }
    for (const argv of [[], ["steal", "--target-env", "qa"]]) {
      expect(() => parseQaLockArgs(argv)).toThrow("Usage: qa-lock.mjs <acquire|release> --target-env qa");
    }
  });

  it("identifies the holder by run id and attempt, both whole numbers", () => {
    expect(lockIdentity({ GITHUB_RUN_ID: "36341337609", GITHUB_RUN_ATTEMPT: "2" })).toEqual({ runId: "36341337609", attempt: 2 });
    for (const env of [{}, { GITHUB_RUN_ID: "1" }, { GITHUB_RUN_ID: "1'; DROP TABLE x; --", GITHUB_RUN_ATTEMPT: "1" }, { GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1.5" }]) {
      expect(() => lockIdentity(env)).toThrow("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be set to whole numbers to take the QA lock.");
    }
  });

  it("builds single-row, holder-scoped SQL with a TTL longer than the journeys job timeout", () => {
    const acquire = buildAcquireSql({ runId: "7", attempt: 3 });
    expect(acquire.startsWith(CREATE_TABLE_SQL)).toBe(true);
    expect(acquire).toContain(`'+${LOCK_TTL_MINUTES} minutes'`);
    expect(acquire).toContain('WHERE "QaRunLock"."expiresAt" < excluded."acquiredAt"');
    expect(buildAcquireSql({ runId: "7", attempt: 3 }, 5)).toContain("'+5 minutes'");
  });
});

describe("runQaSql", () => {
  it("runs against QA's D1 binding, remotely, and nothing else", async () => {
    const exec = vi.fn(async () => ({ stdout: "[]" }));
    await runQaSql("SELECT 1;", exec);
    expect(exec).toHaveBeenCalledWith("pnpm", [
      "exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--json", "--command", "SELECT 1;",
    ]);
  });

  it("skips any text before the JSON results and rejects missing or failed results", async () => {
    await expect(runQaSql("x", async () => ({ stdout: 'note\n[{"results":[],"success":true}]' }))).resolves.toEqual([
      { results: [], success: true },
    ]);
    await expect(runQaSql("x", async () => ({ stdout: "no json here" }))).rejects.toThrow("wrangler returned no JSON results.");
    await expect(runQaSql("x", async () => ({ stdout: '[{"success":false}]' }))).rejects.toThrow("wrangler reported a failed statement.");
    await expect(runQaSql("x", async () => ({ stdout: '[{"a":1}' }))).rejects.toThrow();
  });
});

describe("acquireQaLock", () => {
  it("takes a free lock at once, creating the table on first use", async () => {
    const qa = fakeQaD1();
    const time = clock();
    const log = vi.fn();

    const holder = await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: time.sleep, now: time.now, log });

    expect(holder).toMatchObject({ runId: "1001", attempt: 1 });
    expect(qa.holder()).toMatchObject({ runId: "1001", attempt: 1 });
    expect(time.sleep).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Took the QA lock for run 1001 attempt 1 \(expires \d{4}-\d\d-\d\dT/));
  });

  it("is harmless to retry for the run that already holds it", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });

    await expect(acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() }))
      .resolves.toMatchObject({ runId: "1001" });
  });

  it("never lets a second run in while the lock is held, then takes it once released", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });
    const time = clock();
    const log = vi.fn();
    let polls = 0;
    const exec = vi.fn(async (file: string, args: string[]) => {
      polls += 1;
      if (polls === 4) await releaseQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), log: vi.fn() });
      return qa.exec(file, args);
    });

    const holder = await acquireQaLock({ env: RUN_B, exec, sleep: time.sleep, now: time.now, log });

    expect(holder).toMatchObject({ runId: "1002" });
    expect(time.sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 10_000, 20_000]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Waiting for the QA lock: QA is locked by run 1001 attempt 1 \(since .+, expires .+\); retrying in 5 s\.$/));
  });

  it("treats a new attempt of the same run as a different holder", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });
    const time = clock();

    await expect(acquireQaLock({ env: { ...RUN_A, GITHUB_RUN_ATTEMPT: "2" }, exec: qa.exec, sleep: time.sleep, now: time.now, log: vi.fn(), maxWaitMs: 1 }))
      .rejects.toThrow("Run 1001 attempt 2 could not take the QA lock within 0 min: QA is locked by run 1001 attempt 1");
    expect(qa.holder()).toMatchObject({ runId: "1001", attempt: 1 });
  });

  it("takes over an expired lock left by a run that crashed", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });
    qa.db.prepare(`UPDATE "QaRunLock" SET "expiresAt" = '2000-01-01T00:00:00.000Z'`).run();

    await expect(acquireQaLock({ env: RUN_B, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() }))
      .resolves.toMatchObject({ runId: "1002" });
  });

  it("backs off up to a minute and fails after the maximum wait, naming the holder", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });
    const time = clock();

    await expect(acquireQaLock({ env: RUN_B, exec: qa.exec, sleep: time.sleep, now: time.now, log: vi.fn() }))
      .rejects.toThrow(/^Run 1002 attempt 1 could not take the QA lock within 10 min: QA is locked by run 1001 attempt 1 \(since .+, expires .+\)\.$/);
    const delays = time.sleep.mock.calls.map(([ms]) => ms);
    expect(delays.slice(0, 5)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
    expect(Math.max(...delays)).toBe(MAX_DELAY_MS);
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(DEFAULT_MAX_WAIT_MS);
    expect(INITIAL_DELAY_MS).toBe(5_000);
  });

  it("retries when QA's database cannot be reached, and never proceeds without the lock", async () => {
    const time = clock();
    const log = vi.fn();
    const failing = vi.fn(async () => { throw new Error("wrangler exited 1"); });

    await expect(acquireQaLock({ env: RUN_A, exec: failing, sleep: time.sleep, now: time.now, log, maxWaitMs: 12_000 }))
      .rejects.toThrow("Run 1001 attempt 1 could not take the QA lock within 0 min: could not reach QA's database (wrangler exited 1).");
    expect(log).toHaveBeenCalledWith("Waiting for the QA lock: could not reach QA's database (wrangler exited 1); retrying in 5 s.");

    const odd = vi.fn(async () => { throw "not an error"; });
    await expect(acquireQaLock({ env: RUN_A, exec: odd, sleep: vi.fn(), now: () => 0, log: vi.fn(), maxWaitMs: 0 }))
      .rejects.toThrow("could not reach QA's database (not an error)");
  });

  it("reports an empty read-back as held by nobody", async () => {
    const exec = vi.fn(async () => ({ stdout: JSON.stringify([{ results: [], success: true }]) }));

    await expect(acquireQaLock({ env: RUN_A, exec, sleep: vi.fn(), now: () => 0, log: vi.fn(), maxWaitMs: 0 }))
      .rejects.toThrow("QA is locked by nobody.");
    const empty = vi.fn(async () => ({ stdout: "[]" }));
    await expect(acquireQaLock({ env: RUN_A, exec: empty, sleep: vi.fn(), now: () => 0, log: vi.fn(), maxWaitMs: 0 }))
      .rejects.toThrow("QA is locked by nobody.");
  });
});

describe("releaseQaLock", () => {
  it("releases only this run's lock", async () => {
    const qa = fakeQaD1();
    await acquireQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), now: () => 0, log: vi.fn() });
    const log = vi.fn();

    await expect(releaseQaLock({ env: RUN_B, exec: qa.exec, sleep: vi.fn(), log })).resolves.toBe(true);
    expect(qa.holder()).toMatchObject({ runId: "1001" });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Run 1002 attempt 1 no longer holds the QA lock \(now held by run 1001 attempt 1 /));

    await expect(releaseQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), log })).resolves.toBe(true);
    expect(qa.holder()).toBeUndefined();
    expect(log).toHaveBeenLastCalledWith("Run 1001 attempt 1 no longer holds the QA lock (now held by nobody).");
    expect(buildReleaseSql({ runId: "7", attempt: 3 })).toContain(`DELETE FROM "QaRunLock" WHERE "id" = 1 AND "runId" = '7' AND "attempt" = 3;`);
  });

  it("is a no-op before the table exists", async () => {
    const qa = fakeQaD1();
    await expect(releaseQaLock({ env: RUN_A, exec: qa.exec, sleep: vi.fn(), log: vi.fn() })).resolves.toBe(true);
  });

  it("retries while the row still names this run, then warns instead of failing, leaving the lock to expire", async () => {
    const sleep = vi.fn(async () => undefined);
    const log = vi.fn();
    const stuck = vi.fn(async () => ({
      stdout: JSON.stringify([{ success: true, results: [] }, { success: true, results: [{ runId: "1001", attempt: 1 }] }]),
    }));

    await expect(releaseQaLock({ env: RUN_A, exec: stuck, sleep, log })).resolves.toBe(false);
    expect(stuck).toHaveBeenCalledTimes(RELEASE_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(RELEASE_ATTEMPTS - 1);
    expect(log).toHaveBeenCalledWith(
      `::warning::Could not release the QA lock for run 1001 attempt 1 (the lock row still names this run). It expires on its own within ${LOCK_TTL_MINUTES} minutes.`,
    );

    const failing = vi.fn(async () => { throw new Error("network down"); });
    await releaseQaLock({ env: RUN_A, exec: failing, sleep, log });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("(network down)"));
    const odd = vi.fn(async () => { throw 42; });
    await releaseQaLock({ env: RUN_A, exec: odd, sleep, log });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("(42)"));
  });

  it("treats an empty read-back as released", async () => {
    const exec = vi.fn(async () => ({ stdout: "[]" }));
    await expect(releaseQaLock({ env: RUN_A, exec, sleep: vi.fn(), log: vi.fn() })).resolves.toBe(true);
  });
});

describe("main and CLI guard", () => {
  it("dispatches acquire and release with injected dependencies", async () => {
    const qa = fakeQaD1();
    const log = vi.fn();
    await expect(main(["acquire", "--target-env", "qa"], { env: RUN_A, exec: qa.exec, log, sleep: vi.fn(), now: () => 0 }))
      .resolves.toMatchObject({ runId: "1001" });
    await expect(main(["release", "--target-env", "qa"], { env: RUN_A, exec: qa.exec, log, sleep: vi.fn() })).resolves.toBe(true);
    expect(qa.holder()).toBeUndefined();
    await expect(main(["acquire", "--target-env", "production"], { env: RUN_A, exec: qa.exec })).rejects.toThrow("refuses non-QA targets");
    expect(qa.exec).toHaveBeenCalledTimes(2);
  });

  it("uses process defaults and refuses before touching anything when the target is wrong", async () => {
    const argv = process.argv;
    process.argv = ["node", "qa-lock.mjs", "acquire", "--target-env", "staging"];
    try {
      await expect(main()).rejects.toThrow("refuses non-QA targets");
    } finally {
      process.argv = argv;
    }
  });

  it("uses the real exec, timers and console by default", async () => {
    const saved = { ...process.env };
    process.env = { ...saved, ...RUN_A, PATH: "/nonexistent" };
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      // With no pnpm on PATH the real exec fails, so release retries on real (faked) timers and warns.
      const pending = main(["release", "--target-env", "qa"]);
      await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS * RELEASE_ATTEMPTS);
      await expect(pending).resolves.toBe(false);
      expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^::warning::Could not release the QA lock for run 1001 attempt 1/));
      const acquiring = main(["acquire", "--target-env", "qa"], { maxWaitMs: 0 });
      await expect(acquiring).rejects.toThrow("could not reach QA's database");
    } finally {
      vi.useRealTimers();
      log.mockRestore();
      process.env = saved;
    }
  });

  it("detects the CLI entrypoint and reports errors as failing annotations", async () => {
    expect(isCliEntry("file:///repo/scripts/qa-lock.mjs", "/repo/scripts/qa-lock.mjs")).toBe(true);
    expect(isCliEntry("file:///repo/scripts/qa-lock.mjs", undefined)).toBe(false);
    const runMain = vi.fn(async () => true);
    const onError = vi.fn();
    await expect(runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/b.mjs", runMain, onError })).resolves.toBe(false);
    await expect(runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain, onError })).resolves.toBe(true);
    const failure = new Error("boom");
    await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain: async () => { throw failure; }, onError });
    expect(onError).toHaveBeenCalledWith(failure);
    await expect(runCliIfEntry()).resolves.toBe(false);

    const exitCode = process.exitCode;
    try {
      const io = { error: vi.fn() };
      defaultCliErrorHandler("plain", io);
      expect(io.error).toHaveBeenCalledWith("::error::plain");
      expectConsoleError("::error::qa-lock-default-output");
      defaultCliErrorHandler(new Error("qa-lock-default-output"));
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = exitCode;
    }
  });
});

describe("Journeys workflow lock wiring", () => {
  const workflow = parse(readFileSync(resolve(__dirname, "../../.github/workflows/journeys.yml"), "utf8"));
  const journeys = workflow.jobs.journeys;
  const steps: Array<{ name?: string; id?: string; if?: string; run?: string }> = journeys.steps;
  const index = (name: string) => steps.findIndex((step) => step.name === name);

  it("takes the lock after the queue and before anything touches QA", () => {
    const take = steps[index("Take the QA lock")];
    expect(take.id).toBe("qa-lock");
    expect(take.run).toBe("node scripts/qa-lock.mjs acquire --target-env qa");
    expect(take.if).toBeUndefined();
    expect(index("Require this run's turn on QA")).toBe(0);
    expect(index("Install dependencies")).toBeLessThan(index("Take the QA lock"));
    expect(index("Take the QA lock")).toBeLessThan(index("Deploy this build to QA"));
    expect(journeys["timeout-minutes"]).toBeLessThan(LOCK_TTL_MINUTES);
  });

  it("releases the lock last, always, and only when this run took it", () => {
    const release = steps.at(-1)!;
    expect(release.name).toBe("Release the QA lock");
    expect(release.if).toBe("always() && steps.qa-lock.outcome == 'success'");
    expect(release.run).toBe("node scripts/qa-lock.mjs release --target-env qa");
  });

  it("never touches QA after a failure unless this run holds the lock", () => {
    for (const name of ["Stop QA Worker tail and summarise it", "Rotate persona passwords", "Clean up disposable QA data"]) {
      expect(steps[index(name)].if, name).toBe("always() && steps.qa-lock.outcome == 'success'");
    }
  });
});
