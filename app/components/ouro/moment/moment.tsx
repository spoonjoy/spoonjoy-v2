"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type HTMLAttributes, type JSX, type ReactNode, type Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import {
  artFrameClass,
  haloClass,
  dismissPeriods,
  isDismissed,
  keepDismissed,
  kindToneClass,
  periods,
  rootClass,
  SETTLE_MS,
  seenThisSession,
  sparkClasses,
  sparkleClass,
  subscribeMoments,
  takeShowing,
  type MomentKind,
  type MomentPeriod,
} from "~/components/ouro/moment/moment-styles";
import { Spinner } from "~/components/ouro/spinner/spinner";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";
import { announce as speak } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useFocusHandoff } from "~/lib/ouro/focus-handoff";
import { useMergedRef } from "~/lib/ouro/refs";
import { useOuro } from "~/lib/ouro/use-ouro";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useReducedMotion } from "~/lib/ouro/use-reduced-motion";

/** The props Moment adds to the `<div>` attributes it passes through. */
export interface MomentOwnProps {
  /**
   * What the moment is about. `empty`: nothing here yet. `loading`: on its way, with a
   * spinner when there is no art. `error`: something failed. `first-run`: a first run or a
   * welcome (`welcome` is the same kind by its older name, and the root says `first-run`).
   * `success`: something finished, which celebrates (see `celebrate`). `ask`: something the
   * app, or an agent working for the person, asks them to look at; show it with
   * `size="inline"` in a slot of its own, such as a header strip or a notices area, never over
   * the content. The kind colours the art's `currentColor` from the theme and is on the root
   * as `data-moment`.
   * @claim "`ask`: something the app, or an" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment ask > docks in the slot it is given as one row, is heard when asked, and comes back after dismissFor)
   * @default "empty"
   * @claim "`loading`: on its way, with a" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > shows a spinner for a loading moment without art, sized to the layout)
   * @claim "`welcome` is the same kind by" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > takes welcome as first-run's older name, and says first-run)
   * @claim "The kind colours the art's `currentColor`" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > names its kind in data-moment and colours the art from the theme by kind)
   */
  kind?: "empty" | "loading" | "error" | "first-run" | "welcome" | "success" | "ask" | (string & { 'Use "empty", "loading", "error", "first-run", "success" or "ask"; info is "empty"': never }) | undefined;
  /**
   * What happened or what is here, in a few words: "Inbox cleared". Required, because it is
   * what a screen reader finds.
   */
  title: string;
  /** One line on what to do or what it means: "Messages you send show up here." */
  description?: ReactNode;
  /**
   * The picture: any node, usually an inline SVG, which fills the art's height (160px, 96px
   * when the moment is narrower than 24rem, 24px inline; none when quiet). It is decorative
   * and hidden from screen readers unless you pass `artLabel`. Draw it with `currentColor`
   * and the theme's variables so it follows the kind, the theme and dark mode. With reduced
   * motion, its CSS animations stop and its SVG animations pause. Its motion has a budget too:
   * its loops settle at the end of their turn about 5 s after it appears, and with a `dismissKey`
   * or `id` its entrance plays once a session, so a moment that comes back as people switch
   * views or filters arrives still.
   * @claim "Its motion has a budget too:" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion budget > settles the art's loops at the end of their turn within 5 s, SVG animations too, and leaves other motion alone)
   * @claim "Its motion has a budget too:" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion budget > plays the art's entrance once a session for a moment with a key, and every time without one)
   * @claim "which fills the art's height (160px," registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > gives the art 160px, 96px in a pane narrower than 24rem, and 24px inline)
   * @claim "It is decorative and hidden from" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > hides the art from screen readers, or names it with artLabel)
   * @claim "With reduced motion, its CSS animations" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion > stops the art's CSS animations and pauses its SVG animations with reduced motion, and lets them run again after)
   */
  art?: ReactNode;
  /** Names the art for screen readers (`role="img"`), for a picture that says something the title does not. */
  artLabel?: string | undefined;
  /**
   * Which picture this is, such as a pose ("waving", "pedalling"), for checkers, tests and
   * styles: the art carries it as `data-moment-art`, which it has, empty, whenever there is
   * art. Not shown or spoken.
   * @claim "the art carries it as `data-moment-art`," registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > marks its art with data-moment-art, carrying artName)
   */
  artName?: string | undefined;
  /** The way forward, usually one `Button`: `action={<Button onClick={compose}>New message</Button>}`. */
  action?: ReactNode;
  /**
   * A second, quieter way, beside `action`: `secondaryAction={<Button variant="plain">Learn more</Button>}`. Two at most.
   * @claim "Two at most." registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > renders the art, an <h3> title, the line and up to two actions)
   */
  secondaryAction?: ReactNode;
  /**
   * The title's heading level. Pick the level below the section the moment sits in. Inline,
   * the title is plain text unless you pass one.
   * @default 3, and no heading with `size="inline"`
   * @claim "3, and no heading with" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > is one row inline, with a plain-text title unless given a heading level)
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6 | (number & { "Use 2 to 6, one below the section's heading": never }) | undefined;
  /**
   * `default` stacks the art, title, line and actions in the space it is given. `hero` does too,
   * with art up to 220px tall, for the main state of a large, otherwise empty pane; narrower than
   * 24rem it holds at 96px, as `default` does. `inline` is a single row with 24px art, for a
   * "working" row in a list or toolbar; in a slot too narrow for its words and its actions, the
   * actions move under the words.
   * @default "default"
   * @claim "`hero` does too, with art up" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > gives hero art 220px, and 96px in a pane narrower than 24rem)
   * @claim "in a slot too narrow for its" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment ask > moves its actions under its words in a slot too narrow for both, so the words keep their room)
   * @claim "`inline` is a single row with" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > gives the art 160px, 96px in a pane narrower than 24rem, and 24px inline)
   * @claim "`inline` is a single row with" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > is one row inline, with a plain-text title unless given a heading level)
   */
  size?: "default" | "hero" | "inline" | (string & { 'Use "default", "hero" or "inline"; for a compact moment use quiet': never }) | undefined;
  /**
   * Words only, in a compact row: the title and one line, with no art and no celebration (a
   * loading moment keeps its small spinner). For dense panes, and for people who want less:
   * `OuroProvider`'s `quiet` sets it for the whole app, and `MomentProvider` for a part of it.
   * @default the nearest `MomentProvider`'s `quiet`, else `OuroProvider`'s, else `false`
   * @claim "Words only, in a compact row:" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > keeps its words and drops its art and celebration under OuroProvider's quiet, unless MomentProvider or the prop says otherwise)
   * @claim "Words only, in a compact row:" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > renders a compact row from the prop or from MomentProvider, and the prop wins)
   */
  quiet?: boolean | undefined;
  /**
   * A short flourish when the moment appears: a soft disc swells from behind the art and four
   * sparks grow and fade, all inside the art's frame. With reduced motion only the disc fades.
   * Never when quiet or inline. Capped with `cap`.
   * @default `true` for `kind="success"`, otherwise `false`
   * @claim "A short flourish when the moment" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > stays in the page's flow, and its celebration stays inside the art's frame)
   * @claim "A short flourish when the moment" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion > swells the disc and grows the sparks when it celebrates, and with reduced motion only fades the disc)
   * @claim "Never when quiet or inline." registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > never celebrates when quiet or inline)
   * @claim "With reduced motion only the disc fades." registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion > swells the disc and grows the sparks when it celebrates, and with reduced motion only fades the disc)
   */
  celebrate?: boolean | undefined;
  /**
   * Shows the flourish at most `times` times `per` day, week, 30-day month or ever, counted in
   * `localStorage` under the moment's `dismissKey`, or its `id`; after that the moment is
   * quiet. Without a key the flourish shows every time the moment appears.
   * @claim "Without a key the flourish shows" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > celebrates every time without a cap, or without a key to count under)
   * @claim "Shows the flourish at most `times`" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > celebrates at most times per period, then again once the period has passed)
   */
  cap?: { times: number; per: "day" | "week" | "month" | "ever" | (string & { 'Use "day", "week", "month" or "ever"': never }) } | undefined;
  /**
   * Keeps a dismissal: once the person closes the moment, it stays closed on every visit and in
   * every tab, stored in `localStorage` as `ouro-moment:dismissed:<dismissKey>`. Shows the
   * close button. With it the moment renders nothing until the browser has said whether it
   * was dismissed, so a server-rendered page never flashes a closed moment.
   * @claim "Keeps a dismissal: once the person closes" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > stays dismissed through dismissKey, after a remount and in another tab)
   * @claim "With it the moment renders nothing" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > renders nothing on the server with a dismissKey, and everything without one)
   */
  dismissKey?: string | undefined;
  /**
   * How long a dismissal through `dismissKey` lasts: an hour, a day, a week or 30 days; then the
   * moment may show again. Without it a dismissal lasts for good. For an ask that may come back
   * later, but not straight away.
   * @claim "How long a dismissal through `dismissKey`" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment ask > docks in the slot it is given as one row, is heard when asked, and comes back after dismissFor)
   */
  dismissFor?: "hour" | "day" | "week" | "month" | (string & { 'Use "hour", "day", "week" or "month"': never }) | undefined;
  /**
   * Shows a quiet close button. Pressing it hides the moment, hands focus to what follows it,
   * and calls this.
   * @claim "Pressing it hides the moment, hands" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > closes from the keyboard, calls onDismiss and hands focus on)
   */
  onDismiss?: (() => void) | undefined;
  /** The close button's accessible name, for other languages. @default "Dismiss" */
  dismissLabel?: string | undefined;
  /**
   * Speaks a `success`, `error` or `ask` moment politely to screen readers when it appears: the title,
   * then the description when it is text. Other kinds are never spoken.
   * @claim "Other kinds are never spoken." registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > speaks a success or error moment politely only when asked)
   * @claim "Speaks a `success`, `error` or `ask`" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > speaks a success or error moment politely only when asked)
   */
  announce?: boolean | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development; use `kind` and `quiet`. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `art`: `<Moment art={<Illustration />}>`. */
  icon?: { 'Use art={<Illustration />}': never };
  /** Not a prop. Ouro UI uses `art`: `<Moment art={<Illustration />}>`. */
  illustration?: { 'Use art={<Illustration />}': never };
  /** Not a prop. Ouro UI uses `title`: `<Moment title="No messages yet">`. */
  heading?: { 'Use <Moment title="No messages yet">': never };
  /** Not a prop. Ouro UI uses `description`: `<Moment description="Messages you send show up here.">`. */
  body?: { 'Use <Moment description="Messages you send show up here.">': never };
  /** Not a prop. Ouro UI uses `action` and `secondaryAction`: `<Moment action={<Button>Retry</Button>}>`. */
  actions?: { 'Use action={<Button>Retry</Button>} and secondaryAction': never };
  /** Not a prop. Ouro UI uses `onDismiss`: `<Moment onDismiss={() => setOpen(false)}>`. */
  onClose?: { 'Use onDismiss={() => setOpen(false)}': never };
  /** Not a prop. Ouro UI uses `kind`: `<Moment kind="error">`. */
  variant?: { 'Use kind="error"': never };
}

/** Props for {@link Moment}: its own props and the div attributes it passes through. */
export type MomentProps = Omit<HTMLAttributes<HTMLDivElement>, keyof MomentOwnProps> & MomentOwnProps;

/** Props for {@link MomentProvider}. */
export interface MomentProviderProps {
  /**
   * Renders every `Moment` inside quiet, unless the moment sets `quiet` itself.
   * @default `OuroProvider`'s `quiet`
   * @claim "Renders every `Moment` inside quiet, unless" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > renders a compact row from the prop or from MomentProvider, and the prop wins)
   */
  quiet?: boolean | undefined;
  /** The part of the app it applies to. */
  children: ReactNode;
}

const MomentContext = createContext<boolean | undefined>(undefined);

/**
 * Sets `quiet` for every `Moment` inside it, so an app can make its moments compact
 * everywhere, for a dense layout or for people who asked for less. A moment's own `quiet`
 * wins.
 *
 * Use `Moment`'s `quiet` prop instead for one moment.
 *
 * @claim "Sets `quiet` for every `Moment` inside" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > renders a compact row from the prop or from MomentProvider, and the prop wins)
 *
 * @group Feedback
 * @see https://ui.ouroboros.bot/docs/moment
 *
 * @example
 * <MomentProvider quiet={settings.quietMoments}>
 *   <App />
 * </MomentProvider>
 */
export function MomentProvider({ quiet, children }: MomentProviderProps): JSX.Element {
  return <MomentContext value={quiet}>{children}</MomentContext>;
}

const levels = [2, 3, 4, 5, 6] as const;
const sizes = ["default", "hero", "inline"] as const;
const spoken = new Set<MomentKind>(["success", "error", "ask"]);

// A slot holds something to render unless it is undefined, null or false.
const present = (node: ReactNode) => node !== undefined && node !== null && node !== false;

function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-4">
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </svg>
  );
}

/**
 * A moment in an app's life, shown in the space it is given: nothing here yet, on its way,
 * something failed, a first run, or something finished. It holds art (any node, usually an
 * inline SVG), a title, one line and up to two actions. It renders in the page's flow and
 * never floats over what the person is using; its celebration stays inside the art's frame.
 *
 * Moments behave so they never get in the way: the art is decorative unless labelled, the
 * art's own motion stops with reduced motion, the close button keeps a dismissal through
 * `dismissKey`, `cap` limits how often a success celebrates, and `quiet` (or
 * `MomentProvider`) makes them compact. The root carries `data-moment` (the kind),
 * `data-celebrate` while it celebrates and `data-quiet` when quiet, and the art
 * `data-moment-art` (its `artName`).
 *
 * Use `Empty` instead for a plain empty list with an icon and no art, `Alert` for a message
 * about something that happened beside the content, `Skeleton` for the shape of content that
 * is loading, and `toast()` to confirm an everyday action.
 *
 * @claim "It holds art (any node, usually" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > renders the art, an <h3> title, the line and up to two actions)
 * @claim "Moments behave so they never get" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > hides the art from screen readers, or names it with artLabel)
 * @claim "Moments behave so they never get" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion > stops the art's CSS animations and pauses its SVG animations with reduced motion, and lets them run again after)
 * @claim "Moments behave so they never get" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > stays dismissed through dismissKey, after a remount and in another tab)
 * @claim "Moments behave so they never get" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > celebrates at most times per period, then again once the period has passed)
 * @claim "Moments behave so they never get" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment quiet > renders a compact row from the prop or from MomentProvider, and the prop wins)
 * @claim "It renders in the page's flow" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > stays in the page's flow, and its celebration stays inside the art's frame)
 * @group Feedback
 * @see https://ui.ouroboros.bot/docs/moment
 *
 * @example
 * <Moment
 *   art={<EmptyInbox />}
 *   title="No messages yet"
 *   description="Messages you send show up here."
 *   action={<Button onClick={compose}>New message</Button>}
 * />
 * <Moment kind="success" art={<Done />} title="All caught up" dismissKey="caught-up" cap={{ times: 1, per: "day" }} />
 */
export function Moment(props: MomentProps): JSX.Element | null {
  const {
    kind: kindProp = "empty",
    title,
    description,
    art,
    artLabel,
    artName,
    action,
    secondaryAction,
    headingLevel,
    size: sizeProp = "default",
    quiet: quietProp,
    celebrate,
    cap,
    dismissKey,
    dismissFor,
    onDismiss,
    dismissLabel = "Dismiss",
    announce,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    icon,
    illustration,
    heading,
    body,
    actions,
    onClose,
    variant,
    ...rest
  } = props;
  // `welcome` is first-run's older name.
  const named = kindProp === "welcome" ? "first-run" : kindProp;
  const kind: MomentKind = Object.hasOwn(kindToneClass, named) ? (named as MomentKind) : "empty";
  const provided = useContext(MomentContext);
  const ouro = useOuro();
  const quiet = quietProp ?? provided ?? ouro.quiet === true;
  const layout = sizeProp === "inline" ? "inline" : quiet ? "quiet" : "default";
  const level = headingLevel === undefined ? (layout === "inline" ? undefined : 3) : (levels as readonly unknown[]).includes(headingLevel) ? (headingLevel as (typeof levels)[number]) : 3;
  const per: MomentPeriod = cap !== undefined && Object.hasOwn(periods, cap.per) ? (cap.per as MomentPeriod) : "day";
  const times = cap === undefined ? undefined : Number.isInteger(cap.times) && cap.times >= 0 ? cap.times : 1;
  const key = dismissKey ?? rest.id;

  useAppearanceClassNameCheck(
    "Moment",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Moment takes its look from kind and quiet`
      : // Stryker disable next-line StringLiteral: production only; the check never runs there.
        /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Moment",
    process.env.NODE_ENV !== "production"
      ? () => [
          !title && ["title is required; it says what the moment is about", '<Moment title="No messages yet">'],
          kind !== named && [`kind="${String(kindProp)}" is not a kind; use "empty", "loading", "error", "first-run", "success", "ask"`, '<Moment kind="empty">'],
          !(sizes as readonly string[]).includes(sizeProp) && [`size="${String(sizeProp)}" is not a size; use "default", "hero", "inline"`, "<Moment quiet>"],
          headingLevel !== undefined && level !== headingLevel && [`headingLevel must be 2, 3, 4, 5 or 6, got ${String(headingLevel)}`, "<Moment headingLevel={2}>"],
          cap !== undefined && per !== cap.per && [`cap per "${String(cap.per)}" is not a period; use "day", "week", "month", "ever"`, '<Moment cap={{ times: 1, per: "day" }}>'],
          cap !== undefined && times !== cap.times && [`cap times must be a whole number, 0 or more, got ${String(cap.times)}`, '<Moment cap={{ times: 1, per: "day" }}>'],
          cap !== undefined && key === undefined && ["cap counts showings under dismissKey or id, and this moment has neither", '<Moment dismissKey="caught-up" cap={{ times: 1, per: "day" }}>'],
          announce === true && !spoken.has(kind) && [`announce speaks only success, error and ask moments, not kind="${kind}"`, '<Moment kind="success" announce>'],
          dismissFor !== undefined && !Object.hasOwn(dismissPeriods, dismissFor) && [`dismissFor="${String(dismissFor)}" is not a period; use "hour", "day", "week", "month"`, '<Moment dismissKey="ask" dismissFor="day">'],
          dismissFor !== undefined && dismissKey === undefined && ["dismissFor keeps a dismissal through dismissKey, and this moment has none", '<Moment dismissKey="ask" dismissFor="day">'],
          (icon !== undefined || illustration !== undefined) && [`${icon !== undefined ? "icon" : "illustration"} is not a prop`, "<Moment art={<Illustration />}>"],
          heading !== undefined && ["heading is not a prop", `<Moment title="${String(heading)}">`],
          body !== undefined && ["body is not a prop", `<Moment description="${String(body)}">`],
          actions !== undefined && ["actions is not a prop", "<Moment action={<Button>…</Button>} secondaryAction={<Button>…</Button>}>"],
          onClose !== undefined && ["onClose is not a prop", "<Moment onDismiss={() => setOpen(false)}>"],
          variant !== undefined && ["variant is not a prop", `<Moment kind="${Object.hasOwn(kindToneClass, String(variant)) ? String(variant) : "error"}">`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const forMs = dismissFor === undefined ? undefined : Object.hasOwn(dismissPeriods, dismissFor) ? dismissPeriods[dismissFor as keyof typeof dismissPeriods] : dismissPeriods.day;
  // A kept dismissal is read after hydration: until then a moment with a dismissKey renders nothing.
  const kept = useSyncExternalStore(
    subscribeMoments,
    () => dismissKey !== undefined && isDismissed(dismissKey, forMs, Date.now()),
    () => dismissKey !== undefined,
  );
  const [closed, setClosed] = useState(false);
  const visible = !kept && !closed;

  // The celebration starts a frame after the moment appears, once per appearance, within its cap.
  const celebratory = layout === "default" && (celebrate ?? kind === "success");
  const [celebrating, setCelebrating] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!celebratory || !visible) {
      requestAnimationFrame(() => setCelebrating(false));
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    if (key !== undefined && times !== undefined && !takeShowing(key, { times, per }, Date.now())) return;
    requestAnimationFrame(() => setCelebrating(true));
  }, [celebratory, visible, key, times, per]);
  const flourish = celebrating && celebratory;

  const speakText = typeof description === "string" ? `${title}. ${description}` : title;
  const speaks = announce === true && spoken.has(kind) && visible;
  useEffect(() => {
    if (speaks) speak(speakText);
  }, [speaks, speakText]);

  // SVG animations ignore CSS, so the art's are paused here while reduced motion is on.
  // Stryker disable next-line BooleanLiteral: the server's guess lasts only until hydration, and the effect that reads it runs after the live value replaces it.
  const reduced = useReducedMotion(false);
  const artRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = artRef.current;
    if (!reduced || !host) return;
    const svgs = [...host.querySelectorAll("svg")];
    for (const svg of svgs) svg.pauseAnimations();
    return () => svgs.forEach((svg) => svg.unpauseAnimations());
  }, [reduced, art]);

  // The art's own motion has a budget: its entrance plays once a session for a moment with a key,
  // and its loops settle, at the end of the turn they are on, a few seconds after it appears.
  // Whether this moment's key had already appeared is asked once per key, so a second run of the
  // effect, as React's StrictMode makes in development, does not count as a second showing.
  const repeat = useRef<{ key: string; seen: boolean }>(undefined);
  useLayoutEffect(() => {
    const host = artRef.current;
    if (!host || key === undefined) return;
    if (repeat.current?.key !== key) repeat.current = { key, seen: seenThisSession(key) };
    if (!repeat.current.seen) return;
    for (const animation of host.getAnimations({ subtree: true })) if (animation.effect!.getComputedTiming().endTime !== Infinity) animation.finish();
  }, [art, key]);
  useEffect(() => {
    const host = artRef.current;
    if (!host) return;
    const timer = setTimeout(() => {
      for (const animation of host.getAnimations({ subtree: true })) {
        const timing = animation.effect!.getComputedTiming();
        if (timing.endTime === Infinity) animation.effect!.updateTiming({ iterations: timing.currentIteration! + 1 });
      }
      for (const svg of host.querySelectorAll("svg")) {
        svg.pauseAnimations();
        svg.setCurrentTime(0);
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [art, kind]);

  const merged = useMergedRef(ref, useFocusHandoff<HTMLDivElement>());
  if (!visible) return null;

  const dismissible = onDismiss !== undefined || dismissKey !== undefined;
  const dismiss = () => {
    setClosed(true);
    if (dismissKey !== undefined) keepDismissed(dismissKey, forMs === undefined ? undefined : Date.now());
    onDismiss?.();
  };
  const hasArt = present(art) && !quiet;
  const spinner = !hasArt && kind === "loading";

  const titleNode =
    level === undefined ? (
      <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
    ) : (
      <Heading level={level} size={layout === "default" ? "md" : "sm"} className={layout === "default" ? undefined : "min-w-0 truncate text-nowrap"}>
        {title}
      </Heading>
    );
  const descriptionNode =
    !present(description) ? null : layout === "default" ? (
      <Text as="div" size="sm" tone="muted">
        {description}
      </Text>
    ) : (
      <Text as={layout === "inline" ? "span" : "div"} size="sm" tone="muted" truncate className="min-w-0">
        {description}
      </Text>
    );
  const hasActions = present(action) || present(secondaryAction);

  return (
    <div
      {...rest}
      ref={merged}
      data-ouro="moment"
      data-moment={kind}
      data-quiet={quiet ? "" : undefined}
      data-celebrate={flourish ? "" : undefined}
      data-open={flourish ? "" : undefined}
      className={cn(rootClass[layout], dismissible && layout === "default" && "pt-12", className)}
    >
      {spinner && (
        <span aria-hidden="true" data-ouro-moment-art="" className={cn("grid shrink-0 place-items-center", kindToneClass[kind])}>
          <Spinner size={layout === "default" ? "lg" : layout === "quiet" ? "md" : "sm"} />
        </span>
      )}
      {hasArt && (
        <div data-ouro-moment-frame="" className={cn(artFrameClass[layout === "inline" ? "inline" : sizeProp === "hero" ? "hero" : "default"], kindToneClass[kind])}>
          {flourish && <span aria-hidden="true" data-ouro-part="halo" className={haloClass} />}
          {flourish &&
            sparkClasses.map((spark) => (
              <svg key={spark} aria-hidden="true" viewBox="0 0 12 12" data-ouro-part="sparkle" className={cn(sparkleClass, spark)}>
                <path d="M6 0Q6.7 5.3 12 6 6.7 6.7 6 12 5.3 6.7 0 6 5.3 5.3 6 0Z" fill="currentColor" />
              </svg>
            ))}
          <div
            ref={artRef}
            {...(artLabel ? { role: "img", "aria-label": artLabel } : { "aria-hidden": true })}
            data-ouro-moment-art=""
            data-moment-art={artName ?? ""}
            className="relative flex h-(--ouro-moment-art) max-w-full items-center justify-center *:h-(--ouro-moment-art) *:w-auto *:max-w-full motion-reduce:**:[animation:none]!"
          >
            {art}
          </div>
        </div>
      )}
      <div className={layout === "default" ? "flex min-w-0 flex-col items-center gap-1.5" : layout === "quiet" ? "flex min-w-0 flex-1 flex-col" : "flex min-w-0 flex-[1_1_12rem] items-baseline gap-2"}>
        {titleNode}
        {descriptionNode}
      </div>
      {hasActions && (
        <div data-ouro-moment-actions="" className={layout === "default" ? "flex flex-wrap items-center justify-center gap-2 pt-1" : "flex shrink-0 items-center gap-2"}>
          {action}
          {secondaryAction}
        </div>
      )}
      {dismissible && (
        <Button
          variant="plain"
          tone="secondary"
          size="sm"
          aria-label={dismissLabel}
          data-ouro-control="moment"
          data-ouro-part="dismiss"
          onClick={dismiss}
          className={cn("w-(--ouro-button-h) shrink-0 px-0", layout === "default" ? "absolute end-2 top-2" : "-me-1")}
        >
          <CloseIcon />
        </Button>
      )}
    </div>
  );
}
