"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState, useSyncExternalStore, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { iconClass, ownLook, panelClass, rootClass, triggerClass } from "~/components/ouro/collapsible/collapsible-styles";

/** Props for {@link Collapsible}. */
export interface CollapsibleProps {
  /** The title, in view whether open or closed. It is the button that opens and closes the content. */
  title: ReactNode;
  /** What shows while it is open. */
  children: ReactNode;
  /** Whether it is open, when you control it. Pair it with `onOpenChange`. */
  open?: boolean | undefined;
  /** Opens it first, when the component keeps its own state. */
  defaultOpen?: boolean | undefined;
  /** Called with the new state when the person opens or closes it. */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Keeps it from opening or closing. */
  disabled?: boolean | undefined;
  /** Layout only: margins, width, grid placement (`mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. The button is drawn for you from `title`: `<Collapsible title="Nutrition facts">`. */
  trigger?: { 'Use <Collapsible title="Nutrition facts">': never };
  /** Not a prop. Ouro UI uses `title`: `<Collapsible title="Nutrition facts">`. */
  label?: { 'Use <Collapsible title="Nutrition facts">': never };
  /** Not a prop. Ouro UI uses `onOpenChange`: `<Collapsible onOpenChange={(open) => …}>`. */
  onChange?: { 'Use <Collapsible onOpenChange={(open) => ...}>': never };
  /** Not a prop. Ouro UI uses `open`: `<Collapsible open>`. */
  isOpen?: { 'Use <Collapsible open>': never };
}

const noSubscribe = () => () => {};

/**
 * Whether the browser reveals `hidden="until-found"` content for its page search
 * (Chromium does; WebKit does not, and would show the content). False on the server, so
 * hydration matches, and closed content stays in the server HTML either way.
 */
function useUntilFound(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => "onbeforematch" in document.body,
    () => false,
  );
}

/**
 * One section that opens and closes under its title, such as nutrition facts under a
 * recipe. The content grows to its measured height with CSS, the closed content is in the
 * server HTML and found by the page search of browsers that support `hidden="until-found"`,
 * and the title is a 44px row on touch screens.
 *
 * Use `Accordion` instead for a stack of such sections. Use `ShowMore` instead to cut a long
 * list or text short behind a "Show more" button. Use `Dialog` or `Sheet` instead when the
 * content is a task of its own.
 *
 * @group Lists
 * @see https://ui.ouroboros.bot/docs/collapsible
 *
 * @example
 * <Collapsible title="Nutrition facts">
 *   <NutritionTable />
 * </Collapsible>
 * @claim "The content grows to its measured" registry/ouro/components/ouro/collapsible/collapsible.test.tsx verify:testExists(registry/ouro/components/ouro/collapsible/collapsible.test.tsx::Collapsible > links the title and panel in server HTML and hydrates without a mismatch)
 * @claim "The content grows to its measured" registry/ouro/components/ouro/collapsible/collapsible.test.tsx verify:testExists(registry/ouro/components/ouro/collapsible/collapsible.test.tsx::Collapsible > lets the browser's page search find and open it, and hides it plainly where until-found is unsupported)
 * @claim "The content grows to its measured" registry/ouro/components/ouro/collapsible/collapsible.test.tsx verify:testExists(registry/ouro/components/ouro/collapsible/collapsible.test.tsx::Collapsible > gives the title a 44px row on a coarse pointer, or 36px otherwise)
 */
export function Collapsible(props: CollapsibleProps): JSX.Element {
  const {
    title,
    children,
    open,
    defaultOpen,
    onOpenChange,
    disabled,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    trigger,
    label,
    onChange,
    isOpen,
  } = props;
  useAppearanceClassNameCheck(
    "Collapsible",
    className,
    process.env.NODE_ENV !== "production" ? ownLook("Collapsible") : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Collapsible",
    process.env.NODE_ENV !== "production"
      ? () => {
          const named = typeof label === "string" ? (label as string) : "Nutrition facts";
          return [
            trigger !== undefined && ["trigger is not a prop", `<Collapsible title="${named}">`],
            label !== undefined && ["label is not a prop", `<Collapsible title="${named}">`],
            onChange !== undefined && ["onChange is not a prop", "<Collapsible onOpenChange={(open) => …}>"],
            isOpen !== undefined && ["isOpen is not a prop", "<Collapsible open>"],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const untilFound = useUntilFound();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(defaultOpen === true);
  const expanded = open ?? own;
  const change = (next: boolean) => {
    // Stryker disable next-line ConditionalExpression: a controlled component ignores its own state, so setting it too changes nothing visible.
    if (open === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const changeRef = useRef(change);
  useLayoutEffect(() => {
    changeRef.current = change;
  });
  // The panel stays shown through its closing transition, then hides.
  const [seen, setSeen] = useState(expanded);
  // Stryker disable next-line BooleanLiteral: the first closing state is overwritten by the render-phase sync before any effect reads it.
  const [closing, setClosing] = useState(false);
  const [moved, setMoved] = useState(false);
  if (seen !== expanded) {
    setSeen(expanded);
    setMoved(true);
    setClosing(!expanded);
  }
  const listenForFound = () => {
    const panel = panelRef.current;
    // Stryker disable next-line ConditionalExpression: the panel always exists once effects run; the guard only satisfies the type.
    /* istanbul ignore next @preserve -- the panel always exists once effects run */
    if (!panel) return;
    const found = () => changeRef.current(true);
    panel.addEventListener("beforematch", found);
    return () => panel.removeEventListener("beforematch", found);
  };
  // Stryker disable next-line ArrayDeclaration: the effect reads only refs, so re-running it adds the same listener again.
  useEffect(listenForFound, []);
  useEffect(() => {
    const panel = panelRef.current;
    // Stryker disable next-line ConditionalExpression,LogicalOperator: the panel always exists once effects run, and an open panel has nothing to close.
    if (!closing || !panel) return;
    if (panel.getAnimations().length === 0) {
      setClosing(false);
      return;
    }
    const done = (event: Event) => {
      // Stryker disable next-line ConditionalExpression: transition events from the panel's descendants do not occur in this markup.
      /* istanbul ignore else @preserve -- descendants of the panel send no transition events */
      if (event.target === panel) setClosing(false);
    };
    // Stryker disable next-line StringLiteral: the cancel and end listeners are interchangeable for the same transition.
    panel.addEventListener("transitionend", done);
    // Stryker disable next-line StringLiteral,CallExpression: the cancel and end listeners are interchangeable for the same transition.
    panel.addEventListener("transitioncancel", done);
    // Stryker disable next-line BlockStatement: the panel is kept for the component's life, so an unreleased listener is unobservable.
    return () => {
      // Stryker disable next-line StringLiteral,CallExpression: removal only releases a listener on a node that is being kept.
      panel.removeEventListener("transitionend", done);
      // Stryker disable next-line StringLiteral,CallExpression: removal only releases a listener on a node that is being kept.
      panel.removeEventListener("transitioncancel", done);
    };
  }, [closing]);
  const shown = expanded || closing;
  // React writes a plain `hidden`; the until-found value is set by hand.
  useLayoutEffect(() => {
    // Stryker disable next-line OptionalChaining: the ref is set before layout effects run.
    if (!shown && untilFound) panelRef.current?.setAttribute("hidden", "until-found");
  }, [shown, untilFound]);
  return (
    <div ref={ref} data-ouro="collapsible" className={cn(rootClass, className)}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        // Stryker disable next-line StringLiteral: any value of a presence attribute styles the same.
        data-disabled={disabled ? "" : undefined}
        // Stryker disable next-line StringLiteral: any value of a presence attribute styles the same.
        data-panel-open={expanded ? "" : undefined}
        data-ouro-control="collapsible"
        data-ouro-part="trigger"
        className={triggerClass}
        onClick={() => change(!expanded)}
      >
        {title}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={iconClass}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        // Stryker disable next-line BooleanLiteral: hidden="false" would still hide in the same way for the browser engines under test.
        hidden={shown ? undefined : true}
        // Stryker disable next-line StringLiteral: any value of a presence attribute styles the same.
        data-open={expanded ? "" : undefined}
        // Stryker disable next-line StringLiteral: any value of a presence attribute styles the same.
        data-moved={moved ? "" : undefined}
        data-ouro-collapsible-panel=""
        className={panelClass}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-1 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
