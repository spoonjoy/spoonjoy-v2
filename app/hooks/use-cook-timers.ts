import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCookAlarm, type CookAlarm } from "~/lib/cook-alarm.client";
import {
  ALARM_WINDOW_MS,
  clearTimer,
  cookTimersStorageKey,
  isRinging,
  parseStoredTimers,
  pauseTimer,
  resumeTimer,
  settleTimers,
  startTimer,
  timerKey,
  type CookTimers,
  type StoredCookTimer,
} from "~/lib/cook-timers";

export interface CookTimerStep {
  stepNum: number;
  // The step's title, or "" when it has none.
  label: string;
  durationMinutes: number | null | undefined;
}

export interface CookTimerEntry {
  stepNum: number;
  label: string;
  durationSeconds: number;
  // null while the step's timer is idle (never started, cancelled or dismissed).
  stored: StoredCookTimer | null;
  ringing: boolean;
}

export interface CookTimersController {
  // Every step with a positive duration, idle or not, keyed by step number.
  timers: Map<number, CookTimerEntry>;
  // Timers that are counting, paused or finished, in step order.
  active: CookTimerEntry[];
  announcement: string;
  start(stepNum: number): void;
  pause(stepNum: number): void;
  resume(stepNum: number): void;
  clear(stepNum: number): void;
}

const ALARM_REPEAT_MS = 2500;
const EMPTY_TIMERS: CookTimers = {};
// Browsers clamp timeouts to a signed 32-bit number of milliseconds.
const MAX_TIMEOUT_MS = 2_147_483_647;

function durationSecondsFor(step: CookTimerStep): number {
  return Math.max(0, Math.round((step.durationMinutes ?? 0) * 60));
}

function readStoredTimers(recipeId: string): CookTimers {
  try {
    return parseStoredTimers(window.localStorage.getItem(cookTimersStorageKey(recipeId)));
  } catch {
    return {};
  }
}

function writeStoredTimers(recipeId: string, timers: CookTimers) {
  try {
    const key = cookTimersStorageKey(recipeId);
    if (Object.keys(timers).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(timers));
  } catch {
    // Storage can be unavailable (private windows, quota); timers still run for this page.
  }
}

// The next moment the timers' state changes on its own: a running timer reaches zero, or a
// finished timer's alarm falls quiet.
function nextChangeAt(timers: CookTimers, now: number): number | null {
  let next: number | null = null;
  for (const timer of Object.values(timers)) {
    const at = timer.status === "running"
      ? timer.endsAt
      : timer.status === "done" && isRinging(timer, now)
        ? timer.endedAt + ALARM_WINDOW_MS
        : null;
    if (at !== null && (next === null || at < next)) next = at;
  }
  return next;
}

// Owns every cook-mode timer for one recipe. It lives at the recipe route, above cook mode's step
// view, so moving between steps or leaving cook mode never drops a running timer. It re-renders
// only when a timer changes state; the countdown digits tick inside the timer components.
export function useCookTimers(
  recipeId: string,
  steps: CookTimerStep[],
  { alarmFactory = createCookAlarm }: { alarmFactory?: () => CookAlarm } = {},
): CookTimersController {
  // Timers are stored with the recipe they were loaded for, so a recipe change can never write
  // one recipe's timers under another's storage key.
  const [loaded, setLoaded] = useState<{ recipeId: string | null; timers: CookTimers }>({ recipeId: null, timers: {} });
  const timers = loaded.recipeId === recipeId ? loaded.timers : EMPTY_TIMERS;
  const setTimers = useCallback((update: CookTimers | ((current: CookTimers) => CookTimers)) => {
    setLoaded((current) => ({
      recipeId: current.recipeId,
      timers: typeof update === "function" ? update(current.timers) : update,
    }));
  }, []);
  const [clock, setClock] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");
  const alarmRef = useRef<CookAlarm | null>(null);
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const alarm = useCallback(() => {
    if (!alarmRef.current) alarmRef.current = alarmFactory();
    return alarmRef.current;
  }, [alarmFactory]);

  const labelFor = useCallback((key: string) => {
    const step = stepsRef.current.find((candidate) => timerKey(candidate.stepNum) === key);
    return step?.label ? `Step ${key}, ${step.label}` : `Step ${key}`;
  }, []);

  // Load this recipe's timers after hydration (the server never sees localStorage).
  useEffect(() => {
    setLoaded({ recipeId, timers: readStoredTimers(recipeId) });
    setClock(Date.now());
  }, [recipeId]);

  useEffect(() => {
    if (loaded.recipeId !== null) writeStoredTimers(loaded.recipeId, loaded.timers);
  }, [loaded]);

  // Wake up when the next timer ends or the next alarm falls quiet. A background tab may run this
  // late, so coming back to the tab also catches up.
  const wakeAt = nextChangeAt(timers, clock);
  useEffect(() => {
    if (wakeAt === null) return;
    const timeoutId = window.setTimeout(() => setClock(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, wakeAt - Date.now())));
    return () => window.clearTimeout(timeoutId);
  }, [wakeAt]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") setClock(Date.now());
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Finish timers whose end time passed (including while the tab slept or the page was closed)
  // and ring for each one that ended recently enough to still matter.
  useEffect(() => {
    const { timers: settled, finished } = settleTimers(timers, clock);
    if (finished.length === 0) return;
    setTimers(settled);
    const recent = finished.filter((key) => isRinging(settled[key], clock));
    if (recent.length === 0) return;
    const labels = recent.map(labelFor).join("; ");
    setAnnouncement(`Time's up: ${labels}`);
    alarm().ring("Time's up", labels);
  }, [timers, clock, alarm, labelFor, setTimers]);

  // Keep ringing in bursts while a finished timer is inside its alarm window.
  const ringingKeys = Object.keys(timers).filter((key) => isRinging(timers[key], clock));
  const ringingLabels = ringingKeys.map(labelFor).join("; ");
  useEffect(() => {
    if (!ringingLabels) return;
    const intervalId = window.setInterval(() => alarm().ring("Time's up", ringingLabels), ALARM_REPEAT_MS);
    return () => window.clearInterval(intervalId);
  }, [ringingLabels, alarm]);

  // While a timer rings, the tab title says so, which is what a cook sees across the room.
  useEffect(() => {
    if (!ringingLabels) return;
    const previousTitle = document.title;
    document.title = `Time's up: ${ringingLabels}`;
    return () => {
      document.title = previousTitle;
    };
  }, [ringingLabels]);

  useEffect(() => () => alarmRef.current?.close(), []);

  const start = useCallback((stepNum: number) => {
    const step = stepsRef.current.find((candidate) => candidate.stepNum === stepNum);
    const durationSeconds = step ? durationSecondsFor(step) : 0;
    if (durationSeconds <= 0) return;
    alarm().prime();
    const startedAt = Date.now();
    setClock(startedAt);
    setAnnouncement("");
    setTimers((current) => startTimer(current, timerKey(stepNum), durationSeconds, startedAt));
  }, [alarm, setTimers]);

  const pause = useCallback((stepNum: number) => {
    const at = Date.now();
    setClock(at);
    setTimers((current) => pauseTimer(current, timerKey(stepNum), at));
  }, [setTimers]);

  const resume = useCallback((stepNum: number) => {
    alarm().prime();
    const at = Date.now();
    setClock(at);
    setTimers((current) => resumeTimer(current, timerKey(stepNum), at));
  }, [alarm, setTimers]);

  const clear = useCallback((stepNum: number) => {
    setTimers((current) => clearTimer(current, timerKey(stepNum)));
  }, [setTimers]);

  const entries = useMemo(() => {
    const map = new Map<number, CookTimerEntry>();
    for (const step of steps) {
      const stored = timers[timerKey(step.stepNum)] ?? null;
      const durationSeconds = stored ? stored.durationSeconds : durationSecondsFor(step);
      if (durationSeconds <= 0) continue;
      map.set(step.stepNum, {
        stepNum: step.stepNum,
        label: step.label,
        durationSeconds,
        stored,
        ringing: stored ? isRinging(stored, clock) : false,
      });
    }
    return map;
  }, [steps, timers, clock]);

  const active = useMemo(() => Array.from(entries.values()).filter((entry) => entry.stored !== null), [entries]);

  return { timers: entries, active, announcement, start, pause, resume, clear };
}
