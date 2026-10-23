"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * The slowest release, in px/ms, that is a flick: fast enough that its direction decides, however short the drag.
 *
 * @claim "The slowest release, in px/ms, that" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > measures velocity over the last 100ms up to the event, in px per millisecond, and calls a fast release a flick)
 * @claim "The slowest release, in px/ms, that" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > prunes old coalesced points and still reads a slow release as slow)
 */
export const FLICK_VELOCITY = 0.11;

// A release velocity is read from the moves of the last 100ms.
const VELOCITY_WINDOW = 100;

/** Where a drag is. */
export interface DragState {
  /**
   * Movement from the grab point along the axis, in px. 1:1 with the finger; the caller applies `rubberband`.
   *
   * @claim "1:1 with the finger; the caller" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > starts once the pointer has moved 10px along the axis, and reports movement from the grab point)
   * @claim "1:1 with the finger; the caller" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > gives the gesture up when the other axis wins the first 10px, so the page scrolls)
   */
  delta: number;
  /**
   * Velocity along the axis in px/ms over the last 100ms, up to this event. Its sign is the direction at release; a finger that paused before lifting reads slower, and one that rested 100ms reads 0.
   *
   * @claim "Velocity along the axis in px/ms" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > measures velocity over the last 100ms up to the event, in px per millisecond, and calls a fast release a flick)
   * @claim "Its sign is the direction at" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > measures velocity over the last 100ms up to the event, in px per millisecond, and calls a fast release a flick)
   */
  velocity: number;
  /** Whether the velocity is a flick: `Math.abs(velocity) >= FLICK_VELOCITY`. */
  flick: boolean;
  event: PointerEvent;
}

/** What `useDrag` takes. */
export interface DragOptions {
  /** The gesture's axis. */
  axis: "x" | "y";
  /**
   * Movement in px before the axis is chosen and the pointer captured.
   * @default 10
   */
  threshold?: number | undefined;
  /**
   * What a move along the other axis means. `scroll`: it is left to the browser, so the
   * page scrolls, and the gesture is given up when it wins the first `threshold` px.
   * `ignore`: for an element with `touch-action: none`, such as a drag handle, where
   * every touch is the gesture's.
   * @default "scroll"
   * @claim "`ignore`: for an element with `touch-action" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > ignores the other axis for an element that takes every touch)
   * @claim "`ignore`: for an element with `touch-action" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > takes the touch moves of a drag, and of nothing else, so the browser makes no scroll or fling of them)
   */
  crossAxis?: "scroll" | "ignore" | undefined;
  /**
   * Called when a pointer this hook will follow goes down, before it has moved. Stop a
   * running spring here, so what is on screen holds still under the finger.
   */
  onPress?: ((event: PointerEvent) => void) | undefined;
  /**
   * Called when a press ends without becoming a drag: lifted in place, given up to a
   * scroll, refused by `onStart`, or replaced by a new press. Settle again here whatever
   * `onPress` stopped. Not called when the component unmounts.
   */
  onPressEnd?: (() => void) | undefined;
  /** Called once the axis is chosen. Start from where the element is. Return false to refuse the drag. */
  onStart?: ((state: DragState) => boolean | void) | undefined;
  /**
   * Called on every move after the start, the move that started it included.
   *
   * @claim "Called on every move after the" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > starts once the pointer has moved 10px along the axis, and reports movement from the grab point)
   */
  onMove: (state: DragState) => void;
  /**
   * Called on release, or on cancel with `cancelled` true. Not called for a press that never became a drag: that is `onPressEnd`.
   *
   * @claim "Not called for a press that" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > says when a press begins, and when it ends without becoming a drag)
   */
  onEnd: (state: DragState & { cancelled: boolean }) => void;
}

/** The handlers and the ref `useDrag` returns, to spread on the element. */
export interface DragProps {
  /**
   * Takes the element's touch moves once a drag has begun, so the browser makes no scroll
   * or fling of them. Without it, Chromium runs a fling after a fast drag, although
   * nothing scrolls, and for its half second or so the next tap gets no `click`.
   * @claim "Takes the element's touch moves once" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > takes the touch moves of a drag, and of nothing else, so the browser makes no scroll or fling of them)
   * @claim "Without it, Chromium runs a fling" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > takes the touch moves of a drag, and of nothing else, so the browser makes no scroll or fling of them)
   */
  ref: (element: HTMLElement | null) => (() => void) | undefined;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** A press being followed. */
interface Gesture {
  /** Whether the press has become a drag. */
  started: () => boolean;
  move: (event: PointerEvent) => void;
  end: (event: PointerEvent) => void;
  /**
   * Stops listening. A press that never became a drag reports its end, unless `silent`.
   *
   * @claim "A press that never became a" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > says when a press begins, and when it ends without becoming a drag)
   */
  release: (silent?: boolean) => void;
}

/**
 * Pointer handlers for a one-axis drag. The element also needs `touch-pan-y` (axis "x")
 * or `touch-pan-x` (axis "y"), or `touch-none` with `crossAxis: "ignore"`.
 *
 * It follows the first pointer only and a mouse's primary button only, ignores a second
 * finger, gives up without capturing when the cross axis wins the first 10px, captures
 * the pointer once the drag has started, and never blocks a new `pointerdown` while a
 * settle is running: stop the spring in `onPress`. Once a drag has begun, its touch moves
 * are the hook's (`preventDefault`), so the browser makes no scroll or fling of them and
 * the tap after a fast drag still clicks; that needs the returned `ref` on the element. A mouse whose release was never heard
 * (it happened outside the window) is released by its next move with no button down. The
 * handlers are the same on every render and call the options of the latest one.
 * @claim "It follows the first pointer only" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > starts once the pointer has moved 10px along the axis, and reports movement from the grab point)
 * @claim "It follows the first pointer only" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > gives the gesture up when the other axis wins the first 10px, so the page scrolls)
 * @claim "It follows the first pointer only" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > follows the first pointer only, and a mouse's primary button only)
 * @claim "Once a drag has begun, its" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > takes the touch moves of a drag, and of nothing else, so the browser makes no scroll or fling of them)
 * @claim "A mouse whose release was never" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > lets go of a mouse press whose release was never heard, at its next move with no button down)
 * @claim "The handlers are the same on" registry/ouro/lib/ouro/use-drag.test.tsx verify:testExists(registry/ouro/lib/ouro/use-drag.test.tsx::useDrag > uses the handlers of the latest render, and keeps the same props between renders)
 */
export function useDrag(options: DragOptions): DragProps {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const gesture = useRef<Gesture | undefined>(undefined);
  // A component unmounted mid-drag stops listening.
  useEffect(() => () => gesture.current?.release(true), []);

  // Chromium starts a fling when a fast touch drag ends, whatever `touch-action` says, and
  // the first touch during the fling "stops" it and gets no click. A drag whose last
  // touch move was taken starts none. The listener must not be passive, which React's are,
  // and must be on the element before the touch starts.
  const hold = useCallback((event: Event) => {
    if (gesture.current?.started() && event.cancelable) event.preventDefault();
  }, []);
  const ref = useCallback(
    (element: HTMLElement | null) => {
      // React gives the element and takes the cleanup; null comes only from a caller that merges refs the old way.
      if (!element) return undefined;
      element.addEventListener("touchmove", hold, { passive: false });
      return () => element.removeEventListener("touchmove", hold);
    },
    [hold],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    // Once a drag has begun, another press is ignored. A press that never became a drag
    // and whose release went unheard gives way to the next one.
    if (gesture.current?.started()) return;
    gesture.current?.release();
    const element = event.currentTarget;
    const pointer = event.pointerId;
    const horizontal = latest.current.axis === "x";
    const along = (at: PointerEvent) => (horizontal ? at.clientX : at.clientY);
    const across = (at: PointerEvent) => (horizontal ? at.clientY : at.clientX);
    const origin = along(event.nativeEvent);
    const crossOrigin = across(event.nativeEvent);
    let samples = [{ position: origin, time: event.timeStamp }];
    let started = false;
    // The element's handlers and the window's listeners can hear the same event: it counts once.
    let seen: Event = event.nativeEvent;

    const state = (at: PointerEvent): DragState => {
      // From the oldest move of the last 100ms up to this event itself: time the finger
      // spent still before lifting counts, so a pause slows the release.
      const first = samples.find((sample) => at.timeStamp - sample.time <= VELOCITY_WINDOW);
      const velocity = first && at.timeStamp > first.time ? (along(at) - first.position) / (at.timeStamp - first.time) : 0;
      return { delta: along(at) - origin, velocity, flick: Math.abs(velocity) >= FLICK_VELOCITY, event: at };
    };
    const release = (silent = false) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      gesture.current = undefined;
      if (!started && !silent) latest.current.onPressEnd?.();
    };
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointer || moved === seen) return;
      seen = moved;
      // A mouse moving with no button down was released where nothing heard it.
      if (!started && moved.pointerType === "mouse" && moved.buttons === 0) return release();
      const { threshold = 10, crossAxis = "scroll", onStart, onMove } = latest.current;
      // A browser can deliver several physical moves as one event; keep their history,
      // without turning them into additional drag callbacks.
      samples = [
        ...samples,
        ...(moved.getCoalescedEvents?.() ?? []).map((sample) => ({ position: along(sample), time: sample.timeStamp })),
        { position: along(moved), time: moved.timeStamp },
      ].filter((sample) => moved.timeStamp - sample.time <= VELOCITY_WINDOW);
      if (!started) {
        const distance = Math.abs(along(moved) - origin);
        const cross = crossAxis === "scroll" ? Math.abs(across(moved) - crossOrigin) : 0;
        if (distance < threshold && cross < threshold) return;
        // The other axis won: the gesture is the browser's, a scroll.
        if (cross >= distance) return release();
        if (onStart?.(state(moved)) === false) return release();
        started = true;
        try {
          element.setPointerCapture(pointer);
        } catch {
          // A pointer the browser no longer has cannot be captured; the window listeners still hear it.
        }
      }
      onMove(state(moved));
    };
    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== pointer || ended === seen) return;
      seen = ended;
      release();
      if (started) latest.current.onEnd({ ...state(ended), cancelled: ended.type === "pointercancel" });
    };
    latest.current.onPress?.(event.nativeEvent);
    // Until it is captured, a pointer that leaves the element is heard on the window.
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    gesture.current = { started: () => started, move, end, release };
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => gesture.current?.move(event.nativeEvent), []);
  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => gesture.current?.end(event.nativeEvent), []);
  return useMemo(
    () => ({ ref, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }),
    [ref, onPointerDown, onPointerMove, onPointerEnd],
  );
}
