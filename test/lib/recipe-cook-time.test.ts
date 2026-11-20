import { describe, expect, it } from "vitest";
import { cookTimeLabel } from "~/lib/recipe-cook-time";

describe("cookTimeLabel", () => {
  it("adds up the timed steps, as the Apple app's meta row does", () => {
    expect(cookTimeLabel([15, null, 8])).toBe("23 min");
    expect(cookTimeLabel([60])).toBe("1 hr");
    expect(cookTimeLabel([45, 20])).toBe("1 hr 5 min");
  });

  it("leaves the clause out when no step is timed", () => {
    expect(cookTimeLabel([])).toBeUndefined();
    expect(cookTimeLabel([null, undefined, 0, -5])).toBeUndefined();
  });
});
