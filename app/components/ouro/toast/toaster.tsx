"use client";

import { Toast } from "@base-ui/react/toast";
import type { BaseUIEvent } from "@base-ui/react/types";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "~/lib/ouro/cn";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { devWarn } from "~/lib/ouro/dev";
import { useFocusHandoff, type FocusHandoffOptions } from "~/lib/ouro/focus-handoff";
import { useMergedRef } from "~/lib/ouro/refs";
import { rubberband, spring, type SpringHandle } from "~/lib/ouro/spring";
import { connectToaster, type ToastRecord } from "~/lib/ouro/toast";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useDrag, type DragState } from "~/lib/ouro/use-drag";
import { PortalScope } from "~/lib/ouro/portal-container";
import {
  actionClass,
  closeClass,
  contentClass,
  iconTones,
  portalClass,
  rootClass,
  viewportClass,
} from "~/components/ouro/toast/toaster-styles";

/** Props for {@link Toaster}. */
export interface ToasterProps {
  /**
   * Layout classes on the actual portaled toast viewport, not on each toast.
   * For example, `bottom-[calc(5rem+max(1rem,env(safe-area-inset-bottom)))]`
   * clears persistent bottom controls. A bottom override replaces the default
   * safe-area expression; include the appropriate inset in your own clearance.
   * Use statically written classes matching your app's visibility/breakpoints,
   * which need not match the Toaster's `sm` breakpoint.
   * @claim "Layout classes on the actual portaled" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > updates viewport layout without replacing or reannouncing a live toast or resetting its countdown)
   * @claim "Layout classes on the actual portaled" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > lets unprefixed app clearance and width win on the actual viewport at phone and desktop widths)
   */
  className?: string | undefined;
  /**
   * The name screen readers give the region the toasts appear in. Translate it with the
   * rest of your interface.
   * @default "Notifications"
   */
  label?: string | undefined;
  /**
   * The accessible name of each toast's dismiss button, which shows an icon only.
   * @default "Dismiss"
   * @claim "The accessible name of each toast's" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > translates the region name and the dismiss button with label and closeLabel)
   */
  closeLabel?: string | undefined;

  /** Not a prop. Toasts default to the bottom: full width on phones, at the bottom end from `sm`; className adjusts viewport layout. */
  position?: { 'Not a prop: toasts show at the bottom. Use <Toaster />': never };
  /**
   * Not a prop. Each toast takes its own `tone`: `toast("Saved", { tone: "success" })`.
   *
   * @claim "Each toast takes its own `tone`" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > marks the tone and shows an icon for every tone but secondary)
   */
  richColors?: { 'Use toast("Saved", { tone: "success" })': never };
  /** Not a prop. Dark mode follows the `.dark` class, as in shadcn. */
  theme?: { 'Not a prop: dark mode follows the .dark class. Use <Toaster />': never };
  /**
   * Not a prop. Each toast takes its own `duration`: `toast("Saved", { duration: 8000 })`.
   *
   * @claim "Each toast takes its own `duration`" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > dismisses itself after duration; 0 and Infinity keep it)
   */
  duration?: { 'Use toast("Saved", { duration: 8000 })': never };
}

/**
 * Shows the toasts you send with `toast("Saved")` from `@/lib/ouro/toast`: render it
 * once, at the root of your app, inside `OuroProvider` if you use one, or alone. Adding
 * Toaster installs `toast` with it. Toasts stack at the
 * bottom of the screen, full width on phones by default; `className` adjusts viewport
 * layout/clearance, not each toast's appearance. Up to three show, and later ones wait their
 * turn, a `destructive` toast ahead of the others. They pause while the pointer is over them or a toast has focus, F6 moves focus to
 * them, newest first, and a swipe down or sideways dismisses one: a toast follows the
 * finger, a quick flick is enough, and one let go short of that springs back. Each toast is read to
 * screen readers once, its message and description: politely, and a `destructive` toast
 * assertively, so it interrupts. Every toast and its buttons stay reachable by screen readers, a
 * touch screen reader too, while the stack is collapsed, and focus in a toast fans the stack out
 * and pauses it, however it got there, even while a pointer passes over and away.
 *
 * Render one Toaster. A second one warns in development and shows nothing until the
 * first unmounts, then takes over.
 *
 * The viewport is portaled to the body. A variable set only on an app-shell wrapper
 * does not reach it: put app clearance variables on a real ancestor of the portal
 * (such as `:root`) or declare them through the viewport's supplied classes.
 * Do not construct arbitrary-value class names from runtime numbers. A width override
 * changes the width, not the anchoring mode or centering. Bottom overrides replace
 * the default phone safe-area expression; the app owns its clearance and safe area.
 * Shared `--popover`, `--popover-foreground` and `--radius` theme tokens style the
 * toast surface and also affect other components; a wrapper cannot style this portal.
 *
 * Use `Alert` instead for a message that stays on the page, and `Dialog` when the user
 * must answer before going on.
 *
 * @group Feedback
 * @see https://ui.ouro.bot/docs/toaster
 *
 * @example
 * <OuroProvider>
 *   <App />
 *   <Toaster />
 * </OuroProvider>
 * // Anywhere in the app:
 * toast("Recipe saved", { tone: "success" });
 * @claim "Toasts stack at the bottom of" registry/ouro/components/ouro/toast/toaster.tsx verify:fileLine(registry/ouro/components/ouro/toast/toaster.tsx, /^import\s\{\sconnectToaster,\stype\sToastRecord\s\}\sfrom\s"@\/registry\/ouro\/lib\/ouro\/toast";/)
 * @claim "Up to three show, and later" registry/ouro/components/ouro/toast/toaster.tsx verify:fileLine(registry/ouro/components/ouro/toast/toaster.tsx, /^import\s\{\sconnectToaster,\stype\sToastRecord\s\}\sfrom\s"@\/registry\/ouro\/lib\/ouro\/toast";/)
 * @claim "They pause while the pointer is" registry/ouro/components/ouro/toast/toaster.tsx verify:fileLine(registry/ouro/components/ouro/toast/toaster.tsx, /^import\s\{\sconnectToaster,\stype\sToastRecord\s\}\sfrom\s"@\/registry\/ouro\/lib\/ouro\/toast";/)
 * @claim "Each toast is read to screen" registry/ouro/components/ouro/toast/toaster.tsx verify:fileLine(registry/ouro/components/ouro/toast/toaster.tsx, /^import\s\{\sconnectToaster,\stype\sToastRecord\s\}\sfrom\s"@\/registry\/ouro\/lib\/ouro\/toast";/)
 * @claim "Every toast and its buttons stay" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps every toast, its action and its dismiss button reachable by a screen reader while the stack rests collapsed)
 * @claim "and focus in a toast fans" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > fans the stack out and waits while focus is in a toast though no key moved it there, as a screen reader moves it, and folds it when focus leaves)
 * @claim "and focus in a toast fans" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps the stack fanned out and waiting while focus is in a toast and a pointer passes over and away)
 * @claim "Each toast is read to screen" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > is announced once, its message and description only: politely, and a destructive toast assertively (Review Focus 5))
 * @claim "They pause while the pointer is" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 * @claim "They pause while the pointer is" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while a toast has keyboard focus; F6 moves focus to the toasts)
 * @claim "Toasts stack at the bottom of" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 * @claim "Up to three show, and later" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 * @claim "They pause while the pointer is" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 * @claim "Each toast is read to screen" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 */
export function Toaster(props: ToasterProps): JSX.Element | null {
  const { className, label = "Notifications", closeLabel = "Dismiss", position, richColors, theme, duration } = props;
  const [active, setActive] = useState(false);
  useAppearanceClassNameCheck(
    "Toaster",
    className,
    process.env.NODE_ENV !== "production"
      ? ":root { --popover: var(--background); --popover-foreground: var(--foreground); --radius: 0.5rem; } (shared theme tokens affect other components too)"
      : /* istanbul ignore next @preserve -- production only */ "",
    process.env.NODE_ENV !== "production"
      ? "Toaster owns toast-content alignment; use <Toaster /> without the alignment class"
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Toaster",
    process.env.NODE_ENV !== "production"
      ? () => [
          position !== undefined && ["position is not a prop; toasts show at the bottom, full width on phones", "<Toaster />"],
          richColors !== undefined && ["richColors is not a prop", 'toast("Saved", { tone: "success" })'],
          theme !== undefined && ["theme is not a prop; dark mode follows the .dark class", "<Toaster />"],
          duration !== undefined && ["duration is not a prop", `toast("Saved", { duration: ${String(duration)} })`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <Toast.Provider limit={VISIBLE}>
      <Connect onActive={setActive} />
      {active && (
        <Toast.Portal className={portalClass}>
          <PortalScope>
            <Toast.Viewport
              aria-label={label}
              // Not a live region: the announcer inside speaks each toast, so the buttons in the
              // toasts are never read out as they arrive and need not be hidden to stay quiet.
              aria-live={undefined}
              aria-atomic={undefined}
              aria-relevant={undefined}
              data-ouro="toaster"
              className={cn(viewportClass, className)}
              onFocus={onViewportFocus}
              onBlur={onViewportBlur}
              onMouseLeave={onViewportMouseLeave}
            >
              <ToastList closeLabel={closeLabel} />
              <ToastAnnouncer />
            </Toast.Viewport>
          </PortalScope>
        </Toast.Portal>
      )}
    </Toast.Provider>
  );
}

/** Whether a toast waits ahead of the others: a destructive one. */
const urgent = (record: ToastRecord) => record.tone === "destructive";

/** How many toasts show at once; later ones wait in the Toaster's queue. */
const VISIBLE = 3;
/** How many toasts may wait before development warns that the app sends too many; more may still wait. */
const MAX_WAITING_HINT = 10;

/**
 * Connects this Toaster to `toast()`. Up to three toasts are in Base UI's manager at a time;
 * later ones wait here, first in first out, and are added, with their countdown, when a
 * slot frees. Another Toaster already connected keeps this one waiting until it unmounts.
 * @claim "Up to three toasts are in" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > queues: up to three show, and later ones wait, out of the page, until a slot frees)
 * @claim "Up to three toasts are in" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > starts a waiting toast's countdown only when it shows, so it shows for its full duration and is announced once)
 */
function Connect({ onActive }: { onActive: (active: boolean) => void }): null {
  // add and close are the store's own methods, stable for the Toaster's life. The queue
  // lives as long as the Toaster too, across StrictMode's second effect run.
  const { add, close } = Toast.useToastManager();
  const state = useRef({ shown: new Set<string>(), queue: [] as ToastRecord[] });
  const key = useRef({});
  useEffect(() => {
    const { shown } = state.current;
    const next = () => {
      while (shown.size < VISIBLE && state.current.queue.length > 0) {
        const [record, ...rest] = state.current.queue;
        state.current.queue = rest;
        show(record!);
      }
    };
    const show = (record: ToastRecord) => {
      shown.add(record.id);
      add({
        id: record.id,
        title: record.message,
        description: record.description,
        type: record.tone,
        timeout: record.timeout,
        // Never Base UI's "high": it hides such a toast, buttons and all, from screen readers until
        // focused, and speaks it from an alert of its own. ToastAnnouncer speaks a destructive toast
        // assertively instead, and the toast stays reachable.
        // Stryker disable next-line StringLiteral: Base UI treats every priority but "high" as "low".
        priority: "low",
        onRemove: () => {
          shown.delete(record.id);
          // Base UI removes the toast by its index after this call returns, so adding the
          // next one here would shift the list under it; add it once the removal is done.
          queueMicrotask(next);
        },
        actionProps: record.action
          ? {
              children: (
                <>
                  <TouchTarget />
                  {record.action.label}
                </>
              ),
              onClick: () => {
                record.action!.onClick();
                close(record.id);
              },
            }
          : undefined,
      });
    };
    const { disconnect, active } = connectToaster({
      add: (record) => {
        const { queue } = state.current;
        const waiting = queue.find((item) => item.id === record.id);
        if (shown.has(record.id)) show(record);
        else if (waiting && urgent(waiting) === urgent(record)) state.current.queue = queue.map((item) => (item.id === record.id ? record : item));
        else {
          // Destructive toasts wait ahead of the others, first in first out among themselves;
          // they never push out a toast that is showing. A waiting toast replaced with a tone
          // that changes its group moves to the end of the destructive ones.
          const rest = queue.filter((item) => item.id !== record.id);
          const firstOther = rest.findIndex((item) => !urgent(item));
          const end = firstOther === -1 ? rest.length : firstOther;
          const at = urgent(record) || waiting ? end : rest.length;
          state.current.queue = [...rest.slice(0, at), record, ...rest.slice(at)];
          next();
          /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
          if (process.env.NODE_ENV !== "production" && state.current.queue.length > MAX_WAITING_HINT) {
            devWarn(
              "Toaster",
              `more than ${MAX_WAITING_HINT} toasts are waiting to show`,
              'send fewer toasts, or update one in place with toast("…", { id })',
              key.current,
            );
          }
        }
      },
      close: (id) => {
        state.current.queue = id === undefined ? [] : state.current.queue.filter((item) => item.id !== id);
        if (id === undefined || shown.has(id)) close(id);
      },
      activate: () => onActive(true),
    });
    /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
    if (!active && process.env.NODE_ENV !== "production") {
      devWarn(
        "Toaster",
        "another <Toaster /> is already mounted, so this one shows toasts only after that one unmounts",
        "render <Toaster /> once, at the root of your app",
        key.current,
      );
    }
    return () => {
      disconnect();
      onActive(false);
    };
  }, [add, close, onActive]);
  return null;
}

/**
 * The toasts, newest first in the page as Base UI orders them, so F6 then Tab reaches the
 * newest and goes on to each older one. Each is announced as it arrives.
 * @claim "The toasts, newest first in the" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 * @claim "The toasts, newest first in the" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard > reaches and runs the oldest toast's action with F6, then Tab)
 * @claim "Each is announced as it arrives" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > is announced once, its message and description only: politely, and a destructive toast assertively (Review Focus 5))
 * @claim "Each is announced as it arrives" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > starts a waiting toast's countdown only when it shows, so it shows for its full duration and is announced once)
 */
function ToastList({ closeLabel }: { closeLabel: string }): JSX.Element[] {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => <ToastItem key={item.id} item={item} closeLabel={closeLabel} />);
}

type ToastObject = ReturnType<typeof Toast.useToastManager>["toasts"][number];

/**
 * Where focus was before it entered each toast region, so a toast that leaves with it can send it back there.
 *
 * @claim "Where focus was before it entered" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > hands focus to %s when its dismiss button closes it from the keyboard)
 */
const cameFrom = new WeakMap<Element, HTMLElement>();

function rememberEntry(event: FocusEvent<HTMLElement>): void {
  const from = event.relatedTarget;
  // Focus that comes from nowhere (a handoff from a toast that left, after focus fell to <body>)
  // keeps the place it entered from.
  if (from instanceof HTMLElement && !event.currentTarget.contains(from)) cameFrom.set(event.currentTarget, from);
}

/**
 * Focus in the toasts fans the stack out and pauses it, however it came. Base UI does so only for
 * keyboard focus (`:focus-visible`), so a screen reader that moves focus to a toast behind the
 * front one, or a script, would leave it covered and fading out while it is read. A hover says the
 * same to Base UI, so the region gets one, as a finger's press does in `useSwipeAway`.
 *
 * @claim "Focus in the toasts fans the stack out" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > fans the stack out and waits while focus is in a toast though no key moved it there, as a screen reader moves it, and folds it when focus leaves)
 */
function onViewportFocus(event: FocusEvent<HTMLElement>): void {
  rememberEntry(event);
  hover(event.currentTarget, true);
}

/**
 * Tells Base UI's region that a pointer came in or left (its onMouseEnter and onMouseLeave), and
 * no component around the Toaster. React makes both from `mouseout`: one from the region's
 * parent, Base UI's portal node, to the region enters the region alone, and one back leaves it
 * alone. The page sees only that `mouseout`, between two nodes of the toasts, and no move.
 *
 * @claim "and no component around the Toaster" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > tells nothing outside the toasts that a pointer came or went when focus fans the stack out and folds it)
 * @claim "The page sees only that `mouseout`" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > tells nothing outside the toasts that a pointer came or went when focus fans the stack out and folds it)
 */
function hover(region: HTMLElement, entering: boolean): void {
  // Base UI always renders the region in its portal node.
  const parent = region.parentElement!;
  const [from, to] = entering ? [parent, region] : [region, parent];
  from.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }));
}

/**
 * A pointer leaving the toasts leaves the stack fanned out while focus is in one, as Base UI
 * does for keyboard focus; focus leaving folds it then.
 *
 * @claim "A pointer leaving the toasts leaves" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps the stack fanned out and waiting while focus is in a toast and a pointer passes over and away)
 */
function onViewportMouseLeave(event: BaseUIEvent<ReactMouseEvent<HTMLElement>>): void {
  if (event.currentTarget.contains(document.activeElement)) event.preventBaseUIHandler();
}

/**
 * Focus that leaves a toast folds the stack, unless the pointer is over it. Focus moving on to
 * another toast fans it out again in the same task, so React renders no fold between.
 *
 * @claim "Focus that leaves a toast folds the stack" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps the stack fanned out while focus moves from toast to toast, and while the pointer is over it after focus leaves)
 * @claim "Focus moving on to another toast" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps the stack fanned out while focus moves from toast to toast, and while the pointer is over it after focus leaves)
 */
function onViewportBlur(event: FocusEvent<HTMLElement>): void {
  const region = event.currentTarget;
  if (!region.matches(":hover")) hover(region, false);
}

/** How long a live region is on the page before it is given text: Safari drops text added to a newer one (see `announce`). */
const LIVE_REGION_SETTLE_MS = 100;

/**
 * How long a toast's words stay in the live regions once said: long enough to be read out, then
 * they leave, so a screen reader moving through the Notifications landmark meets each toast once.
 *
 * @claim "How long a toast's words stay" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > says a description's words without copying its link, and lets the words go a few seconds after they are said)
 */
const SPOKEN_FOR_MS = 7000;

/** Visually hidden, but read. Inline, so it works without the stylesheet. */
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: "0",
  border: "0",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
} as const;

/** What the live regions say for one toast: its words as shown, and when they were first said. */
interface Spoken {
  id: string;
  /** Changes when the toast is replaced with new words, so the new ones are an addition. */
  key: string;
  destructive: boolean;
  lines: string[];
  at: number;
}

/**
 * What screen readers hear as a toast shows: its message and description, once, from a polite
 * live region, or an assertive one (`role="alert"`) for a destructive toast, so it interrupts. A
 * toast replaced in place is heard again with its new words, and one that leaves says nothing.
 * The regions hold only the words, read from the toast as shown, so a link or button in a
 * description is never there twice, and the words leave after a few seconds. The toasts
 * themselves are not a live region, so their action and dismiss buttons are never read out as
 * they arrive, and nothing in them needs hiding: a touch screen reader reaches every toast and
 * button. The regions sit last in the Notifications landmark, after the toasts they speak for.
 *
 * @claim "What screen readers hear as a" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > is announced once, its message and description only: politely, and a destructive toast assertively (Review Focus 5))
 * @claim "A toast replaced in place is" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > announces a toast again when it is replaced with new text, and not when it leaves)
 * @claim "The regions hold only the words" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > says a description's words without copying its link, and lets the words go a few seconds after they are said)
 * @claim "a touch screen reader reaches every" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps every toast, its action and its dismiss button reachable by a screen reader while the stack rests collapsed)
 */
function ToastAnnouncer(): JSX.Element {
  const { toasts } = Toast.useToastManager();
  const anchor = useRef<HTMLDivElement>(null);
  const settled = useSettled();
  // Stryker disable next-line ArrayDeclaration: an entry with no time is never shown, and the first reading of the toasts replaces the list.
  const [spoken, setSpoken] = useState<Spoken[]>([]);
  // Read after the toasts are on the page and before it paints, so each toast's words arrive whole.
  useLayoutEffect(() => {
    if (!settled) return;
    const region = anchor.current!.closest('[data-ouro="toaster"]')!;
    setSpoken((before) => wordsOf(region, toasts, before, Date.now()));
  }, [settled, toasts]);
  const current = useUnexpired(spoken);
  return (
    <div ref={anchor} data-ouro-toast-announcer="" style={visuallyHidden}>
      <div aria-live="polite" aria-relevant="additions text">
        <SpokenWords entries={current.filter((entry) => !entry.destructive)} />
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" aria-relevant="additions text">
        <SpokenWords entries={current.filter((entry) => entry.destructive)} />
      </div>
    </div>
  );
}

/** Whether the live regions have been on the page LIVE_REGION_SETTLE_MS, so text given to them is read. */
function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(
    () => {
      const timer = setTimeout(() => setSettled(true), LIVE_REGION_SETTLE_MS);
      // Stryker disable next-line ArrowFunction: React ignores a state set after unmount, so clearing only tidies.
      return () => clearTimeout(timer);
    },
    // Stryker disable next-line ArrayDeclaration: any list that never changes runs it once, as this one does.
    [],
  );
  return settled;
}

/**
 * The toasts' words as `region` shows them, leaving out a toast with none. A toast whose words are
 * unchanged keeps its entry from `before`, so they are not said again.
 *
 * @claim "leaving out a toast with none" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > says nothing for a toast with no words, and only the description of one with no message)
 * @claim "A toast whose words are unchanged" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > says a toast's words once while other toasts come and go)
 */
function wordsOf(region: Element, toasts: ToastObject[], before: Spoken[], at: number): Spoken[] {
  return toasts
    .map((item) => ({ item, lines: shownLines(region, item.id) }))
    .filter(({ lines }) => lines.length > 0)
    .map(({ item, lines }) => {
      const was = before.find((entry) => entry.id === item.id);
      if (was && JSON.stringify(was.lines) === JSON.stringify(lines)) return was;
      return { id: item.id, key: `${item.id} ${at}`, destructive: item.type === "destructive", lines, at };
    });
}

/** The message and description the toast with this id shows in `region`, leaving out an empty one. */
function shownLines(region: Element, id: string): string[] {
  // ToastList renders every toast the manager lists, so each is on the page by now.
  const shown = [...region.querySelectorAll("[data-ouro-toast-id]")].find((element) => element.getAttribute("data-ouro-toast-id") === id)!;
  return [shown.querySelector("[data-ouro-toast-title]")?.textContent ?? "", shown.querySelector("[data-ouro-toast-description]")?.textContent ?? ""].filter(Boolean);
}

/** The words not yet said for SPOKEN_FOR_MS, rendering again when the oldest of them is due to go. */
function useUnexpired(spoken: Spoken[]): Spoken[] {
  const [now, setNow] = useState(0);
  const current = spoken.filter((entry) => now - entry.at < SPOKEN_FOR_MS);
  const first = Math.min(...current.map((entry) => entry.at));
  useEffect(() => {
    if (first === Infinity) return;
    const timer = setTimeout(() => setNow(first + SPOKEN_FOR_MS), first + SPOKEN_FOR_MS - Date.now());
    // Stryker disable next-line ArrowFunction: a timer left from an earlier first sets the time it was due, already past, so it hides nothing early.
    return () => clearTimeout(timer);
  }, [first]);
  return current;
}

/** The toasts' words in one live region, a line to a message or description. */
function SpokenWords({ entries }: { entries: Spoken[] }): JSX.Element[] {
  return entries.map((entry) => (
    <div key={entry.key}>
      {entry.lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  ));
}

/**
 * A toast hands focus to the next toast, and never past its region to some other control of the
 * page (a footer link): when it was the last, focus goes back where it was before it entered the
 * toasts, or stays on the page when it came from nowhere.
 *
 * @claim "A toast hands focus to the next toast" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > hands focus to %s when its dismiss button closes it from the keyboard) verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > leaves focus on the page when the last toast goes and focus came from nowhere, rather than moving it to the page's last control)
 */
function toastHandoff(element: HTMLDivElement): FocusHandoffOptions {
  const region = element.closest('[data-ouro="toaster"]')!;
  return { within: region, fallback: cameFrom.get(region) ?? null };
}

/** One toast. The swipe is Ouro's own, so Base UI's is off. */
function ToastItem({ item, closeLabel }: { item: ToastObject; closeLabel: string }): JSX.Element {
  const { close } = Toast.useToastManager();
  const destructive = item.type === "destructive";
  const swipe = useSwipeAway(() => close(item.id), item.transitionStatus === "ending");
  // A toast its dismiss button or action closes hands focus to the next toast, or back to the page.
  const ref = useMergedRef(swipe.ref, useFocusHandoff<HTMLDivElement>(toastHandoff));
  return (
    <Toast.Root
      toast={item}
      swipeDirection={NO_SWIPE}
      {...swipe}
      ref={ref}
      data-ouro="toast"
      data-ouro-toast-id={item.id}
      data-tone={item.type}
      // A destructive toast is an alertdialog, an urgent part of its own.
      role={destructive ? "alertdialog" : "dialog"}
      data-ouro-control="toaster"
      data-ouro-part={destructive ? "alert" : "toast"}
      className={rootClass}
    >
      <Toast.Content className={contentClass}>
        <ToneIcon tone={item.type} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Toast.Title render={<div />} data-ouro-toast-title="" className="m-0 text-sm font-medium text-popover-foreground" />
          <Toast.Description render={<div />} data-ouro-toast-description="" className="m-0 text-sm text-muted-foreground" />
        </div>
        <Toast.Action data-ouro-control="toaster" data-ouro-part="action" className={actionClass} />
        {/* Base UI hides this from assistive technology while the stack is collapsed. A touch
            screen reader could then never reach it, since it cannot focus or hover the stack first. */}
        <Toast.Close aria-label={closeLabel} aria-hidden={undefined} data-ouro-control="toaster" data-ouro-part="close" className={closeClass}>
          <TouchTarget />
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-4">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  );
}

const NO_SWIPE: [] = [];
/** How far, in px, a toast let go without a flick must be from rest to leave. */
const AWAY = 40;
/**
 * A press on one of these never starts a swipe: the action, the dismiss button, a link or a control in the message, and anything an app marks `data-swipe-ignore`. The list Base UI's swipe used.
 *
 * @claim "A press on one of these" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::swiping > takes its press from the first pointer: a second one on a button does not stop the swipe, and one that began on a button starts none)
 * @claim "A press on one of these" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::swiping > starts no swipe from content marked data-swipe-ignore or data-base-ui-swipe-ignore, as before)
 */
const CONTROLS = 'button,a,input,textarea,[role="button"],[data-base-ui-swipe-ignore],[data-swipe-ignore]';

type Axis = "x" | "y";

/**
 * The swipe that dismisses a toast: sideways either way, or down, off the edge it came in
 * from. The toast follows the finger from where it is taken, after 10px that choose the
 * axis. Up is the one way it cannot leave, so there it follows less and less. Let go, a
 * flick away from rest dismisses it however short, and so does a release more than 40px
 * from rest that is not on its way back; anything else springs back from where it is,
 * with the speed it was let go at, and can be caught again on the way. A dismissed toast
 * goes on the way it was thrown while it fades. With reduced motion it still follows the
 * finger, then returns or fades with no travel.
 *
 * The offset is the element's `translate`, which adds to the `transform` the stack sets.
 * @claim "The toast follows the finger from" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > moves 1:1 from where it was taken, either way, once 10px have chosen sideways)
 * @claim "With reduced motion it still follows" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > moves 1:1 from where it was taken, either way, once 10px have chosen sideways)
 * @claim "The toast follows the finger from" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > is taken without a jump when caught above rest, where it was held back)
 * @claim "With reduced motion it still follows" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > is taken without a jump when caught above rest, where it was held back)
 */
function useSwipeAway(dismiss: () => void, ending: boolean) {
  const state = useRef<SwipeState>({ element: null, axis: null, offset: 0, grab: 0, pressed: { x: false, y: false }, moved: false, leaving: false, control: false, settle: undefined });

  const write = useCallback((offset: number) => {
    const now = state.current;
    now.offset = offset;
    now.element!.style.translate = offset === 0 ? "" : now.axis === "x" ? `${offset}px 0px` : `0px ${offset}px`;
  }, []);
  /** The toast's size along the axis: what a rubber band stretches against, and how far out a dismissed toast is thrown. */
  const size = useCallback(() => {
    const { axis, element } = state.current;
    return axis === "x" ? element!.offsetWidth : element!.offsetHeight;
  }, []);
  const settle = useCallback(
    (velocity = 0, flick = false) => {
      const now = state.current;
      now.settle = spring({
        from: now.offset,
        to: 0,
        velocity,
        damping: flick ? 0.8 : 1,
        element: now.element,
        onUpdate: write,
        onRest: () => {
          now.axis = null;
        },
      });
    },
    [write],
  );

  // A toast sent again with the id of one that is on its way out comes back on the same
  // element (Base UI keeps it). It starts over: at rest, not swiped, and the finger's to take.
  useLayoutEffect(() => {
    const now = state.current;
    if (ending || !now.leaving) return;
    now.settle?.stop();
    now.leaving = false;
    now.element!.removeAttribute("data-ouro-swiped");
    write(0);
    now.axis = null;
  }, [ending, write]);

  // Two drags, one per axis, on the one element: the first to move 10px its way has the toast.
  const press = useCallback((axis: Axis, event: PointerEvent) => {
    const now = state.current;
    now.pressed[axis] = true;
    now.moved = false;
    // A press on a control holds the toast still, as any press does, so the tap lands; it starts no swipe.
    now.control = (event.target as Element).closest(CONTROLS) !== null;
    // Hold still under the finger, where the spring had brought it.
    now.settle?.stop();
  }, []);
  const pressEnd = useCallback(
    (axis: Axis) => {
      const now = state.current;
      now.pressed[axis] = false;
      // Neither axis took the press: carry on back to rest.
      if (!now.pressed.x && !now.pressed.y && !now.moved && now.offset !== 0) settle();
    },
    [settle],
  );
  const start = useCallback(
    (axis: Axis) => {
      const now = state.current;
      // One drag at a time, and a toast caught off rest moves along the axis it is off on.
      if (now.control || now.moved || (now.offset !== 0 && now.axis !== axis)) return false;
      now.axis = axis;
      now.moved = true;
      now.pressed[axis] = false;
      // Above rest the toast is held back: start from the finger travel that puts it there.
      now.grab = axis === "y" && now.offset < 0 ? unband(now.offset, size()) : now.offset;
      return true;
    },
    [size],
  );
  const move = useCallback(
    (axis: Axis, { delta }: DragState) => {
      const wanted = state.current.grab + delta;
      // Following a finger is not an animation: the toast does it with reduced motion too.
      write(axis === "y" && wanted < 0 ? rubberband(wanted, size()) : wanted);
    },
    [size, write],
  );
  const end = (axis: Axis, { velocity, flick, cancelled }: DragState & { cancelled: boolean }) => {
    const now = state.current;
    const { offset } = now;
    // Whether the finger was moving the toast away from rest when it lifted.
    const toward = velocity * offset;
    const canLeave = axis === "x" || offset > 0;
    if (cancelled || !canLeave || !(flick ? toward > 0 : Math.abs(offset) > AWAY && toward >= 0)) return settle(cancelled ? 0 : velocity, flick && !cancelled);
    now.leaving = true;
    // Before the close: a swiped toast fades on its way, and does not slide down as a closed one does.
    now.element!.setAttribute("data-ouro-swiped", "");
    // With reduced motion it fades where it is.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      now.settle = spring({ from: offset, to: offset + Math.sign(offset) * size() * 1.5, velocity, onUpdate: write });
    }
    dismiss();
  };
  const x = useDrag({
    axis: "x",
    onPress: (event) => press("x", event),
    onPressEnd: () => pressEnd("x"),
    onStart: () => start("x"),
    onMove: (drag) => move("x", drag),
    onEnd: (drag) => end("x", drag),
  });
  const y = useDrag({
    axis: "y",
    // The toast takes every touch (`touch-none`), so no move is a scroll: sideways travel is the other drag's.
    crossAxis: "ignore",
    onPress: (event) => press("y", event),
    onPressEnd: () => pressEnd("y"),
    onStart: () => start("y"),
    onMove: (drag) => move("y", drag),
    onEnd: (drag) => end("y", drag),
  });

  const ref = useCallback(
    (element: HTMLDivElement) => {
      state.current.element = element;
      const detachX = x.ref(element);
      const detachY = y.ref(element);
      return () => {
        // A toast removed on its way out, or on its way back, stops there.
        state.current.settle?.stop();
        detachX!();
        detachY!();
      };
    },
    [x, y],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Base UI pauses the toasts and fans them out while a mouse is over them. A finger has no
      // hover, so its press says the same: the toasts wait while one is held or read.
      // The event is where the finger is, for an app that follows the mouse.
      if (event.pointerType !== "mouse") {
        const { clientX, clientY, screenX, screenY } = event;
        event.currentTarget.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY, screenX, screenY }));
      }
      // A toast on its way out is no longer the finger's.
      if (state.current.leaving) return;
      x.onPointerDown(event);
      y.onPointerDown(event);
    },
    [x, y],
  );
  // Sideways first, so a move that could start either drag starts that one.
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      x.onPointerMove(event);
      y.onPointerMove(event);
    },
    [x, y],
  );
  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      x.onPointerUp(event);
      y.onPointerUp(event);
    },
    [x, y],
  );
  return { ref, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}

/** What a toast's swipe keeps between events. */
interface SwipeState {
  element: HTMLElement | null;
  /** The axis of the drag, or of the offset a settle is bringing back. */
  axis: Axis | null;
  /** What is on screen, in px along `axis`. */
  offset: number;
  /** The finger travel that put the toast where it was taken. */
  grab: number;
  /**
   * Which of the two drags, one per axis, still follows a press that has not chosen.
   *
   * @claim "Which of the two drags, one" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > moves 1:1 from where it was taken, either way, once 10px have chosen sideways)
   */
  pressed: { x: boolean; y: boolean };
  /** Whether the press became a drag. */
  moved: boolean;
  leaving: boolean;
  /** Whether the press is on one of the toast's controls. */
  control: boolean;
  settle: SpringHandle | undefined;
}

/** The finger travel past an end that `rubberband` turns into `shown`, for a toast `size` px along the axis. */
function unband(shown: number, size: number, constant = 0.55): number {
  return (shown * size) / (constant * (size - Math.abs(shown)));
}

/**
 * The tone's icon, drawn in the tone's color; `secondary` has none.
 *
 * @claim "The tone's icon, drawn in the" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > marks the tone and shows an icon for every tone but secondary)
 */
function ToneIcon({ tone }: { tone: string | undefined }): JSX.Element | null {
  if (tone === undefined || !Object.hasOwn(iconTones, tone)) return null;
  const color = iconTones[tone as keyof typeof iconTones];
  return (
    <svg
      aria-hidden="true"
      data-ouro-toast-icon=""
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("mt-px size-5 shrink-0", color)}
    >
      {tone === "success" && (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="M6.5 10.25l2.25 2.25 4.75-5" />
        </>
      )}
      {tone === "warning" && (
        <>
          <path d="M10 2.75 1.75 17.25h16.5Z" />
          <path d="M10 8v4M10 14.75v.01" />
        </>
      )}
      {tone === "destructive" && (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 6v4.5M10 13.75v.01" />
        </>
      )}
      {tone === "primary" && (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5M10 6.25v.01" />
        </>
      )}
    </svg>
  );
}
