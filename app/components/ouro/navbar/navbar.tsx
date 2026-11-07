"use client";

import { useId, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { currentHref } from "~/lib/ouro/current-path";
import { RouterLink } from "~/lib/ouro/router-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import { Button } from "~/components/ouro/button/button";
import { NavigationMenuView } from "~/components/ouro/navigation-menu/navigation-menu";
import { SheetFrame } from "~/components/ouro/sheet/sheet";

/** One link in a Navbar: in the bar, or in a group's panel. */
export interface NavbarLink {
  /** The link's text: "Recipes". */
  label: string;
  /** Where it goes. Internal paths go through `OuroProvider`'s `linkComponent` (your router's link). */
  href: string;
  /**
   * In a group: a line under the label in the bar's panel, "Everything you have saved."
   *
   * @claim "In a group: a line under" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar at tablet widths and with groups > opens a group of links as a panel in the bar)
   */
  description?: string | undefined;
  /**
   * Marks this link as the current page (`aria-current="page"`), when the Navbar's
   * `currentPath` cannot tell: a link whose page lives at another path.
   */
  current?: boolean | undefined;
  /** Not with `href`. An item is a link (`href`) or a group of links (`links`). */
  links?: never;
}

/** A group of links in a Navbar: a button that opens a panel in the bar, and a labelled group in the sheet. */
export interface NavbarGroup {
  /** The group's name, the button's text: "Recipes". */
  label: string;
  /**
   * The group's links, each with an optional `description`.
   *
   * @claim "The group's links, each with an" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar at tablet widths and with groups > closes the sheet when the links come to fit)
   */
  links: readonly NavbarLink[];
  /** Not with `links`. To link the section's own page, make it the group's first link. */
  href?: never;
}

/** One item of a Navbar: a link (`href`), or a group of links (`links`). */
export type NavbarItem = NavbarLink | NavbarGroup;

/** Props for {@link Navbar}. */
export interface NavbarProps {
  /** Names the navigation for screen readers ("Main"). It is not shown. */
  label: string;
  /**
   * The links, in order, and groups of links (`{ label, links }`), which open a panel in the
   * bar. When they do not fit, as on a phone, they move into a sheet.
   */
  items: readonly NavbarItem[];
  /**
   * The path of the page being shown, from your router (`useLocation().pathname`, or
   * `usePathname()` in Next.js). The link to that path, or else the longest link above it
   * (`/recipes` for `/recipes/12`), gets `aria-current="page"` and the current look.
   */
  currentPath?: string | undefined;
  /** Your logo or product name, at the start of the bar. Link it to the home page. */
  brand?: ReactNode;
  /**
   * Controls at the end of the bar, at every width: a search button, an account `Menu`.
   *
   * @claim "Controls at the end of the" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar > shows the brand at the start and the actions at the end)
   */
  actions?: ReactNode;
  /**
   * The name of the button that opens the links below 640px, and the title of the sheet
   * it opens. @default "Menu"
   * @claim "The name of the button that" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar > collapses the links into a sheet behind a menu button below 640px)
   * @claim "The name of the button that" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar > hides the menu button from 640px up)
   */
  menuLabel?: string | undefined;
  /** The label of that sheet's close button. @default "Close" */
  closeLabel?: string | undefined;
  /** Layout only: margins, position (`sticky top-0`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `items`: `<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} />`. */
  links?: { 'Use <Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} />': never };
  /** Not a prop. Ouro UI uses `brand`: `<Navbar brand={<Logo />}>`. */
  logo?: { "Use <Navbar brand={<Logo />}>": never };
  /** Not a prop. Ouro UI uses `currentPath`: `<Navbar currentPath={pathname}>`. */
  pathname?: { "Use <Navbar currentPath={pathname}>": never };
  /** Not rendered. The bar is `items`, `brand` and `actions`. */
  children?: { "Use items={[{ label, href }]}, brand={...} and actions={...}": never };
}

// Class strings are literal so the app's Tailwind finds them when it compiles.

const bar =
  "box-border flex min-h-14 items-center gap-2 border-0 border-b border-solid border-border bg-background text-foreground " +
  "ps-[max(1rem,env(safe-area-inset-left,0px))] pe-[max(1rem,env(safe-area-inset-right,0px))]";

// A link: 44px with 16px text on a coarse pointer at every width, 36px with 14px text with a
// fine one. The current page has a bar at the start edge, not a hover highlight.
const link_ =
  "relative m-0 box-border items-center rounded-md px-3 font-medium text-muted-foreground no-underline select-none touch-manipulation " +
  "text-base pointer-fine:text-sm leading-5 [-webkit-tap-highlight-color:transparent] " +
  "pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground " +
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:start-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-current aria-[current=page]:before:content-[''] " +
  "forced-colors:aria-[current=page]:before:border-s-2 forced-colors:aria-[current=page]:before:border-solid forced-colors:aria-[current=page]:before:border-current " +
  "outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
// In the sheet a link is a full-width row, which highlights while pressed instead of scaling.
const sheetLink = "flex min-h-11 pointer-fine:min-h-9 py-2 transition-colors duration-(--ouro-duration-fast) ease-[ease] active:bg-accent active:text-accent-foreground";

const list_ = "m-0 flex list-none p-0";
const example = '<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]}';

/**
 * The bar across the top of an app: your brand, the main links and a few controls, with
 * the current page marked `aria-current="page"` and a bar at the start edge, distinct from hover and press highlights. A group of links (`{ label, links }`)
 * opens a panel, as in `NavigationMenu`. Whenever the links do not fit, below 640px and on
 * a narrow tablet, they collapse behind a menu button into a `Sheet` that slides in from
 * the side, with each group under its name; the brand and `actions` stay in the bar. Links
 * render through `OuroProvider`'s `linkComponent`, so your router navigates.
 *
 * The phone menu opens once JavaScript has loaded (after hydration); the links are in the
 * server HTML from 640px up.
 *
 * Use `Sidebar` instead for more than a handful of destinations, or sections of them. Use
 * `NavigationMenu` alone for a row of panels inside a page, and `Tabs` for views of one
 * page. `StackedLayout` puts a Navbar above the page.
 *
 * @group Navigation
 * @see https://ui.ouro.bot/docs/navbar
 *
 * @example
 * <Navbar
 *   label="Main"
 *   brand={<Link href="/">Spoonjoy</Link>}
 *   items={[
 *     { label: "Recipes", href: "/recipes" },
 *     { label: "Cookbooks", href: "/cookbooks" },
 *   ]}
 *   currentPath={pathname}
 *   actions={<Button href="/recipes/new">New recipe</Button>}
 * />
 * @claim "Whenever the links do not fit" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar at tablet widths and with groups > collapses into the menu button whenever its links do not fit, from 640px up too)
 * @claim "Whenever the links do not fit" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar > collapses the links into a sheet behind a menu button below 640px)
 * @claim "Whenever the links do not fit" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar at tablet widths and with groups > puts a group's button and the bar's links in the server HTML)
 * @claim "The phone menu opens once JavaScript" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar > collapses the links into a sheet behind a menu button below 640px)
 * @claim "The phone menu opens once JavaScript" registry/ouro/components/ouro/navbar/navbar.test.tsx verify:testExists(registry/ouro/components/ouro/navbar/navbar.test.tsx::Navbar at tablet widths and with groups > puts a group's button and the bar's links in the server HTML)
 */
export function Navbar(props: NavbarProps): JSX.Element {
  const {
    label,
    items,
    currentPath,
    brand,
    actions,
    menuLabel = "Menu",
    closeLabel = "Close",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    links,
    logo,
    pathname,
    children,
  } = props;
  useAppearanceClassNameCheck(
    "Navbar",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Navbar sets its own look`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Navbar",
    process.env.NODE_ENV !== "production"
      ? () => [
          !label && ["label is required; it names the navigation for screen readers", '<Navbar label="Main">'],
          links !== undefined && ["links is not a prop", `${example} />`],
          logo !== undefined && ["logo is not a prop", "<Navbar brand={<Logo />}>"],
          pathname !== undefined && ["pathname is not a prop", "<Navbar currentPath={pathname}>"],
          children !== undefined && ["children are not rendered", `${example} brand={…} actions={…} />`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // The links collapse into the sheet below the sm breakpoint, and wherever they do not fit
  // the bar. Server HTML shows them from 640px up, until the client measures.
  const wide = useMediaQuery("(min-width: 640px)", true);
  const [overflow, setOverflow] = useState(false);
  const collapsed = !wide || overflow;
  const [open, setOpen] = useState(false);
  // Focus goes back to the menu button when the sheet closes, in every browser.
  const menuButton = useRef<HTMLButtonElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  if (!collapsed && open) setOpen(false);

  // Before paint, so a client mount never shows a row that does not fit.
  useLayoutEffect(() => {
    const measure = () => {
      // The room the links would have: the slot, and the menu button's place when it shows.
      const button = menuButton.current!.offsetWidth;
      setOverflow(list.current!.scrollWidth > slot.current!.clientWidth + (button > 0 ? button + 8 : 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot.current!);
    observer.observe(list.current!);
    return () => observer.disconnect();
  }, []);

  // An item's own `current` wins; otherwise the path decides, across the links and the groups.
  const all = items.flatMap((item): ReadonlyArray<{ href: string; current?: boolean | undefined }> => (item.links !== undefined ? item.links : [item]));
  const marked = all.some((link) => link.current)
    ? undefined
    : currentHref(
        all.map((link) => link.href),
        currentPath,
      );
  const id = useId();
  const sheetLinkFor = (link: { label: string; href: string; current?: boolean | undefined }, key: number) => (
    <li key={key}>
      <RouterLink
        href={link.href}
        aria-current={link.current || link.href === marked ? "page" : undefined}
        data-ouro-control="navbar"
        data-ouro-part="sheet-link"
        onClick={() => setOpen(false)}
        className={cn(link_, sheetLink)}
      >
        {link.label}
      </RouterLink>
    </li>
  );

  return (
    <header ref={ref} data-ouro="navbar" className={cn(bar, className)}>
      <Button
        ref={menuButton}
        data-ouro-navbar-menu=""
        data-ouro-control="navbar"
        data-ouro-part="menu"
        variant="plain"
        tone="secondary"
        aria-label={menuLabel}
        // Only where the button shows: then it opens the sheet.
        aria-haspopup={collapsed ? "dialog" : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn("-ms-2 w-11 px-0", !overflow && "sm:hidden")}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-5">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        </svg>
      </Button>
      {brand !== undefined && <div className="flex min-w-0 shrink-0 items-center">{brand}</div>}
      {/* The links' slot takes the room between the brand and the actions; hidden but measured when they do not fit. */}
      <div ref={slot} data-ouro-navbar-links="" className={cn("min-w-0 flex-1 overflow-hidden max-sm:hidden", overflow && "invisible")}>
        <NavigationMenuView label={label} items={items} currentPath={currentPath} oneLine listRef={list} />
      </div>
      {actions !== undefined && <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>}
      <SheetFrame title={menuLabel} closeLabel={closeLabel} side="left" open={open} onOpenChange={setOpen} finalFocus={menuButton}>
        <nav aria-label={label}>
          <ul className={cn(list_, "flex-col gap-1")}>
            {items.map((item, index) =>
              item.links !== undefined ? (
                <li key={index} className="grid gap-1 pt-3 first:pt-0">
                  <p id={`${id}${index}`} className="m-0 px-3 py-1 text-xs leading-4 font-medium text-muted-foreground">
                    {item.label}
                  </p>
                  <ul aria-labelledby={`${id}${index}`} className={cn(list_, "flex-col gap-1")}>
                    {item.links.map(sheetLinkFor)}
                  </ul>
                </li>
              ) : (
                sheetLinkFor(item, index)
              ),
            )}
          </ul>
        </nav>
      </SheetFrame>
    </header>
  );
}
