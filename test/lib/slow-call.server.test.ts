// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectConsoleWarning } from "../warning-policy";
import {
  consoleSlowCallReporter,
  firstTable,
  requestPlacement,
  SLOW_CALL_THRESHOLD_MS,
  watchSlowCall,
  type SlowCallClock,
  type SlowCallReport,
} from "~/lib/slow-call.server";

/** A clock whose time and timers move only when the test says so. */
function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 1;
  const clock: SlowCallClock = {
    now: () => now,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    clock,
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const label = { call: "d1.first", operation: "read" as const, table: "User", attempt: 1 };

describe("watchSlowCall", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the call as it is, with no timer, when nothing reports", async () => {
    const { clock, timers } = fakeClock();
    const run = vi.fn(async () => "rows");

    await expect(watchSlowCall(label, run, undefined, clock)).resolves.toBe("rows");
    expect(run).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });

  it("reports nothing for a call that settles within the threshold, and clears its timer", async () => {
    const { clock, timers, advance } = fakeClock();
    const reports: SlowCallReport[] = [];
    const call = deferred<string>();

    const watched = watchSlowCall(label, () => call.promise, (report) => reports.push(report), clock);
    advance(SLOW_CALL_THRESHOLD_MS - 1);
    call.resolve("rows");

    await expect(watched).resolves.toBe("rows");
    expect(timers.size).toBe(0);
    expect(reports).toEqual([]);
  });

  it("reports a call still waiting at the threshold even if it never settles", () => {
    const { clock, advance } = fakeClock();
    const reports: SlowCallReport[] = [];

    void watchSlowCall(label, () => new Promise<never>(() => {}), (report) => reports.push(report), clock);
    advance(SLOW_CALL_THRESHOLD_MS);

    expect(reports).toEqual([
      { event: "slow_call", call: "d1.first", operation: "read", table: "User", attempt: 1, waitedMs: 1000, settled: false, outcome: null },
    ]);
  });

  it("reports a slow call again when it settles, with the whole wait and the outcome", async () => {
    const { clock, advance } = fakeClock();
    const reports: SlowCallReport[] = [];
    const ok = deferred<string>();
    const failed = deferred<string>();
    const failure = new Error("D1_ERROR: boom");

    const first = watchSlowCall({ call: "cook_session.fetch", operation: "write" }, () => ok.promise, (report) => reports.push(report), clock);
    const second = watchSlowCall(label, () => failed.promise, (report) => reports.push(report), clock);
    advance(3900);
    ok.resolve("done");
    failed.reject(failure);

    await expect(first).resolves.toBe("done");
    await expect(second).rejects.toBe(failure);
    expect(reports).toEqual([
      { event: "slow_call", call: "cook_session.fetch", operation: "write", table: null, attempt: 1, waitedMs: 3900, settled: false, outcome: null },
      { event: "slow_call", call: "d1.first", operation: "read", table: "User", attempt: 1, waitedMs: 3900, settled: false, outcome: null },
      { event: "slow_call", call: "cook_session.fetch", operation: "write", table: null, attempt: 1, waitedMs: 3900, settled: true, outcome: "ok" },
      { event: "slow_call", call: "d1.first", operation: "read", table: "User", attempt: 1, waitedMs: 3900, settled: true, outcome: "error" },
    ]);
  });

  it("passes a fast failure through without a report", async () => {
    const { clock, timers } = fakeClock();
    const reports: SlowCallReport[] = [];
    const failure = new Error("UNIQUE constraint failed");

    await expect(watchSlowCall(label, () => Promise.reject(failure), (report) => reports.push(report), clock)).rejects.toBe(failure);
    expect(timers.size).toBe(0);
    expect(reports).toEqual([]);
  });

  it("clears its timer and rethrows when the call throws before returning a promise", () => {
    const { clock, timers } = fakeClock();
    const failure = new TypeError("not a statement");

    expect(() => watchSlowCall(label, () => { throw failure; }, () => {}, clock)).toThrow(failure);
    expect(timers.size).toBe(0);
  });

  it("never lets a failing reporter change the call's outcome", async () => {
    const { clock, advance } = fakeClock();
    const call = deferred<string>();
    const report = vi.fn(() => {
      throw new Error("log sink down");
    });

    const watched = watchSlowCall(label, () => call.promise, report, clock);
    advance(SLOW_CALL_THRESHOLD_MS);
    call.resolve("rows");

    await expect(watched).resolves.toBe("rows");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("uses the real clock and timers by default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const reports: SlowCallReport[] = [];
    const call = deferred<string>();

    const watched = watchSlowCall(label, () => call.promise, (report) => reports.push(report));
    vi.advanceTimersByTime(SLOW_CALL_THRESHOLD_MS);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ waitedMs: SLOW_CALL_THRESHOLD_MS, settled: false });

    vi.advanceTimersByTime(500);
    call.resolve("rows");
    await expect(watched).resolves.toBe("rows");
    expect(reports[1]).toMatchObject({ waitedMs: 1500, settled: true, outcome: "ok" });
  });
});

describe("consoleSlowCallReporter", () => {
  it("writes each report as one JSON warning line", () => {
    const report: SlowCallReport = {
      event: "slow_call", call: "d1.batch", operation: "read", table: "Cookbook", attempt: 1, waitedMs: 1000, settled: false, outcome: null,
    };
    expectConsoleWarning(JSON.stringify(report));

    consoleSlowCallReporter()(report);
  });
});

describe("firstTable", () => {
  it.each([
    ['SELECT "sessionVersion" FROM "User" WHERE "id" = ?', "User"],
    ["select id from RecipeStep where recipeId = ?", "RecipeStep"],
    ["INSERT INTO `CookingNow` (id) VALUES (?)", "CookingNow"],
    ['UPDATE "Cookbook" SET title = ?', "Cookbook"],
    ["SELECT 1 FROM [Recipe]", "Recipe"],
    ["SELECT a.id FROM (SELECT 1) a JOIN Ingredient i ON 1", "Ingredient"],
    ["SELECT ? AS value", null],
    ["FROM", null],
  ])("names the first table of %s", (sql, table) => {
    expect(firstTable(sql)).toBe(table);
  });
});

describe("requestPlacement", () => {
  const withHeader = (value?: string) =>
    new Request("https://qa.example/", { headers: value === undefined ? {} : { "cf-placement": value } });

  it("keeps Smart Placement's local and remote values, and nothing else", () => {
    expect(requestPlacement(withHeader("remote-IAD"))).toBe("remote-IAD");
    expect(requestPlacement(withHeader("local-EWR"))).toBe("local-EWR");
    expect(requestPlacement(withHeader("remote-iad"))).toBe("other");
    expect(requestPlacement(withHeader("remote-IAD; secret"))).toBe("other");
    expect(requestPlacement(withHeader())).toBeNull();
  });
});
