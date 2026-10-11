import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devThrow, devWarn } from "~/lib/ouro/dev";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("devWarn", () => {
  it("uses the spec format", () => {
    devWarn("Button", "bg-red-500 sets appearance", 'tone="destructive"', {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[ouro-ui\] Button: .+\. Fix: .+\.$/);
  });

  it("warns once per key", () => {
    const key = {};
    devWarn("Button", "problem one", "fix one", key);
    devWarn("Button", "problem one", "fix one", key);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns separately for different keys and different messages on one key", () => {
    const a = {};
    devWarn("Button", "same problem", "same fix", a);
    devWarn("Button", "same problem", "same fix", {});
    devWarn("Button", "another problem", "same fix", a);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("de-duplicates by message text when there is no key", () => {
    devWarn("Dialog", "keyless problem", "keyless fix");
    devWarn("Dialog", "keyless problem", "keyless fix");
    devWarn("Dialog", "other keyless problem", "keyless fix");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not double a trailing period", () => {
    devWarn("Sheet", "ends with a period.", "also does.", {});
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Sheet: ends with a period. Fix: also does.");
  });
});

// Production behavior (no warning, no fix text, strings stripped) is tested against a
// real Vite production bundle in scripts/dev-strip.test.mjs.
describe("devThrow", () => {
  it("throws the full message in development", () => {
    expect(() => devThrow("Sheet.Title", "outside Sheet", "<Sheet title='x' />")).toThrow(
      "[ouro-ui] Sheet.Title: outside Sheet. Fix: <Sheet title='x' />.",
    );
  });
});
