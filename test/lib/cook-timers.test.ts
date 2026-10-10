import { describe, expect, it } from "vitest";
import {
  ALARM_WINDOW_MS,
  clearTimer,
  cookTimersStorageKey,
  formatTimerSeconds,
  isRinging,
  parseStoredTimers,
  pauseTimer,
  remainingSeconds,
  resumeTimer,
  settleTimers,
  startTimer,
  timerKey,
  type CookTimers,
} from "~/lib/cook-timers";

describe("cook timers", () => {
  it("anchors a started timer to a wall-clock end time", () => {
    const timers = startTimer({}, timerKey(1), 600, 1_000);
    expect(timers).toEqual({ "1": { status: "running", durationSeconds: 600, endsAt: 601_000 } });
    expect(remainingSeconds(timers["1"], 1_000)).toBe(600);
    expect(remainingSeconds(timers["1"], 4_000)).toBe(597);
    expect(remainingSeconds(timers["1"], 3_500)).toBe(598);
    // A clock read a moment before the start never shows more than the full duration.
    expect(remainingSeconds(timers["1"], 0)).toBe(600);
    expect(remainingSeconds(timers["1"], 700_000)).toBe(0);
  });

  it("pauses and resumes from the time that was left", () => {
    const running = startTimer({}, "1", 60, 0);
    const paused = pauseTimer(running, "1", 15_000);
    expect(paused["1"]).toEqual({ status: "paused", durationSeconds: 60, remainingMs: 45_000 });
    expect(remainingSeconds(paused["1"], 999_999)).toBe(45);
    const resumed = resumeTimer(paused, "1", 100_000);
    expect(resumed["1"]).toEqual({ status: "running", durationSeconds: 60, endsAt: 145_000 });
    // Pausing after the end time keeps zero, not a negative remainder.
    expect(pauseTimer(running, "1", 90_000)["1"]).toMatchObject({ remainingMs: 0 });
  });

  it("ignores pause and resume for timers in the wrong state", () => {
    const running = startTimer({}, "1", 60, 0);
    expect(pauseTimer({}, "1", 0)).toEqual({});
    expect(resumeTimer(running, "1", 0)).toBe(running);
    expect(resumeTimer({}, "1", 0)).toEqual({});
    const paused = pauseTimer(running, "1", 0);
    expect(pauseTimer(paused, "1", 0)).toBe(paused);
  });

  it("clears a timer and leaves unknown keys alone", () => {
    const timers = startTimer(startTimer({}, "1", 60, 0), "2", 30, 0);
    expect(Object.keys(clearTimer(timers, "1"))).toEqual(["2"]);
    expect(clearTimer(timers, "9")).toBe(timers);
  });

  it("settles running timers whose end time has passed", () => {
    const timers: CookTimers = {
      ...startTimer({}, "1", 60, 0),
      ...startTimer({}, "2", 120, 0),
      "3": { status: "paused", durationSeconds: 10, remainingMs: 5_000 },
    };
    const early = settleTimers(timers, 30_000);
    expect(early.finished).toEqual([]);
    expect(early.timers).toBe(timers);
    const later = settleTimers(timers, 60_000);
    expect(later.finished).toEqual(["1"]);
    expect(later.timers["1"]).toEqual({ status: "done", durationSeconds: 60, endedAt: 60_000 });
    expect(later.timers["2"]).toBe(timers["2"]);
    expect(remainingSeconds(later.timers["1"], 61_000)).toBe(0);
  });

  it("rings only inside the alarm window after a timer ends", () => {
    const done = { status: "done" as const, durationSeconds: 60, endedAt: 1_000 };
    expect(isRinging(done, 1_000)).toBe(true);
    expect(isRinging(done, 1_000 + ALARM_WINDOW_MS - 1)).toBe(true);
    expect(isRinging(done, 1_000 + ALARM_WINDOW_MS)).toBe(false);
    expect(isRinging({ status: "running", durationSeconds: 60, endsAt: 0 }, 5)).toBe(false);
  });

  it.each([
    ["no stored value", null],
    ["broken JSON", "{"],
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "4"],
  ])("reads %s as no timers", (_label, raw) => {
    expect(parseStoredTimers(raw)).toEqual({});
  });

  it("keeps valid stored timers and drops malformed ones", () => {
    const raw = JSON.stringify({
      "1": { status: "running", durationSeconds: 60, endsAt: 5 },
      "2": { status: "paused", durationSeconds: 60, remainingMs: 10 },
      "3": { status: "done", durationSeconds: 60, endedAt: 7 },
      "4": { status: "running", durationSeconds: 0, endsAt: 5 },
      "5": { status: "paused", durationSeconds: 60, remainingMs: -1 },
      "6": { status: "done", durationSeconds: 60 },
      "7": { status: "mystery", durationSeconds: 60 },
      "8": null,
      "9": "running",
      "10": { status: "running", durationSeconds: "60", endsAt: 5 },
      "11": { status: "running", durationSeconds: 60, endsAt: null },
      "12": { status: "paused", durationSeconds: 60 },
    });
    expect(parseStoredTimers(raw)).toEqual({
      "1": { status: "running", durationSeconds: 60, endsAt: 5 },
      "2": { status: "paused", durationSeconds: 60, remainingMs: 10 },
      "3": { status: "done", durationSeconds: 60, endedAt: 7 },
    });
  });

  it("namespaces storage per recipe", () => {
    expect(cookTimersStorageKey("abc")).toBe("spoonjoy-cook-timers:v1:abc");
  });

  it.each([
    [0, "00:00"],
    [65, "01:05"],
    [600, "10:00"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [5_430, "1:30:30"],
    [-5, "00:00"],
  ])("formats %i seconds as %s", (seconds, text) => {
    expect(formatTimerSeconds(seconds)).toBe(text);
  });
});
