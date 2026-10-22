import { expect, onTestFinished, type TestContext } from "vitest";

export { expectGestureSettle, expectMotion, expectNoMotion, expectTransition, parseDuration, takeMotionRecords };
export type { ExpectMotionOptions, ExpectNoMotionOptions, MotionRecord };

// The motion helpers a component test calls right after it changes a state. Each reads what runs
// on one part (the element's `data-ouro-part`), fails on anything but the expected set, waits for
// it to finish and records what it proved in the test's meta (`task.meta.motion`) when the test
// finishes. Ouro UI's own runs collect the records into the evidence `pnpm motion:coverage` holds
// each component.json `motion` map to; in an app they are only meta, which nothing reads.

/** What a motion helper proved. Ouro UI's evidence reporter adds the test's id (`<file>::<full test name>`). */
type MotionRecord =
  | { kind: "state"; stem: string; part: string; state: string; properties: string[]; reduced: boolean; dir: "ltr" | "rtl" }
  | { kind: "transition"; stem: string; from: string; to: string; interrupt: boolean }
  | { kind: "gesture"; stem: string; gesture: string };

/** The longhands a browser runs for a shorthand transition, read back as the shorthand. */
const shorthands: Record<string, string[]> = {
  "border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  "border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  "border-style": ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  inset: ["top", "right", "bottom", "left"],
};

/**
 * A duration in milliseconds, from `"240ms"`, `"0.24s"` or a custom property's computed value
 * (`getComputedStyle(document.documentElement).getPropertyValue("--ouro-duration-fast")`).
 * Throws on anything that is not one non-negative duration.
 */
function parseDuration(value: string): number {
  const match = /^\s*(\d*\.?\d+)(ms|s)\s*$/.exec(value);
  if (!match) throw new Error(`"${value}" is not a duration: use "240ms" or "0.24s".`);
  const amount = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  return Math.round(amount * 1000) / 1000;
}

/** The CSS transitions and animations still running on the element itself (not its children). */
function running(element: Element): Array<CSSTransition | CSSAnimation> {
  return element
    .getAnimations()
    .filter((animation): animation is CSSTransition | CSSAnimation => (animation instanceof CSSTransition || animation instanceof CSSAnimation) && animation.playState !== "finished" && animation.playState !== "idle");
}

const kebabCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The properties one animation runs, as the browser names them (longhands not folded). */
function namesOf(animation: CSSTransition | CSSAnimation): string[] {
  return animation instanceof CSSTransition
    ? [animation.transitionProperty]
    : (animation.effect as KeyframeEffect)
        .getKeyframes()
        .flatMap((keyframe) => Object.keys(keyframe))
        .filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key))
        .map(kebabCase);
}

/**
 * Each running property with its duration in milliseconds, shorthand longhands folded back into their shorthand.
 *
 * @claim "Each running property with its duration" test/motion.test.ts verify:testExists(test/motion.test.ts::expectMotion > reads the four sides of a shorthand as the shorthand)
 */
function runningProperties(animations: Array<CSSTransition | CSSAnimation>): Map<string, number> {
  const found = new Map<string, number>();
  for (const animation of animations) {
    const duration = Math.round(Number(animation.effect?.getComputedTiming().duration ?? 0));
    for (const name of namesOf(animation)) found.set(name, duration);
  }
  for (const [shorthand, longhands] of Object.entries(shorthands)) {
    const durations = longhands.map((longhand) => found.get(longhand));
    if (durations.every((duration) => duration !== undefined && duration === durations[0])) {
      for (const longhand of longhands) found.delete(longhand);
      found.set(shorthand, durations[0]!);
    }
  }
  return found;
}

const list = (names: Iterable<string>) => [...names].sort().join(", ") || "nothing";

/** The element's `data-ouro-part`, which names the part whose motion this is. */
function partOf(element: Element, where: string): string {
  const part = element.getAttribute("data-ouro-part");
  if (part === null) throw new Error(`${where}: the element has no data-ouro-part, so its motion has no part to belong to: ${element.outerHTML.slice(0, 120)}`);
  return part;
}

/** Fails unless the page's reduced-motion preference is the one the call names. */
function checkReduced(where: string, reduced: boolean): void {
  const prefers = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefers !== reduced) throw new Error(`${where}: reduced: ${reduced}, but the page ${prefers ? "prefers" : "does not prefer"} reduced motion.`);
}

/** The records of the running test, handed to its meta when it finishes. */
let pending: MotionRecord[] | undefined;

/** The running test's records, created on first use with a hook that moves them into its meta. */
function records(): MotionRecord[] {
  if (!pending) {
    const made: MotionRecord[] = [];
    pending = made;
    onTestFinished((context: TestContext) => {
      (context.task.meta as { motion?: MotionRecord[] }).motion = made;
      if (pending === made) pending = undefined;
    });
  }
  return pending;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** One CSS transition (by property) or CSS animation (by name) beginning or ending on an element. */
interface Ran {
  kind: "transition" | "animation";
  name: string;
  event: "run" | "end" | "cancel";
}

const ranEvents = {
  transitionrun: "run",
  transitionend: "end",
  transitioncancel: "cancel",
  animationstart: "run",
  animationend: "end",
  animationcancel: "cancel",
} as const;

/**
 * Logs, in order, the CSS transitions and animations the browser reports beginning and ending
 * on the element itself (not its children or pseudo-elements) until `stop()`.
 */
function watchRan(element: Element): { log: Ran[]; stop: () => void } {
  const log: Ran[] = [];
  const record = (event: Event) => {
    if (event.target !== element || !event.isTrusted) return;
    const { pseudoElement } = event as TransitionEvent | AnimationEvent;
    if (pseudoElement) return;
    const type = event.type as keyof typeof ranEvents;
    log.push(
      event instanceof TransitionEvent
        ? { kind: "transition", name: event.propertyName, event: ranEvents[type] }
        : { kind: "animation", name: (event as AnimationEvent).animationName, event: ranEvents[type] },
    );
  };
  for (const type of Object.keys(ranEvents)) element.addEventListener(type, record);
  return { log, stop: () => Object.keys(ranEvents).forEach((type) => element.removeEventListener(type, record)) };
}

/**
 * Whether the log, from `from` on, holds a transition of the property (or a CSS animation of the
 * name) that began and then ended without being cancelled. An element runs one transition of a
 * property at a time, and the cancelled one never ends, so such a transition began after it.
 * @claim "An element runs one transition of" test/motion.test.ts verify:testExists(test/motion.test.ts::expectMotion > fails when a transition is cancelled early with nothing in its place)
 * @claim "An element runs one transition of" test/motion.test.ts verify:testExists(test/motion.test.ts::expectMotion > waits for a transition the browser restarts mid-way, and fails on another property that starts meanwhile)
 */
function endedInPlace(log: readonly Ran[], from: number, kind: Ran["kind"], name: string): boolean {
  let open = false;
  for (const entry of log.slice(from)) {
    if (entry.kind !== kind || entry.name !== name) continue;
    if (entry.event === "end" && open) return true;
    open = entry.event === "run";
  }
  return false;
}

/**
 * Waits, a frame at a time, for the part's motion to end. A browser cancels a running transition
 * when the element's style is recomputed mid-way and usually starts an equal one in its place:
 * a cancelled property counts only when an animation of it is running on the next read, when one
 * of it (a CSS animation: of its name) began and ended, uncancelled, since the last read (on a
 * slow frame the replacement can run its whole course between two reads), or when the cancelled
 * one had already run 90% of its duration in time (WebKit cancels a transition that is about
 * to end on a restyle under load). A property cancelled earlier with nothing in its place fails,
 * and so does any other property that starts meanwhile.
 * @claim "A browser cancels a running transition" registry/ouro/lib/ouro/testing/motion.ts verify:fileLine(registry/ouro/lib/ouro/testing/motion.ts, /progress\s<\s0\.9/)
 * @claim "A browser cancels a running transition" https://www.w3.org/TR/css-transitions-1/#starting verify:urlOk(https://www.w3.org/TR/css-transitions-1/#starting)
 */
async function settled(element: Element, where: string, first: Array<CSSTransition | CSSAnimation>, expected: Set<string>): Promise<void> {
  const reached = new Map<Animation, number>();
  // Elapsed time, not progress: progress is eased, and --ouro-ease-out passes 90% early.
  const sample = (animations: Array<CSSTransition | CSSAnimation>) => {
    for (const animation of animations) {
      const timing = animation.effect?.getComputedTiming();
      const local = Number(timing?.localTime ?? Number.NaN) - Number(timing?.delay ?? 0);
      const active = Number(timing?.activeDuration ?? Number.NaN);
      if (Number.isFinite(local) && Number.isFinite(active) && active > 0) reached.set(animation, Math.max(reached.get(animation) ?? 0, Math.min(1, Math.max(0, local / active))));
    }
  };
  for (const animation of first) animation.finished.catch(() => {});
  sample(first);
  const ran = watchRan(element);
  try {
    let current = first;
    let restarts = 0;
    // Where the log stood at the last read, when every animation in `current` still ran.
    let mark = 0;
    while (current.length > 0) {
      await nextFrame();
      const next = running(element);
      sample(next);
      const extra = [...runningProperties(next).keys()].filter((name) => !expected.has(name));
      if (extra.length > 0) throw new Error(`${where}: ${list(extra)} started while the expected motion ran.`);
      const replacing = new Set(next.flatMap(namesOf));
      for (const animation of current) {
        if (next.includes(animation) || animation.playState !== "idle") continue;
        const progress = reached.get(animation) ?? 0;
        const replaced = (name: string) =>
          animation instanceof CSSTransition ? endedInPlace(ran.log, mark, "transition", name) : endedInPlace(ran.log, mark, "animation", animation.animationName);
        for (const name of namesOf(animation)) {
          if (!replacing.has(name) && progress < 0.9 && !replaced(name)) throw new Error(`${where}: ${name} was cancelled ${Math.round(progress * 100)}% of the way through its duration with nothing in its place.`);
        }
      }
      const fresh = next.filter((animation) => !current.includes(animation));
      for (const animation of fresh) animation.finished.catch(() => {});
      if (fresh.length > 0 && ++restarts > 20) throw new Error(`${where}: the motion kept restarting.`);
      current = next;
      mark = ran.log.length;
    }
    // WebKit lists a finished transition until its next animation update, the update that also
    // gives the element its end style. For a composited property (opacity, scale) a timer sets
    // that update, and under load it trails the frame the transition finished in, so until then
    // the computed style can hold an earlier update's value. Waiting for it means the caller
    // reads the end state.
    while (element.getAnimations().some((animation) => animation instanceof CSSTransition && animation.playState === "finished")) await nextFrame();
  } finally {
    ran.stop();
  }
}

/**
 * Fails unless the part, or an element around it inside the part's own component root
 * (`[data-ouro]`), carries the state's attribute (and value), so a checked row or an open overlay
 * around the component cannot stand in for the component's own state.
 */
function checkState(element: Element, where: string, state: string): void {
  const [attribute, value] = state.split("=");
  const selector = value === undefined ? `[${attribute}]` : `[${attribute}="${value}"]`;
  const root = element.closest("[data-ouro]");
  if (!root) throw new Error(`${where}: the part is in no component root ([data-ouro]), so its state has no component to belong to.`);
  const match = element.closest(selector);
  if (!match || !root.contains(match)) {
    throw new Error(`${where}: the part is not in ${state}: neither it nor an element around it inside its [data-ouro="${root.getAttribute("data-ouro")}"] root has ${selector}. Call the helper after the change into that state.`);
  }
}

const directionOf = (element: Element, dir: "ltr" | "rtl" | undefined): "ltr" | "rtl" => dir ?? (getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr");

interface ExpectMotionOptions {
  /** The component stem whose component.json declares the motion: `checkbox`. */
  stem: string;
  /** The state attribute whose change this is: `data-checked`. */
  state: string;
  /**
   * Exactly the CSS properties that must be running on the part: a list, or each with its
   * duration in milliseconds (`{ opacity: parseDuration(token) }`).
   * @claim "Exactly the CSS properties that must" test/motion.test.ts verify:testExists(test/motion.test.ts::expectMotion > passes when exactly the declared properties run, waits for them and records them on the part)
   * @claim "Exactly the CSS properties that must" test/motion.test.ts verify:testExists(test/motion.test.ts::expectMotion > checks each property's duration in milliseconds when given them, and records the direction)
   */
  properties: readonly string[] | Readonly<Record<string, number>>;
  /** Whether the page prefers reduced motion; the call fails when it does not match. */
  reduced: boolean;
  /** The direction the part runs in; read from the element when left out. */
  dir?: "ltr" | "rtl";
}

/**
 * Proves a state change's motion on one part. Call it right after the change into `state`, with
 * no await in between (several parts at once with `Promise.all`): it fails unless the part or an
 * element around it inside its own component root (`[data-ouro]`) carries the state's attribute, reads the CSS transitions and animations
 * running on the element (its `data-ouro-part`), fails unless they are exactly `properties` (no
 * missing and no extra property, and the given durations in milliseconds), waits for them to
 * end (a transition the browser cancels and restarts on a restyle included, even when the
 * restarted one runs its whole course between two frames), and records `{ stem, part, state, properties, reduced, dir }` for pnpm motion:coverage.
 *
 * @example
 * await act(() => box.click());
 * await Promise.all([
 *   expectMotion(tick, { stem: "checkbox", state: "data-checked", properties: ["stroke-dashoffset"], reduced: false }),
 *   expectMotion(box, { stem: "checkbox", state: "data-checked", properties: ["background-color", "border-color"], reduced: false }),
 * ]);
 */
async function expectMotion(element: Element, options: ExpectMotionOptions): Promise<void> {
  const animations = running(element);
  const { stem, state, reduced } = options;
  const part = partOf(element, `${stem} ${state}`);
  const where = `${stem} ${state} ${part}`;
  checkState(element, where, state);
  checkReduced(where, reduced);
  const expected: Record<string, number | undefined> = Array.isArray(options.properties)
    ? Object.fromEntries((options.properties as readonly string[]).map((name) => [name, undefined]))
    : { ...(options.properties as Readonly<Record<string, number>>) };
  const actual = runningProperties(animations);
  if (actual.size === 0) throw new Error(`${where}: nothing is running; expected ${list(Object.keys(expected))}. Call expectMotion right after the change, before any await.`);
  const missing = Object.keys(expected).filter((name) => !actual.has(name));
  const extra = [...actual.keys()].filter((name) => !(name in expected));
  if (missing.length > 0 || extra.length > 0) {
    const detail = [missing.length > 0 && `missing ${list(missing)}`, extra.length > 0 && `extra ${list(extra)}`].filter(Boolean).join(", ");
    throw new Error(`${where}: expected ${list(Object.keys(expected))} but ${list(actual.keys())} ${actual.size === 1 ? "is" : "are"} running (${detail}).`);
  }
  for (const [name, duration] of Object.entries(expected)) {
    if (duration !== undefined && Math.round(duration) !== actual.get(name)) throw new Error(`${where}: ${name} runs for ${actual.get(name)}ms, not ${Math.round(duration)}ms.`);
  }
  const dir = directionOf(element, options.dir);
  await settled(element, where, animations, new Set(Object.keys(expected)));
  records().push({ kind: "state", stem, part, state, properties: [...actual.keys()].sort(), reduced, dir });
}

interface ExpectNoMotionOptions {
  stem: string;
  state: string;
  reduced: boolean;
  dir?: "ltr" | "rtl";
}

/**
 * Proves that a state change runs nothing on one part, which must be in `state` (it or an element
 * around it inside its component root carries the attribute): no CSS transition or animation right after
 * the change, nor a style flush and a frame later. Records an explicit empty set, which is how a
 * `none` state, and a part whose `reduced` list is `[]`, are covered.
 *
 * @example
 * await expectNoMotion(box, { stem: "checkbox", state: "data-disabled", reduced: false });
 * @claim "Proves that a state change runs" test/motion.test.ts verify:testExists(test/motion.test.ts::expectNoMotion > records an explicit empty set when nothing runs a frame after the change)
 * @claim "Proves that a state change runs" test/motion.test.ts verify:testExists(test/motion.test.ts::expectNoMotion > fails when anything runs on the part)
 */
async function expectNoMotion(element: Element, options: ExpectNoMotionOptions): Promise<void> {
  const now = running(element);
  const { stem, state, reduced } = options;
  const part = partOf(element, `${stem} ${state}`);
  const where = `${stem} ${state} ${part}`;
  checkState(element, where, state);
  checkReduced(where, reduced);
  getComputedStyle(element).getPropertyValue("opacity");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const found = runningProperties([...now, ...running(element)]);
  if (found.size > 0) throw new Error(`${where}: expected no motion, but ${list(found.keys())} ${found.size === 1 ? "is" : "are"} running.`);
  records().push({ kind: "state", stem, part, state, properties: [], reduced, dir: directionOf(element, options.dir) });
}

/**
 * Proves a released gesture settles: a spring (`data-ouro-settling` on the element) or a CSS
 * settle runs now, and ends. Records `{ stem, gesture }`.
 *
 * @example
 * await expectGestureSettle(row, { stem: "swipe-actions", gesture: "swipe" });
 */
async function expectGestureSettle(element: Element, options: { stem: string; gesture: string }): Promise<void> {
  const animations = running(element);
  const settling = element.hasAttribute("data-ouro-settling");
  if (!settling && animations.length === 0) throw new Error(`${options.stem} gesture ${options.gesture}: no settle is running (no data-ouro-settling and no CSS transition on the element).`);
  await Promise.all(animations.map((animation) => animation.finished));
  await expect.poll(() => element.hasAttribute("data-ouro-settling")).toBe(false);
  records().push({ kind: "gesture", stem: options.stem, gesture: options.gesture });
}

/**
 * Records that the test drove a change from one state to another (`interrupt`: while the first
 * was still animating) and checked where it ended.
 *
 * @example
 * expectTransition({ stem: "checkbox", from: "data-checked", to: "data-unchecked", interrupt: true });
 */
function expectTransition(options: { stem: string; from: string; to: string; interrupt: boolean }): void {
  records().push({ kind: "transition", ...options });
}

/**
 * Takes back the records the running test made so far, so a test of these helpers leaves no
 * evidence behind.
 *
 * @example
 * expect(takeMotionRecords()).toEqual([{ kind: "transition", stem: "checkbox", from: "data-checked", to: "data-unchecked", interrupt: true }]);
 * @claim "Takes back the records the running" test/motion.test.ts verify:testExists(test/motion.test.ts::motion records > move into the test's meta when it finishes)
 */
function takeMotionRecords(): MotionRecord[] {
  return pending ? pending.splice(0) : [];
}
