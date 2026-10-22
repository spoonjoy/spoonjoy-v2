"use client";

import { useEffect, useReducer, useRef, useState, type CSSProperties, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** Props for {@link RouteProgress}. */
export interface RouteProgressProps {
  /**
   * Whether a navigation or a form submission is under way: in React Router,
   * `useNavigation().state !== "idle"`; in Next.js, the pending state of `useTransition`
   * around `router.push`.
   */
  active: boolean;
  /** What screen readers hear when a navigation starts. @default "Loading" */
  label?: string | undefined;
  /** Layout only: rarely needed, since the bar places itself at the top of the screen. Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the root, the status region. */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `active`: `<RouteProgress active={navigation.state !== "idle"} />`. */
  loading?: { 'Use <RouteProgress active={navigation.state !== "idle"} />': never };
  /** Not a prop. Ouro UI uses `active`: `<RouteProgress active={navigation.state !== "idle"} />`. */
  isLoading?: { 'Use <RouteProgress active={navigation.state !== "idle"} />': never };
  /** Not a prop. RouteProgress shows that something is loading, not how much; use `Progress` for a known amount. */
  value?: { 'RouteProgress has no amount; use <Progress value={50}> for a known one': never };
}

// Class strings are literal so the app's Tailwind finds them when it compiles.
const rootClass = "pointer-events-none fixed inset-x-0 top-0 z-(--ouro-layer) block h-0.5 print:hidden";
// The bar fades in and out; with reduced motion it fades faster.
const barClass =
  "group absolute inset-0 overflow-hidden transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) data-closed:opacity-0 " +
  "motion-reduce:duration-(--ouro-duration-fast)";
// The filled part grows from the start edge to --ouro-route-progress of the width, easing into each step while
// the bar shows. With reduced motion it is the whole width and never grows.
const indicatorClass =
  "h-full w-full origin-left rtl:origin-right bg-primary scale-x-(--ouro-route-progress) " +
  "motion-safe:group-data-open:transition-[scale] motion-safe:group-data-open:duration-(--ouro-duration-slow) motion-safe:group-data-open:ease-(--ouro-ease-out) " +
  "motion-reduce:scale-x-100 forced-colors:bg-[CanvasText]";

/** How long a navigation runs before the bar shows, so a fast one shows and says nothing. */
const DELAY = 150;
/** How often the bar creeps on while it shows. */
const TRICKLE = 400;
/**
 * Where the bar starts, where it creeps toward, and the share of the rest it covers each step.
 *
 * @claim "Where the bar starts, where it" registry/ouro/components/ouro/route-progress/route-progress.test.tsx verify:testExists(registry/ouro/components/ouro/route-progress/route-progress.test.tsx::RouteProgress > trickles toward 90%, more slowly the nearer it gets, and never reaches it)
 */
const START = 0.15;
const LIMIT = 0.9;
const STEP = 0.1;

/**
 * `idle`: hidden. `waiting`: a navigation runs, but not yet for DELAY. `loading`: shown and creeping
 * on. `completing`: the navigation ended, and the bar fills to the end. `fading`: full, it fades out.
 */
type Phase = "idle" | "waiting" | "loading" | "completing" | "fading";
interface State {
  phase: Phase;
  /** The share of the width the bar is filled to. */
  value: number;
}
type Action = "activate" | "deactivate" | "show" | "tick" | "settled";

function reduce(state: State, action: Action): State {
  switch (action) {
    case "activate":
      // A navigation that starts while the last one's bar is still on screen carries on at once.
      return state.phase === "idle" ? { phase: "waiting", value: 0 } : { phase: "loading", value: START };
    case "deactivate":
      return state.phase === "waiting" ? { phase: "idle", value: 0 } : { phase: "completing", value: 1 };
    case "show":
      return { phase: "loading", value: START };
    case "tick":
      return { phase: "loading", value: state.value + (LIMIT - state.value) * STEP };
    case "settled":
      // Filled, it fades out; faded, it empties for the next navigation.
      return state.phase === "completing" ? { phase: "fading", value: 1 } : { phase: "idle", value: 0 };
  }
}

/** Resolves once the element's transitions have ended, including any that started meanwhile. */
async function settled(element: Element): Promise<void> {
  for (let running = element.getAnimations(); running.length > 0; running = element.getAnimations()) {
    await Promise.allSettled(running.map((animation) => animation.finished));
  }
}

const fix = '<RouteProgress active={navigation.state !== "idle"} />';

/**
 * The thin bar across the top of the screen while the app loads the next page or submits
 * a form, so a click that waits on the server never feels frozen: one global affordance
 * instead of a pending state on every action. Once `active` has held for 150ms the bar
 * fades in, and screen readers hear "Loading" once; a faster navigation shows and says
 * nothing. While it shows, it creeps toward 90% of the width, more slowly the nearer it
 * gets; when `active` turns false it fills to the end and fades out. With reduced motion
 * it is the whole width from the start and only fades.
 *
 * Render it once, in the root layout, with your router's navigation state.
 *
 * Use `Progress` instead for a task whose amount is known, `Spinner` inside the control
 * that is busy, and `Button`'s `loading` for the one action a person just took.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/route-progress
 *
 * @example
 * // React Router, in the root route:
 * const navigation = useNavigation();
 * <RouteProgress active={navigation.state !== "idle"} />
 * @claim "Once `active` has held for 150ms" registry/ouro/components/ouro/route-progress/route-progress.test.tsx verify:testExists(registry/ouro/components/ouro/route-progress/route-progress.test.tsx::RouteProgress > waits 150ms before it shows or speaks, so a fast navigation shows and says nothing)
 * @claim "While it shows, it creeps toward" registry/ouro/components/ouro/route-progress/route-progress.test.tsx verify:testExists(registry/ouro/components/ouro/route-progress/route-progress.test.tsx::RouteProgress > trickles toward 90%, more slowly the nearer it gets, and never reaches it)
 * @claim "The thin bar across the top" registry/ouro/components/ouro/route-progress/route-progress.test.tsx verify:testExists(registry/ouro/components/ouro/route-progress/route-progress.test.tsx::RouteProgress > is a 2px bar fixed across the top of the screen in the primary color, which no click reaches)
 */
export function RouteProgress(props: RouteProgressProps): JSX.Element {
  const {
    active,
    label = "Loading",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    loading,
    isLoading,
    value,
  } = props;
  useAppearanceClassNameCheck(
    "RouteProgress",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; RouteProgress takes the theme's --primary color`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "RouteProgress",
    process.env.NODE_ENV !== "production"
      ? () => [
          loading !== undefined && ["loading is not a prop", fix],
          isLoading !== undefined && ["isLoading is not a prop", fix],
          value !== undefined && ["RouteProgress has no amount", "<Progress value={50}>"],
          typeof active !== "boolean" && ["active is required; pass whether a navigation is under way", fix],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const [{ phase, value: filled }, dispatch] = useReducer(reduce, active, (on): State => ({ phase: on ? "waiting" : "idle", value: 0 }));
  // A change of `active` moves the phase in the same render, so the bar answers it at once.
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    dispatch(active ? "activate" : "deactivate");
  }
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    switch (phase) {
      case "waiting": {
        const timer = setTimeout(() => dispatch("show"), DELAY);
        return () => clearTimeout(timer);
      }
      case "loading": {
        const timer = setInterval(() => dispatch("tick"), TRICKLE);
        return () => clearInterval(timer);
      }
      case "completing":
      case "fading": {
        // Waits for the fill, or the fade, to end; a new navigation meanwhile cancels the wait.
        let current = true;
        void settled((phase === "completing" ? indicatorRef : barRef).current!).then(() => {
          if (current) dispatch("settled");
        });
        return () => {
          current = false;
        };
      }
      default:
        return undefined;
    }
  }, [phase]);
  const shown = phase === "loading" || phase === "completing";
  return (
    // A status region that is always there, so screen readers hear the label when it appears in it.
    <div ref={ref} role="status" data-ouro="route-progress" className={cn(rootClass, className)}>
      <span className="sr-only">{phase === "loading" ? label : ""}</span>
      <div ref={barRef} aria-hidden="true" data-ouro-part="bar" data-open={shown ? "" : undefined} data-closed={shown ? undefined : ""} className={barClass}>
        <div ref={indicatorRef} data-ouro-part="indicator" className={indicatorClass} style={{ "--ouro-route-progress": filled } as CSSProperties} />
      </div>
    </div>
  );
}
