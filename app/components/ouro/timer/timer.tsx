"use client";

import { useRef, type HTMLAttributes, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { formatDuration, useTimer, type TimerDoneEvent } from "~/lib/ouro/use-timer";
import { Button } from "~/components/ouro/button/button";
import { alertDone, doneText, primeAlert, wordsFor, type TimerLabels } from "~/components/ouro/timer/timer-styles";

export type { TimerLabels } from "~/components/ouro/timer/timer-styles";

/** The props Timer adds to the `<div>` attributes it passes through. */
export interface TimerOwnProps {
  /** How long it runs, in seconds: `duration={600}`. */
  duration: number;
  /** What the timer is for, shown above the time and naming it for screen readers: "Pasta", "Break". */
  label: string;
  /**
   * Keeps the timer through a reload and a closed tab, and shares it with a `TimerTray` and
   * every other `Timer` or `useTimer` given the same `timerId`. Without it the timer ends with
   * the component. (`id` is the element's, as on any `<div>`.)
   * @claim "Keeps the timer through a reload" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > keeps its time through a reload with a timerId, and stays quiet about a timer that ended long ago)
   * @claim "Keeps the timer through a reload" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > passes id to the element, and keeps and shares the timer only by timerId)
   */
  timerId?: string | undefined;
  /**
   * Called once when the timer reaches zero, including when it ended while the page was closed.
   *
   * @claim "Called once when the timer reaches" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > keeps its time through a reload with a timerId, and stays quiet about a timer that ended long ago)
   * @claim "Called once when the timer reaches" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > says, chimes and buzzes once at zero, shows Time's up, then dismisses or restarts)
   */
  onDone?: ((event: TimerDoneEvent) => void) | undefined;
  /**
   * No chime and no vibration at zero; it still shows and says that the time is up.
   *
   * @claim "No chime and no vibration at" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > only says the time is up when silent)
   */
  silent?: boolean | undefined;
  /** How large the time is: `md` beside other content, `lg` as a screen's focus. @default "md" */
  size?: "md" | "lg" | (string & { 'Use "md" or "lg"': never }) | undefined;
  /** The words it shows and says, for apps in other languages. */
  labels?: TimerLabels | undefined;
  /** Layout only: margins, width (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. The length is `duration`, in seconds: `<Timer duration={600} />`. */
  seconds?: { 'Use duration={600} (seconds)': never };
  /** Not a prop. The length is `duration`, in seconds: `<Timer duration={10 * 60} />`. */
  minutes?: { 'Use duration={10 * 60} (seconds)': never };
  /** Not a prop. Ouro UI says `onDone`: `<Timer onDone={() => …} />`. */
  onComplete?: { 'Use onDone={() => ...}': never };
  /** Not a prop. Ouro UI says `onDone`: `<Timer onDone={() => …} />`. */
  onEnd?: { 'Use onDone={() => ...}': never };
  /** Not a prop. Turn the sound off with `silent`: `<Timer silent />`. */
  sound?: { 'Use silent to turn the chime off': never };
  /** Not a prop. A timer is kept and shared by `timerId`: `<Timer timerId="pasta" />`. */
  autoSaveId?: { 'Use timerId="pasta"': never };
  /** Not a prop. A timer is kept and shared by `timerId`: `<Timer timerId="pasta" />`. */
  storageKey?: { 'Use timerId="pasta"': never };
}

/** Props for {@link Timer}: its own props and the `<div>` attributes it passes through. */
export type TimerProps = Omit<HTMLAttributes<HTMLDivElement>, keyof TimerOwnProps> & TimerOwnProps;

const sizes = {
  md: "text-4xl leading-10",
  lg: "text-6xl leading-none sm:text-7xl",
} as const;

/** "10 min", "1 h 30 min", "45 s": the length beside the label. */
function lengthOf(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  // Round the whole length to minutes first, so 59 min 30 s reads "1 h", never "60 min".
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}

/**
 * A countdown timer with its own controls: the time left in large numbers, Start, then Pause
 * and Cancel, Resume when paused, and at zero "Time's up" with Dismiss and Restart. It keeps
 * time by the clock, so it stays right in a background tab and, with `timerId`, across a reload.
 * At zero it chimes and vibrates (unless `silent`) and screen readers hear "Pasta: Time's up"
 * once; the time itself is a `timer` region, read when the person asks rather than every second.
 *
 * Give timers that should outlive their screen a `timerId` and list them in a `TimerTray`, so a
 * person who moves on can still see and stop them.
 *
 * Use `Progress` instead for how far a task has got, and `useTimer` for a timer of your own design.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * <Timer label="Pasta" duration={600} timerId="pasta" />
 * @claim "At zero it chimes and vibrates" registry/ouro/components/ouro/timer/timer.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer.test.tsx::Timer > says, chimes and buzzes once at zero, shows Time's up, then dismisses or restarts)
 * @claim "A countdown timer with its own" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > is a region listing the running, paused and finished timers with their time, and hides idle ones)
 * @claim "At zero it chimes and vibrates" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > is a region listing the running, paused and finished timers with their time, and hides idle ones)
 * @claim "At zero it chimes and vibrates" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > follows the Timer on the page, and alerts once at zero even when both show it)
 */
export function Timer(props: TimerProps): JSX.Element {
  const {
    duration,
    label,
    timerId,
    onDone,
    silent,
    size: sizeProp = "md",
    labels,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    seconds,
    minutes,
    onComplete,
    onEnd,
    sound,
    autoSaveId,
    storageKey,
    ...rest
  } = props;
  const size = sizeProp === "lg" ? "lg" : "md";
  const words = wordsFor(labels);
  useAppearanceClassNameCheck(
    "Timer",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; use size="lg" for a larger time`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Timer",
    process.env.NODE_ENV !== "production"
      ? () => [
          size !== sizeProp && [`size="${String(sizeProp)}" is not a size; use "md" or "lg"`, '<Timer size="lg" />'],
          !(duration > 0) && [`duration={${String(duration)}} is not a length; it is in seconds and above 0`, "<Timer duration={600} />"],
          seconds !== undefined && ["seconds is not a prop", `<Timer duration={${typeof seconds === "number" ? seconds : 600}} />`],
          minutes !== undefined && ["minutes is not a prop", `<Timer duration={${typeof minutes === "number" ? minutes : 10} * 60} />`],
          onComplete !== undefined && ["onComplete is not a prop", "<Timer onDone={() => {}} />"],
          onEnd !== undefined && ["onEnd is not a prop", "<Timer onDone={() => {}} />"],
          sound !== undefined && ["sound is not a prop", "<Timer silent />"],
          autoSaveId !== undefined && ["autoSaveId is not a prop", '<Timer timerId="pasta" />'],
          storageKey !== undefined && ["storageKey is not a prop", '<Timer timerId="pasta" />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const timer = useTimer({
    duration,
    timerId,
    onDone: (event) => {
      alertDone(label, words.done, event, silent === true);
      onDone?.(event);
    },
  });
  const primary = useRef<HTMLButtonElement>(null);
  const { status } = timer;
  const done = status === "done";

  const act = () => {
    if (status === "running") return timer.pause();
    if (status === "paused") return timer.resume();
    if (done) {
      timer.reset();
      return;
    }
    if (!silent) primeAlert();
    timer.start();
  };
  const other = () => {
    if (done) {
      if (!silent) primeAlert();
      timer.start();
      return;
    }
    timer.reset();
    // The button goes with the running timer; focus stays on the one that remains.
    primary.current!.focus();
  };

  return (
    <div {...rest} data-ouro="timer" data-status={status} role="group" aria-label={label} className={cn("grid min-w-0 gap-3", className)}>
      <div className="grid min-w-0 gap-1">
        <p className={cn("m-0 min-w-0 truncate text-sm leading-5 font-medium", done ? doneText : "text-muted-foreground")}>
          {done ? words.done : `${label} · ${lengthOf(timer.duration)}`}
        </p>
        <p role="timer" className={cn("m-0 font-semibold tabular-nums", sizes[size], done ? doneText : "text-foreground")}>
          {formatDuration(timer.remaining)}
          {status === "paused" ? <span className="ms-3 align-middle text-sm font-medium text-muted-foreground">{words.paused}</span> : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={primary}
          data-ouro-control="timer"
          data-ouro-part="primary"
          tone={done ? "destructive" : "primary"}
          variant={status === "running" ? "soft" : "solid"}
          onClick={act}
        >
          {status === "running" ? words.pause : status === "paused" ? words.resume : done ? words.dismiss : words.start}
        </Button>
        {status !== "idle" ? (
          <Button data-ouro-control="timer" data-ouro-part="secondary" variant="plain" tone="secondary" onClick={other}>
            {done ? words.restart : words.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
