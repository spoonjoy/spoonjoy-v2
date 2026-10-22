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

/**
 * The alert at zero: said once, and chimed and buzzed unless silent or stale.
 *
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > follows the Timer on the page, and alerts once at zero even when both show it)
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > keeps its time through a reload with a timerId, and stays quiet about a timer that ended long ago)
 * @claim "The alert at zero: said once" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > only says the time is up when silent)
 */
export function alertDone(label: string, done: string, event: TimerDoneEvent, silent: boolean): void {
  if (!event.first) return;
  announce(`${label}: ${done}`);
  if (silent || Date.now() - event.endedAt > FRESH_MS) return;
  void chime({ context });
  buzz();
}

/**
 * The time when it is up: the destructive color mixed 20% toward the foreground, for contrast on the page.
 *
 * @claim "The time when it is up" registry/ouro/components/ouro/timer/timer-styles.ts verify:fileLine(registry/ouro/components/ouro/timer/timer-styles.ts, /text-\[color-mix\(in_oklab,var\(--destructive\)_80%,var\(--foreground\)\)\]/)
 */
export const doneText = "text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]";
