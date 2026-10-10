// Cook-mode timers, as plain data anchored to wall-clock times.
//
// A timer belongs to a recipe step (keyed by step number) and stores when it ends rather than how
// many ticks are left, so it survives moving between steps, a throttled background tab and a page
// reload: the remaining time is always recomputed from `Date.now()`.

export type StoredCookTimer =
  | { status: "running"; durationSeconds: number; endsAt: number }
  | { status: "paused"; durationSeconds: number; remainingMs: number }
  | { status: "done"; durationSeconds: number; endedAt: number };

export type CookTimers = Record<string, StoredCookTimer>;

// How long a finished timer keeps ringing before it falls quiet (it still shows "Time's up").
export const ALARM_WINDOW_MS = 2 * 60 * 1000;

export function timerKey(stepNum: number): string {
  return String(stepNum);
}

export function startTimer(timers: CookTimers, key: string, durationSeconds: number, now: number): CookTimers {
  return { ...timers, [key]: { status: "running", durationSeconds, endsAt: now + durationSeconds * 1000 } };
}

export function pauseTimer(timers: CookTimers, key: string, now: number): CookTimers {
  const timer = timers[key];
  if (!timer || timer.status !== "running") return timers;
  return {
    ...timers,
    [key]: { status: "paused", durationSeconds: timer.durationSeconds, remainingMs: Math.max(0, timer.endsAt - now) },
  };
}

export function resumeTimer(timers: CookTimers, key: string, now: number): CookTimers {
  const timer = timers[key];
  if (!timer || timer.status !== "paused") return timers;
  return {
    ...timers,
    [key]: { status: "running", durationSeconds: timer.durationSeconds, endsAt: now + timer.remainingMs },
  };
}

// Cancelling a running or paused timer and dismissing a finished one both remove it, so the step
// goes back to its idle, full-length timer.
export function clearTimer(timers: CookTimers, key: string): CookTimers {
  if (!(key in timers)) return timers;
  const next = { ...timers };
  delete next[key];
  return next;
}

// Turns every running timer whose end time has passed into a finished one. Returns the same object
// when nothing finished, so callers can skip a state update.
export function settleTimers(timers: CookTimers, now: number): { timers: CookTimers; finished: string[] } {
  const finished = Object.keys(timers).filter((key) => {
    const timer = timers[key];
    return timer.status === "running" && timer.endsAt <= now;
  });
  if (finished.length === 0) return { timers, finished };
  const next = { ...timers };
  for (const key of finished) {
    const timer = timers[key] as Extract<StoredCookTimer, { status: "running" }>;
    next[key] = { status: "done", durationSeconds: timer.durationSeconds, endedAt: timer.endsAt };
  }
  return { timers: next, finished };
}

export function remainingSeconds(timer: StoredCookTimer, now: number): number {
  if (timer.status === "running") {
    return Math.min(timer.durationSeconds, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));
  }
  if (timer.status === "paused") return Math.ceil(timer.remainingMs / 1000);
  return 0;
}

export function isRinging(timer: StoredCookTimer, now: number): boolean {
  return timer.status === "done" && now - timer.endedAt < ALARM_WINDOW_MS;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimer(value: unknown): StoredCookTimer | null {
  if (!value || typeof value !== "object") return null;
  const timer = value as Record<string, unknown>;
  if (!isFiniteNumber(timer.durationSeconds) || timer.durationSeconds <= 0) return null;
  const durationSeconds = timer.durationSeconds;
  if (timer.status === "running" && isFiniteNumber(timer.endsAt)) {
    return { status: "running", durationSeconds, endsAt: timer.endsAt };
  }
  if (timer.status === "paused" && isFiniteNumber(timer.remainingMs) && timer.remainingMs >= 0) {
    return { status: "paused", durationSeconds, remainingMs: timer.remainingMs };
  }
  if (timer.status === "done" && isFiniteNumber(timer.endedAt)) {
    return { status: "done", durationSeconds, endedAt: timer.endedAt };
  }
  return null;
}

// Stored timers come from localStorage, so anything malformed is dropped rather than trusted.
export function parseStoredTimers(raw: string | null): CookTimers {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const timers: CookTimers = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const timer = parseTimer(entry);
    if (timer) timers[key] = timer;
  }
  return timers;
}

export function cookTimersStorageKey(recipeId: string): string {
  return `spoonjoy-cook-timers:v1:${recipeId}`;
}

export function formatTimerSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`;
  return `${minutes.toString().padStart(2, "0")}:${seconds}`;
}
