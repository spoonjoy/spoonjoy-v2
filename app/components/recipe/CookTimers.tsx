import { useEffect, useState } from "react";
import { BellRing, TimerReset } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { CookTimerEntry, CookTimersController } from "~/hooks/use-cook-timers";
import { formatTimerSeconds, remainingSeconds } from "~/lib/cook-timers";

const TICK_MS = 250;

type CookTimerStatus = "idle" | "running" | "paused" | "done";

interface CookTimerView extends CookTimerEntry {
  status: CookTimerStatus;
  remainingSeconds: number;
}

// The countdown ticks here, in the small timer components, rather than re-rendering the whole
// recipe page several times a second.
function useTimerViews(entries: CookTimerEntry[]): CookTimerView[] {
  const [now, setNow] = useState(() => Date.now());
  const running = entries.some((entry) => entry.stored?.status === "running");
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [running]);
  return entries.map((entry) => ({
    ...entry,
    status: entry.stored ? entry.stored.status : "idle",
    remainingSeconds: entry.stored ? remainingSeconds(entry.stored, now) : entry.durationSeconds,
  }));
}

function durationLabel(view: CookTimerView): string {
  const minutes = view.durationSeconds / 60;
  const rounded = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(1));
  return `${rounded} min timer`;
}

// The current step's timer, inside the cook-mode step page.
export function CookStepTimer({ stepNum, controller }: { stepNum: number; controller: CookTimersController }) {
  const entry = controller.timers.get(stepNum);
  return entry ? <StepTimer entry={entry} controller={controller} /> : null;
}

function StepTimer({ entry, controller }: { entry: CookTimerEntry; controller: CookTimersController }) {
  const [view] = useTimerViews([entry]);
  const stepNum = entry.stepNum;

  const isDone = view.status === "done";
  return (
    <div
      data-testid="cook-mode-timer"
      data-status={view.status}
      className={`mt-6 flex flex-col gap-4 border-y py-4 sm:flex-row sm:items-center sm:justify-between ${
        view.ringing ? "border-[var(--sj-tomato)]" : "border-[var(--sj-border)]"
      }`}
    >
      <div>
        <p
          className={`font-sj-ui text-xs font-bold uppercase tracking-[0.18em] ${
            isDone ? "text-[var(--sj-tomato)]" : "text-[var(--sj-brass)]"
          }`}
        >
          {isDone ? "Time's up" : durationLabel(view)}
        </p>
        <p
          className={`font-sj-display mt-2 text-4xl/10 font-semibold tabular-nums ${
            isDone ? "text-[var(--sj-tomato)]" : "text-[var(--sj-ink)]"
          }`}
        >
          {formatTimerSeconds(view.remainingSeconds)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex">
        {view.status === "idle" ? (
          <Button type="button" className="col-span-2" onClick={() => controller.start(stepNum)}>
            Start timer
          </Button>
        ) : null}
        {view.status === "running" ? (
          <Button type="button" onClick={() => controller.pause(stepNum)}>
            Pause timer
          </Button>
        ) : null}
        {view.status === "paused" ? (
          <Button type="button" onClick={() => controller.resume(stepNum)}>
            Resume timer
          </Button>
        ) : null}
        {view.status === "running" || view.status === "paused" ? (
          <Button type="button" plain onClick={() => controller.clear(stepNum)}>
            Cancel timer
          </Button>
        ) : null}
        {isDone ? (
          <>
            <Button type="button" variant="destructive" onClick={() => controller.clear(stepNum)}>
              {view.ringing ? "Stop alarm" : "Dismiss"}
            </Button>
            <Button type="button" plain onClick={() => controller.start(stepNum)}>
              Restart timer
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// Every running, paused or finished timer that is not on the step in view, so a cook who moves on
// can still see (and stop) the pasta timer from step 1.
export function CookTimerTray({
  controller,
  currentStepNum,
  onGoToStep,
}: {
  controller: CookTimersController;
  currentStepNum?: number;
  onGoToStep?: (stepNum: number) => void;
}) {
  const others = useTimerViews(controller.active.filter((entry) => entry.stepNum !== currentStepNum));

  return (
    <>
      {/* Always mounted so screen readers hear "Time's up" even when the timer is on another step. */}
      <p className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="cook-timer-announcement">
        {controller.announcement}
      </p>
      {others.length > 0 ? (
        <section
          aria-label="Running timers"
          data-testid="cook-timer-tray"
          className="shrink-0 border-b border-[var(--sj-border)] py-2"
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {others.map((view) => (
              <li
                key={view.stepNum}
                data-testid={`cook-timer-tray-item-${view.stepNum}`}
                className={`flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--sj-radius-surface)] border px-3 py-2 ${
                  view.ringing
                    ? "border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_12%,var(--sj-panel-solid))]"
                    : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)]"
                }`}
              >
                {view.status === "done" ? (
                  <BellRing aria-hidden="true" className="size-5 shrink-0 text-[var(--sj-tomato)]" />
                ) : (
                  <TimerReset aria-hidden="true" className="size-5 shrink-0 text-[var(--sj-brass)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-sj-ui m-0 truncate text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                    Step {view.stepNum}{view.label ? ` · ${view.label}` : ""}
                  </p>
                  <p
                    className={`font-sj-display m-0 text-2xl/7 font-semibold tabular-nums ${
                      view.status === "done" ? "text-[var(--sj-tomato)]" : "text-[var(--sj-ink)]"
                    }`}
                  >
                    {view.status === "done"
                      ? "Time's up"
                      : `${formatTimerSeconds(view.remainingSeconds)}${view.status === "paused" ? " paused" : ""}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {onGoToStep ? (
                    <Button
                      type="button"
                      plain
                      aria-label={`Go to step ${view.stepNum}`}
                      onClick={() => onGoToStep(view.stepNum)}
                    >
                      Go to step
                    </Button>
                  ) : null}
                  {view.status === "done" ? (
                    <Button
                      type="button"
                      variant="destructive"
                      aria-label={`${view.ringing ? "Stop alarm" : "Dismiss timer"} for step ${view.stepNum}`}
                      onClick={() => controller.clear(view.stepNum)}
                    >
                      {view.ringing ? "Stop alarm" : "Dismiss"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      plain
                      aria-label={`Cancel timer for step ${view.stepNum}`}
                      onClick={() => controller.clear(view.stepNum)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
