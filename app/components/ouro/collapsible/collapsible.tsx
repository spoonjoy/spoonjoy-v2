"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { useSyncExternalStore, type JSX, type ReactNode, type Ref } from "react";
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
 * @see https://ourostack.github.io/ouro-ui/docs/collapsible
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
  return (
    <BaseCollapsible.Root
      ref={ref}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      disabled={disabled}
      data-ouro="collapsible"
      className={cn(rootClass, className)}
    >
      <BaseCollapsible.Trigger data-ouro-control="collapsible" data-ouro-part="trigger" className={triggerClass}>
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
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel keepMounted hiddenUntilFound={untilFound} data-ouro-collapsible-panel="" className={panelClass}>
        <div className="pt-1 pb-2">{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
