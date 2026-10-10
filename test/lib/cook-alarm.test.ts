import { afterEach, describe, expect, it, vi } from "vitest";
import { createCookAlarm, VIBRATION_PATTERN } from "~/lib/cook-alarm.client";

function fakeAudioContext({ state = "running" as AudioContextState, failResume = false } = {}) {
  const oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const instance = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => (failResume ? Promise.reject(new Error("no")) : Promise.resolve())),
    close: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      const oscillator = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  const Constructor = vi.fn(function FakeAudioContext() {
    return instance;
  });
  return { instance, Constructor, oscillators };
}

function setGlobal(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
}

describe("cook alarm", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "AudioContext");
    Reflect.deleteProperty(window, "webkitAudioContext");
    Reflect.deleteProperty(navigator, "vibrate");
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("beeps three times, vibrates and resumes a suspended audio context", () => {
    const audio = fakeAudioContext({ state: "suspended" });
    setGlobal(window, "AudioContext", audio.Constructor);
    const vibrate = vi.fn(() => true);
    setGlobal(navigator, "vibrate", vibrate);

    const alarm = createCookAlarm();
    alarm.prime();
    expect(audio.Constructor).toHaveBeenCalledTimes(1);
    expect(audio.instance.resume).toHaveBeenCalledTimes(1);
    alarm.ring("Time's up", "Step 1");
    expect(audio.Constructor).toHaveBeenCalledTimes(1);
    expect(audio.oscillators).toHaveLength(3);
    expect(audio.oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(VIBRATION_PATTERN);
    alarm.close();
    expect(audio.instance.close).toHaveBeenCalledTimes(1);
    alarm.close();
    expect(audio.instance.close).toHaveBeenCalledTimes(1);
  });

  it("uses the prefixed WebKit audio context and survives a failing resume", async () => {
    const audio = fakeAudioContext({ state: "suspended", failResume: true });
    setGlobal(window, "webkitAudioContext", audio.Constructor);
    const alarm = createCookAlarm();
    alarm.ring("Time's up", "Step 1");
    alarm.prime();
    await Promise.resolve();
    expect(audio.oscillators).toHaveLength(3);
    expect(audio.instance.resume).toHaveBeenCalledTimes(2);
    audio.instance.close.mockImplementation(() => Promise.reject(new Error("closed")));
    alarm.close();
    await Promise.resolve();
    expect(audio.instance.close).toHaveBeenCalledTimes(1);
  });

  it("does nothing audible without Web Audio and tolerates a throwing constructor", () => {
    const silent = createCookAlarm();
    expect(() => {
      silent.prime();
      silent.ring("Time's up", "Step 1");
      silent.close();
    }).not.toThrow();

    setGlobal(window, "AudioContext", vi.fn(function Broken() {
      throw new Error("blocked");
    }));
    const broken = createCookAlarm();
    expect(() => broken.ring("Time's up", "Step 1")).not.toThrow();
  });

  it("keeps going when a beep or vibration throws", () => {
    const audio = fakeAudioContext();
    audio.instance.createOscillator.mockImplementation(() => {
      throw new Error("no oscillator");
    });
    setGlobal(window, "AudioContext", audio.Constructor);
    setGlobal(navigator, "vibrate", vi.fn(() => {
      throw new Error("no vibration");
    }));
    expect(() => createCookAlarm().ring("Time's up", "Step 1")).not.toThrow();
  });

  it("notifies only when permission is already granted and the page is hidden", () => {
    const Notification = vi.fn();
    setGlobal(window, "Notification", Object.assign(Notification, { permission: "granted" }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    createCookAlarm().ring("Time's up", "Step 2, Simmer");
    expect(Notification).toHaveBeenCalledWith("Time's up", { body: "Step 2, Simmer", tag: "spoonjoy-cook-timer" });

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    createCookAlarm().ring("Time's up", "Step 2");
    expect(Notification).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    (Notification as unknown as { permission: string }).permission = "default";
    createCookAlarm().ring("Time's up", "Step 2");
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it("tolerates a notification constructor that throws", () => {
    const Notification = vi.fn(function Throws() {
      throw new TypeError("Illegal constructor");
    });
    setGlobal(window, "Notification", Object.assign(Notification, { permission: "granted" }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    expect(() => createCookAlarm().ring("Time's up", "Step 1")).not.toThrow();
  });
});
