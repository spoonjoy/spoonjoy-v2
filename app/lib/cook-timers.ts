// Cook-mode timers: one per step with a duration, run and kept by HX's Timer and TimerTray
// under a timerId, so a timer carries on through moving between steps and a reload.

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
}

/** Every step's timer, for the steps whose duration is positive, in step order. */
export function cookTimers(scope: string, steps: readonly CookTimerStepSource[]): CookTimer[] {
  return steps.flatMap((step) => {
    const duration = Math.round((step.duration ?? 0) * 60);
    if (duration <= 0) return [];
    return [{
      stepNum: step.stepNum,
      label: step.stepTitle ? `Step ${step.stepNum} · ${step.stepTitle}` : `Step ${step.stepNum}`,
      duration,
      timerId: `spoonjoy-cook-timer:${scope}:${step.stepNum}`,
    }];
  });
}
