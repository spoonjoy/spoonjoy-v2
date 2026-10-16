export { nearest, project, rubberband, spring, springAt };
export type { SpringHandle, SpringOptions, SpringState };

// A spring and the gesture math that goes with it, for anything a finger moves. No
// animation library: the spring is a formula, solved exactly for each frame, so it does
// not depend on the frame rate. Positions are in px, velocities in px per millisecond
// (what `useDrag` reports), `response` in seconds.
//
// A gesture uses the pieces in this order:
//   1. while the finger moves, `rubberband` for how far the element follows past an end;
//   2. on release, `project` and `nearest` to choose among several places to rest, or the
//      sign of the release velocity to choose between two;
//   3. `spring` from the element's live position to that place, with that velocity.
//      A new drag calls `stop()` and carries on from the value it returns.

/** What `spring` takes. */
interface SpringOptions {
  /** The live value to start from: read it from the element, never from the logical target. */
  from: number;
  /** The value to settle on. */
  to: number;
  /**
   * Release velocity in px/ms, as `useDrag` reports it, so the motion continues without a seam.
   * @default 0
   */
  velocity?: number | undefined;
  /**
   * 1 is critically damped (no overshoot). Pass 0.8 only after a flick. More than 1 is treated as 1.
   * @default 1
   */
  damping?: number | undefined;
  /**
   * Seconds to approach the target (Apple's "response"). Not a duration: a spring has none.
   * @default 0.3
   */
  response?: number | undefined;
  /** Called every frame with the value and its velocity in px/ms, and last with exactly `to` and 0. Write `transform` here. */
  onUpdate: (value: number, velocity: number) => void;
  /** Called when the spring comes to rest on its target. Not called after `stop()`. */
  onRest?: (() => void) | undefined;
  /**
   * The element being moved. It carries `data-ouro-settling` while the spring runs, from the
   * call to the rest or the stop, so styles can follow it and tests can wait for rest. With
   * reduced motion the spring never runs, and the attribute is never set.
   */
  element?: Element | null | undefined;
}

/** Where a spring is and how fast it is moving, in px and px/ms. */
interface SpringState {
  value: number;
  velocity: number;
}

/** A spring started by `spring`. */
interface SpringHandle {
  /** Stops at once and returns the value last written and its velocity: what is on screen, for a new drag or a new spring to start from. */
  stop(): SpringState;
  /** Moves the target and keeps the current value and velocity. */
  retarget(to: number): void;
  /** Whether it is still moving. Pass `element` and it carries `data-ouro-settling` for as long. */
  readonly running: boolean;
}

// A spring this close to its target, in px, and this slow, in px/ms, is at rest.
const REST_DISTANCE = 0.5;
const REST_VELOCITY = 0.01;
// A spring with no damping never rests, and one with no response time divides by zero.
const MIN_DAMPING = 0.1;
const MIN_RESPONSE = 0.01;

/**
 * Where a spring that left `from` toward `to` at `velocity` (px/ms) is after `elapsed`
 * milliseconds. It is the exact solution, so any moment can be asked for in any order.
 * `damping` is kept between 0.1 and 1, and `response` at 0.01s or more.
 */
function springAt(
  from: number,
  to: number,
  velocity: number,
  elapsed: number,
  options: Pick<SpringOptions, "damping" | "response"> = {},
): SpringState {
  const damping = Math.max(options.damping ?? 1, MIN_DAMPING);
  const response = Math.max(options.response ?? 0.3, MIN_RESPONSE);
  const seconds = elapsed / 1000;
  const speed = velocity * 1000;
  const omega = (2 * Math.PI) / response;
  const offset = from - to;
  if (damping >= 1) {
    const rate = speed + omega * offset;
    const decay = Math.exp(-omega * seconds);
    return { value: to + (offset + rate * seconds) * decay, velocity: ((rate - omega * (offset + rate * seconds)) * decay) / 1000 };
  }
  const damped = omega * Math.sqrt(1 - damping * damping);
  const sine = (speed + damping * omega * offset) / damped;
  const decay = Math.exp(-damping * omega * seconds);
  const cos = Math.cos(damped * seconds);
  const sin = Math.sin(damped * seconds);
  return {
    value: to + decay * (offset * cos + sine * sin),
    velocity: (decay * ((sine * damped - damping * omega * offset) * cos - (offset * damped + damping * omega * sine) * sin)) / 1000,
  };
}

/**
 * Runs a spring on `requestAnimationFrame`, from the live value to the target, starting
 * with the velocity it is handed. With `prefers-reduced-motion: reduce` it jumps to `to`
 * and rests before it returns, so `onRest` can run before the caller has the handle.
 *
 * A critically damped spring handed a velocity toward its target passes the target once,
 * by less than a pixel below the flick speed.
 */
function spring({ from, to, velocity = 0, damping, response, onUpdate, onRest, element }: SpringOptions): SpringHandle {
  let start = performance.now();
  let frame = 0;
  let running = false;
  // The value last written and its velocity: what is on screen.
  let last: SpringState = { value: from, velocity };
  const mark = (on: boolean) => element?.toggleAttribute("data-ouro-settling", on);
  const rest = () => {
    running = false;
    last = { value: to, velocity: 0 };
    mark(false);
    onUpdate(to, 0);
    onRest?.();
  };
  const tick = (now: number) => {
    // A frame that outlived `stop()` does nothing.
    if (!running) return;
    // A frame's time can be a little before the call that asked for it.
    last = springAt(from, to, velocity, Math.max(now - start, 0), { damping, response });
    if (Math.abs(last.value - to) < REST_DISTANCE && Math.abs(last.velocity) < REST_VELOCITY) return rest();
    onUpdate(last.value, last.velocity);
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return rest();
    running = true;
    mark(true);
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (running) {
      running = false;
      mark(false);
      cancelAnimationFrame(frame);
    }
    return last;
  };
  run();
  return {
    stop,
    retarget(next) {
      ({ value: from, velocity } = stop());
      to = next;
      start = performance.now();
      run();
    },
    get running() {
      return running;
    },
  };
}

/**
 * Where a flick released at `position` with `velocity` (px/ms) would come to rest, as
 * scrolling does: `position + velocity * d / (1 - d)`. Snap to the place `nearest` it.
 */
function project(position: number, velocity: number, deceleration = 0.998): number {
  return position + (velocity * deceleration) / (1 - deceleration);
}

/**
 * Resistance past a boundary: how far an element follows a finger that has dragged it
 * `over` px beyond an end, less and less the further it goes, never a hard stop.
 * `(over * dimension * c) / (dimension + c * |over|)`, where `dimension` is the size of
 * what is dragged along that axis. The sign of `over` is kept.
 */
function rubberband(over: number, dimension: number, constant = 0.55): number {
  return (over * dimension * constant) / (dimension + constant * Math.abs(over));
}

/** The snap point nearest `value`; the first of two equally near. `value` itself when there are no points. */
function nearest(points: readonly number[], value: number): number {
  return points.reduce((best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best), points[0] ?? value);
}
