"use client";

import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type JSX, type Ref } from "react";
import { announce } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props Celebrate adds to the `<span>` attributes it passes through. */
export interface CelebrateOwnProps {
  /**
   * Whether the moment is happening. When it turns `true`, confetti bursts from the message and
   * screen readers hear the message, once; set it back to `false` to clear it, and to `true`
   * again for another burst.
   */
  show: boolean;
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

/** Props for {@link Celebrate}: its own props and the `<span>` attributes it passes through. */
export type CelebrateProps = Omit<HTMLAttributes<HTMLSpanElement>, keyof CelebrateOwnProps> & CelebrateOwnProps;

/** Leaves time for the triggering control's state announcement before the celebration message. This fixed delay cannot detect when a screen reader has finished speaking; the badge and confetti show immediately. */
const SPEAK_DELAY_MS = 1500;

// Twelve pieces around the circle, at two distances, in the theme's tones.
const PIECES = 12;
const tones = ["bg-primary", "bg-success", "bg-warning", "bg-destructive"] as const;
const pieces = Array.from({ length: PIECES }, (_, index) => {
  const angle = (index / PIECES) * Math.PI * 2 + (index % 2 ? 0.2 : 0);
  const distance = index % 2 ? 56 : 80;
  return {
    tone: tones[index % tones.length]!,
    style: {
      "--ouro-celebrate-x": `${Math.round(Math.cos(angle) * distance)}px`,
      "--ouro-celebrate-y": `${Math.round(Math.sin(angle) * distance)}px`,
      "--ouro-celebrate-turn": `${(index % 3) * 120 + 90}deg`,
    } as CSSProperties,
  };
});

/**
 * A small moment of celebration for something the person finished: confetti bursts from a badge with the message ("List cleared") and screen readers hear the message once. The message waits about 1.5 s to leave time for the triggering control's announcement; this does not detect when a screen reader finishes speaking. With reduced motion nothing flies: the badge only fades in. Put it where the eye already is, such as at the end of the list that was just cleared.
 *
 * Use `toast()` instead to confirm an everyday action (saved, sent), and `Alert` for a
 * message that should stay.
 *
 * @claim "The message waits about 1.5 s" registry/ouro/components/ouro/celebrate/celebrate.test.tsx verify:testExists(registry/ouro/components/ouro/celebrate/celebrate.test.tsx::Celebrate > says the message once after a delay when the moment starts, and again for the next one)
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/celebrate
 *
 * @example
 * <Celebrate show={items.every((item) => item.checked)} message="List cleared" />
 */
export function Celebrate(props: CelebrateProps): JSX.Element {
  const {
    show,
    message,
    hideMessage,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    open,
    active,
    children,
    ...rest
  } = props;
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
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Spoken when the moment starts, not when a page renders with it already shown.
  const shown = useRef(show);
  useEffect(() => {
    if (show && !shown.current) announce(message, { delayMs: SPEAK_DELAY_MS });
    shown.current = show;
  }, [show, message]);

  return (
    <span
      {...rest}
      data-ouro="celebrate"
      data-open={show ? "" : undefined}
      className={cn("relative inline-flex min-h-7 items-center justify-center", className)}
    >
      {show ? (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto size-0 motion-reduce:hidden">
            {pieces.map((piece, index) => (
              <span
                key={index}
                data-ouro-part="piece"
                style={piece.style}
                className={cn(
                  "absolute -start-1 -top-1 size-2 rounded-[2px] opacity-0 [transform:translate(var(--ouro-celebrate-x),var(--ouro-celebrate-y))_rotate(var(--ouro-celebrate-turn))]",
                  "[transition:transform_var(--ouro-duration-sheet)_var(--ouro-ease-out),opacity_var(--ouro-duration-slow)_ease_var(--ouro-duration-base)]",
                  "starting:opacity-100 starting:[transform:none]",
                  piece.tone,
                )}
              />
            ))}
          </span>
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
