"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { createContext, useContext, useEffect, useRef, type JSX } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import {
  indicatorClass,
  listClass,
  ownLook,
  panelClass,
  rootClass,
  tabClass,
  tabFaceClass,
} from "~/components/ouro/tabs/tabs-styles";

const TabsContext = createContext(false);

/** Throws in development, with the JSX the part belongs in, unless it sits inside a TabsRoot. */
function useTabsPart(part: string, inner: string): void {
  if (!useContext(TabsContext)) {
    devThrow(
      part,
      "must be rendered inside <TabsRoot>",
      process.env.NODE_ENV !== "production"
        ? `<TabsRoot defaultValue="…"><TabsList aria-label="…"><TabsTab value="…">…</TabsTab><TabsIndicator /></TabsList><TabsPanel value="…">…</TabsPanel></TabsRoot>, with ${inner} in its place`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
}

/** Runs the className check for a part, with a hint only in development. */
function usePartClassName(part: string, className: unknown): void {
  useAppearanceClassNameCheck(
    part,
    typeof className === "string" ? className : undefined,
    process.env.NODE_ENV !== "production" ? ownLook(part) : /* istanbul ignore next @preserve -- production only */ "",
  );
}

/** Props for {@link TabsRoot}. `className` is for layout only. */
export type TabsRootProps = Omit<BaseTabs.Root.Props, "className"> & { className?: string | undefined };

/**
 * Part: the state owner of tabs built from parts. Use the `Tabs` component instead
 * unless its `items` cannot express your layout, such as a tab that holds a badge next to
 * its label or a panel shared by two tabs.
 *
 * @example
 * <TabsRoot defaultValue="ingredients">
 *   <TabsList aria-label="Recipe">
 *     <TabsTab value="ingredients">Ingredients</TabsTab>
 *     <TabsTab value="method">Method</TabsTab>
 *     <TabsIndicator />
 *   </TabsList>
 *   <TabsPanel value="ingredients">…</TabsPanel>
 *   <TabsPanel value="method">…</TabsPanel>
 * </TabsRoot>
 */
export function TabsRoot(props: TabsRootProps): JSX.Element {
  usePartClassName("TabsRoot", props.className);
  return <TabsRootUnchecked {...props} />;
}

/**
 * The root without its own className check, for `Tabs`, which checks its own.
 *
 * @internal
 */
export function TabsRootUnchecked({ className, onPointerDownCapture, ...props }: TabsRootProps): JSX.Element {
  return (
    <TabsContext.Provider value>
      <BaseTabs.Root
        {...props}
        data-ouro="tabs"
        // A pointer anywhere inside (a tab, or a control in a panel) ends the keyboard's quiet spell.
        onPointerDownCapture={(event) => {
          event.currentTarget.toggleAttribute("data-ouro-keyboard", false);
          onPointerDownCapture?.(event);
        }}
        className={cn(rootClass, className)}
      />
    </TabsContext.Provider>
  );
}

/** Props for {@link TabsList}. Name the list with `aria-label`. */
export type TabsListProps = Omit<BaseTabs.List.Props, "className"> & { className?: string | undefined };

/**
 * Marks which sides of a scrolling tab row hide more tabs, as `data-fade="left"`, `"right"` or
 * `"both"`, so the row fades out on that edge. Physical sides, so the CSS needs no direction.
 */
function useEdgeFade(list: { current: HTMLElement | null }): void {
  useEffect(() => {
    const element = list.current!;
    const update = () => {
      const horizontal = element.getAttribute("aria-orientation") !== "vertical";
      // In a right-to-left row, scrollLeft runs from 0 down to a negative number.
      const scrolled = Math.abs(element.scrollLeft);
      const before = horizontal && scrolled > 1;
      const after = horizontal && scrolled + element.clientWidth < element.scrollWidth - 1;
      const rtl = getComputedStyle(element).direction === "rtl";
      const [left, right] = rtl ? [after, before] : [before, after];
      const fade = left && right ? "both" : left ? "left" : right ? "right" : null;
      if (fade) element.setAttribute("data-fade", fade);
      else element.removeAttribute("data-fade");
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    // The orientation can change, and tabs can come and go.
    const mutation = new MutationObserver(update);
    mutation.observe(element, { attributes: true, attributeFilter: ["aria-orientation"], childList: true });
    return () => {
      element.removeEventListener("scroll", update);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [list]);
}

/**
 * Part: the row (or column) of tabs. Name it with `aria-label` when the page has more than
 * one set of tabs. `activateOnFocus` selects a tab when the arrow keys focus it. A row that
 * scrolls, on a phone, fades out on the side that hides more tabs. A key that moves the
 * selection switches tabs without animation.
 */
export function TabsList({ className, ref, onKeyDownCapture, ...props }: TabsListProps): JSX.Element {
  useTabsPart("TabsList", '<TabsList aria-label="…">…</TabsList>');
  usePartClassName("TabsList", className);
  const own = useRef<HTMLDivElement>(null);
  const merged = useMergedRef(ref, own);
  useEdgeFade(own);
  // The tabs say when a key moved the selection (the root clears it on a pointer), so switching
  // by key doesn't animate the indicator or the panel.
  return (
    <BaseTabs.List
      {...props}
      ref={merged}
      onKeyDownCapture={(event) => {
        event.currentTarget.closest('[data-ouro="tabs"]')!.toggleAttribute("data-ouro-keyboard", true);
        onKeyDownCapture?.(event);
      }}
      className={cn(listClass, className)}
    />
  );
}

/** Props for {@link TabsTab}. */
export type TabsTabProps = Omit<BaseTabs.Tab.Props, "className"> & { className?: string | undefined };

/** Part: one tab, a button that shows the panel with the same `value`. */
export function TabsTab({ className, children, ...props }: TabsTabProps): JSX.Element {
  useTabsPart("TabsTab", '<TabsTab value="…">…</TabsTab>');
  usePartClassName("TabsTab", className);
  return (
    <BaseTabs.Tab data-ouro-control="tabs" data-ouro-part="tab" {...props} className={cn(tabClass, className)}>
      <span className={tabFaceClass}>{children}</span>
    </BaseTabs.Tab>
  );
}

/** Part: the line that slides to the selected tab. Put it last inside `TabsList`. */
export function TabsIndicator(props: Omit<BaseTabs.Indicator.Props, "className">): JSX.Element {
  useTabsPart("TabsIndicator", "<TabsIndicator />");
  return <BaseTabs.Indicator {...props} data-ouro-tabs-indicator="" className={indicatorClass} />;
}

/** Props for {@link TabsPanel}. */
export type TabsPanelProps = Omit<BaseTabs.Panel.Props, "className"> & { className?: string | undefined };

/** Part: the content shown while the tab with the same `value` is selected. */
export function TabsPanel({ className, ...props }: TabsPanelProps): JSX.Element {
  useTabsPart("TabsPanel", '<TabsPanel value="…">…</TabsPanel>');
  usePartClassName("TabsPanel", className);
  return <BaseTabs.Panel data-ouro-control="tabs" data-ouro-part="panel" {...props} className={cn(panelClass, className)} />;
}
