"use client";

import { useId, useState, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { currentTabHref } from "~/lib/ouro/current-path";
import { devThrow } from "~/lib/ouro/dev";
import { RouterLink } from "~/lib/ouro/router-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import {
  TabsIndicator,
  TabsLinkList,
  TabsList,
  TabsPanel,
  TabsRootUnchecked,
  TabsTab,
} from "~/components/ouro/tabs/tabs-parts";
import {
  activations,
  linkIndicatorClass,
  linkItemClass,
  orientations,
  ownLook,
  rootClass,
  tabClass,
  tabFaceClass,
  tabLinkClass,
  type TabsActivation,
  type TabsOrientation,
} from "~/components/ouro/tabs/tabs-styles";

export type { TabsActivation, TabsOrientation } from "~/components/ouro/tabs/tabs-styles";

/** One tab and its panel. */
export interface TabsItem {
  /** Identifies the tab: `value`, `defaultValue` and `onValueChange` use it. Unique within the tabs. */
  value: string;
  /** The tab's text. Keep it short: one or two words. */
  label: ReactNode;
  /** What the panel shows while this tab is selected. */
  content: ReactNode;
  /** Shows the tab but keeps it from being selected. */
  disabled?: boolean | undefined;
  /** Not set: a tab with a panel. Give every item an `href`, and no `content`, for tabs that are links. */
  href?: never;
}

/** One tab that is a link to a page of its own. */
export interface TabsLinkItem {
  /** Identifies the tab: `value` names the current one with it. Unique within the tabs. */
  value: string;
  /** The tab's text. Keep it short: one or two words. */
  label: ReactNode;
  /**
   * The page the tab opens. Internal paths render through `OuroProvider`'s `linkComponent`
   * (your router's link).
   */
  href: string;
  /** Not set: the page at `href` is the tab's content. */
  content?: never;
  /** A link cannot be disabled. Leave the item out instead. */
  disabled?: never;
}

/** Props for {@link Tabs}. Items with `content` make tabs with panels; items with `href`, tabs that are links. */
export interface TabsProps {
  /**
   * Names the tab list for screen readers ("Recipe sections"), or the nav of links. It is not
   * shown: the tabs' own labels are the visible text.
   */
  label: string;
  /**
   * The tabs, in order: each with the panel it shows (`content`), or each a link to its own
   * page (`href`). Links render as a `<nav>` of links named by `label`, and Tab moves between
   * them as between any links.
   *
   * @claim "The tabs, in order: each with" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > renders a labelled tab list with the first tab selected and its panel shown)
   * @claim "Links render as a `<nav>` of" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > renders a named nav of links, marking the current page, with the tabs' look)
   * @claim "Links render as a `<nav>` of" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > moves between the links with Tab, and leaves the arrow keys to the page)
   */
  items: readonly TabsItem[] | readonly TabsLinkItem[];
  /**
   * The selected tab's value, when you control it. Pair it with `onValueChange`. With links,
   * the current page's value, when `currentPath` cannot tell; it wins over `currentPath`.
   */
  value?: string | undefined;
  /** The tab selected first, when the component keeps its own state. Panels only. @default the first enabled item */
  defaultValue?: string | undefined;
  /** Called with the new tab's value when the person selects a tab. Panels only: a link opens its page. */
  onValueChange?: ((value: string) => void) | undefined;
  /**
   * Links only: the path of the page being shown, from your router, with its query when the
   * tabs differ by query (`location.pathname + location.search`). The link at that path whose
   * parameters the path carries gets `aria-current="page"` and the current look; with links at
   * other paths, the longest one the path sits under (`/recipes` for `/recipes/12`).
   * @claim "The link at that path whose" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > marks the tab for the current path, by its query when the tabs share a path)
   */
  currentPath?: string | undefined;
  /**
   * `horizontal` puts the tabs in a row above the panel; `vertical` in a column beside it,
   * from the `sm` breakpoint (640px) up, and in a row on a phone. With panels, the arrow keys
   * follow: left and right in a row, up and down in a column.
   * @default "horizontal"
   * @claim "`horizontal` puts the tabs in a" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > puts vertical tabs in a row above the panel on a narrow screen)
   * @claim "`horizontal` puts the tabs in a" registry/ouro/components/ouro/tabs/tabs.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.touch.test.tsx::stacks vertical tabs in a row on a phone)
   */
  orientation?: TabsOrientation | (string & { 'Use "horizontal" or "vertical"': never }) | undefined;
  /**
   * How the keyboard selects a tab with a panel. `automatic` selects it as soon as the arrow
   * keys focus it, which suits panels that show at once. `manual` moves focus only and waits
   * for Enter or Space, for panels that load slowly.
   * @default "automatic"
   */
  activation?: TabsActivation | (string & { 'Use "automatic" or "manual"': never }) | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `onValueChange`, which gets the tab's value: `<Tabs onValueChange={(value) => …}>`. */
  onChange?: { 'Use <Tabs onValueChange={(value) => ...}>': never };
  /** Not a prop. Ouro UI uses `activation`: `<Tabs activation="manual">`. */
  activateOnFocus?: { 'Use <Tabs activation="automatic"> or activation="manual"': never };
  /** Not a prop. Ouro UI uses `items`: `<Tabs items={[{ value, label, content }]}>`. */
  tabs?: { 'Use <Tabs items={[{ value, label, content }]}>': never };
  /** Not a prop. Tabs that are links use `currentPath`: `<Tabs currentPath={pathname}>`. */
  pathname?: { 'Use <Tabs currentPath={pathname}>': never };
}

/** The first value that appears twice, or undefined. Development only. */
function duplicateValue(items: readonly { value: string }[]): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.value)) return item.value;
    seen.add(item.value);
  }
  return undefined;
}

/**
 * Tabs that switch between panels in place: an accessible tab list with roving focus,
 * arrow-key navigation, a line that slides to the selected tab, and
 * 44px tabs on touch screens. Pass the tabs and their panels as `items`.
 * Under forced colours (Windows contrast themes) each tab keeps a border and the selected one is filled with Highlight.
 *
 * When each tab is a view of one page with a URL of its own (a section's pages, a search's
 * scopes), give each item an `href` instead of `content`: the tabs render as a `<nav>` of
 * links in the same look, through your router's link, with the current one marked
 * `aria-current="page"` from `currentPath`, and Tab moves between them as between any links.
 *
 * Use `SegmentedControl` instead when the choice changes how one view looks (list or grid)
 * rather than which content shows. Use `Navbar` or `Sidebar` instead for the site's own
 * navigation. Use the parts in `tabs-parts` when `items` cannot express your layout.
 *
 * @group Navigation
 * @see https://ourostack.github.io/ouro-ui/docs/tabs
 *
 * @example
 * <Tabs
 *   label="Recipe"
 *   items={[
 *     { value: "ingredients", label: "Ingredients", content: <IngredientList /> },
 *     { value: "method", label: "Method", content: <Steps /> },
 *   ]}
 * />
 * <Tabs
 *   label="Recipes"
 *   currentPath={location.pathname}
 *   items={[
 *     { value: "all", label: "All", href: "/recipes" },
 *     { value: "mine", label: "Mine", href: "/my-recipes" },
 *   ]}
 * />
 * @claim "Tabs that switch between panels in" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > renders a labelled tab list with the first tab selected and its panel shown)
 * @claim "Tabs that switch between panels in" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > slides the indicator under the selected tab)
 * @claim "Tabs that switch between panels in" registry/ouro/components/ouro/tabs/tabs.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.touch.test.tsx::keeps 44px tabs with 16px text on a phone, also in landscape)
 * @claim "Under forced colours (Windows contrast" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > draws each tab's edge under forced colours, where its fill and the underline drop away)
 * @claim "Under forced colours (Windows contrast" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > shows which tab is selected under forced colours: Highlight behind it and HighlightText on it)
 * @claim "When each tab is a view" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > renders a named nav of links, marking the current page, with the tabs' look)
 * @claim "When each tab is a view" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > renders each link through the app's router link)
 * @claim "When each tab is a view" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs as links > moves between the links with Tab, and leaves the arrow keys to the page)
 */
export function Tabs(props: TabsProps): JSX.Element {
  const {
    label,
    items,
    value,
    defaultValue,
    onValueChange,
    orientation: orientationProp = "horizontal",
    activation: activationProp = "automatic",
    currentPath,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    activateOnFocus,
    tabs,
    pathname,
  } = props;
  // An orientation or activation that is not one of Ouro UI's (a type error) warns and renders the default.
  const orientation = orientations.includes(orientationProp as TabsOrientation) ? (orientationProp as TabsOrientation) : "horizontal";
  const activation = activations.includes(activationProp as TabsActivation) ? (activationProp as TabsActivation) : "automatic";
  useAppearanceClassNameCheck(
    "Tabs",
    className,
    process.env.NODE_ENV !== "production" ? ownLook("Tabs") : /* istanbul ignore next @preserve -- production only */ "",
  );
  // Tabs that are links: every item has an href.
  const links = items.length > 0 && items.every((item) => item.href !== undefined);
  const duplicate = duplicateValue(items);
  if (duplicate !== undefined) {
    // Two tabs with one value would select together and loop Base UI's bookkeeping.
    devThrow(
      "Tabs",
      `two items have the value "${duplicate}"`,
      process.env.NODE_ENV !== "production" ? "give each item its own value" : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useDevWarnings(
    "Tabs",
    process.env.NODE_ENV !== "production"
      ? () => {
          const known = (candidate: string | undefined) => candidate === undefined || items.some((item) => item.value === candidate);
          const first = items[0]?.value ?? "…";
          return [
            orientation !== orientationProp && [
              `orientation="${String(orientationProp)}" is not an orientation; use ${orientations.map((name) => `"${name}"`).join(", ")}`,
              '<Tabs orientation="horizontal">',
            ],
            activation !== activationProp && [
              `activation="${String(activationProp)}" is not an activation; use ${activations.map((name) => `"${name}"`).join(", ")}`,
              '<Tabs activation="automatic">',
            ],
            onChange !== undefined && ["onChange is not a prop", "<Tabs onValueChange={(value) => …}>"],
            activateOnFocus !== undefined && [
              "activateOnFocus is not a prop",
              `<Tabs activation="${activateOnFocus === (false as unknown) ? "manual" : "automatic"}">`,
            ],
            tabs !== undefined && ["tabs is not a prop", "<Tabs items={[{ value, label, content }]}>"],
            pathname !== undefined && ["pathname is not a prop", "<Tabs currentPath={pathname}>"],
            !known(defaultValue) && [`defaultValue="${defaultValue}" matches no item`, `<Tabs defaultValue="${first}">`],
            !known(value) && [`value="${value}" matches no item`, `<Tabs value="${first}">`],
            ...(links
              ? (
                  [
                    ["defaultValue", defaultValue],
                    ["onValueChange", onValueChange],
                    ["activation", props.activation],
                  ] as const
                ).map(([name, given]) => given !== undefined && [`${name} does nothing when the tabs are links`, "<Tabs currentPath={pathname}>"] as const)
              : [currentPath !== undefined && (["currentPath marks a link, and these tabs have panels", '<Tabs value="…">'] as const)]),
            !links &&
              items.some((item) => item.href !== undefined) && [
                "some items have an href and some do not, so they render as panels",
                '<Tabs items={[{ value: "…", label: "…", href: "/…" }]}> for links, or { value, label, content } for panels',
              ],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // A column of tabs squeezes the panel on a phone: below the sm breakpoint it becomes a row.
  // Wide in server HTML, so a desktop page does not shift.
  const wide = useMediaQuery("(min-width: 640px)", true);
  const shown = orientation === "vertical" && !wide ? "horizontal" : orientation;
  // Start on the first enabled tab, also in server HTML, where Base UI cannot see which tabs are disabled.
  const [own, setOwn] = useState(() => defaultValue ?? items.find((item) => !item.disabled)?.value ?? null);
  const selected = value !== undefined ? value : own;
  // Ids from useId, so the tab and its panel name each other in server HTML too (Base UI
  // links them only after it mounts). Only the selected panel is mounted, so only the
  // selected tab points at one.
  const id = useId();
  if (links) {
    const linkItems = items as readonly TabsLinkItem[];
    const marked = currentTabHref(
      linkItems.map((item) => item.href),
      currentPath,
    );
    const current = value ?? linkItems.find((item) => item.href === marked)?.value;
    return (
      <div ref={ref} data-ouro="tabs" data-orientation={shown} className={cn(rootClass, className)}>
        <nav aria-label={label} className="min-w-0">
          <TabsLinkList orientation={shown} current={current}>
            {linkItems.map((item) => {
              const here = item.value === current;
              return (
                <li key={item.value} className={linkItemClass}>
                  <RouterLink
                    href={item.href}
                    aria-current={here ? "page" : undefined}
                    data-ouro-control="tabs"
                    data-ouro-part="link"
                    data-orientation={shown}
                    data-active={here ? "" : undefined}
                    className={cn(tabClass, tabLinkClass)}
                  >
                    <span className={tabFaceClass}>{item.label}</span>
                    {here && <span aria-hidden="true" data-ouro-tabs-indicator="" data-orientation={shown} className={linkIndicatorClass} />}
                  </RouterLink>
                </li>
              );
            })}
          </TabsLinkList>
        </nav>
      </div>
    );
  }
  return (
    <TabsRootUnchecked
      ref={ref}
      orientation={shown}
      value={selected}
      onValueChange={(next: string) => {
        setOwn(next);
        onValueChange?.(next);
      }}
      className={className}
    >
      <TabsList aria-label={label} activateOnFocus={activation === "automatic"}>
        {items.map((item, index) => (
          <TabsTab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            id={`${id}tab${index}`}
            aria-controls={item.value === selected ? `${id}panel${index}` : undefined}
          >
            {item.label}
          </TabsTab>
        ))}
        <TabsIndicator />
      </TabsList>
      {items.map((item, index) => (
        <TabsPanel key={item.value} value={item.value} id={`${id}panel${index}`} aria-labelledby={`${id}tab${index}`}>
          {item.content}
        </TabsPanel>
      ))}
    </TabsRootUnchecked>
  );
}
