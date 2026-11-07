import { announce } from "~/lib/ouro/announce";
import { buzz, chime, createChimeContext } from "~/lib/ouro/feedback";
import type { TimerDoneEvent } from "~/lib/ouro/use-timer";

/** The words a timer shows and says, for apps in other languages. */
export interface TimerLabels {
  /** @default "Start" */
  start?: string | undefined;
  /** @default "Pause" */
  pause?: string | undefined;
  /** @default "Resume" */
  resume?: string | undefined;
  /** @default "Cancel" */
  cancel?: string | undefined;
  /** @default "Dismiss" */
  dismiss?: string | undefined;
  /** @default "Restart" */
  restart?: string | undefined;
  /**
   * What it shows, and screen readers hear, at zero. @default "Time's up"
   *
   * @claim "What it shows, and screen readers" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > says, chimes and buzzes once at zero, shows Time's up, then dismisses or restarts)
   */
  done?: string | undefined;
  /** What it shows after the time while paused. @default "Paused" */
  paused?: string | undefined;
  /** TimerTray's link to the timer's page. @default "Go to" */
  goTo?: string | undefined;
}

export const timerWords = {
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
  dismiss: "Dismiss",
  restart: "Restart",
  done: "Time's up",
  paused: "Paused",
  goTo: "Go to",
} as const satisfies Required<TimerLabels>;

/** The words to use: the app's where it gave them, else the defaults. */
export function wordsFor(labels: TimerLabels | undefined): Required<{ [Key in keyof TimerLabels]: string }> {
  return { ...timerWords, ...Object.fromEntries(Object.entries(labels ?? {}).filter(([, word]) => word !== undefined)) };
}

/** A finished timer sounds only when it ended a moment ago, not when a page opens long after. */
const FRESH_MS = 60_000;

// One audio context for every timer on the page, made in the click that starts a timer, which
// is when browsers allow sound to start.
let context: AudioContext | null | undefined;

/** Makes the page's chime context, from a click. */
export function primeAlert(): void {
  context ??= createChimeContext();
}

/** How a timer sounds when its time is up: once, or again until it is stopped. */
export type TimerAlert = "once" | "repeat";

/** The ways a timer can sound when its time is up. @internal */
export const timerAlerts = ["once", "repeat"] as const satisfies readonly TimerAlert[];

/**
 * How often a repeating alert sounds again, in ms: every 2.5 seconds, as Spoonjoy's kitchen timer did.
 *
 * @claim "every 2.5 seconds, as Spoonjoy's kitchen" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > chimes and buzzes again every 2.5 seconds with alert=repeat, says it once, and stops on Dismiss)
 */
export const REPEAT_MS = 2500;

/** How long a repeating alert keeps sounding unless stopped, in seconds. */
export const REPEAT_FOR = 120;

/**
 * `repeatFor` when it is a length (finite and above 0), else {@link REPEAT_FOR}, so a bad value never rings forever.
 *
 * @claim "`repeatFor` when it is a length" registry/ouro/components/ouro/timer/timer.test.tsx verify:fileLine(registry/ouro/components/ouro/timer/timer.test.tsx, /takes a repeatFor that is not finite and above 0 as two minutes/)
 */
export function repeatLength(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : REPEAT_FOR;
}

/** The repeating alerts sounding now, by timer (its `timerId`, or the view's own key). */
const repeating = new Map<string, ReturnType<typeof setInterval>>();

/** How a view sounds its timer's alert. */
export interface AlertOptions {
  /** Keeps it quiet: the alert is only said. */
  silent: boolean;
  /** Sounds again at {@link REPEAT_MS} intervals until stopped or `repeatFor` seconds pass. */
  repeat: boolean;
  /** How long a repeating alert lasts, in seconds from when the time was up. */
  repeatFor: number;
  /** Which timer it is, so any view of it can stop it. */
  key: string;
}

/**
 * The alert at zero: said once, and chimed and buzzed unless silent or stale; with `repeat`,
 * chimed and buzzed again until {@link stopAlert} or the end of `repeatFor`.
 *
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > follows the Timer on the page, and alerts once at zero even when both show it)
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > keeps its time through a reload with a timerId, and stays quiet about a timer that ended long ago)
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > only says the time is up when silent)
 */
export function alertDone(label: string, done: string, event: TimerDoneEvent, { silent, repeat, repeatFor, key }: AlertOptions): void {
  if (!event.first) return;
  announce(`${label}: ${done}`);
  if (silent || Date.now() - event.endedAt > FRESH_MS) return;
  void chime({ context });
  buzz();
  if (!repeat) return;
  repeating.set(
    key,
    setInterval(() => {
      if (Date.now() - event.endedAt >= repeatFor * 1000) return stopAlert(key);
      void chime({ context });
      buzz();
    }, REPEAT_MS),
  );
}

/** How many views of a timer are mounted (a `Timer`, a tray's row), by key. */
const views = new Map<string, number>();

/**
 * Counts a view of a timer while it is mounted. The function it returns uncounts it, and stops
 * the timer's repeating alert once no view of the timer is left, so nothing rings with no
 * Dismiss on screen.
 *
 * @claim "stops the timer's repeating alert once" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > stops a repeating alert when the last view of its timer goes)
 */
export function registerView(key: string): () => void {
  views.set(key, (views.get(key) ?? 0) + 1);
  return () => {
    const left = views.get(key)! - 1;
    views.set(key, left);
    // A commit unmounts the old view before mounting its replacement.
    queueMicrotask(() => {
      if (views.get(key) === 0) stopAlert(key);
    });
  };
}

/** Stops a timer's repeating alert, if it has one: on Dismiss, Restart or Cancel in any view of it. */
export function stopAlert(key: string): void {
  clearInterval(repeating.get(key));
  // Stryker disable next-line CallExpression: clearing the interval stops the alert; this only frees its entry.
  repeating.delete(key);
}

/**
 * The time when it is up: the destructive color mixed 20% toward the foreground, for contrast on the page.
 *
 * @claim "The time when it is up" registry/ouro/components/ouro/timer/timer-styles.ts verify:fileLine(registry/ouro/components/ouro/timer/timer-styles.ts, /text-\[color-mix\(in_oklab,var\(--destructive\)_80%,var\(--foreground\)\)\]/)
 */
export const doneText = "text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]";
