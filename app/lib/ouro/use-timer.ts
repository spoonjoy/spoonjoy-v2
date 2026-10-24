"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";

/**
 * Where a timer is: not started, counting down, stopped part way, or at zero.
 *
 * @claim "Where a timer is: not started" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > waits at the full duration until it starts, then counts down by the clock)
 * @claim "Where a timer is: not started" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > stops where it is when paused and carries on when resumed)
 */
export type TimerStatus = "idle" | "running" | "paused" | "done";

/**
 * What a timer's `onDone` hears when it reaches zero.
 *
 * @claim "What a timer's `onDone` hears when" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > finishes at zero and calls onDone once, then resets to idle)
 */
export interface TimerDoneEvent {
  /**
   * When it reached zero, in milliseconds since the epoch: in the past when the page was closed at the time.
   *
   * @claim "When it reached zero, in milliseconds" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > carries a stored timer on after a reload, and finishes one that ended while the page was closed)
   */
  endedAt: number;
  /**
   * Whether this `useTimer` is the one on the page that should sound the alert: the first with
   * the timer's `timerId` to hear it, not counting `fallback` ones unless only those are mounted. When
   * a `Timer` and a `TimerTray` both show one timer, the `Timer` alerts, whichever mounted first.
   * A hook without `onDone` reads the timer without taking the alert.
   * @claim "A hook without `onDone` reads" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > does not let a passive reader claim a fallback's completion event (fallback=%s))
   */
  first: boolean;
}

/** Options for {@link useTimer}. */
export interface TimerOptions {
  /** How long the timer runs, in seconds. */
  duration: number;
  /**
   * Keeps the timer in `localStorage` under this name, so it carries on through a reload and
   * a closed tab, and shares it with every `useTimer`, `Timer` and `TimerTray` given the same
   * `timerId`, in this tab and in others. Without it the timer lives as long as the component.
   * @claim "Keeps the timer in `localStorage` under" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > carries a stored timer on after a reload, and finishes one that ended while the page was closed)
   * @claim "Keeps the timer in `localStorage` under" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > keeps a timer with a timerId in localStorage and shares it with every hook that has the timerId)
   * @claim "Keeps the timer in `localStorage` under" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > follows a timer another tab changes, without its alert)
   */
  timerId?: string | undefined;
  /** Not an option. A timer is kept and shared by `timerId`: `useTimer({ duration: 600, timerId: "pasta" })`. */
  id?: { 'Use timerId: "pasta"': never };
  /**
   * Called once when the timer reaches zero, including when it ended while the page was closed.
   *
   * @claim "Called once when the timer reaches" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > carries a stored timer on after a reload, and finishes one that ended while the page was closed)
   * @claim "Called once when the timer reaches" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > finishes at zero and calls onDone once, then resets to idle)
   */
  onDone?: ((event: TimerDoneEvent) => void) | undefined;
  /**
   * For a view that watches a timer shown elsewhere, as `TimerTray` does: its `onDone` hears
   * `first: true` only while no `useTimer` without `fallback` shares the timer.
   * @claim "For a view that watches a" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > gives first to a hook without fallback, whichever mounted first, and to the first fallback when only fallbacks watch)
   */
  fallback?: boolean | undefined;
}

/** What {@link useTimer} returns. */
export interface TimerControls {
  status: TimerStatus;
  /**
   * Whole seconds left, rounded up: the full duration before it starts, 0 once it is done.
   *
   * @claim "Whole seconds left, rounded up: the" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > waits at the full duration until it starts, then counts down by the clock)
   * @claim "Whole seconds left, rounded up: the" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > starts again from the full duration from any status)
   */
  remaining: number;
  /** The timer's length in seconds, as it was started. */
  duration: number;
  /**
   * When it reached zero, or `null` until it does.
   *
   * @claim "When it reached zero, or `null`" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > waits at the full duration until it starts, then counts down by the clock)
   */
  endedAt: number | null;
  /** Starts from the full duration, from any status. */
  start: () => void;
  /** Stops a running timer where it is. */
  pause: () => void;
  /** Carries a paused timer on from where it stopped. */
  resume: () => void;
  /** Cancels or dismisses the timer: back to `idle` at the full duration, and forgotten. */
  reset: () => void;
}

/** A countdown's saved state, for importing progress from another timer implementation. */
export type TimerState =
  | { status: "running"; duration: number; endsAt: number }
  | { status: "paused"; duration: number; remainingMs: number }
  | { status: "done"; duration: number; endedAt: number };

interface DoneListener {
  hear: (event: Omit<TimerDoneEvent, "first">, first: boolean) => void;
  hasCallback: () => boolean;
  fallback: () => boolean;
}

interface Entry {
  stored: TimerState | null;
  loaded: boolean;
  persist: boolean;
  listeners: Set<() => void>;
  done: Set<DoneListener>;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

const PREFIX = "ouro-timer:";
const TICK_MS = 250;
const entries = new Map<string, Entry>();
let listening = false;

// The clock running timers read, moved on four times a second while any is on screen. A value
// that changes only on a tick, so a render reads the same time throughout.
let clock = 0;
const clockListeners = new Set<() => void>();
let clockInterval: ReturnType<typeof setInterval> | undefined;

function subscribeClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  clock = Date.now();
  clockInterval ??= setInterval(() => {
    clock = Date.now();
    for (const listener of [...clockListeners]) listener();
  }, TICK_MS);
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size > 0) return;
    clearInterval(clockInterval);
    clockInterval = undefined;
  };
}

const still = (): (() => void) => () => {};
const readClock = (): number => clock;

function entryFor(key: string, persist: boolean): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { stored: null, loaded: false, persist, listeners: new Set(), done: new Set(), timeout: undefined };
    entries.set(key, entry);
  }
  return entry;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A stored timer, or null for anything malformed: storage is the page's, and anyone may write it. */
function parse(raw: string | null): TimerState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseState(value);
}

function parseState(value: unknown): TimerState | null {
  if (!value || typeof value !== "object") return null;
  const timer = value as Record<string, unknown>;
  if (!finite(timer["duration"]) || timer["duration"] <= 0) return null;
  const duration = timer["duration"];
  if (timer["status"] === "running" && finite(timer["endsAt"])) return { status: "running", duration, endsAt: timer["endsAt"] };
  if (timer["status"] === "paused" && finite(timer["remainingMs"]) && timer["remainingMs"] >= 0) return { status: "paused", duration, remainingMs: timer["remainingMs"] };
  if (timer["status"] === "done" && finite(timer["endedAt"])) return { status: "done", duration, endedAt: timer["endedAt"] };
  return null;
}

function read(key: string): TimerState | null {
  try {
    return parse(localStorage.getItem(PREFIX + key));
  } catch {
    return null;
  }
}

function write(key: string, entry: Pick<Entry, "persist" | "stored">): boolean {
  if (!entry.persist) return true;
  try {
    if (entry.stored) localStorage.setItem(PREFIX + key, JSON.stringify(entry.stored));
    else localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    // Storage may be full or blocked; the timer still runs in this page.
    return false;
  }
}

function notify(entry: Entry): void {
  clock = Date.now();
  for (const listener of [...entry.listeners]) listener();
}

/** Turns a running timer whose end has passed into a finished one and tells its listeners, once. */
function settle(key: string, entry: Entry, alert: boolean): void {
  clearTimeout(entry.timeout);
  entry.timeout = undefined;
  const stored = entry.stored;
  if (stored?.status !== "running") return;
  const wait = stored.endsAt - Date.now();
  if (wait > 0) {
    entry.timeout = setTimeout(() => settle(key, entry, true), wait);
    return;
  }
  entry.stored = { status: "done", duration: stored.duration, endedAt: stored.endsAt };
  write(key, entry);
  notify(entry);
  if (!alert) return;
  const listeners = [...entry.done].filter((listener) => listener.hasCallback());
  // The alert is the first listener's that is not a fallback, else the first fallback's.
  const alerter = listeners.find((listener) => !listener.fallback()) ?? listeners[0];
  for (const listener of listeners) listener.hear({ endedAt: stored.endsAt }, listener === alerter);
}

function update(key: string, entry: Entry, stored: TimerState | null): boolean {
  entry.stored = stored;
  const persisted = write(key, entry);
  settle(key, entry, true);
  notify(entry);
  return persisted;
}

/**
 * Imports a saved countdown, leaving an existing native timer intact.
 * A false return means storage is unavailable: keep the original saved data. When a write fails,
 * mounted readers still receive the import in memory. An unreadable store is left untouched.
 * Invalid state throws before changing the timer.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/use-timer
 * @example
 * restoreTimer("pasta", { status: "paused", duration: 600, remainingMs: 120000 });
 * @claim "Imports a saved countdown" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > restores a %s snapshot without changing its original time)
 * @claim "Imports a saved countdown" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > preserves an existing stored timer instead of replacing it with an import)
 * @claim "A false return means storage is unavailable" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > reports a failed import write while a mounted timer still works in memory)
 * @claim "An unreadable store is left untouched" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > does not overwrite storage when an import cannot check for an existing timer)
 * @claim "Invalid state throws before changing" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > rejects an invalid snapshot before changing an existing timer)
 */
export function restoreTimer(timerId: string, state: TimerState): boolean {
  const imported = parseState(state);
  if (!imported) throw new TypeError("[ouro-ui] useTimer: invalid timer state. Fix: pass a running, paused or done state with a positive duration and finite times.");
  try {
    if (parse(localStorage.getItem(PREFIX + timerId))) return true;
  } catch {
    return false;
  }
  const entry = entries.get(timerId);
  if (!entry) return write(timerId, { persist: true, stored: imported });
  entry.loaded = true;
  return update(timerId, entry, entry.stored ?? imported);
}

/**
 * Cancels or dismisses a timer by its timerId, including when its screen is not mounted.
 * Mounted readers return to idle. A false return means storage could not forget the timer;
 * mounted state still resets.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/use-timer
 * @example
 * resetTimer("pasta");
 * @claim "Cancels or dismisses a timer" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > resets a stored timer with no mounted reader)
 * @claim "Mounted readers return to idle" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > resets every mounted reader and its pending completion by timer id)
 * @claim "A false return means storage could" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::timer state transfer > reports a blocked reset write while resetting mounted state)
 */
export function resetTimer(timerId: string): boolean {
  const entry = entries.get(timerId);
  return entry ? update(timerId, entry, null) : write(timerId, { persist: true, stored: null });
}

/** Follows the timers other tabs change. */
function onStorage(event: StorageEvent): void {
  if (!event.key?.startsWith(PREFIX)) return;
  const key = event.key.slice(PREFIX.length);
  const entry = entries.get(key);
  if (!entry?.loaded) return;
  entry.stored = parse(event.newValue);
  // The tab that changed it settles and alerts it; this one only follows.
  settle(key, entry, false);
  notify(entry);
}

function remainingOf(stored: TimerState | null, duration: number, now: number): number {
  if (!stored) return duration;
  if (stored.status === "running") return Math.min(stored.duration, Math.max(0, Math.ceil((stored.endsAt - now) / 1000)));
  if (stored.status === "paused") return Math.ceil(stored.remainingMs / 1000);
  return 0;
}

/**
 * A countdown timer that keeps time by the clock, not by ticks, so it stays right in a
 * background tab, across a reload (with `timerId`) and when the screen sleeps. It re-renders four
 * times a second while it runs, and calls `onDone` once at zero. Every `useTimer`, `Timer`
 * and `TimerTray` with the same `timerId` shares one timer, in this tab and in others.
 *
 * Use `Timer` instead for the whole control (the time, Start, Pause and the alert), and
 * this hook for a timer of your own design.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * const timer = useTimer({ duration: 600, timerId: "pasta", onDone: () => chime() });
 * <Button onClick={timer.start}>Start</Button>
 * <p>{formatDuration(timer.remaining)}</p>
 * @claim "Every `useTimer`, `Timer` and `TimerTray` with" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > keeps a timer with a timerId in localStorage and shares it with every hook that has the timerId)
 * @claim "Every `useTimer`, `Timer` and `TimerTray` with" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > follows a timer another tab changes, without its alert)
 * @claim "It re-renders four times a second" registry/ouro/lib/ouro/use-timer.test.tsx verify:testExists(registry/ouro/lib/ouro/use-timer.test.tsx::useTimer > finishes at zero and calls onDone once, then resets to idle)
 * @claim "It re-renders four times a second" registry/ouro/lib/ouro/use-timer.ts verify:fileLine(registry/ouro/lib/ouro/use-timer.ts, /const\sTICK_MS\s=\s250;/)
 */
export function useTimer({ duration, timerId, onDone, fallback }: TimerOptions): TimerControls {
  const anonymous = useId();
  const key = timerId ?? `local:${anonymous}`;
  const onDoneRef = useRef(onDone);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    onDoneRef.current = onDone;
    fallbackRef.current = fallback;
  });

  const subscribe = useCallback(
    (onChange: () => void) => {
      const entry = entryFor(key, timerId !== undefined);
      if (!entry.loaded) {
        entry.loaded = true;
        if (entry.persist) entry.stored = read(key);
      }
      if (entry.persist && !listening) {
        listening = true;
        window.addEventListener("storage", onStorage);
      }
      const done: DoneListener = {
        hear: (event, first) => onDoneRef.current?.({ ...event, first }),
        hasCallback: () => onDoneRef.current !== undefined,
        fallback: () => fallbackRef.current === true,
      };
      entry.listeners.add(onChange);
      entry.done.add(done);
      // Settled after this commit, once every component that shows the timer has subscribed, so a
      // timer that ended while the page was closed alerts through the right one (a Timer over a tray).
      queueMicrotask(() => {
        if (entry.listeners.size > 0) settle(key, entry, true);
      });
      onChange();
      return () => {
        entry.listeners.delete(onChange);
        entry.done.delete(done);
        queueMicrotask(() => {
          if (entry.listeners.size === 0 && entries.get(key) === entry) {
            clearTimeout(entry.timeout);
            entry.timeout = undefined;
            // A later mount reads storage again; a same-commit replacement keeps this entry.
            entries.delete(key);
          }
        });
      };
    },
    [key, timerId],
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => entries.get(key)?.stored ?? null,
    () => null,
  );

  const status: TimerStatus = stored?.status ?? "idle";
  const now = useSyncExternalStore(status === "running" ? subscribeClock : still, readClock, readClock);

  const change = useCallback(
    (next: (current: TimerState | null, now: number) => TimerState | null) => {
      const entry = entryFor(key, timerId !== undefined);
      update(key, entry, next(entry.stored, Date.now()));
    },
    [key, timerId],
  );
  const start = useCallback(() => change((_current, now) => ({ status: "running", duration, endsAt: now + duration * 1000 })), [change, duration]);
  const pause = useCallback(
    () => change((current, now) => (current?.status === "running" ? { status: "paused", duration: current.duration, remainingMs: Math.max(0, current.endsAt - now) } : current)),
    [change],
  );
  const resume = useCallback(
    () => change((current, now) => (current?.status === "paused" ? { status: "running", duration: current.duration, endsAt: now + current.remainingMs } : current)),
    [change],
  );
  const reset = useCallback(() => change(() => null), [change]);

  return {
    status,
    remaining: remainingOf(stored, duration, now),
    duration: stored?.duration ?? duration,
    endedAt: stored?.status === "done" ? stored.endedAt : null,
    start,
    pause,
    resume,
    reset,
  };
}

/**
 * Seconds as a clock reads them: `9:05`, or `1:02:03` from an hour up.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * formatDuration(545); // "9:05"
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
