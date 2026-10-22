import { afterEach, describe, expect, it, vi } from "vitest";
import { buzz, chime, createChimeContext } from "~/lib/ouro/feedback";

type Scope = { AudioContext?: unknown; webkitAudioContext?: unknown };
const scope = globalThis as unknown as Scope;
const real = { AudioContext: scope.AudioContext, webkitAudioContext: scope.webkitAudioContext };

/** A stand-in AudioContext that records the tones it is asked for. */
function fakeContext(state: AudioContextState = "running", { resumesTo = "running" as AudioContextState, failOn = "", resumeAfter = 0 } = {}) {
  const tones: { frequency: number; start: number; stop: number; oscillator: { onended: (() => void) | null } }[] = [];
  const context = {
    state,
    currentTime: 2,
    destination: {},
    closed: 0,
    // A browser that keeps the page silent may leave resume() pending; Infinity never settles.
    resume: vi.fn(async () => {
      if (resumeAfter === Infinity) return new Promise<void>(() => {});
      if (resumeAfter > 0) await new Promise((settle) => setTimeout(settle, resumeAfter));
      context.state = resumesTo;
    }),
    close: vi.fn(async () => {
      context.closed += 1;
    }),
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
    createOscillator: () => {
      if (failOn === "oscillator") throw new Error("no oscillator");
      const tone = { frequency: 0, start: 0, stop: 0, oscillator: null as unknown as { onended: (() => void) | null } };
      const oscillator = {
        type: "",
        frequency: {
          set value(hz: number) {
            tone.frequency = hz;
          },
        },
        connect: vi.fn(),
        start: (at: number) => void (tone.start = at),
        stop: (at: number) => void (tone.stop = at),
        onended: null as (() => void) | null,
      };
      tone.oscillator = oscillator;
      tones.push(tone);
      return oscillator;
    },
  };
  return { context: context as unknown as AudioContext & { closed: number; close: ReturnType<typeof vi.fn> }, tones };
}

function useConstructor(value: unknown, webkit?: unknown) {
  scope.AudioContext = value;
  scope.webkitAudioContext = webkit;
}

afterEach(() => {
  scope.AudioContext = real.AudioContext;
  scope.webkitAudioContext = real.webkitAudioContext;
  delete (navigator as { vibrate?: unknown }).vibrate;
  vi.restoreAllMocks();
});

describe("createChimeContext", () => {
  it("makes an AudioContext where the browser has Web Audio", async () => {
    const context = createChimeContext();
    expect(context).toBeInstanceOf(AudioContext);
    await context!.close();
  });

  it("uses the prefixed constructor of older Safari", () => {
    const made: unknown[] = [];
    useConstructor(undefined, class {
      constructor() {
        made.push(this);
      }
    });
    expect(createChimeContext()).toBe(made[0]);
  });

  it("returns null without Web Audio, or when the browser refuses one", () => {
    useConstructor(undefined, undefined);
    expect(createChimeContext()).toBeNull();
    useConstructor(class {
      constructor() {
        throw new Error("too many contexts");
      }
    });
    expect(createChimeContext()).toBeNull();
  });
});

describe("chime", () => {
  it("schedules three short tones on the context it is given, and leaves it open", async () => {
    const { context, tones } = fakeContext();
    expect(await chime({ context })).toBe(true);
    expect(tones.map((tone) => tone.frequency)).toEqual([880, 880, 880]);
    expect(tones.map((tone) => Number(tone.start.toFixed(2)))).toEqual([2, 2.3, 2.6]);
    expect(tones.every((tone) => Number((tone.stop - tone.start).toFixed(2)) === 0.18)).toBe(true);
    tones.at(-1)!.oscillator.onended!();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("resumes a context the browser suspended", async () => {
    const { context, tones } = fakeContext("suspended");
    expect(await chime({ context })).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(tones).toHaveLength(3);
  });

  it("resolves false when the page may not play sound yet", async () => {
    const { context, tones } = fakeContext("suspended", { resumesTo: "suspended" });
    expect(await chime({ context })).toBe(false);
    expect(tones).toHaveLength(0);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("resolves false soon when the browser never settles resume, and plays nothing when it settles late", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const never = fakeContext("suspended", { resumeAfter: Infinity });
      const pending = chime({ context: never.context });
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBe(false);
      expect(never.context.close).not.toHaveBeenCalled();
      const late = fakeContext("suspended", { resumeAfter: 1000 });
      const playing = chime({ context: late.context });
      await vi.advanceTimersByTimeAsync(300);
      expect(await playing).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(late.context.state).toBe("running");
      expect(late.tones).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a context it made for itself when the browser never settles resume", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let last: ReturnType<typeof fakeContext> | undefined;
      useConstructor(function () {
        last = fakeContext("suspended", { resumeAfter: Infinity });
        return last.context;
      });
      const pending = chime();
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBe(false);
      expect(last!.context.close).toHaveBeenCalledOnce();
      expect(last!.tones).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves false, and closes its own context, when resume is refused", async () => {
    let last: ReturnType<typeof fakeContext> | undefined;
    useConstructor(function () {
      last = fakeContext("suspended");
      last.context.resume = vi.fn(async () => {
        throw new Error("not allowed");
      });
      return last.context;
    });
    expect(await chime()).toBe(false);
    expect(last!.context.close).toHaveBeenCalledOnce();
  });

  it("resolves false, without throwing, when Web Audio fails", async () => {
    const { context } = fakeContext("running", { failOn: "oscillator" });
    expect(await chime({ context })).toBe(false);
  });

  it("makes its own context without one, and closes it when the tones end or when it stays silent", async () => {
    let last: ReturnType<typeof fakeContext> | undefined;
    let state: AudioContextState = "running";
    useConstructor(function () {
      last = fakeContext(state);
      return last.context;
    });
    expect(await chime()).toBe(true);
    expect(last!.context.close).not.toHaveBeenCalled();
    last!.tones.at(-1)!.oscillator.onended!();
    expect(last!.context.close).toHaveBeenCalledOnce();
    state = "closed";
    expect(await chime({ context: null })).toBe(false);
    expect(last!.context.close).toHaveBeenCalledOnce();
  });

  it("closes its own context when Web Audio fails, and ignores a refused close", async () => {
    let last: ReturnType<typeof fakeContext> | undefined;
    useConstructor(function () {
      last = fakeContext("running", { failOn: "oscillator" });
      last.context.close.mockRejectedValue(new Error("closed already"));
      return last.context;
    });
    expect(await chime()).toBe(false);
    expect(last!.context.close).toHaveBeenCalledOnce();
  });

  it("resolves false without Web Audio", async () => {
    useConstructor(undefined, undefined);
    expect(await chime()).toBe(false);
  });
});

describe("buzz", () => {
  it("vibrates in a short alert pattern where the device can", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    expect(buzz()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 400]);
  });

  it("returns false where the device cannot vibrate or refuses", () => {
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    expect(buzz()).toBe(false);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: () => {
        throw new Error("blocked");
      },
    });
    expect(buzz()).toBe(false);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => false });
    expect(buzz()).toBe(false);
  });
});
