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
  stickyListClass,
  tabClass,
  tabFaceClass,
  type TabsOrientation,
} from "~/components/ouro/tabs/tabs-styles";

const TabsContext = createContext(false);

/**
 * Base UI scrolls the highlighted tab into view whenever the tabs register, which reads the
 * row's layout and so makes the browser lay the page out in the middle of the mount. A tab that
 * has just mounted hides `scrollTo`, the method that scroll needs, for one frame. In that frame,
 * once the mount has committed, the selected tab brings itself into view in a row that scrolls
 * sideways (only a horizontal row scrolls), so a row that opens on a later tab still shows it.
 * After it, the arrow keys scroll the row as before.
 */
function holdScrollOnMount(element: HTMLElement | null): void {
  if (!element) return;
  Object.defineProperty(element, "scrollTo", { value: undefined, configurable: true });
  requestAnimationFrame(() => {
    delete (element as { scrollTo?: unknown }).scrollTo;
    if (!element.isConnected || element.getAttribute("aria-selected") !== "true") return;
    const list = element.closest<HTMLElement>('[role="tablist"]')!;
    const row = list.getBoundingClientRect();
    const tab = element.getBoundingClientRect();
    const by = Math.min(0, tab.left - row.left) + Math.max(0, tab.right - row.right);
    list.scrollLeft += by;
  });
}

/** The selected tab of the root's own row, which comes before any Tabs nested in a panel, and the panel it labels. */
function selection(root: HTMLElement): { tab: HTMLElement | null; panel: HTMLElement | undefined } {
  const tab = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  return { tab, panel: tab ? [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find((panel) => panel.getAttribute("aria-labelledby") === tab.id) : undefined };
}

/**
 * Measures, as the person chooses a tab, whether the panel's start shows in the box that scrolls (or the page): below the
 * box's `scroll-padding-top` (a sticky bar's room) and a row of tabs (sticky or not), and with a tab's height of the panel
 * above the box's bottom. When it doesn't, returns what brings
 * the tabs to the top of the box with the chosen panel under them, once that panel is drawn, if the choice took, the
 * chosen tab has a panel, and the box is still where it was. Null when the start shows, or without a panel.
 * @claim "if the choice took, the" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs show the chosen panel > moves nothing when the choice doesn't take, the chosen tab has no panel, or the app scrolled the box itself)
 */
function revealPanel(root: HTMLElement): (() => void) | null {
  const { tab, panel } = selection(root);
  if (!panel) return null;
  const list = root.querySelector<HTMLElement>('[role="tablist"]')!;
  const doc = root.ownerDocument;
  // The walk ends at the body, or at a shadow root's edge, where the page scrolls.
  let box = root.parentElement;
  while (box && box !== doc.body && !(getComputedStyle(box).overflowY !== "visible" && box.scrollHeight > box.clientHeight)) box = box.parentElement;
  const scroller = box && box !== doc.body ? box : doc.scrollingElement!;
  const edge = scroller === box ? box.getBoundingClientRect().top : 0;
  const top = edge + (parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0);
  const covered = getComputedStyle(list).flexDirection === "row" ? list.getBoundingClientRect().bottom : top;
  const start = panel.getBoundingClientRect().top;
  if (start >= Math.max(top, covered) && start + tab!.offsetHeight <= edge + scroller.clientHeight) return null;
  const before = scroller.scrollTop;
  const at = before + root.getBoundingClientRect().top - top;
  return () => {
    const now = selection(root);
    if (now.tab !== tab && now.panel && scroller.scrollTop === before) scroller.scrollTo({ top: at, behavior: "instant" });
  };
}

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
 * Choosing a tab brings its panel's start into view under the tabs when it is below the fold
 * or scrolled under a sticky row, and moves nothing when it shows.
 * @claim "Choosing a tab brings its panel's" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs show the chosen panel > brings a panel whose start is below the fold up under the tabs, in the nearest box that scrolls, past one its content overflows in view)
 * @claim "Choosing a tab brings its panel's" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs show the chosen panel > moves nothing when the chosen panel's start shows a row's height under the tabs, to the pixel)
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
export function TabsRootUnchecked({ className, onPointerDownCapture, onValueChange, ref, ...props }: TabsRootProps): JSX.Element {
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
          // The person's choice (not one Base UI makes itself, on mount or when a tab is disabled) is measured before the
          // app's handler and before the chosen panel is drawn, and revealed once it is, before the frame is painted. Until
          // the leaving panel is gone, the browser's scroll anchoring doesn't follow it.
          onValueChange={(value, details) => {
            const element = root.current!;
            const reveal = details.reason === "none" ? revealPanel(element) : null;
            onValueChange?.(value, details);
            element.toggleAttribute("data-ouro-switching", true);
            requestAnimationFrame(() => {
              reveal?.();
              // Base UI takes the leaving panel away later in this frame.
              requestAnimationFrame(() => element.toggleAttribute("data-ouro-switching", false));
            });
          }}
          className={cn(rootClass, className)}
        />
      </PageDirection>
    </TabsContext.Provider>
  );
}

/** Props for {@link TabsList}. Name the list with `aria-label`. */
export type TabsListProps = Omit<BaseTabs.List.Props, "className"> & {
  className?: string | undefined;
  /**
   * Keeps the row at the top of the box that scrolls (or the page) once what is above it scrolls away, over the panel.
   * @claim "Keeps the row at the top" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs show the chosen panel > keeps a sticky row at the top of the box, filled with its surface, brings back a start scrolled under it, and leaves one just under it)
   */
  sticky?: boolean | undefined;
};

/**
 * Part: the row (or column) of tabs. Name it with `aria-label` when the page has more than
 * one set of tabs. `activateOnFocus` selects a tab when the arrow keys focus it. A row that
 * overflows scrolls sideways, on a phone. A key that moves the
 * selection switches tabs without animation.
 */
export function TabsList({ className, ref, onKeyDownCapture, sticky, ...props }: TabsListProps): JSX.Element {
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
      className={cn(listClass, sticky && stickyListClass, className)}
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
  const merged = useMergedRef(props.ref, holdScrollOnMount);
  const tab = (
    <BaseTabs.Tab
      data-ouro-control="tabs"
      data-ouro-part="tab"
      data-slot="tabs-trigger"
      {...props}
      ref={merged}
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
