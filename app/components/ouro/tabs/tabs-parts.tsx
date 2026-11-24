"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { createContext, memo, useContext, useEffect, useRef, type JSX, type ReactNode } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { useDisabledReason } from "~/lib/ouro/disabled-reason";
import { PageDirection } from "~/lib/ouro/page-direction";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import {
  indicatorClass,
  linkListClass,
  listClass,
  ownLook,
  panelClass,
  rootClass,
  tabClass,
  tabFaceClass,
  type TabsOrientation,
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
export function TabsRootUnchecked({ className, onPointerDownCapture, ref, ...props }: TabsRootProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const merged = useMergedRef(ref, root);
  return (
    <TabsContext.Provider value>
      <PageDirection of={root}>
        <BaseTabs.Root data-slot="tabs"
          {...props}
          ref={merged}
          data-ouro="tabs"
          // A pointer anywhere inside (a tab, or a control in a panel) ends the keyboard's quiet spell.
          onPointerDownCapture={(event) => {
            event.currentTarget.toggleAttribute("data-ouro-keyboard", false);
            onPointerDownCapture?.(event);
          }}
          className={cn(rootClass, className)}
        />
      </PageDirection>
    </TabsContext.Provider>
  );
}

/** Props for {@link TabsList}. Name the list with `aria-label`. */
export type TabsListProps = Omit<BaseTabs.List.Props, "className"> & { className?: string | undefined };

/**
 * Part: the row (or column) of tabs. Name it with `aria-label` when the page has more than
 * one set of tabs. `activateOnFocus` selects a tab when the arrow keys focus it. A row that
 * overflows scrolls sideways, on a phone. A key that moves the
 * selection switches tabs without animation.
 */
export function TabsList({ className, ref, onKeyDownCapture, ...props }: TabsListProps): JSX.Element {
  useTabsPart("TabsList", '<TabsList aria-label="…">…</TabsList>');
  usePartClassName("TabsList", className);
  const own = useRef<HTMLDivElement>(null);
  const merged = useMergedRef(ref, own);
  // The tabs say when a key moved the selection (the root clears it on a pointer), so switching
  // by key doesn't animate the indicator or the panel.
  return (
    <BaseTabs.List
      data-slot="tabs-list"
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

/**
 * The list of Tabs' links, in the tab row's look. It scrolls the
 * link to the current page (`current`, its value) into view.
 *
 * @internal Used by Tabs when its items are links; apps pass `items` with `href`.
 */
export function TabsLinkList({ orientation, current, children }: { orientation: TabsOrientation; current: string | undefined; children: ReactNode }): JSX.Element {
  const own = useRef<HTMLUListElement>(null);
  // A row that scrolls, on a phone, brings the current page's link into view, as a row of tabs
  // brings the selected tab, without scrolling the page.
  useEffect(() => {
    const list = own.current!;
    const here = list.querySelector('[aria-current="page"]');
    if (!here) return;
    const [box, link] = [list.getBoundingClientRect(), here.getBoundingClientRect()];
    // Back by what hides past the start, or on by what hides past the end; nothing when it shows.
    list.scrollLeft += Math.min(link.left - box.left, 0) + Math.max(link.right - box.right, 0);
  }, [current, orientation]);
  return (
    <ul data-slot="tabs-list" ref={own} data-orientation={orientation} className={cn(listClass, linkListClass)}>
      {children}
    </ul>
  );
}

/** Props for {@link TabsTab}. */
export type TabsTabProps = Omit<BaseTabs.Tab.Props, "className"> & {
  className?: string | undefined;
  /**
   * Why this tab can't be selected now. Turns it off with `aria-disabled`: it stays focusable
   * and pressing it selects nothing, and the reason shows as its tooltip on hover and keyboard
   * focus and is read as its description. The arrow keys skip it, as they skip a `disabled`
   * tab; Tab reaches it, so a keyboard user can read why. It wins over `disabled`. Pass
   * `undefined` while the tab is available.
   * @example
   * <TabsTab value="sharing" disabledReason={signedIn ? undefined : "Sign in to share"}>Sharing</TabsTab>
   */
  disabledReason?: string | undefined;
};

/** Part: one tab, a button that shows the panel with the same `value`. */
export function TabsTab(allProps: TabsTabProps): JSX.Element {
  const { className, children, disabledReason: _reason, disabled, ...props } = allProps;
  useTabsPart("TabsTab", '<TabsTab value="…">…</TabsTab>');
  usePartClassName("TabsTab", className);
  const reason = useDisabledReason(allProps, props["aria-describedby"]);
  const tab = (
    <BaseTabs.Tab
      data-ouro-control="tabs"
      data-ouro-part="tab"
      data-slot="tabs-trigger"
      {...props}
      disabled={disabled && !reason.off}
      {...(reason.off
        ? {
            "aria-disabled": true,
            "data-disabled": "",
            "aria-describedby": reason.describedBy,
            // Tab is what reaches it, since the arrow keys skip an aria-disabled tab.
            tabIndex: 0,
            onClick: (event: { preventBaseUIHandler: () => void }) => event.preventBaseUIHandler(),
            onFocus: (event: { preventBaseUIHandler: () => void }) => event.preventBaseUIHandler(),
          }
        : {})}
      className={cn(tabClass, className)}
    >
      <span data-slot="tabs-face" className={tabFaceClass}>{children}</span>
      {reason.note}
    </BaseTabs.Tab>
  );
  return reason.wrapped ? <Tooltip content={reason.reason}>{tab}</Tooltip> : tab;
}

/** Part: the line that slides to the selected tab. Put it last inside `TabsList`. */
export const TabsIndicator = memo(function TabsIndicator(props: Omit<BaseTabs.Indicator.Props, "className">): JSX.Element {
  useTabsPart("TabsIndicator", "<TabsIndicator />");
  return <BaseTabs.Indicator data-slot="tabs-indicator" {...props} data-ouro-tabs-indicator="" className={indicatorClass} />;
});

/** Props for {@link TabsPanel}. */
export type TabsPanelProps = Omit<BaseTabs.Panel.Props, "className"> & { className?: string | undefined };

/** Part: the content shown while the tab with the same `value` is selected. */
export function TabsPanel({ className, ...props }: TabsPanelProps): JSX.Element {
  useTabsPart("TabsPanel", '<TabsPanel value="…">…</TabsPanel>');
  usePartClassName("TabsPanel", className);
  return <BaseTabs.Panel data-ouro-control="tabs" data-ouro-part="panel" data-slot="tabs-content" {...props} className={cn(panelClass, className)} />;
}
