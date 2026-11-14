"use client";

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type JSX, type Ref } from "react";
import { announce } from "~/lib/ouro/announce";
import { canCelebrate, celebrationPeriods, recordCelebration, type CelebrationPeriod } from "~/lib/ouro/celebration-cap";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings, type DevWarning } from "~/lib/ouro/use-dev-messages";
import { useOuro } from "~/lib/ouro/use-ouro";

/** The props Celebrate adds to the `<span>` attributes it passes through. */
export interface CelebrateOwnProps {
  /**
   * Whether the moment is happening. When it turns `true`, confetti bursts from the message and
   * screen readers hear the message, once; set it back to `false` to clear it, and to `true`
   * again for another burst.
   */
  show: boolean;
  /**
   * How often the confetti may burst: at most `times` times `per` day, week, 30-day month or
   * ever, counted in `localStorage` under `capKey` (or the cap's own `key`). Pass several to
   * hold to all of them, such as once per conversation and three times a day across the app:
   * `` cap={[{ times: 1, per: "ever", key: `cleared:${id}` }, { times: 3, per: "day", key: "celebrations" }]} ``.
   * Past a cap the message still shows and is heard, with no confetti. `Moment` counts under the
   * same keys, so the two can share a cap.
   * @claim "Past a cap the message still" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate cap > bursts at most times per period under its key, then shows and speaks the message alone)
   * @claim "How often the confetti may burst:" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate cap > bursts at most times per period under its key, then shows and speaks the message alone)
   * @claim "Pass several to hold to all" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate cap > holds to every cap it is given, and counts a burst against each)
   * @claim "`Moment` counts under the same keys," registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate cap > shares a key with Moment's cap)
   */
  cap?: CelebrateCap | readonly CelebrateCap[] | undefined;
  /** The key a cap without its own `key` counts under, such as "list-cleared". Falls back to `id`. */
  capKey?: string | undefined;
  /** What was achieved, in a few words: "List cleared", "Steps done". Shown in a badge and spoken. */
  message: string;
  /** Speaks the message without showing the badge, for a screen that already says it. The confetti still bursts. */
  hideMessage?: boolean | undefined;
  /** Layout only: placement (`mx-auto`, `mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLSpanElement> | undefined;

  /** Not a prop. Ouro UI uses `show`: `<Celebrate show={done} message="…" />`. */
  open?: { 'Use show={done}': never };
  /** Not a prop. Ouro UI uses `show`: `<Celebrate show={done} message="…" />`. */
  active?: { 'Use show={done}': never };
  /** Not a prop. The text is `message`: `<Celebrate show={done} message="List cleared" />`. */
  children?: { 'Use message="List cleared"': never };
}

/** One limit on how often {@link Celebrate} bursts: `times` per period, under `key` or the component's `capKey`. */
export interface CelebrateCap {
  times: number;
  per: CelebrationPeriod | (string & { 'Use "day", "week", "month" or "ever"': never });
  key?: string | undefined;
}

/** Props for {@link Celebrate}: its own props and the `<span>` attributes it passes through. */
export type CelebrateProps = Omit<HTMLAttributes<HTMLSpanElement>, keyof CelebrateOwnProps> & CelebrateOwnProps;

/** Leaves time for the triggering control's state announcement before the celebration message. This fixed delay cannot detect when a screen reader has finished speaking; the badge and confetti show immediately. */
const SPEAK_DELAY_MS = 1500;

// Twelve pieces around the circle, at two distances, in the theme's tones. Each lands inside
// Celebrate's own box, a share of its width and height out from the middle, so the burst never
// flies over what is around it: its layer grows from nothing to full size, carrying the piece out.
const PIECES = 12;
const tones = ["bg-primary", "bg-success", "bg-warning", "bg-destructive"] as const;
const pieces = Array.from({ length: PIECES }, (_, index) => {
  const angle = (index / PIECES) * Math.PI * 2 + (index % 2 ? 0.2 : 0);
  const reach = index % 2 ? 30 : 44;
  return {
    tone: tones[index % tones.length]!,
    style: {
      insetInlineStart: `calc(50% + ${Math.round(Math.cos(angle) * reach)}% - 4px)`,
      top: `calc(50% + ${Math.round(Math.sin(angle) * reach)}% - 4px)`,
      "--ouro-celebrate-turn": `${(index % 3) * 120 + 90}deg`,
    } as CSSProperties,
  };
});

/**
 * A small moment of celebration for something the person finished: confetti bursts from a badge with the message ("List cleared") and screen readers hear the message once. The confetti stays inside Celebrate's own box and never flies over what is around it: give it room with layout classes (`h-24 w-full`) for a wider burst. The message waits about 1.5 s to leave time for the triggering control's announcement; this does not detect when a screen reader finishes speaking. With reduced motion nothing flies: the badge only fades in. Put it where the eye already is, such as at the end of the list that was just cleared.
 *
 * Under `OuroProvider`'s `quiet`, for people who want less, only the message shows and is
 * heard: no confetti.
 *
 * Use `toast()` instead to confirm an everyday action (saved, sent), and `Alert` for a
 * message that should stay.
 *
 * While the moment lasts, the root carries `data-celebrate`, so a checker or a test can find it.
 *
 * @claim "While the moment lasts, the root" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate > carries data-celebrate while the moment lasts, and not before or after)
 * @claim "The confetti stays inside Celebrate's own" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate > throws twelve pieces in every direction, at two distances, in the theme's tones, inside its own box and hidden from screen readers)
 * @claim "Under `OuroProvider`'s `quiet`, for people" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate > shows and speaks only the message under OuroProvider's quiet, with no confetti)
 * @claim "The message waits about 1.5 s" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate > says the message once after a delay when the moment starts, and again for the next one)
 * @group Feedback
 * @see https://ui.ouroboros.bot/docs/celebrate
 *
 * @example
 * <Celebrate show={items.every((item) => item.checked)} message="List cleared" />
 */
export function Celebrate(props: CelebrateProps): JSX.Element {
  const {
    show,
    message,
    hideMessage,
    cap,
    capKey,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    open,
    active,
    children,
    ...rest
  } = props;
  const caps: readonly CelebrateCap[] = cap === undefined ? [] : Array.isArray(cap) ? cap : [cap as CelebrateCap];
  useAppearanceClassNameCheck(
    "Celebrate",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Celebrate takes its colors from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Celebrate",
    process.env.NODE_ENV !== "production"
      ? () => [
          open !== undefined && ["open is not a prop", "<Celebrate show={done} />"],
          active !== undefined && ["active is not a prop", "<Celebrate show={done} />"],
          children !== undefined && ["Celebrate takes its text as message", `<Celebrate message="${typeof children === "string" ? children : "All done"}" />`],
          ...caps.flatMap((limit): DevWarning[] => [
            !Object.hasOwn(celebrationPeriods, limit.per) && [`cap per "${String(limit.per)}" is not a period; use "day", "week", "month", "ever"`, '<Celebrate cap={{ times: 3, per: "day" }} capKey="cleared">'],
            (limit.key ?? capKey ?? rest.id) === undefined && ["a cap counts bursts under its key, capKey or id, and this one has none", '<Celebrate cap={{ times: 3, per: "day" }} capKey="cleared">'],
          ]),
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const quiet = useOuro().quiet === true;
  // Spoken when the moment starts, not when a page renders with it already shown.
  const shown = useRef(show);
  useEffect(() => {
    if (show && !shown.current) announce(message, { delayMs: SPEAK_DELAY_MS });
    shown.current = show;
  }, [show, message]);

  // With a cap, whether this showing may burst is decided once, as it starts, and counted.
  const [allowed, setAllowed] = useState(false);
  const decided = useRef(false);
  useEffect(() => {
    if (!show) {
      decided.current = false;
      requestAnimationFrame(() => setAllowed(false));
      return;
    }
    if (decided.current) return;
    decided.current = true;
    const now = Date.now();
    const counted = caps.flatMap((limit) => {
      const key = limit.key ?? capKey ?? rest.id;
      return key === undefined ? [] : [{ key, limit: { times: limit.times, per: Object.hasOwn(celebrationPeriods, limit.per) ? (limit.per as CelebrationPeriod) : "day" } }];
    });
    const ok = counted.every(({ key, limit }) => canCelebrate(key, limit, now));
    if (ok) for (const { key, limit } of counted) recordCelebration(key, limit, now);
    requestAnimationFrame(() => setAllowed(ok));
    // The decision reads the caps as the showing starts; later changes to them wait for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  const burst = show && (caps.length === 0 || allowed);

  return (
    <span
      {...rest}
      data-ouro="celebrate"
      data-open={show ? "" : undefined}
      data-celebrate={show ? "" : undefined}
      data-quiet={quiet ? "" : undefined}
      className={cn("relative inline-flex min-h-7 items-center justify-center", className)}
    >
      {show ? (
        <>
          {burst && !quiet && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-clip motion-reduce:hidden">
              {pieces.map((piece, index) => (
                <span
                  key={index}
                  data-ouro-part="piece"
                  className={cn(
                    "absolute inset-0 opacity-0",
                    "[transition:transform_var(--ouro-duration-sheet)_var(--ouro-ease-out),opacity_var(--ouro-duration-slow)_ease_var(--ouro-duration-base)]",
                    "starting:opacity-100 starting:[transform:scale(0)]",
                  )}
                >
                  <span style={piece.style} className={cn("absolute size-2 rounded-[2px] [transform:rotate(var(--ouro-celebrate-turn))]", piece.tone)} />
                </span>
              ))}
            </span>
          )}
          <span
            data-ouro-part="message"
            className={
              hideMessage
                ? "sr-only"
                : "inline-flex min-h-7 items-center rounded-full bg-success/10 px-3 text-sm leading-5 font-medium text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))] " +
                  "transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) starting:opacity-0"
            }
          >
            {message}
          </span>
        </>
      ) : null}
    </span>
  );
}
