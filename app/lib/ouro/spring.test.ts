import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { nearest, project, rubberband, spring, springAt } from "~/lib/ouro/spring";
import { holdFrames, type HeldFrames } from "~/lib/ouro/testing/frames";

afterEach(async () => {
  vi.restoreAllMocks();
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

/** Samples a spring every 4ms for `ms`. */
function sample(from: number, to: number, velocity: number, config: { response?: number; damping?: number } = {}, ms = 1500) {
  const values: number[] = [];
  for (let elapsed = 0; elapsed <= ms; elapsed += 4) values.push(springAt(from, to, velocity, elapsed, config).value);
  return values;
}

describe("spring", () => {
  it("starts at the live value with the velocity it was handed, in px per millisecond", () => {
    for (const damping of [1, 0.8]) {
      const start = springAt(40, 200, 0.9, 0, { damping });
      expect(start.value).toBe(40);
      expect(start.velocity).toBeCloseTo(0.9, 9);
      // A moment later it has moved the way the velocity points, at that speed.
      expect(springAt(40, 200, 0.9, 0.1, { damping }).value).toBeCloseTo(40.09, 2);
      expect(springAt(40, 200, -0.9, 0.1, { damping }).value).toBeCloseTo(39.91, 2);
    }
  });

  it("settles on its target without passing it when critically damped, the default", () => {
    const values = sample(0, 100, 0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
    // It only ever moves toward the target.
    for (let index = 1; index < values.length; index++) expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]!);
    expect(values.at(-1)).toBeCloseTo(100, 3);
    expect(springAt(0, 100, 0, 1500).velocity).toBeCloseTo(0, 5);
    // A damping ratio above 1 is treated as 1: this helper has no slower-than-critical spring.
    expect(springAt(0, 100, 0, 100, { damping: 3 })).toEqual(springAt(0, 100, 0, 100));
  });

  it("passes its target a little and comes back when under-damped", () => {
    const values = sample(0, 100, 0, { damping: 0.8 });
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(100.5);
    expect(peak).toBeLessThan(105);
    expect(values.at(-1)).toBeCloseTo(100, 2);
  });

  it("reaches its target sooner with a shorter response", () => {
    expect(springAt(0, 100, 0, 100, { response: 0.2 }).value).toBeGreaterThan(springAt(0, 100, 0, 100, { response: 0.5 }).value);
  });

  it("keeps a damping or response of zero or less from breaking it: it still comes to rest, on a number", () => {
    // No damping would swing for ever: it is held at 0.1, which dies away.
    expect(springAt(0, 100, 0, 250, { damping: 0 })).toEqual(springAt(0, 100, 0, 250, { damping: 0.1 }));
    expect(springAt(0, 100, 0, 250, { damping: -2 })).toEqual(springAt(0, 100, 0, 250, { damping: 0.1 }));
    expect(Math.abs(springAt(0, 100, 0, 20_000, { damping: 0 }).value - 100)).toBeLessThan(0.01);
    // No response time would divide by zero: it is held at 10ms.
    const instant = springAt(0, 100, 0, 16, { response: 0 });
    expect(instant).toEqual(springAt(0, 100, 0, 16, { response: 0.01 }));
    expect(Number.isFinite(instant.value) && Number.isFinite(instant.velocity)).toBe(true);
    expect(springAt(0, 100, 0, 16, { response: -1 })).toEqual(instant);
  });

  it("agrees with a step-by-step simulation of the same spring", () => {
    for (const damping of [1, 0.8, 0.5]) {
      const response = 0.3;
      const omega = (2 * Math.PI) / response;
      let value = 30;
      let speed = -400;
      const step = 1 / 100_000;
      for (let time = 0; time < 0.2; time += step) {
        speed += (-omega * omega * (value - 120) - 2 * damping * omega * speed) * step;
        value += speed * step;
      }
      const exact = springAt(30, 120, -0.4, 200, { response, damping });
      expect(exact.value).toBeCloseTo(value, 1);
      expect(exact.velocity * 1000).toBeCloseTo(speed, 0);
    }
  });

  it("projects where a flick would come to rest", () => {
    // Apple's function: position + velocity * d / (1 - d), with d 0.998.
    expect(project(100, 1)).toBeCloseTo(599, 6);
    expect(project(100, -0.5)).toBeCloseTo(-149.5, 6);
    expect(project(40, 0)).toBe(40);
    expect(project(0, 1, 0.99)).toBeCloseTo(99, 6);
  });

  it("resists more the further past a boundary, and never stops dead", () => {
    expect(rubberband(0, 300)).toBe(0);
    expect(rubberband(100, 300)).toBeCloseTo((100 * 300 * 0.55) / (300 + 55), 9);
    expect(rubberband(-100, 300)).toBeCloseTo(-rubberband(100, 300), 9);
    // Each further 100px moves it less, and it stays short of the dimension.
    const steps = [100, 200, 300, 400].map((over) => rubberband(over, 300));
    for (let index = 1; index < steps.length; index++) {
      expect(steps[index]!).toBeGreaterThan(steps[index - 1]!);
      if (index > 1) expect(steps[index]! - steps[index - 1]!).toBeLessThan(steps[index - 1]! - steps[index - 2]!);
    }
    expect(rubberband(1_000_000, 300)).toBeLessThan(300);
    expect(rubberband(100, 300, 0.2)).toBeLessThan(rubberband(100, 300));
  });

  it("finds the snap point nearest a value", () => {
    expect(nearest([0, 120, 360], 70)).toBe(120);
    expect(nearest([0, 120, 360], 50)).toBe(0);
    expect(nearest([0, 120, 360], 900)).toBe(360);
    // The first of two equally near, and the value itself with nowhere to snap.
    expect(nearest([0, 100], 50)).toBe(0);
    expect(nearest([], 42)).toBe(42);
    // With project: a flick from 40 at 0.3px/ms lands near 190, so it snaps to 120, not 0.
    expect(nearest([0, 120, 360], project(40, 0.3))).toBe(120);
  });

  describe("on animation frames", () => {
    // Frames are the test's to step, 16ms apart, so a spring is where the test expects on any machine.
    let frames: HeldFrames;
    beforeEach(() => {
      frames = holdFrames();
    });
    afterEach(() => frames.release());

    it("moves from the live value to the target, ends exactly on it and says when it rests", () => {
      const seen: [number, number][] = [];
      const onRest = vi.fn();
      const handle = spring({ from: 0, to: 100, onUpdate: (value, velocity) => seen.push([value, velocity]), onRest });
      expect(handle.running).toBe(true);
      // Nothing moves before the first frame.
      expect(seen).toEqual([]);
      frames.step(16);
      expect(seen.length).toBe(1);
      expect(seen[0]![0]).toBeCloseTo(springAt(0, 100, 0, 16).value, 9);
      // On the way it reports a velocity toward the target, in px/ms.
      expect(seen[0]![1]).toBeCloseTo(springAt(0, 100, 0, 16).velocity, 9);
      expect(seen[0]![1]).toBeGreaterThan(0);
      frames.until(() => !handle.running);
      expect(onRest).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)).toEqual([100, 0]);
      expect(Math.max(...seen.map(([value]) => value))).toBeLessThanOrEqual(100);
      expect(seen.length).toBeGreaterThan(20);
      // At rest nothing more is asked of the browser.
      const count = seen.length;
      frames.step(16);
      expect(seen.length).toBe(count);
      expect(handle.stop()).toEqual({ value: 100, velocity: 0 });
    });

    it("carries the release velocity, and bounces only when asked to", () => {
      const run = (options: { velocity: number; damping?: number; response?: number }) => {
        const seen: number[] = [];
        const handle = spring({ from: 0, to: 100, ...options, onUpdate: (value) => seen.push(value) });
        frames.until(() => !handle.running);
        return seen;
      };
      // After a flick the caller passes 0.8; the default stays critically damped.
      const flicked = run({ velocity: 0.3, damping: 0.8 });
      const placed = run({ velocity: 0.3 });
      expect(Math.max(...flicked)).toBeGreaterThan(100.5);
      expect(Math.max(...placed)).toBeLessThanOrEqual(100);
      expect(flicked.at(-1)).toBe(100);
      // The velocity is felt from the first frame: faster than the same spring from a standstill.
      expect(placed[0]!).toBeGreaterThan(springAt(0, 100, 0, 16).value + 3);
      // A velocity away from the target carries the value that way first.
      const away = run({ velocity: -2, response: 0.2 });
      expect(Math.min(...away)).toBeLessThan(-5);
      expect(away.at(-1)).toBe(100);
    });

    it("can be stopped mid-flight, and says where it was and how fast", () => {
      const seen: number[] = [];
      const onRest = vi.fn();
      const handle = spring({ from: 0, to: 300, onUpdate: (value) => seen.push(value), onRest });
      frames.step(16);
      frames.step(16);
      frames.step(16);
      const held = handle.stop();
      expect(handle.running).toBe(false);
      expect(held.value).toBe(seen.at(-1));
      expect(held).toEqual(springAt(0, 300, 0, 48));
      expect(held.velocity).toBeGreaterThan(0);
      // Stopped between frames, it says what the last frame wrote, which is what is on
      // screen, not where the clock says it would be by now.
      const other = spring({ from: 0, to: 300, onUpdate: () => {} });
      frames.step(10);
      const now = performance.now;
      performance.now = () => now.call(performance) + 9;
      expect(other.stop()).toEqual(springAt(0, 300, 0, 10));
      performance.now = now;
      // Stopped before its first frame, it is where it began.
      expect(spring({ from: 7, to: 300, velocity: 0.5, onUpdate: () => {} }).stop()).toEqual({ value: 7, velocity: 0.5 });
      frames.step(16);
      frames.step(16);
      // Stopped: no more updates, no rest, and a second stop says the same.
      expect(seen.length).toBe(3);
      expect(onRest).not.toHaveBeenCalled();
      expect(handle.stop()).toEqual(held);
    });

    it("moves to a new target from where it is, keeping its velocity", () => {
      const seen: number[] = [];
      const onRest = vi.fn();
      const handle = spring({ from: 0, to: 300, onUpdate: (value) => seen.push(value), onRest });
      frames.until(() => seen.length > 0 && seen.at(-1)! > 60);
      const before = handle.stop();
      // Stopping to look did not end it for retarget: it carries on from the same place.
      handle.retarget(0);
      expect(handle.running).toBe(true);
      frames.step(16);
      // No jump at the turn: one frame later it is where a spring from there, at that speed, would be, still going up.
      expect(seen.at(-1)).toBeCloseTo(springAt(before.value, 0, before.velocity, 16).value, 9);
      expect(seen.at(-1)!).toBeGreaterThan(before.value);
      frames.until(() => !handle.running);
      expect(onRest).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)).toBe(0);
      // At rest it can be sent off again.
      handle.retarget(50);
      expect(handle.running).toBe(true);
      frames.until(() => !handle.running);
      expect(onRest).toHaveBeenCalledTimes(2);
      expect(seen.at(-1)).toBe(50);
    });

    it("keeps its velocity when retargeted mid-flight without a stop first", () => {
      const seen: number[] = [];
      const handle = spring({ from: 0, to: 300, onUpdate: (value) => seen.push(value) });
      frames.step(16);
      frames.step(16);
      const before = springAt(0, 300, 0, 32);
      handle.retarget(100);
      frames.step(16);
      expect(seen.at(-1)).toBeCloseTo(springAt(before.value, 100, before.velocity, 16).value, 9);
      // The frame the old course had asked for does not also run.
      expect(seen.length).toBe(3);
      handle.stop();
    });

    it("does nothing in a frame that outlives its stop", () => {
      const seen: number[] = [];
      const asked: FrameRequestCallback[] = [];
      // Set by hand and put back by hand: the held frames underneath are not a spy's to restore.
      const held = { request: window.requestAnimationFrame, cancel: window.cancelAnimationFrame };
      window.requestAnimationFrame = (callback) => asked.push(callback);
      window.cancelAnimationFrame = () => {};
      try {
        const handle = spring({ from: 0, to: 100, onUpdate: (value) => seen.push(value) });
        handle.stop();
        // The cancel did not reach this frame (a test harness, or a browser bug): it runs anyway.
        asked[0]!(performance.now() + 16);
        expect(seen).toEqual([]);
        expect(asked.length).toBe(1);
        expect(handle.running).toBe(false);
      } finally {
        window.requestAnimationFrame = held.request;
        window.cancelAnimationFrame = held.cancel;
      }
    });

    it("can be retargeted and stopped through functions taken off the handle", () => {
      const seen: number[] = [];
      const { retarget, stop } = spring({ from: 0, to: 100, onUpdate: (value) => seen.push(value) });
      frames.step(16);
      retarget(-50);
      frames.step(16);
      expect(seen.at(-1)!).toBeLessThan(100);
      frames.until(() => seen.at(-1) === -50);
      expect(stop()).toEqual({ value: -50, velocity: 0 });
    });

    it("marks the element it moves while it runs, until it rests or is stopped", () => {
      const element = document.createElement("div");
      const handle = spring({ from: 0, to: 100, element, onUpdate: () => {}, onRest: () => expect(element.hasAttribute("data-ouro-settling")).toBe(false) });
      expect(element.getAttribute("data-ouro-settling")).toBe("");
      frames.step(16);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      frames.until(() => !handle.running);
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      // Sent off again it is marked again, and a stop clears the mark.
      handle.retarget(0);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      handle.stop();
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      // No element, or none yet, is fine.
      spring({ from: 0, to: 1, element: null, onUpdate: () => {} }).stop();
    });

    it("rests at once when it starts on its target with no velocity", () => {
      const onUpdate = vi.fn();
      const onRest = vi.fn();
      spring({ from: 80, to: 80, onUpdate, onRest });
      frames.step(16);
      expect(onRest).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls).toEqual([[80, 0]]);
    });

    it("treats a frame stamped before the spring began as its start", () => {
      const seen: number[] = [];
      const handle = spring({ from: 0, to: 100, onUpdate: (value) => seen.push(value) });
      // A browser can hand a frame a time a little before the call that asked for it.
      frames.step(-5);
      expect(seen).toEqual([0]);
      handle.stop();
    });

    it("runs on the browser's own frames", async () => {
      frames.release();
      const seen: number[] = [];
      const handle = spring({ from: 0, to: 10, onUpdate: (value) => seen.push(value) });
      await expect.poll(() => handle.running, { timeout: 5000 }).toBe(false);
      expect(seen.at(-1)).toBe(10);
    });

    it("jumps to the target and rests, before it returns, with reduced motion", async () => {
      await commands.emulateMedia({ reducedMotion: "reduce" });
      const onUpdate = vi.fn();
      const onRest = vi.fn();
      const asked = vi.spyOn(window, "requestAnimationFrame");
      const element = document.createElement("div");
      const marked = vi.spyOn(element, "toggleAttribute");
      const handle = spring({ from: 0, to: 100, velocity: 2, damping: 0.8, element, onUpdate, onRest });
      // Nothing ran, so the element was never marked as settling.
      expect(marked.mock.calls.every(([, on]) => on === false)).toBe(true);
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      expect(onUpdate.mock.calls).toEqual([[100, 0]]);
      expect(onRest).toHaveBeenCalledTimes(1);
      expect(handle.running).toBe(false);
      expect(asked).not.toHaveBeenCalled();
      expect(handle.stop()).toEqual({ value: 100, velocity: 0 });
      // A new target is a jump too.
      handle.retarget(20);
      expect(onUpdate.mock.calls.at(-1)).toEqual([20, 0]);
      expect(onRest).toHaveBeenCalledTimes(2);
      expect(asked).not.toHaveBeenCalled();
    });
  });
});
