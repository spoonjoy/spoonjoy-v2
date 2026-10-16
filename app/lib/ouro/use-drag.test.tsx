import { useEffect, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { FLICK_VELOCITY, useDrag, type DragOptions, type DragProps, type DragState } from "~/lib/ouro/use-drag";

// Pointer events are dispatched, each with a time the test sets, so a release is exactly
// as fast as the test says. Real touch and mouse drags run through the hook in the
// SwipeActions and Reorderable tests.

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  vi.restoreAllMocks();
});

type Calls = { start: DragState[]; move: DragState[]; end: (DragState & { cancelled: boolean })[] };

let latestProps: DragProps | undefined;

function Pad({ calls, options }: { calls: Calls; options?: Partial<DragOptions> | undefined }): JSX.Element {
  const drag = useDrag({
    axis: "x",
    onStart: (state) => {
      calls.start.push(state);
    },
    onMove: (state) => calls.move.push(state),
    onEnd: (state) => calls.end.push(state),
    ...options,
  });
  useEffect(() => {
    latestProps = drag;
  });
  return <div data-testid="pad" style={{ width: 200, height: 100 }} {...drag} />;
}

async function mount(options?: Partial<DragOptions>) {
  const calls: Calls = { start: [], move: [], end: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (next?: Partial<DragOptions>) => act(async () => root!.render(<Pad calls={calls} options={next} />));
  await render(options);
  return { calls, pad: host.querySelector<HTMLElement>("[data-testid=pad]")!, render };
}

let clock = 1000;
/** Dispatches a pointer event `ms` after the last one. While the pointer is down its button is held, as a real one's is. */
async function fire(target: EventTarget, type: string, x: number, y: number, ms = 16, init: PointerEventInit = {}, coalesced?: PointerEvent[] | null) {
  clock += ms;
  const buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: x, clientY: y, ...init });
  Object.defineProperty(event, "timeStamp", { value: clock });
  if (coalesced !== undefined) {
    Object.defineProperty(event, "getCoalescedEvents", { value: coalesced === null ? undefined : () => coalesced });
  }
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("useDrag", () => {
  it("starts once the pointer has moved 10px along the axis, and reports movement from the grab point", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 106, 52);
    expect(calls.start).toEqual([]);
    expect(calls.move).toEqual([]);
    const started = await fire(pad, "pointermove", 112, 53);
    expect(calls.start.length).toBe(1);
    expect(calls.start[0]!.delta).toBe(12);
    expect(calls.start[0]!.event).toBe(started);
    // The move that started it is a move too, 1:1 with the pointer.
    expect(calls.move.map((state) => state.delta)).toEqual([12]);
    await fire(pad, "pointermove", 60, 90);
    expect(calls.move.map((state) => state.delta)).toEqual([12, -40]);
    expect(calls.start.length).toBe(1);
    const lifted = await fire(pad, "pointerup", 60, 90);
    expect(calls.end.length).toBe(1);
    expect(calls.end[0]).toMatchObject({ delta: -40, cancelled: false });
    expect(calls.end[0]!.event).toBe(lifted);
    // The gesture is over: later moves are nobody's.
    await fire(pad, "pointermove", 0, 0);
    expect(calls.move.length).toBe(2);
  });

  it("follows the vertical axis when asked", async () => {
    const { calls, pad } = await mount({ axis: "y" });
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 103, 75);
    await fire(pad, "pointerup", 103, 75);
    expect(calls.move.map((state) => state.delta)).toEqual([25]);
    expect(calls.end[0]!.delta).toBe(25);
  });

  it("gives the gesture up when the other axis wins the first 10px, so the page scrolls", async () => {
    const { calls, pad } = await mount();
    const capture = vi.spyOn(pad, "setPointerCapture");
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 104, 54);
    await fire(pad, "pointermove", 108, 64);
    // Given up: a later sideways move starts nothing, and nothing was captured.
    await fire(pad, "pointermove", 20, 64);
    await fire(pad, "pointerup", 20, 64);
    expect(calls).toEqual({ start: [], move: [], end: [] });
    expect(capture).not.toHaveBeenCalled();
    // A tie goes to the page.
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 112, 62);
    await fire(pad, "pointerup", 112, 62);
    expect(calls.start).toEqual([]);
  });

  it("ignores the other axis for an element that takes every touch", async () => {
    const { calls, pad } = await mount({ axis: "y", crossAxis: "ignore" });
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 160, 54);
    expect(calls.start).toEqual([]);
    await fire(pad, "pointermove", 170, 61);
    expect(calls.start.length).toBe(1);
    expect(calls.move.map((state) => state.delta)).toEqual([11]);
    await fire(pad, "pointerup", 170, 61);
  });

  it("takes its own threshold", async () => {
    const { calls, pad } = await mount({ threshold: 3 });
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 102, 50);
    expect(calls.start.length).toBe(0);
    await fire(pad, "pointermove", 104, 50);
    expect(calls.start.length).toBe(1);
    await fire(pad, "pointerup", 104, 50);
  });

  it("measures velocity over the last 100ms up to the event, in px per millisecond, and calls a fast release a flick", async () => {
    const { calls, pad } = await mount();
    expect(FLICK_VELOCITY).toBe(0.11);
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 120, 50, 20);
    await fire(pad, "pointermove", 140, 50, 20);
    // 40px in 40ms.
    expect(calls.move.at(-1)!.velocity).toBeCloseTo(1, 9);
    expect(calls.move.at(-1)!.flick).toBe(true);
    // The release is measured up to the lift: 40px in the 50ms since the press.
    await fire(pad, "pointerup", 140, 50, 10);
    expect(calls.end[0]!.velocity).toBeCloseTo(0.8, 9);
    expect(calls.end[0]!.flick).toBe(true);

    // The same fast move, then the finger sits still for 60ms before it lifts: the pause
    // counts, so the release is not read at the speed the finger had before it stopped.
    await fire(pad, "pointerdown", 100, 50, 1000);
    await fire(pad, "pointermove", 120, 50, 20);
    await fire(pad, "pointermove", 140, 50, 20);
    await fire(pad, "pointerup", 140, 50, 60);
    expect(calls.end[1]!.velocity).toBeCloseTo(0.4, 9);
    calls.end.splice(1);

    // Out and then back: the sign is the direction at release, whatever the distance.
    await fire(pad, "pointerdown", 100, 50, 1000);
    for (let step = 1; step <= 5; step++) await fire(pad, "pointermove", 100 + step * 20, 50, 30);
    for (let step = 1; step <= 5; step++) await fire(pad, "pointermove", 200 - step * 4, 50, 30);
    await fire(pad, "pointerup", 180, 50, 10);
    expect(calls.end[1]!.delta).toBe(80);
    expect(calls.end[1]!.velocity).toBeLessThan(0);
    expect(calls.end[1]!.flick).toBe(true);

    // A finger that rests before it lifts has no velocity, and a slow one is no flick.
    await fire(pad, "pointerdown", 100, 50, 1000);
    await fire(pad, "pointermove", 160, 50, 20);
    await fire(pad, "pointerup", 160, 50, 300);
    expect(calls.end[2]).toMatchObject({ velocity: 0, flick: false });
    await fire(pad, "pointerdown", 100, 50, 1000);
    await fire(pad, "pointermove", 112, 50, 50);
    await fire(pad, "pointermove", 115, 50, 50);
    await fire(pad, "pointerup", 115, 50, 10);
    // 3px in the 60ms from the oldest move of the last 100ms to the lift.
    expect(calls.end[3]!.velocity).toBeCloseTo(0.05, 9);
    expect(calls.end[3]!.flick).toBe(false);
    // Two events in the same instant give no velocity, not a division by zero.
    await fire(pad, "pointerdown", 100, 50, 1000);
    await fire(pad, "pointermove", 130, 50, 0);
    expect(calls.move.at(-1)!.velocity).toBe(0);
    await fire(pad, "pointerup", 130, 50, 0);
  });

  it.each(["x", "y"] as const)("reads a coalesced %s flick after the grab point has left the velocity window", async (axis) => {
    const { calls, pad } = await mount({ axis });
    const down = await fire(pad, "pointerdown", 100, 50);
    const samples = Array.from({ length: 10 }, (_, index) => {
      const delta = (index + 1) * 4;
      const sample = new PointerEvent("pointermove", { clientX: axis === "x" ? 100 + delta : 100, clientY: axis === "y" ? 50 + delta : 50 });
      Object.defineProperty(sample, "timeStamp", { value: down.timeStamp + (index + 1) * 10 + 0.1 });
      return sample;
    });
    const x = axis === "x" ? 140 : 100;
    const y = axis === "y" ? 90 : 50;
    await fire(pad, "pointermove", x, y, 100.1, {}, samples);
    await fire(pad, "pointerup", x, y, 0);
    expect(calls.move).toHaveLength(1);
    expect(calls.move[0]!.delta).toBe(40);
    expect(calls.end[0]!.velocity).toBeCloseTo(0.4, 9);
    expect(calls.end[0]!.flick).toBe(true);
  });

  it("prunes old coalesced points and still reads a slow release as slow", async () => {
    const { calls, pad } = await mount();
    const down = await fire(pad, "pointerdown", 100, 50);
    const samples = Array.from({ length: 10 }, (_, index) => {
      const sample = new PointerEvent("pointermove", { clientX: 100 + (index + 1) * 4, clientY: 50 });
      Object.defineProperty(sample, "timeStamp", { value: down.timeStamp + (index + 1) * 60 + 0.1 });
      return sample;
    });
    await fire(pad, "pointermove", 140, 50, 600.1, {}, samples);
    await fire(pad, "pointerup", 140, 50, 0);
    expect(calls.end[0]!.velocity).toBeCloseTo(4 / 60, 9);
    expect(calls.end[0]!.flick).toBe(false);
  });

  it("keeps measuring individual moves when coalesced events are unavailable", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 120, 50, 20, {}, null);
    await fire(pad, "pointerup", 120, 50, 0);
    expect(calls.end[0]!.velocity).toBeCloseTo(1, 9);
    expect(calls.end[0]!.flick).toBe(true);
  });

  it("reports a cancel as cancelled", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 140, 50);
    await fire(pad, "pointercancel", 140, 50);
    expect(calls.end).toMatchObject([{ delta: 40, cancelled: true }]);
    // A press that never became a drag ends without a word.
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointercancel", 100, 50);
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointerup", 103, 50);
    expect(calls.end.length).toBe(1);
  });

  it("says when a press begins, and when it ends without becoming a drag", async () => {
    const onPress = vi.fn();
    const onPressEnd = vi.fn();
    const { calls, pad } = await mount({ onPress, onPressEnd });
    // Lifted in place.
    const down = await fire(pad, "pointerdown", 100, 50);
    expect(onPress.mock.calls).toEqual([[down]]);
    expect(onPressEnd).not.toHaveBeenCalled();
    await fire(pad, "pointerup", 102, 50);
    expect(onPressEnd).toHaveBeenCalledTimes(1);
    // Cancelled by the browser.
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointercancel", 100, 50);
    expect(onPressEnd).toHaveBeenCalledTimes(2);
    // Given up to a scroll.
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 102, 80);
    expect(onPressEnd).toHaveBeenCalledTimes(3);
    await fire(pad, "pointerup", 102, 80);
    expect(onPressEnd).toHaveBeenCalledTimes(3);
    // Replaced by a new press when its release went unheard.
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointerdown", 100, 50);
    expect(onPress).toHaveBeenCalledTimes(5);
    expect(onPressEnd).toHaveBeenCalledTimes(4);
    // A press that becomes a drag ends with onEnd, not here.
    await fire(pad, "pointermove", 140, 50);
    await fire(pad, "pointerup", 140, 50);
    expect(calls.end.length).toBe(1);
    expect(onPressEnd).toHaveBeenCalledTimes(4);
    // A press the hook does not follow is not reported.
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "mouse", button: 2 });
    expect(onPress).toHaveBeenCalledTimes(5);
  });

  it("ends a press whose drag onStart refuses, and says nothing when the component unmounts under a press", async () => {
    const onPressEnd = vi.fn();
    const { pad } = await mount({ onStart: () => false, onPressEnd });
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 140, 50);
    expect(onPressEnd).toHaveBeenCalledTimes(1);
    await fire(pad, "pointerdown", 100, 50);
    await act(async () => root!.unmount());
    root = undefined;
    expect(onPressEnd).toHaveBeenCalledTimes(1);
  });

  it("lets go of a mouse press whose release was never heard, at its next move with no button down", async () => {
    const onPressEnd = vi.fn();
    const { calls, pad } = await mount({ onPressEnd });
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "mouse" });
    await fire(pad, "pointermove", 104, 50, 16, { pointerType: "mouse" });
    // The button came up outside the window. The mouse comes back and moves: it is not dragging.
    await fire(window, "pointermove", 160, 50, 16, { pointerType: "mouse", buttons: 0 });
    expect(onPressEnd).toHaveBeenCalledTimes(1);
    await fire(window, "pointermove", 200, 50, 16, { pointerType: "mouse" });
    expect(calls.start).toEqual([]);
    // A touch reports no button between its moves in some browsers; it is never let go this way.
    await fire(pad, "pointerdown", 100, 50, 1000);
    await fire(pad, "pointermove", 140, 50, 16, { buttons: 0 });
    expect(calls.start.length).toBe(1);
    // Nor is a mouse drag that has started: it has the pointer captured, and hears its release.
    await fire(pad, "pointerup", 140, 50);
    await fire(pad, "pointerdown", 100, 50, 1000, { pointerType: "mouse" });
    await fire(pad, "pointermove", 140, 50, 16, { pointerType: "mouse" });
    await fire(pad, "pointermove", 150, 50, 16, { pointerType: "mouse", buttons: 0 });
    expect(calls.move.at(-1)!.delta).toBe(50);
    await fire(pad, "pointerup", 150, 50, 16, { pointerType: "mouse" });
    expect(calls.end.length).toBe(2);
  });

  it("follows the first pointer only, and a mouse's primary button only", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50, 16, { isPrimary: false, pointerId: 7 });
    await fire(pad, "pointermove", 160, 50, 16, { pointerId: 7 });
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "mouse", button: 2 });
    await fire(pad, "pointermove", 160, 50, 16, { pointerType: "mouse" });
    expect(calls.start).toEqual([]);

    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 130, 50);
    // A second finger lands mid-drag: it neither restarts nor steers nor ends the drag.
    await fire(pad, "pointerdown", 10, 50, 16, { pointerId: 2 });
    await fire(pad, "pointermove", 0, 50, 16, { pointerId: 2 });
    await fire(pad, "pointerup", 0, 50, 16, { pointerId: 2 });
    await fire(pad, "pointercancel", 0, 50, 16, { pointerId: 2 });
    expect(calls.start.length).toBe(1);
    expect(calls.move.map((state) => state.delta)).toEqual([30]);
    expect(calls.end).toEqual([]);
    await fire(pad, "pointerup", 130, 50);
    expect(calls.end.length).toBe(1);
  });

  it("starts over with a new press when the last one never became a drag and its release went unheard", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 104, 50);
    // No pointerup arrives (the browser showed a dialog, say). The next press is a fresh gesture.
    await fire(pad, "pointerdown", 40, 50, 1000);
    await fire(pad, "pointermove", 60, 50);
    expect(calls.move.map((state) => state.delta)).toEqual([20]);
    await fire(pad, "pointerup", 60, 50);
    expect(calls.end.length).toBe(1);
  });

  it("lets onStart refuse the drag", async () => {
    const { calls, pad } = await mount({ onStart: (state) => state.event.pointerType !== "mouse" });
    const capture = vi.spyOn(pad, "setPointerCapture");
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "mouse" });
    await fire(pad, "pointermove", 160, 50, 16, { pointerType: "mouse" });
    await fire(pad, "pointermove", 190, 50, 16, { pointerType: "mouse" });
    await fire(pad, "pointerup", 190, 50, 16, { pointerType: "mouse" });
    expect(calls.move).toEqual([]);
    expect(calls.end).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "pen" });
    await fire(pad, "pointermove", 160, 50, 16, { pointerType: "pen" });
    expect(calls.move.length).toBe(1);
    await fire(pad, "pointerup", 160, 50, 16, { pointerType: "pen" });
  });

  it("needs no onStart", async () => {
    const { calls, pad } = await mount({ onStart: undefined });
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 130, 50);
    await fire(pad, "pointerup", 130, 50);
    expect(calls.move.length).toBe(1);
    expect(calls.end.length).toBe(1);
  });

  it("captures the pointer once the drag has started, not before, and works when the browser refuses", async () => {
    const { calls, pad } = await mount();
    const capture = vi.spyOn(pad, "setPointerCapture").mockImplementation(() => {});
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 105, 50);
    expect(capture).not.toHaveBeenCalled();
    await fire(pad, "pointermove", 115, 50);
    await fire(pad, "pointermove", 125, 50);
    expect(capture.mock.calls).toEqual([[1]]);
    await fire(pad, "pointerup", 125, 50);
    // A dispatched pointer is not one the browser has, so capturing it throws: the drag goes on.
    capture.mockRestore();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 130, 50);
    expect(calls.move.length).toBe(3);
    await fire(pad, "pointerup", 130, 50);
  });

  it("hears a pointer that has left the element before it could be captured", async () => {
    const { calls, pad } = await mount();
    await fire(pad, "pointerdown", 100, 50, 16, { pointerType: "mouse" });
    // The mouse is outside the element now: its events reach the window only.
    await fire(window, "pointermove", 400, 50, 16, { pointerType: "mouse" });
    await fire(window, "pointermove", 420, 50, 16, { pointerType: "mouse" });
    await fire(window, "pointerup", 420, 50, 16, { pointerType: "mouse" });
    expect(calls.move.map((state) => state.delta)).toEqual([300, 320]);
    expect(calls.end.length).toBe(1);
    // An event the element and the window both hear counts once.
    expect(calls.start.length).toBe(1);
  });

  it("uses the handlers of the latest render, and keeps the same props between renders", async () => {
    const { calls, pad, render } = await mount();
    const later = vi.fn();
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 130, 50);
    await render({ onMove: later });
    await fire(pad, "pointermove", 140, 50);
    expect(calls.move.length).toBe(1);
    expect(later).toHaveBeenCalledTimes(1);
    await fire(pad, "pointerup", 140, 50);
  });

  it("takes the touch moves of a drag, and of nothing else, so the browser makes no scroll or fling of them", async () => {
    const { pad } = await mount();
    const touchMove = (cancelable = true) => {
      const event = new Event("touchmove", { bubbles: true, cancelable });
      pad.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // No press, and a press that has not become a drag: the touch may still be a scroll.
    expect(touchMove()).toBe(false);
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 105, 50);
    expect(touchMove()).toBe(false);
    await fire(pad, "pointermove", 130, 50);
    expect(touchMove()).toBe(true);
    // A move the browser will not wait for cannot be taken.
    expect(touchMove(false)).toBe(false);
    await fire(pad, "pointerup", 130, 50);
    expect(touchMove()).toBe(false);
    // The listener goes with the element.
    const removed = vi.spyOn(pad, "removeEventListener");
    await act(async () => root!.unmount());
    root = undefined;
    expect(removed.mock.calls.map(([type]) => type)).toContain("touchmove");
    // A caller that merges refs the old way detaches with null: nothing to do.
    expect(latestProps!.ref(null)).toBeUndefined();
  });

  it("stops listening when its component unmounts mid-drag", async () => {
    const { calls, pad } = await mount();
    const removed = vi.spyOn(window, "removeEventListener");
    await fire(pad, "pointerdown", 100, 50);
    await fire(pad, "pointermove", 130, 50);
    await act(async () => root!.unmount());
    root = undefined;
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]));
    await fire(window, "pointermove", 160, 50);
    await fire(window, "pointerup", 160, 50);
    expect(calls.move.length).toBe(1);
    expect(calls.end).toEqual([]);
  });
});
