"use client";

import { useSyncExternalStore, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { currentHref } from "~/lib/ouro/current-path";
import { RouterLink } from "~/lib/ouro/router-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  accessoryClass,
  barClass,
  breakpoints,
  iconClass,
  labelClass,
  listClass,
  rootClass,
  tabClass,
} from "~/components/ouro/tab-bar/tab-bar-styles";

/** One tab in a TabBar: a page of the app, with its icon and a short label. */
export interface TabBarItem {
  /** The tab's text, one short word under the icon: "Recipes". Screen readers hear it as the link's name. */
  label: string;
  /** Where the tab goes. Internal paths go through `OuroProvider`'s `linkComponent` (your router's link). */
  href: string;
  /** The tab's icon, an `<svg>` (a lucide-react icon, for example). It is hidden from screen readers; the label names the tab. */
  icon: ReactNode;
  /**
   * Other paths whose pages belong to this tab, so it stays current there: a Home tab that
   * also owns `/account`. Each matches its own path and the pages under it.
   * @claim "Each matches its own path and" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /\["/account/settings",\s"Home"\]/)
   */
  paths?: readonly string[] | undefined;
  /** Marks this tab as the current page (`aria-current="page"`), when the paths cannot tell. */
  current?: boolean | undefined;
}

/** Props for {@link TabBar}. */
export interface TabBarProps {
  /** Names the navigation for screen readers ("Main"). It is not shown. */
  label: string;
  /**
   * The tabs, in order: two to five of the app's top-level pages.
   *
   * @claim "The tabs, in order: two to" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /6\stabs\sdo\snot\sfit\sa\sphone's\swidth/)
   */
  items: readonly TabBarItem[];
  /**
   * An item that sits apart, in a circle of its own at the end of the bar, as iOS sets
   * Search apart from the tabs. Only its icon shows; its `label` names it for screen readers.
   */
  accessory?: TabBarItem | undefined;
  /**
   * The path of the page being shown, from your router (`useLocation().pathname`, or
   * `usePathname()` in Next.js). The tab whose `href` or `paths` match it, or else the longest
   * one above it (`/recipes` for `/recipes/12`), gets `aria-current="page"` and the current look.
   */
  currentPath?: string | undefined;
  /**
   * The breakpoint from which the bar hides, because the app's `Navbar` or `Sidebar` takes over
   * there. `never` keeps it at every width.
   * @default "sm"
   * @claim "`never` keeps it at every width" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /hides\sfrom\s%s\s\(%ipx\),\sand\swith\snever\sstays/)
   */
  hideFrom?: "sm" | "md" | "lg" | "xl" | "never" | (string & { 'Use "sm", "md", "lg", "xl" or "never"': never }) | undefined;
  /** Layout only: rarely needed, since the bar places itself. Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the `<nav>`. */
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `items`: `<TabBar label="Main" items={[{ label, href, icon }]} />`. */
  tabs?: { 'Use <TabBar label="Main" items={[{ label: "Recipes", href: "/recipes", icon: <BookOpen /> }]} />': never };
  /** Not a prop. Ouro UI uses `items`: `<TabBar label="Main" items={[{ label, href, icon }]} />`. */
  links?: { 'Use <TabBar label="Main" items={[{ label: "Recipes", href: "/recipes", icon: <BookOpen /> }]} />': never };
  /** Not a prop. Ouro UI uses `currentPath`: `<TabBar currentPath={pathname}>`. */
  pathname?: { 'Use <TabBar currentPath={pathname}>': never };
  /** Not a prop. The current tab follows `currentPath`, or an item's `current`: `<TabBar currentPath={pathname}>`. */
  value?: { 'Use <TabBar currentPath={pathname}>, or current: true on the item': never };
  /** Not rendered. The bar is `items` and `accessory`. */
  children?: { 'Use items={[{ label, href, icon }]} and accessory={{ label, href, icon }}': never };
}

const example = '<TabBar label="Main" items={[{ label: "Recipes", href: "/recipes", icon: <BookOpen /> }]} />';

/**
 * How much of the screen a keyboard covers, at the least: more than a browser's own toolbars, which also shrink the visual viewport.
 *
 * @claim "How much of the screen a" registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx::TabBar and the on-screen keyboard > slides away while the keyboard shrinks the visual viewport, even with no field focused, but not for a zoom)
 */
const KEYBOARD = 150;
/**
 * Input types that bring up no on-screen keyboard.
 *
 * @claim "Input types that bring up no" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > stays in place when a field takes focus under a fine pointer, which brings up no on-screen keyboard)
 */
const keyless = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Whether the focused element takes typing: a text field, a text area or an editable region. */
function typing(): boolean {
  const field = document.activeElement;
  if (field instanceof HTMLTextAreaElement) return !field.readOnly;
  if (field instanceof HTMLInputElement) return !field.readOnly && !keyless.has(field.type);
  return field instanceof HTMLElement && field.isContentEditable;
}

/** The tallest the layout viewport has been at its current width; a turn of the phone starts again. */
let layout = { width: 0, height: 0 };

/**
 * Whether the on-screen keyboard is up. Where it covers the page (iOS, and Android by default),
 * it shrinks the visual viewport below the layout viewport, and that alone decides: a field
 * keeps its focus when the keyboard is put away (Android's back gesture, iPad's hide-keyboard
 * key), so focus would keep the bar away. A pinch zoom shrinks the visual viewport too, so it
 * is measured at the zoom's scale. Where the keyboard resizes the page instead, the layout
 * viewport shrinks well below the tallest it has been at this width, with a text field focused
 * on a touch screen. With no visual viewport to read, the focused field is the only sign.
 * @claim "With no visual viewport to read" registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx::TabBar and the on-screen keyboard > where the browser has no visual viewport > follows a focused field)
 * @claim "With no visual viewport to read" registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx::TabBar and the on-screen keyboard > slides away while the keyboard shrinks the visual viewport, even with no field focused, but not for a zoom)
 */
function keyboardUp(): boolean {
  const viewport = window.visualViewport;
  const field = matchMedia("(pointer: coarse)").matches && typing();
  if (viewport === null) return field;
  if (innerHeight - viewport.height * viewport.scale > KEYBOARD) return true;
  if (innerWidth === layout.width) layout.height = Math.max(layout.height, innerHeight);
  else layout = { width: innerWidth, height: innerHeight };
  return field && layout.height - innerHeight > KEYBOARD;
}

function subscribeKeyboard(listener: () => void): () => void {
  const viewport = window.visualViewport;
  // Focus moving from one field to the next leaves nothing focused for a moment; the focusin that follows reports it.
  const left = (event: FocusEvent) => {
    if (event.relatedTarget === null) listener();
  };
  viewport?.addEventListener("resize", listener);
  document.addEventListener("focusin", listener);
  document.addEventListener("focusout", left);
  return () => {
    viewport?.removeEventListener("resize", listener);
    document.removeEventListener("focusin", listener);
    document.removeEventListener("focusout", left);
  };
}

const serverFalse = () => false;

/**
 * Every path a tab owns, with the tab's index, for `currentHref`.
 *
 * @claim "Every path a tab owns, with" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > lets an item's current flag win over the path)
 * @claim "Every path a tab owns, with" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > gives the current tab the accent wash and the rest the muted text)
 */
function ownedPaths(items: readonly TabBarItem[]): Array<{ path: string; index: number }> {
  return items.flatMap((item, index) => [item.href, ...(item.paths ?? [])].map((path) => ({ path, index })));
}

/**
 * The bar of tabs at the bottom of a phone screen: two to five of the app's top-level
 * pages, each an icon over a short label, with the current page marked `aria-current="page"`
 * and an accent wash. An `accessory`, such as Search, sits apart in a circle of its own, as
 * in iOS. The bar is navigation only and the same on every page: put page actions (create,
 * share, edit) on the page itself, never in the bar, so a tab never changes meaning.
 *
 * The bar is fixed to the bottom of the screen, clear of the home indicator, and the
 * component keeps its room at the end of the page, so render it last in the layout and the
 * content scrolls clear of it. It hides from `hideFrom` (640px by default), where the app's
 * `Navbar` or `Sidebar` takes over, and when printing. While the on-screen keyboard is up it
 * slides away below the screen (with reduced motion it fades), so it never rides on the
 * keyboard over the field a person types in, and it comes back when the keyboard goes. To
 * hide it on a page that fills the screen (a full-screen editor, a single decision), don't
 * render it there.
 *
 * Tabs render through `OuroProvider`'s `linkComponent`, so your router navigates. Each tab
 * is 64px tall, well over the 44px a finger needs.
 *
 * Use `Navbar` instead for the links across the top of a wider screen, `Sidebar` for many
 * destinations, and `Tabs` for views of one page.
 *
 * @group Navigation
 * @see https://ui.ouro.bot/docs/tab-bar
 *
 * @example
 * <TabBar
 *   label="Main"
 *   currentPath={pathname}
 *   items={[
 *     { label: "Home", href: "/", icon: <House />, paths: ["/account"] },
 *     { label: "Recipes", href: "/recipes", icon: <BookOpen /> },
 *     { label: "Shopping", href: "/shopping-list", icon: <ShoppingBag /> },
 *   ]}
 *   accessory={{ label: "Search", href: "/search", icon: <Search /> }}
 * />
 * @claim "Each tab is 64px tall, well" registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.touch.test.tsx::fits five tabs and an accessory on a phone, each well over 44px, and a tap reaches the tab under the finger)
 * @claim "The bar of tabs at the" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > sits fixed at the bottom of a phone screen, with equal 64px tabs, and keeps its room in the page)
 * @claim "The bar is navigation only and" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /hides\sfrom\s%s\s\(%ipx\),\sand\swith\snever\sstays/)
 * @claim "It hides from `hideFrom` (640px by" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /hides\sfrom\s%s\s\(%ipx\),\sand\swith\snever\sstays/)
 * @claim "While the on-screen keyboard is up" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx, /hides\sfrom\s%s\s\(%ipx\),\sand\swith\snever\sstays/)
 * @claim "It hides from `hideFrom` (640px by" registry/ouro/components/ouro/tab-bar/tab-bar-styles.ts verify:fileLine(registry/ouro/components/ouro/tab-bar/tab-bar-styles.ts, /print:hidden/)
 */
export function TabBar(props: TabBarProps): JSX.Element {
  const {
    label,
    items,
    accessory,
    currentPath,
    hideFrom: hideFromProp = "sm",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    tabs,
    links,
    pathname,
    value,
    children,
  } = props;
  // A breakpoint that is not one of Ouro UI's (a type error) warns and renders the default.
  const hideFrom = Object.hasOwn(breakpoints, hideFromProp) ? (hideFromProp as keyof typeof breakpoints) : "sm";
  useAppearanceClassNameCheck(
    "TabBar",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; TabBar sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "TabBar",
    process.env.NODE_ENV !== "production"
      ? () => [
          !label && ["label is required; it names the navigation for screen readers", '<TabBar label="Main">'],
          tabs !== undefined && ["tabs is not a prop", example],
          links !== undefined && ["links is not a prop", example],
          pathname !== undefined && ["pathname is not a prop", "<TabBar currentPath={pathname}>"],
          value !== undefined && ["value is not a prop; the current tab follows the page's path", "<TabBar currentPath={pathname}>"],
          children !== undefined && ["children are not rendered", example],
          hideFrom !== hideFromProp && [`hideFrom="${String(hideFromProp)}" is not a breakpoint; use "sm", "md", "lg", "xl" or "never"`, '<TabBar hideFrom="lg">'],
          items.length > 5 && [
            `${items.length} tabs do not fit a phone's width`,
            "keep two to five items, and link the rest from a page of their own",
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // An item's own `current` wins; otherwise the path decides, across the tabs and the accessory.
  const all = accessory === undefined ? items : [...items, accessory];
  const flagged = all.findIndex((item) => item.current);
  let current = flagged;
  if (flagged === -1) {
    const owned = ownedPaths(all);
    const match = currentHref(
      owned.map((entry) => entry.path),
      currentPath,
    );
    current = match === undefined ? -1 : owned.find((entry) => entry.path === match)!.index;
  }
  const isCurrent = (index: number) => (index === current ? ("page" as const) : undefined);
  // The server cannot know, so the bar renders in place and steps aside after hydration if the keyboard is up.
  const aside = useSyncExternalStore(subscribeKeyboard, keyboardUp, serverFalse);

  return (
    <div data-ouro="tab-bar" className={cn(rootClass, breakpoints[hideFrom], className)}>
      <nav
        ref={ref}
        aria-label={label}
        data-ouro-part="bar"
        data-open={aside ? undefined : ""}
        data-closed={aside ? "" : undefined}
        inert={aside}
        className={barClass}
      >
        <ul className={listClass}>
          {items.map((item, index) => (
            <li key={index} className="flex min-w-0 flex-1">
              <RouterLink href={item.href} aria-current={isCurrent(index)} data-ouro-control="tab-bar" data-ouro-part="tab" className={tabClass}>
                <span aria-hidden="true" className={iconClass}>
                  {item.icon}
                </span>
                <span className={labelClass}>{item.label}</span>
              </RouterLink>
            </li>
          ))}
        </ul>
        {accessory !== undefined && (
          <RouterLink
            href={accessory.href}
            aria-current={isCurrent(items.length)}
            data-ouro-control="tab-bar"
            data-ouro-part="accessory"
            className={accessoryClass}
          >
            <span aria-hidden="true" className={cn(iconClass, "size-6")}>
              {accessory.icon}
            </span>
            <span className="sr-only">{accessory.label}</span>
          </RouterLink>
        )}
      </nav>
    </div>
  );
}
