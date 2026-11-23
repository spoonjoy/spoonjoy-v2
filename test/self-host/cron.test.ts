import { describe, expect, it, vi } from "vitest";
import { expectConsoleError } from "../warning-policy";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { nextCronTime, startCronTimers } from "../../self-host/cron.mjs";

const at = (iso: string) => new Date(iso).getTime();

describe("nextCronTime", () => {
  it("finds the next run of spoonjoy.app's photo sweep (23 */6 * * *), in UTC as Cloudflare runs it", () => {
    expect(new Date(nextCronTime("23 */6 * * *", at("2026-11-22T05:00:00Z"))).toISOString()).toBe("2026-11-22T06:23:00.000Z");
    expect(new Date(nextCronTime("23 */6 * * *", at("2026-11-22T06:23:00Z"))).toISOString()).toBe("2026-11-22T12:23:00.000Z");
    expect(new Date(nextCronTime("23 */6 * * *", at("2026-11-22T18:24:10Z"))).toISOString()).toBe("2026-11-23T00:23:00.000Z");
  });

  it("reads numbers, lists, ranges and steps", () => {
    expect(new Date(nextCronTime("0,30 9-10 * * *", at("2026-11-22T09:10:00Z"))).toISOString()).toBe("2026-11-22T09:30:00.000Z");
    expect(new Date(nextCronTime("15 3 1 * *", at("2026-11-22T00:00:00Z"))).toISOString()).toBe("2026-12-01T03:15:00.000Z");
    expect(new Date(nextCronTime("0 0 * 2 *", at("2026-11-22T00:00:00Z"))).toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(new Date(nextCronTime("0 12 * * 1", at("2026-11-22T00:00:00Z"))).toISOString()).toBe("2026-11-23T12:00:00.000Z");
    expect(new Date(nextCronTime("*/20 1-3/2 * * *", at("2026-11-22T01:50:00Z"))).toISOString()).toBe("2026-11-22T03:00:00.000Z");
  });

  it("reads a start with a step, and 7 as Sunday", () => {
    expect(new Date(nextCronTime("5/20 * * * *", at("2026-11-22T09:26:00Z"))).toISOString()).toBe("2026-11-22T09:45:00.000Z");
    // 2026-11-22 is a Sunday.
    expect(new Date(nextCronTime("0 8 * * 7", at("2026-11-21T09:00:00Z"))).toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("matches either day field when both are restricted, as cron does", () => {
    // The 1st of the month, or any Monday: Monday 2026-11-23 comes first.
    expect(new Date(nextCronTime("0 0 1 * 1", at("2026-11-22T00:00:00Z"))).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("refuses an expression it cannot read", () => {
    expect(() => nextCronTime("* * * *", 0)).toThrow(/five fields/);
    expect(() => nextCronTime("5-3 * * * *", 0)).toThrow(/out of range/);
    expect(() => nextCronTime("*/0 * * * *", 0)).toThrow(/out of range/);
    expect(() => nextCronTime("@daily", 0)).toThrow(/cron/);
    expect(() => nextCronTime("61 * * * *", 0)).toThrow(/cron/);
    expect(() => nextCronTime("a * * * *", 0)).toThrow(/cron/);
  });

  it("gives up on an expression that never matches", () => {
    expect(() => nextCronTime("0 0 31 2 *", 0)).toThrow(/never/);
  });
});

describe("startCronTimers", () => {
  it("fires each trigger at its time, then waits for the next one", async () => {
    vi.useFakeTimers({ now: at("2026-11-22T06:00:00Z") });
    const fired: string[] = [];
    const stop = startCronTimers(["23 */6 * * *"], async (cron: string) => { fired.push(`${cron}@${new Date().toISOString()}`); });
    await vi.advanceTimersByTimeAsync(22 * 60_000);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fired).toEqual(["23 */6 * * *@2026-11-22T06:23:00.000Z"]);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    expect(fired).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(fired).toHaveLength(2);
    vi.useRealTimers();
  });

  it("stops for good when stopped during a run", async () => {
    vi.useFakeTimers({ now: at("2026-11-22T06:59:00Z") });
    let calls = 0;
    let stop = () => {};
    stop = startCronTimers(["0 * * * *"], async () => { calls += 1; stop(); });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(calls).toBe(1);
    vi.useRealTimers();
  });

  it("logs a failed run by default", async () => {
    vi.useFakeTimers({ now: at("2026-11-22T06:59:00Z") });
    const failure = new Error("sweep failed");
    expectConsoleError(failure);
    const stop = startCronTimers(["0 * * * *"], async () => { throw failure; });
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    vi.useRealTimers();
  });

  it("keeps the timer going when a run fails, and reports the failure", async () => {
    vi.useFakeTimers({ now: at("2026-11-22T06:00:00Z") });
    const errors: unknown[] = [];
    let calls = 0;
    const stop = startCronTimers(["0 * * * *"], async () => { calls += 1; throw new Error("sweep failed"); }, (error: unknown) => errors.push(error));
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(2);
    stop();
    vi.useRealTimers();
  });
});
