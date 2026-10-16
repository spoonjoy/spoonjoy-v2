"use client";

import { Toast } from "@base-ui/react/toast";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "~/lib/ouro/cn";
import { devWarn } from "~/lib/ouro/dev";
import { rubberband, spring, type SpringHandle } from "~/lib/ouro/spring";
import { connectToaster, type ToastRecord } from "~/lib/ouro/toast";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useDrag, type DragState } from "~/lib/ouro/use-drag";
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
   * The name screen readers give the region the toasts appear in. Translate it with the
   * rest of your interface.
   * @default "Notifications"
   */
  label?: string | undefined;
  /**
   * The accessible name of each toast's dismiss button, which shows an icon only.
   * @default "Dismiss"
   */
  closeLabel?: string | undefined;

  /** Not a prop. Toasts show at the bottom: full width on phones, at the bottom end from `sm`. */
  position?: { 'Not a prop: toasts show at the bottom. Use <Toaster />': never };
  /** Not a prop. Each toast takes its own `tone`: `toast("Saved", { tone: "success" })`. */
  richColors?: { 'Use toast("Saved", { tone: "success" })': never };
  /** Not a prop. Dark mode follows the `.dark` class, as in shadcn. */
  theme?: { 'Not a prop: dark mode follows the .dark class. Use <Toaster />': never };
  /** Not a prop. Each toast takes its own `duration`: `toast("Saved", { duration: 8000 })`. */
  duration?: { 'Use toast("Saved", { duration: 8000 })': never };
}

/**
 * Shows the toasts you send with `toast("Saved")` from `@/lib/ouro/toast`: render it
 * once, at the root of your app, inside `OuroProvider` if you use one, or alone. Every
 * Ouro UI install has `toast`. Toasts stack at the
 * bottom of the screen, full width on phones; up to three show, and later ones wait their
 * turn, a `destructive` toast ahead of the others. They pause while the pointer is over them or a toast has focus, F6 moves focus to
 * them, newest first, and a swipe down or sideways dismisses one: a toast follows the
 * finger, a quick flick is enough, and one let go short of that springs back. Each toast is read to
 * screen readers once: politely through this region, and a `destructive` toast
 * assertively, so it interrupts.
 *
 * Render one Toaster. A second one warns in development and shows nothing until the
 * first unmounts, then takes over.
 *
 * Use `Alert` instead for a message that stays on the page, and `Dialog` when the user
 * must answer before going on.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/toaster
 *
 * @example
 * <OuroProvider>
 *   <App />
 *   <Toaster />
 * </OuroProvider>
 * // Anywhere in the app:
 * toast("Recipe saved", { tone: "success" });
 */
export function Toaster(props: ToasterProps): JSX.Element | null {
  const { label = "Notifications", closeLabel = "Dismiss", position, richColors, theme, duration } = props;
  const [active, setActive] = useState(false);
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
          <Toast.Viewport aria-label={label} data-ouro="toaster" className={viewportClass}>
            <ToastList closeLabel={closeLabel} />
          </Toast.Viewport>
        </Toast.Portal>
      )}
    </Toast.Provider>
  );
}

/** Whether a toast waits ahead of the others: a destructive one. */
const urgent = (record: ToastRecord) => record.tone === "destructive";

/** How many toasts show at once; later ones wait in the Toaster's queue. */
const VISIBLE = 3;
/** How many toasts may wait before development warns that the app sends too many. There is no cap. */
const MAX_WAITING_HINT = 10;

/**
 * Connects this Toaster to `toast()`. Up to three toasts are in Base UI's manager at a time;
 * later ones wait here, first in first out, and are added, with their countdown, when a
 * slot frees. Another Toaster already connected keeps this one waiting until it unmounts.
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
        // A destructive toast interrupts: Base UI speaks it through an alert and hides it from the polite region.
        priority: record.tone === "destructive" ? "high" : "low",
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
 */
function ToastList({ closeLabel }: { closeLabel: string }): JSX.Element[] {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => <ToastItem key={item.id} item={item} closeLabel={closeLabel} />);
}

type ToastObject = ReturnType<typeof Toast.useToastManager>["toasts"][number];

/** One toast. The swipe is Ouro's own, so Base UI's is off. */
function ToastItem({ item, closeLabel }: { item: ToastObject; closeLabel: string }): JSX.Element {
  const { close } = Toast.useToastManager();
  const swipe = useSwipeAway(() => close(item.id), item.transitionStatus === "ending");
  return (
    <Toast.Root toast={item} swipeDirection={NO_SWIPE} {...swipe} data-ouro="toast" data-tone={item.type} className={rootClass}>
      <Toast.Content className={contentClass}>
        <ToneIcon tone={item.type} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Toast.Title render={<div />} data-ouro-toast-title="" className="m-0 text-sm font-medium text-popover-foreground" />
          <Toast.Description render={<div />} data-ouro-toast-description="" className="m-0 text-sm text-muted-foreground" />
        </div>
        <Toast.Action className={actionClass} />
        <Toast.Close aria-label={closeLabel} className={closeClass}>
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
/** A press on one of these never starts a swipe: the action, the dismiss button, a link or a control in the message, and anything an app marks `data-swipe-ignore`. The list Base UI's swipe used. */
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
  /** Which of the two drags, one per axis, still follows a press that has not chosen. */
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

/** The tone's icon, drawn in the tone's color; `secondary` has none. */
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
