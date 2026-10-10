import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCookTimers, type CookTimerStep } from "~/hooks/use-cook-timers";
import { ALARM_WINDOW_MS, cookTimersStorageKey } from "~/lib/cook-timers";
import type { CookAlarm } from "~/lib/cook-alarm.client";

const steps: CookTimerStep[] = [
  { stepNum: 1, label: "Boil pasta", durationMinutes: 10 },
  { stepNum: 2, label: "", durationMinutes: 1 },
  { stepNum: 3, label: "Plate", durationMinutes: null },
];

function fakeAlarm() {
  const alarm: CookAlarm & { prime: ReturnType<typeof vi.fn>; ring: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
    prime: vi.fn(),
    ring: vi.fn(),
    close: vi.fn(),
  };
  return alarm;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useCookTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    window.localStorage.clear();
    document.title = "Pasta Night";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("lists every timed step as idle and ignores steps without a duration", () => {
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: fakeAlarm }));
    expect([...result.current.timers.keys()]).toEqual([1, 2]);
    expect(result.current.timers.get(1)).toEqual({ stepNum: 1, label: "Boil pasta", durationSeconds: 600, stored: null, ringing: false });
    expect(result.current.active).toEqual([]);
  });

  it("starts, pauses, resumes and cancels, saving each change for a reload", () => {
    const alarm = fakeAlarm();
    const { result, unmount } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    act(() => result.current.start(1));
    expect(alarm.prime).toHaveBeenCalledTimes(1);
    expect(result.current.timers.get(1)?.stored).toEqual({ status: "running", durationSeconds: 600, endsAt: 1_600_000 });
    expect(JSON.parse(window.localStorage.getItem(cookTimersStorageKey("r1")) ?? "{}")).toHaveProperty("1");

    act(() => {
      vi.advanceTimersByTime(4_000);
      result.current.pause(1);
    });
    expect(result.current.timers.get(1)?.stored).toEqual({ status: "paused", durationSeconds: 600, remainingMs: 596_000 });
    act(() => result.current.resume(1));
    expect(alarm.prime).toHaveBeenCalledTimes(2);
    expect(result.current.active.map((entry) => entry.stepNum)).toEqual([1]);

    unmount();
    expect(alarm.close).toHaveBeenCalledTimes(1);
    const reloaded = renderHook(() => useCookTimers("r1", steps, { alarmFactory: fakeAlarm }));
    expect(reloaded.result.current.timers.get(1)?.stored).toEqual({ status: "running", durationSeconds: 600, endsAt: 1_600_000 });

    act(() => reloaded.result.current.clear(1));
    expect(reloaded.result.current.active).toEqual([]);
    expect(window.localStorage.getItem(cookTimersStorageKey("r1"))).toBeNull();
  });

  it("does not start a step that has no duration or does not exist", () => {
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    act(() => {
      result.current.start(3);
      result.current.start(42);
    });
    expect(result.current.active).toEqual([]);
    expect(alarm.prime).not.toHaveBeenCalled();
  });

  it("rings at zero, announces it, retitles the tab and repeats until the alarm window ends", () => {
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    act(() => result.current.start(2));
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(alarm.ring).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(alarm.ring).toHaveBeenCalledWith("Time's up", "Step 2");
    expect(result.current.announcement).toBe("Time's up: Step 2");
    expect(result.current.timers.get(2)).toMatchObject({ ringing: true, stored: { status: "done", endedAt: 1_060_000 } });
    expect(document.title).toBe("Time's up: Step 2");

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(alarm.ring).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(ALARM_WINDOW_MS);
    });
    const ringsAtQuiet = alarm.ring.mock.calls.length;
    expect(result.current.timers.get(2)?.ringing).toBe(false);
    expect(document.title).toBe("Pasta Night");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(alarm.ring).toHaveBeenCalledTimes(ringsAtQuiet);

    // Starting again clears the old announcement.
    act(() => result.current.start(2));
    expect(result.current.announcement).toBe("");
  });

  it("stops ringing and restores the title when the cook dismisses the alarm", () => {
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    act(() => result.current.start(1));
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(document.title).toBe("Time's up: Step 1, Boil pasta");
    act(() => result.current.clear(1));
    expect(document.title).toBe("Pasta Night");
    const rings = alarm.ring.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(alarm.ring).toHaveBeenCalledTimes(rings);
  });

  it("catches up when the cook returns to a tab whose timeout was throttled", () => {
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    act(() => result.current.start(2));
    // The browser held the timeout back while the tab was hidden; the clock moved on anyway.
    vi.setSystemTime(1_000_000 + 61_000);
    act(() => setVisibility("hidden"));
    expect(alarm.ring).not.toHaveBeenCalled();
    act(() => setVisibility("visible"));
    expect(alarm.ring).toHaveBeenCalledTimes(1);
  });

  it("finishes a timer that ended while the page was closed, ringing only if it ended recently", () => {
    window.localStorage.setItem(
      cookTimersStorageKey("r1"),
      JSON.stringify({
        "1": { status: "running", durationSeconds: 600, endsAt: 1_000_000 - 30_000 },
        "2": { status: "running", durationSeconds: 60, endsAt: 1_000_000 - ALARM_WINDOW_MS - 1 },
      }),
    );
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    expect(alarm.ring).toHaveBeenCalledWith("Time's up", "Step 1, Boil pasta");
    expect(result.current.timers.get(1)?.ringing).toBe(true);
    expect(result.current.timers.get(2)).toMatchObject({ ringing: false, stored: { status: "done" } });
  });

  it("stays quiet when every finished timer is older than the alarm window", () => {
    window.localStorage.setItem(
      cookTimersStorageKey("r1"),
      JSON.stringify({ "2": { status: "running", durationSeconds: 60, endsAt: 1 } }),
    );
    const alarm = fakeAlarm();
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: () => alarm }));
    expect(alarm.ring).not.toHaveBeenCalled();
    expect(result.current.announcement).toBe("");
    expect(result.current.active).toHaveLength(1);
  });

  it("keeps a stored timer's own duration when the step's duration was edited", () => {
    window.localStorage.setItem(
      cookTimersStorageKey("r1"),
      JSON.stringify({ "3": { status: "paused", durationSeconds: 90, remainingMs: 30_000 } }),
    );
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: fakeAlarm }));
    expect(result.current.timers.get(3)).toMatchObject({ durationSeconds: 90, stored: { status: "paused" } });
  });

  it("loads the new recipe's timers when the recipe changes", () => {
    window.localStorage.setItem(
      cookTimersStorageKey("r2"),
      JSON.stringify({ "1": { status: "paused", durationSeconds: 600, remainingMs: 5_000 } }),
    );
    const { result, rerender } = renderHook(({ id }) => useCookTimers(id, steps, { alarmFactory: fakeAlarm }), {
      initialProps: { id: "r1" },
    });
    expect(result.current.active).toEqual([]);
    act(() => result.current.start(2));
    rerender({ id: "r2" });
    expect(result.current.active.map((entry) => entry.stepNum)).toEqual([1]);
    // The first recipe's timer stays with the first recipe.
    expect(Object.keys(JSON.parse(window.localStorage.getItem(cookTimersStorageKey("r2")) ?? "{}"))).toEqual(["1"]);
    expect(Object.keys(JSON.parse(window.localStorage.getItem(cookTimersStorageKey("r1")) ?? "{}"))).toEqual(["2"]);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useCookTimers("r1", steps, { alarmFactory: fakeAlarm }));
    act(() => result.current.start(1));
    expect(result.current.active).toHaveLength(1);
  });

  it("uses the real alarm by default", () => {
    const { result, unmount } = renderHook(() => useCookTimers("r1", steps));
    act(() => result.current.start(1));
    expect(result.current.active).toHaveLength(1);
    unmount();
  });
});
