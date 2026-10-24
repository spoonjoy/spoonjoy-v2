"use client";

import { useEffect, type HTMLAttributes, type JSX, type MouseEvent, type Ref, type RefObject } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings, type DevWarning } from "~/lib/ouro/use-dev-messages";
import { formatDuration, useTimer, type TimerDoneEvent } from "~/lib/ouro/use-timer";
import { Button } from "~/components/ouro/button/button";
import {
  alertDone,
  doneText,
  registerView,
  REPEAT_FOR,
  repeatLength,
  stopAlert,
  timerAlerts,
  wordsFor,
  type TimerAlert,
  type TimerLabels,
} from "~/components/ouro/timer/timer-styles";

/** One timer a {@link TimerTray} watches. */
export interface TimerTrayItem {
  /** The `timerId` the timer's `Timer` or `useTimer` has. */
  timerId: string;
  /** Not a key. A timer is named by `timerId`, as its `Timer` has it: `{ timerId: "pasta", label, duration }`. */
  id?: { 'Use timerId: "pasta"': never };
  /** What it is for, as its `Timer` says it: "Pasta". */
  label: string;
  /** Its length in seconds, as its `Timer` has it. */
  duration: number;
  /** Where the timer's own screen is, for a "Go to" link. */
  href?: string | undefined;
  /**
   * Called once when this timer finishes. `event.first` says whether this view owns the alert;
   * when a Timer shares it, that Timer owns it instead.
   * @claim "Called once when this timer finishes." registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > reports a timer's completion once with the same alert ownership as its Timer)
   */
  onDone?: ((event: TimerDoneEvent) => void) | undefined;
}

/** The props TimerTray adds to the `<section>` attributes it passes through. */
export interface TimerTrayOwnProps {
  /** The timers to watch, by `timerId`. Only those that are running, paused or finished show. */
  timers: readonly TimerTrayItem[];
  /** Names the tray for screen readers, as a region. @default "Timers" */
  label?: string | undefined;
  /**
   * No chime and no vibration when a timer reaches zero while only the tray shows it. A `Timer`
   * on the page that shows the same timer alerts instead of the tray, by its own `silent`.
   * @claim "No chime and no vibration when" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > alerts on its own when the timer's screen is gone, unless silent)
   */
  silent?: boolean | undefined;
  /**
   * How it sounds when a timer reaches zero while only the tray shows it, as `Timer`'s
   * `alert`: `once`, or `repeat`, again every 2.5 seconds until the timer is dismissed or
   * `repeatFor` seconds pass. Dismiss or Cancel in the tray also stops a `Timer`'s repeating alert.
   * @default "once"
   * @claim "Dismiss or Cancel in the tray" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > stops the Timer's repeating alert when the tray dismisses the timer)
   * @claim "`repeat`, again every 2.5 seconds until" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > repeats its own alert with alert=repeat until the timer is dismissed)
   */
  alert?: TimerAlert | (string & { 'Use "once" or "repeat"': never }) | undefined;
  /**
   * With `alert="repeat"`, how long it keeps sounding, in seconds from when the time was up. A
   * value that is not finite and above 0 is taken as 120, and development warns.
   * @default 120
   * @claim "A value that is not finite" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:fileLine(registry/ouro/components/ouro/timer/timer-tray.test.tsx, /takes a repeatFor that is not finite and above 0 as two minutes/)
   */
  repeatFor?: number | undefined;
  /** The words it shows and says, for apps in other languages. */
  labels?: TimerLabels | undefined;
  /**
   * Where focus goes when Cancel or Dismiss stops the tray's last timer, such as the page
   * heading (give it `tabIndex={-1}`): `finalFocus={headingRef}`. Stopping any other timer
   * moves focus to the next timer's button, or the previous one's. Without it focus goes to
   * the tray, which stays in view, empty, until focus leaves it.
   */
  finalFocus?: RefObject<HTMLElement | null> | undefined;
  /** Layout only: margins, sticky placement (`sticky top-0`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. The tray lists `timers`: `<TimerTray timers={[{ timerId, label, duration }]} />`. */
  items?: { 'Use timers={[{ timerId, label, duration }]}': never };
  /**
   * Not a prop. The tray shows only timers that are running, paused or finished; pass them all.
   *
   * @claim "The tray shows only timers that" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > is a region listing the running, paused and finished timers with their time, and hides idle ones)
   * @claim "The tray shows only timers that" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > hides itself while no timer is running)
   */
  hidden?: { 'The tray hides itself while no timer is running': never };
}

/** Props for {@link TimerTray}: its own props and the `<section>` attributes it passes through. */
export type TimerTrayProps = Omit<HTMLAttributes<HTMLElement>, keyof TimerTrayOwnProps> & TimerTrayOwnProps;

interface TrayRowProps {
  item: TimerTrayItem;
  words: ReturnType<typeof wordsFor>;
  silent: boolean;
  repeat: boolean;
  repeatFor: number;
  finalFocus: RefObject<HTMLElement | null> | undefined;
}

function TrayRow({ item, words, silent, repeat, repeatFor, finalFocus }: TrayRowProps): JSX.Element | null {
  const timer = useTimer({
    duration: item.duration,
    timerId: item.timerId,
    fallback: true,
    onDone: (event) => {
      alertDone(item.label, words.done, event, { silent, repeat, repeatFor, key: item.timerId });
      item.onDone?.(event);
    },
  });
  const done = timer.status === "done";
  // Dismiss or Cancel, here or in the timer's own view, stops a repeating alert.
  useEffect(() => {
    if (!done) stopAlert(item.timerId);
  }, [done, item.timerId]);
  // The alert stops once no view of the timer is left: the row goes with the tray, or leaves timers.
  // Stryker disable next-line ArrayDeclaration: rows are keyed by timerId, so a row's timerId never changes while it is mounted.
  useEffect(() => registerView(item.timerId), [item.timerId]);
  if (timer.status === "idle") return null;
  // The row goes with the timer, so focus moves on first: to the next timer, the previous one, or out.
  const stop = (event: MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest("li")!;
    const focused = row.contains(document.activeElement);
    const neighbour = row.nextElementSibling ?? row.previousElementSibling;
    if (focused) {
      if (neighbour) neighbour.querySelector<HTMLElement>('[data-ouro-control="timer-tray"][data-ouro-part="stop"]')!.focus();
      else (finalFocus?.current ?? row.closest<HTMLElement>('[data-ouro="timer-tray"]')!).focus();
    }
    timer.reset();
  };
  return (
    <li data-status={timer.status} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-2">
      <div className="min-w-40 flex-1">
        <p className="m-0 truncate text-sm leading-5 font-medium text-foreground">{item.label}</p>
        <p role="timer" className={cn("m-0 text-lg leading-7 font-semibold tabular-nums", done ? doneText : "text-foreground")}>
          {done ? words.done : formatDuration(timer.remaining)}
          {timer.status === "paused" ? <span className="ms-2 text-sm font-medium text-muted-foreground">{words.paused}</span> : null}
        </p>
      </div>
      <div className="flex gap-2">
        {item.href !== undefined ? (
          <Button data-ouro-control="timer-tray" data-ouro-part="go-to" href={item.href} variant="plain" tone="secondary" size="sm">
            {words.goTo}
            <span className="sr-only"> {item.label}</span>
          </Button>
        ) : null}
        <Button data-ouro-control="timer-tray" data-ouro-part="stop" onClick={stop} variant={done ? "solid" : "outline"} tone={done ? "destructive" : "secondary"} size="sm">
          {done ? words.dismiss : words.cancel}
          <span className="sr-only"> {item.label}</span>
        </Button>
      </div>
    </li>
  );
}

/**
 * The timers that are running, paused or finished, in one strip, so a person who leaves a
 * timer's screen can still see it count down, hear it at zero, and stop it. Pass every timer
 * the app has, by the `timerId` its `Timer` uses; the tray shows only those not idle, and hides
 * itself while none are. When a timer reaches zero while only the tray shows it, the tray
 * chimes and says so; when its `Timer` is on the page too, the `Timer` alerts instead (with its
 * own `silent`), whichever of the two mounted first.
 *
 * Put it where it stays in view, such as under the header (`className="sticky top-0"`), and
 * leave out the timer on the screen in view.
 *
 * Use `Timer` instead for one timer with all its controls.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer-tray
 *
 * @example
 * <TimerTray timers={[{ timerId: "pasta", label: "Pasta", duration: 600, href: "/steps/2" }]} />
 * @claim "The timers that are running, paused" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > is a region listing the running, paused and finished timers with their time, and hides idle ones)
 * @claim "The timers that are running, paused" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > hides itself while no timer is running)
 * @claim "When a timer reaches zero while" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > follows the Timer on the page, and alerts once at zero even when both show it)
 * @claim "When a timer reaches zero while" registry/ouro/components/ouro/timer/timer-tray.test.tsx verify:testExists(registry/ouro/components/ouro/timer/timer-tray.test.tsx::TimerTray > lets the Timer's silent decide the alert for a timer that ended just before a reload, with both mounted in one commit)
 */
export function TimerTray(props: TimerTrayProps): JSX.Element {
  const {
    timers,
    label = "Timers",
    silent,
    alert: alertProp = "once",
    repeatFor: repeatForProp = REPEAT_FOR,
    labels,
    finalFocus,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    items,
    hidden,
    ...rest
  } = props;
  const words = wordsFor(labels);
  const alert = timerAlerts.includes(alertProp as TimerAlert) ? (alertProp as TimerAlert) : "once";
  const repeatFor = repeatLength(repeatForProp);
  useAppearanceClassNameCheck(
    "TimerTray",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; TimerTray sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "TimerTray",
    process.env.NODE_ENV !== "production"
      ? (): DevWarning[] => [
          items !== undefined && ["items is not a prop", "<TimerTray timers={[{ timerId, label, duration }]} />"],
          ...timers.map((item): DevWarning => {
            const { id } = item as { id?: unknown };
            return id !== undefined && ["id is not a key of a timer in timers", `<TimerTray timers={[{ timerId: ${JSON.stringify(id)}, label, duration }]} />`];
          }),
          hidden !== undefined && ["hidden is not a prop; the tray hides itself while no timer is running", "<TimerTray timers={timers} />"],
          alert !== alertProp && [`alert="${String(alertProp)}" is not an alert; use "once" or "repeat"`, '<TimerTray alert="repeat" timers={timers} />'],
          repeatFor !== repeatForProp && [
            `repeatFor={${String(repeatForProp)}} is not a length; it is in seconds and above 0`,
            '<TimerTray alert="repeat" repeatFor={120} timers={timers} />',
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <section
      tabIndex={-1}
      {...rest}
      data-ouro="timer-tray"
      aria-label={label}
      className={cn("min-w-0 border-0 border-b border-solid border-border bg-background px-4 outline-none not-has-[li]:not-focus:hidden", className)}
    >
      <ul className="m-0 grid list-none divide-y divide-border p-0">
        {timers.map((item, index) => (
          // A plain-JavaScript app may leave timerId out (development names the fix); the index keeps React's key.
          <TrayRow
            key={item.timerId ?? `index:${index}`}
            item={item}
            words={words}
            silent={silent === true}
            repeat={alert === "repeat"}
            repeatFor={repeatFor}
            finalFocus={finalFocus}
          />
        ))}
      </ul>
    </section>
  );
}
