import clsx from "clsx";
import type { ElementType } from "react";
import { useLocation } from "react-router";
import { BookOpen, Globe, Home, Library, LogIn, Search, ShoppingBag } from "lucide-react";
import { useDockContext } from "./dock-context";
import { Link } from "~/components/ui/link";

/**
 * The phone tab bar. It is navigation only, and it is the same on every page: a row of equal
 * tabs, each an icon over a short label, plus Search in its own circle beside them (the
 * iOS 26 tab bar pattern the Spoonjoy iPhone app uses too). Page actions such as create, add,
 * share, edit and cook live on the page itself, never in the tab bar, so a tab never changes
 * meaning between pages.
 */

interface Tab {
  id: string;
  label: string;
  href: string;
  icon: ElementType;
  /** Whether the current page belongs to this tab. */
  owns: (pathname: string) => boolean;
}

function isPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const RECIPE_PATHS = ["/recipes", "/my-recipes", "/saved-recipes"];

const signedInTabs: Tab[] = [
  {
    id: "kitchen",
    label: "Kitchen",
    href: "/",
    icon: Home,
    // Kitchen also owns the pages reached from it: account settings, chefs and profiles.
    owns: (pathname) =>
      pathname === "/" || ["/account", "/chefs", "/users"].some((href) => isPath(pathname, href)),
  },
  {
    id: "recipes",
    label: "Recipes",
    href: "/my-recipes",
    icon: BookOpen,
    owns: (pathname) => RECIPE_PATHS.some((href) => isPath(pathname, href)),
  },
  {
    id: "cookbooks",
    label: "Cookbooks",
    href: "/cookbooks",
    icon: Library,
    owns: (pathname) => isPath(pathname, "/cookbooks"),
  },
  {
    id: "shopping",
    label: "Shopping",
    href: "/shopping-list",
    icon: ShoppingBag,
    owns: (pathname) => isPath(pathname, "/shopping-list"),
  },
];

const signedOutTabs: Tab[] = [
  { id: "home", label: "Home", href: "/", icon: Home, owns: (pathname) => pathname === "/" },
  { id: "recipes", label: "Recipes", href: "/recipes", icon: Globe, owns: (pathname) => isPath(pathname, "/recipes") },
  { id: "login", label: "Log in", href: "/login", icon: LogIn, owns: () => false },
];

function shouldHideTabBar(pathname: string, isAuthenticated: boolean) {
  if (pathname === "/oauth/authorize") {
    return true;
  }

  if (!isAuthenticated) {
    return pathname === "/login" || pathname === "/signup";
  }

  // Forms hide the tab bar; a cookbook's own page is not a form, so it keeps it (R-M3-2). Its
  // inline title editor hides the tab bar itself (useDockSuppressed in cookbooks.$id.tsx).
  if (pathname === "/recipes/new" || pathname === "/cookbooks/new") {
    return true;
  }

  return pathname.startsWith("/recipes/") && (
    pathname.includes("/edit") ||
    pathname.includes("/steps/")
  );
}

// One solid charcoal surface for the bar and the search circle, so no page content shows
// through, in light and dark themes alike.
const surfaceClassName = clsx(
  "border border-[var(--sj-photo-line)]",
  "shadow-[0_18px_60px_rgba(31,26,20,0.28),inset_0_1px_0_color-mix(in_srgb,var(--sj-on-photo)_24%,transparent)]",
);

// Unselected tabs use a solid muted color, not the translucent --sj-on-photo-soft: a translucent
// stroke darkens where an icon's lines overlap, which shows as seams inside the icon.
const mutedClassName = "text-[color-mix(in_srgb,var(--sj-on-photo)_62%,var(--sj-photo-charcoal))]";

const focusClassName =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-on-photo)]";

interface MobileNavProps {
  isAuthenticated?: boolean;
}

export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const { pathname } = useLocation();
  const { isSuppressed } = useDockContext();

  if (isSuppressed || shouldHideTabBar(pathname, isAuthenticated)) {
    return null;
  }

  const tabs = isAuthenticated ? signedInTabs : signedOutTabs;
  const searchActive = isPath(pathname, "/search");

  return (
    <nav
      aria-label="Spoonjoy navigation"
      data-testid="mobile-tab-bar"
      className={clsx(
        "fixed bottom-0 left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))]",
        "z-50 mx-auto mb-[max(1rem,env(safe-area-inset-bottom))] flex max-w-lg items-center gap-2 max-[389px]:gap-1.5 lg:hidden",
      )}
    >
      <ul className={clsx(surfaceClassName, "m-0 flex h-16 bg-[var(--sj-photo-charcoal)] min-w-0 flex-1 list-none items-stretch rounded-full p-1")}>
        {tabs.map(({ id, label, href, icon: Icon, owns }) => {
          const active = owns(pathname);
          return (
            <li key={id} className="flex min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                data-testid={`tab-${id}`}
                className={clsx(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full no-underline transition duration-150 active:scale-95",
                  focusClassName,
                  active
                    ? "bg-[color-mix(in_srgb,var(--sj-on-photo)_14%,transparent)] text-[var(--sj-on-photo)]"
                    : mutedClassName,
                )}
              >
                <Icon
                  className="size-[1.375rem] shrink-0"
                  aria-hidden="true"
                />
                <span className="max-w-full truncate px-0.5 font-sj-ui text-[0.6875rem] font-semibold max-[389px]:text-[0.625rem] leading-none tracking-[0.01em]">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/search"
        aria-label="Search"
        aria-current={searchActive ? "page" : undefined}
        data-testid="tab-search"
        className={clsx(
          surfaceClassName,
          focusClassName,
          "grid size-16 shrink-0 place-items-center max-[389px]:size-14 rounded-full no-underline transition duration-150 active:scale-95",
          // The current search page gets the same lifted fill as a current tab, kept opaque.
          searchActive
            ? "bg-[color-mix(in_srgb,var(--sj-on-photo)_14%,var(--sj-photo-charcoal))] text-[var(--sj-on-photo)]"
            : clsx("bg-[var(--sj-photo-charcoal)]", mutedClassName),
        )}
      >
        <Search className="size-6" aria-hidden="true" />
      </Link>
    </nav>
  );
}
