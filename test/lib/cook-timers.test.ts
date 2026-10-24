import { afterEach, describe, expect, it, vi } from "vitest";
import { cookTimers, restoreCookTimer } from "~/lib/cook-timers";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

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
      { stepNum: 1, label: "Step 1 · Boil pasta", duration: 600, timerId: "spoonjoy-cook-timer:recipe-1:1", legacyStorageKey: "spoonjoy-cook-timers:v1:recipe-1" },
      { stepNum: 2, label: "Step 2", duration: 90, timerId: "spoonjoy-cook-timer:recipe-1:2", legacyStorageKey: "spoonjoy-cook-timers:v1:recipe-1" },
    ]);
  });

  describe("legacy cook timer transfer", () => {
    const [timer] = cookTimers("recipe-1", [{ stepNum: 1, duration: 1 }]);
    const key = "spoonjoy-cook-timers:v1:recipe-1";
    const nativeKey = "ouro-timer:spoonjoy-cook-timer:recipe-1:1";
    const paused = { status: "paused", durationSeconds: 60, remainingMs: 25_000 };

    it("does not invent persisted legacy state for a local controller", () => {
      window.localStorage.setItem(key, JSON.stringify({ "1": paused }));
      const [local] = cookTimers("local:recipe-1", [{ stepNum: 1, duration: 1 }], null);
      expect(restoreCookTimer(local)).toBe(true);
      expect(window.localStorage.getItem(key)).toBe(JSON.stringify({ "1": paused }));
      expect(window.localStorage.getItem("ouro-timer:spoonjoy-cook-timer:local:recipe-1:1")).toBeNull();
    });

    it("leaves storage alone when no legacy record or no matching step exists", () => {
      expect(restoreCookTimer(timer)).toBe(true);
      window.localStorage.setItem(key, JSON.stringify({ "2": paused }));
      expect(restoreCookTimer(timer)).toBe(true);
      expect(window.localStorage.getItem(key)).toBe(JSON.stringify({ "2": paused }));
      expect(window.localStorage.getItem(nativeKey)).toBeNull();
    });

    it.each([
      "{invalid", "null", "42", "[]",
      '{"1":null}', '{"1":42}',
      '{"1":{"status":"paused","durationSeconds":null,"remainingMs":1}}',
      '{"1":{"status":"paused","durationSeconds":1e400,"remainingMs":1}}',
      '{"1":{"status":"paused","durationSeconds":0,"remainingMs":1}}',
      '{"1":{"status":"running","durationSeconds":60}}',
      '{"1":{"status":"running","durationSeconds":60,"endsAt":1e400}}',
      '{"1":{"status":"paused","durationSeconds":60}}',
      '{"1":{"status":"paused","durationSeconds":60,"remainingMs":-1}}',
      '{"1":{"status":"done","durationSeconds":60}}',
      '{"1":{"status":"unknown","durationSeconds":60}}',
    ])("preserves unreadable legacy bytes without creating a native timer: %s", (raw) => {
      window.localStorage.setItem(key, raw);
      expect(restoreCookTimer(timer)).toBe(false);
      expect(window.localStorage.getItem(key)).toBe(raw);
      expect(window.localStorage.getItem(nativeKey)).toBeNull();
    });

    it("reports an unreadable legacy store without writing either format", () => {
      const blocked = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
      expect(restoreCookTimer(timer)).toBe(false);
      blocked.mockRestore();
      expect(window.localStorage.getItem(nativeKey)).toBeNull();
    });

    it("retains the original data when native persistence cannot be checked", () => {
      const raw = JSON.stringify({ "1": paused });
      window.localStorage.setItem(key, raw);
      const read = window.localStorage.getItem;
      const blocked = vi.spyOn(window.localStorage, "getItem").mockImplementation(function (this: Storage, name) {
        if (name.startsWith("ouro-timer:")) throw new DOMException("Blocked", "SecurityError");
        return read.call(this, name);
      });
      try {
        expect(restoreCookTimer(timer)).toBe(false);
        expect(window.localStorage.getItem(key)).toBe(raw);
      } finally {
        blocked.mockRestore();
      }
    });

    it.each([false, true])("retains legacy bytes when their cleanup fails (other step=%s)", (otherStep) => {
      const raw = JSON.stringify(otherStep ? { "1": paused, "2": paused } : { "1": paused });
      window.localStorage.setItem(key, raw);
      const write = window.localStorage.setItem;
      const blocked = otherStep
        ? vi.spyOn(window.localStorage, "setItem").mockImplementation(function (this: Storage, name, value) {
          if (name === key) throw new DOMException("Full", "QuotaExceededError");
          write.call(this, name, value);
        })
        : vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
          throw new DOMException("Blocked", "SecurityError");
        });
      try {
        expect(restoreCookTimer(timer)).toBe(false);
        expect(window.localStorage.getItem(key)).toBe(raw);
        expect(JSON.parse(window.localStorage.getItem(nativeKey)!)).toEqual({ status: "paused", duration: 60, remainingMs: 25_000 });
      } finally {
        blocked.mockRestore();
      }
    });

    it("does not overwrite a legacy record changed while native storage is updated", () => {
      window.localStorage.setItem(key, JSON.stringify({ "1": paused }));
      const changed = JSON.stringify({ "1": paused, "2": { ...paused, remainingMs: 40_000 } });
      const write = window.localStorage.setItem;
      const changedDuringWrite = vi.spyOn(window.localStorage, "setItem").mockImplementation(function (this: Storage, name, value) {
        write.call(this, name, value);
        if (name === nativeKey) write.call(this, key, changed);
      });
      try {
        expect(restoreCookTimer(timer)).toBe(false);
        expect(window.localStorage.getItem(key)).toBe(changed);
        expect(JSON.parse(window.localStorage.getItem(nativeKey)!)).toEqual({ status: "paused", duration: 60, remainingMs: 25_000 });
      } finally {
        changedDuringWrite.mockRestore();
      }
    });
  });
});
