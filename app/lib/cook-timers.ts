// Cook-mode timers: one per step with a duration, run and kept by HX's Timer and TimerTray
// under a timerId, so a timer carries on through moving between steps and a reload.

import { restoreTimer, type TimerState } from "~/lib/ouro/use-timer";

export interface CookTimerStepSource {
  stepNum: number;
  stepTitle?: string | null;
  duration?: number | null;
}

export interface CookTimer {
  stepNum: number;
  /** "Step 2 · Boil pasta", or "Step 2" for a step without a title. */
  label: string;
  /** The step's duration, in whole seconds. */
  duration: number;
  timerId: string;
  legacyStorageKey: string | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The start of the timerId of every timer under `scope` (a recipe's id): its steps' timers. */
export function cookTimerIdPrefix(scope: string): string {
  return `spoonjoy-cook-timer:${scope}:`;
}

/** Where HX's Timer keeps a timer with a timerId (app/lib/ouro/use-timer.ts). */
const HX_TIMER_STORAGE_PREFIX = "ouro-timer:";

/**
 * Seconds left on the soonest running timer of the recipe in this browser, or null when none
 * runs. Reads HX Timer's stored state, so a page without the recipe's timers on it (the Kitchen's
 * Cooking now strip) can still count down.
 */
export function soonestRunningCookTimerSeconds(scope: string, now: number): number | null {
  const prefix = HX_TIMER_STORAGE_PREFIX + cookTimerIdPrefix(scope);
  let soonest: number | null = null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) continue;
      let value: unknown;
      try {
        value = JSON.parse(window.localStorage.getItem(key) ?? "");
      } catch {
        continue;
      }
      const timer = value as Record<string, unknown> | null;
      if (!timer || timer.status !== "running" || !finite(timer.endsAt)) continue;
      const seconds = Math.ceil((timer.endsAt - now) / 1000);
      if (seconds > 0 && (soonest === null || seconds < soonest)) soonest = seconds;
    }
  } catch {
    return null;
  }
  return soonest;
}

/** Every step's timer, for the steps whose duration is positive, in step order. */
export function cookTimers(scope: string, steps: readonly CookTimerStepSource[], legacyRecipeId: string | null = scope): CookTimer[] {
  return steps.flatMap((step) => {
    const duration = Math.round((step.duration ?? 0) * 60);
    if (duration <= 0) return [];
    return [{
      stepNum: step.stepNum,
      label: step.stepTitle ? `Step ${step.stepNum} · ${step.stepTitle}` : `Step ${step.stepNum}`,
      duration,
      timerId: `${cookTimerIdPrefix(scope)}${step.stepNum}`,
      legacyStorageKey: legacyRecipeId === null ? null : `spoonjoy-cook-timers:v1:${legacyRecipeId}`,
    }];
  });
}

function legacyState(value: unknown): TimerState | null {
  if (typeof value !== "object" || value === null) return null;
  const timer = value as Record<string, unknown>;
  const duration = timer.durationSeconds;
  if (!finite(duration) || duration <= 0) return null;
  if (timer.status === "running" && finite(timer.endsAt)) return { status: "running", duration, endsAt: timer.endsAt };
  if (timer.status === "paused" && finite(timer.remainingMs) && timer.remainingMs >= 0) return { status: "paused", duration, remainingMs: timer.remainingMs };
  if (timer.status === "done" && finite(timer.endedAt)) return { status: "done", duration, endedAt: timer.endedAt };
  return null;
}

/** Transfers one legacy step without discarding other steps or unpersisted progress. */
export function restoreCookTimer(timer: CookTimer): boolean {
  const key = timer.legacyStorageKey;
  if (key === null) return true;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return false;
  }
  if (raw === null) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const records = parsed as Record<string, unknown>;
  const step = String(timer.stepNum);
  if (records[step] === undefined) return true;
  const state = legacyState(records[step]);
  if (!state || !restoreTimer(timer.timerId, state)) return false;
  const remaining = { ...records };
  delete remaining[step];
  try {
    // Another tab may have changed the legacy record while native storage was updated.
    if (window.localStorage.getItem(key) !== raw) return false;
    if (Object.keys(remaining).length > 0) window.localStorage.setItem(key, JSON.stringify(remaining));
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
