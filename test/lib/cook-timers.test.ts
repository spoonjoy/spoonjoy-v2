import { describe, expect, it } from "vitest";
import { cookTimers } from "~/lib/cook-timers";

describe("cookTimers", () => {
  it("gives each step with a positive duration a timer in seconds, named by its step and scoped by timerId", () => {
    expect(
      cookTimers("recipe-1", [
        { stepNum: 1, stepTitle: "Boil pasta", duration: 10 },
        { stepNum: 2, stepTitle: null, duration: 1.5 },
        { stepNum: 3, stepTitle: "Plate", duration: null },
        { stepNum: 4, duration: 0 },
        { stepNum: 5 },
      ]),
    ).toEqual([
      { stepNum: 1, label: "Step 1 · Boil pasta", duration: 600, timerId: "spoonjoy-cook-timer:recipe-1:1" },
      { stepNum: 2, label: "Step 2", duration: 90, timerId: "spoonjoy-cook-timer:recipe-1:2" },
    ]);
  });
});
