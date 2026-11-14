import { afterEach, describe, expect, it, vi } from "vitest";
import { canCelebrate, recordCelebration, takeCelebration } from "~/lib/ouro/celebration-cap";

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 1, 12);

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(localStorage)) if (key.startsWith("ouro-moment:")) localStorage.removeItem(key);
});

describe("celebration caps", () => {
  it("counts showings inside the period under a key, and keeps only those", () => {
    const cap = { times: 2, per: "day" } as const;
    expect(takeCelebration("k", cap, now - day)).toBe(true);
    expect(takeCelebration("k", cap, now - 1000)).toBe(true);
    expect(canCelebrate("k", cap, now - 500)).toBe(false);
    expect(canCelebrate("k", cap, now)).toBe(true);
    recordCelebration("k", cap, now);
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:k")!)).toEqual([now - 1000, now]);
    expect(takeCelebration("k", cap, now + 1)).toBe(false);
  });

  it("reads a broken or foreign value as no showings", () => {
    localStorage.setItem("ouro-moment:shown:broken", "{not json");
    expect(canCelebrate("broken", { times: 1, per: "ever" }, now)).toBe(true);
    localStorage.setItem("ouro-moment:shown:object", '{"a":1}');
    expect(canCelebrate("object", { times: 1, per: "week" }, now)).toBe(true);
    localStorage.setItem("ouro-moment:shown:odd", JSON.stringify(["now", now + day, String(now)]));
    expect(canCelebrate("odd", { times: 1, per: "month" }, now)).toBe(true);
  });

  it("keeps counting in memory where the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(takeCelebration("private", { times: 1, per: "day" }, now)).toBe(true);
    expect(takeCelebration("private", { times: 1, per: "day" }, now + 1)).toBe(false);
  });
});
