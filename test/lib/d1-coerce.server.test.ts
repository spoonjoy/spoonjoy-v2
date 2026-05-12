import { describe, expect, it } from "vitest";
import { toDate, toNumber } from "~/lib/d1-coerce.server";

describe("D1 aggregate coercion helpers", () => {
  it("coerces BigInt and number aggregate values to numbers", () => {
    expect(toNumber(12n)).toBe(12);
    expect(toNumber(7)).toBe(7);
  });

  it("coerces BigInt millisecond timestamps to Date values", () => {
    expect(toDate(1_700_000_000_000n).toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("accepts number and string date values from alternate SQLite adapters", () => {
    expect(toDate(1_700_000_000_000).toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(toDate("2026-05-12T00:00:00.000Z").toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  it("returns existing Date instances unchanged", () => {
    const value = new Date("2026-05-12T00:00:00.000Z");
    expect(toDate(value)).toBe(value);
  });
});
