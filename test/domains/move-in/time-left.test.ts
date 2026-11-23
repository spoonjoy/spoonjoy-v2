import { describe, expect, it } from "vitest";
import { timeLeft } from "~/domains/move-in/model/time-left";

const startedAt = "2026-11-23T12:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(startedAt) + seconds * 1000);

describe("timeLeft", () => {
  it("works out the minutes left from the rate so far, rounded up", () => {
    // 84 recipes in 64 s: 416 left at that rate is 317 s, so about 6 minutes.
    expect(timeLeft({ done: 84, found: 500, startedAt, now: at(64) })).toBe("About 6 minutes left");
    // 100 left at 4 recipes every 3 s is 75 s.
    expect(timeLeft({ done: 400, found: 500, startedAt, now: at(300) })).toBe("About 2 minutes left");
    // Exactly a minute left.
    expect(timeLeft({ done: 250, found: 310, startedAt, now: at(250) })).toBe("About 1 minute left");
  });

  it("says less than a minute near the end", () => {
    expect(timeLeft({ done: 480, found: 500, startedAt, now: at(300) })).toBe("Less than a minute left");
  });

  it("says nothing until 30 seconds and 20 recipes have gone by", () => {
    expect(timeLeft({ done: 40, found: 500, startedAt, now: at(29) })).toBeNull();
    expect(timeLeft({ done: 19, found: 500, startedAt, now: at(120) })).toBeNull();
    expect(timeLeft({ done: 20, found: 500, startedAt, now: at(30) })).toBe("About 12 minutes left");
  });

  it("says nothing once every recipe is in, or when the start can't be read", () => {
    expect(timeLeft({ done: 500, found: 500, startedAt, now: at(360) })).toBeNull();
    expect(timeLeft({ done: 100, found: 500, startedAt: "not a time", now: at(60) })).toBeNull();
  });
});
