import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Timer } from "~/components/ouro/timer/timer";
import { alertDone } from "~/components/ouro/timer/timer-styles";
import { TimerTray } from "~/components/ouro/timer/timer-tray";
import { buzz, chime } from "~/lib/ouro/feedback";
import { useTimer, type TimerDoneEvent } from "~/lib/ouro/use-timer";
import type { CookTimer } from "~/lib/cook-timers";

const LABELS = {
  start: "Start timer",
  pause: "Pause timer",
  resume: "Resume timer",
  cancel: "Cancel timer",
  restart: "Restart timer",
};
const DONE = "Time's up";
/** A finished timer notifies only when it ended a moment ago, not when a page opens long after. */
const FRESH_MS = 60_000;
/** A finished timer rings again this often, until it is dismissed or {@link RING_FOR_MS} pass. */
const RING_EVERY_MS = 2_500;
const RING_FOR_MS = 2 * 60_000;

/** The current step's timer, inside the cook-mode step page. */
export function CookStepTimer({ timer }: { timer: CookTimer | undefined }) {
  if (!timer) return null;
  return (
    <Timer
      data-testid="cook-mode-timer"
      className="mt-6"
      label={timer.label}
      duration={timer.duration}
      timerId={timer.timerId}
      labels={LABELS}
    />
  );
}

/**
 * Every running, paused or finished timer that is not on the step in view, so a cook who moves on
 * can still see (and stop) the pasta timer from step 1. In cook mode its "Go to" opens that
 * step; on the recipe page the tray has no link.
 */
export function CookTimerTray({
  timers,
  currentStepNum,
  onGoToStep,
}: {
  timers: readonly CookTimer[];
  currentStepNum?: number;
  onGoToStep?: (stepNum: number) => void;
}) {
  // The tray's "Go to" is a link to #step-N; cook mode shows steps one at a time, so the click
  // opens the step instead of following the link.
  const goToStep = onGoToStep
    ? (event: MouseEvent<HTMLElement>) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[href*="#step-"]');
        if (!link) return;
        event.preventDefault();
        onGoToStep(Number(link.hash.slice("#step-".length)));
      }
    : undefined;
  return (
    <>
      <TimerTray
        data-testid="cook-timer-tray"
        label="Running timers"
        labels={LABELS}
        onClickCapture={goToStep}
        timers={timers
          .filter((timer) => timer.stepNum !== currentStepNum)
          .map((timer) => ({
            timerId: timer.timerId,
            label: timer.label,
            duration: timer.duration,
            href: onGoToStep ? `#step-${timer.stepNum}` : undefined,
          }))}
      />
      <CookTimerAlerts timers={timers} />
    </>
  );
}

/**
 * What a cook sees and hears from across the room while a timer is up: the tab's title says so
 * until the timer is dismissed, and a cook who already allowed notifications gets one while the
 * tab is in the background.
 */
function CookTimerAlerts({ timers }: { timers: readonly CookTimer[] }) {
  const [finished, setFinished] = useState<ReadonlyMap<string, { label: string; endedAt: number }>>(new Map());
  const report = useCallback((timer: CookTimer, endedAt: number | null) => {
    setFinished((current) => {
      if (current.get(timer.timerId)?.endedAt === (endedAt ?? undefined)) return current;
      const next = new Map(current);
      if (endedAt !== null) next.set(timer.timerId, { label: timer.label, endedAt });
      else next.delete(timer.timerId);
      return next;
    });
  }, []);
  const labels = [...finished.values()].map((timer) => timer.label).join("; ");
  useEffect(() => {
    if (!labels) return;
    const previousTitle = document.title;
    document.title = `${DONE}: ${labels}`;
    return () => {
      document.title = previousTitle;
    };
  }, [labels]);
  // TODO(ouro-hx: timer alert until dismissed, ourostack/ouro-ui#179): HX Timer keeps alerting
  // until it is dismissed. Until then its one chime and buzz ring again from here, every 2.5 s,
  // until the cook dismisses the timer or two minutes pass, as Spoonjoy's own alarm did.
  const lastEnded = Math.max(0, ...[...finished.values()].map((timer) => timer.endedAt));
  useEffect(() => {
    if (!lastEnded) return;
    const until = lastEnded + RING_FOR_MS;
    if (Date.now() >= until) return;
    const ring = window.setInterval(() => {
      if (Date.now() > until) {
        window.clearInterval(ring);
        return;
      }
      void chime();
      buzz();
    }, RING_EVERY_MS);
    return () => window.clearInterval(ring);
  }, [lastEnded]);
  return (
    <>
      {timers.map((timer) => (
        <CookTimerWatch key={timer.timerId} timer={timer} onFinished={report} />
      ))}
    </>
  );
}

function CookTimerWatch({ timer, onFinished }: { timer: CookTimer; onFinished: (timer: CookTimer, endedAt: number | null) => void }) {
  const onDone = (event: TimerDoneEvent) => {
    // A watcher is a fallback view, as the tray is: when it is the first to hear the timer end,
    // no Timer or tray on the page alerts, so it gives HX's alert itself.
    alertDone(timer.label, DONE, event, false);
    notifyTimeUp(timer.label, event);
  };
  const { status, endedAt } = useTimer({ duration: timer.duration, timerId: timer.timerId, fallback: true, onDone });
  const done = status === "done";
  useEffect(() => onFinished(timer, done ? endedAt : null), [timer, done, endedAt, onFinished]);
  return null;
}

/** A system notification for a timer that just ended, while the tab is in the background. */
export function notifyTimeUp(label: string, event: TimerDoneEvent) {
  if (!event.first || Date.now() - event.endedAt > FRESH_MS) return;
  // Only notify when the cook already allowed notifications; never prompt from a timer.
  if (typeof window.Notification !== "function" || window.Notification.permission !== "granted") return;
  if (document.visibilityState !== "hidden") return;
  try {
    new window.Notification(DONE, { body: label, tag: "spoonjoy-cook-timer" });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
