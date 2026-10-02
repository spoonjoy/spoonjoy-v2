import clsx from "clsx";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Globe,
  Home,
  LogOut,
  Menu,
  Plus,
  Search,
  ShoppingBag,
  User,
  Users,
} from "lucide-react";
import { SpoonDock } from "./spoon-dock";
import { DockItem } from "./dock-item";
import { configFromActions, useDockContext, type DockButton, type DockConfig } from "./dock-context";
import { Link } from "~/components/ui/link";

function buttonHref(action: DockButton) {
  return typeof action.onAction === "string" ? action.onAction : undefined;
}

function buttonOnClick(action: DockButton) {
  return typeof action.onAction === "function" ? action.onAction : action.onLinkClick;
}

function isPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function hasExplicitChefSearch(search: string) {
  const params = new URLSearchParams(search);
  return params.has("chef") || params.has("chefId");
}

function shouldHideDock(pathname: string, isAuthenticated: boolean) {
  if (pathname === "/oauth/authorize") {
    return true;
  }

  if (!isAuthenticated) {
    return pathname === "/login" || pathname === "/signup";
  }

  // Forms hide the dock; a cookbook's own page is not a form, so it keeps the dock (R-M3-2). Its
  // inline title editor hides the dock itself (useDockSuppressed in cookbooks.$id.tsx).
  if (pathname === "/recipes/new" || pathname === "/cookbooks/new") {
    return true;
  }

  return pathname.startsWith("/recipes/") && (
    pathname.includes("/edit") ||
    pathname.includes("/steps/")
  );
}

interface PantryToggle {
  isOpen: boolean;
  toggle: () => void;
}

function rootConfig(pathname: string, search: string, isAuthenticated: boolean, pantry: PantryToggle): DockConfig {
  if (!isAuthenticated) {
    return {
      variant: "root",
      left: {
        id: "public-home",
        icon: Home,
        label: "SPOONJOY",
        sublabel: "public",
        onAction: "/",
        active: pathname === "/",
      },
      primary: {
        id: "login",
        icon: User,
        label: "Log in",
        onAction: "/login",
      },
      tools: [
        { id: "search", icon: Search, label: "Search", onAction: "/search", active: isPath(pathname, "/search") },
      ],
    };
  }

  if (pathname === "/recipes") {
    return {
      variant: "root",
      left: {
        id: "recipes-place",
        icon: Globe,
        label: "Recipes",
        onAction: "/recipes",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "kitchen", icon: Home, label: "Kitchen", ariaLabel: "My Kitchen", onAction: "/" },
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
      ],
    };
  }

  if (pathname.startsWith("/search")) {
    return {
      variant: "root",
      left: {
        id: "search-place",
        icon: Search,
        label: "Search",
        onAction: "/search",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "kitchen", icon: Home, label: "Kitchen", onAction: "/" },
        { id: "shopping", icon: ShoppingBag, label: "Shopping list", onAction: "/shopping-list" },
      ],
    };
  }

  if (pathname.startsWith("/shopping-list")) {
    return {
      variant: "root",
      left: {
        id: "shopping-place",
        icon: ShoppingBag,
        label: "Shopping List",
        onAction: "/shopping-list",
        active: true,
      },
      primary: { id: "add-shopping-item", icon: Plus, label: "Add", onAction: "/shopping-list#add-item" },
      tools: [
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
        { id: "kitchen", icon: Home, label: "Kitchen", onAction: "/" },
      ],
    };
  }

  if (pathname.startsWith("/account")) {
    return {
      variant: "root",
      left: {
        id: "account-place",
        icon: User,
        label: "Account",
        sublabel: "settings",
        onAction: "/account/settings",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "kitchen", icon: Home, label: "Kitchen", onAction: "/" },
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
      ],
    };
  }

  if (pathname.startsWith("/cookbooks")) {
    return {
      variant: "root",
      left: {
        id: "cookbooks-place",
        icon: BookOpen,
        label: "Cookbooks",
        onAction: "/cookbooks",
        // Current across the whole section, like the other place items; on a cookbook's page it
        // still links back to the list.
        active: true,
      },
      primary: { id: "new-cookbook", icon: Plus, label: "+", ariaLabel: "Create cookbook", onAction: "/cookbooks/new" },
      tools: [
        { id: "kitchen", icon: Home, label: "Kitchen", ariaLabel: "My Kitchen", onAction: "/" },
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
      ],
    };
  }

  if (pathname.startsWith("/my-recipes")) {
    return {
      variant: "root",
      left: {
        id: "my-recipes-place",
        icon: BookOpen,
        label: "My Recipes",
        onAction: "/my-recipes",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "saved", icon: Bookmark, label: "Saved", onAction: "/saved-recipes" },
        { id: "chefs", icon: Users, label: "Chefs", onAction: "/chefs" },
      ],
    };
  }

  if (pathname.startsWith("/saved-recipes")) {
    return {
      variant: "root",
      left: {
        id: "saved-recipes-place",
        icon: Bookmark,
        label: "Saved",
        onAction: "/saved-recipes",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "my-recipes", icon: BookOpen, label: "My Recipes", onAction: "/my-recipes" },
        { id: "chefs", icon: Users, label: "Chefs", onAction: "/chefs" },
      ],
    };
  }

  if (pathname.startsWith("/chefs")) {
    return {
      variant: "root",
      left: {
        id: "chefs-place",
        icon: Users,
        label: "Chefs",
        onAction: "/chefs",
        active: true,
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "my-recipes", icon: BookOpen, label: "My Recipes", onAction: "/my-recipes" },
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
      ],
    };
  }

  if (pathname.startsWith("/users")) {
    return {
      variant: "context",
      left: {
        id: "back-kitchen",
        icon: ArrowLeft,
        label: "Back",
        sublabel: "kitchen",
        onAction: "/",
      },
      primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
      tools: [
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
        { id: "shopping", icon: ShoppingBag, label: "Shopping list", onAction: "/shopping-list" },
      ],
    };
  }

  return {
    variant: "root",
    left: {
      id: "kitchen-place",
      icon: Home,
      label: "My Kitchen",
      ariaLabel: "My Kitchen",
      onAction: "/",
      active: pathname === "/" && !hasExplicitChefSearch(search),
    },
    primary: { id: "new-recipe", icon: Plus, label: "+", ariaLabel: "Create recipe", onAction: "/recipes/new" },
    tools: [
      { id: "my-recipes", icon: BookOpen, label: "My Recipes", onAction: "/my-recipes" },
      { id: "shopping", icon: ShoppingBag, label: "Shopping list", onAction: "/shopping-list" },
      {
        id: "pantry",
        icon: Menu,
        label: "Pantry",
        ariaLabel: "Pantry navigation",
        onAction: pantry.toggle,
        expanded: pantry.isOpen,
        controls: PANTRY_ID,
      },
    ],
  };
}

const PANTRY_ID = "mobile-pantry";

const pantryLinks = [
  { href: "/recipes", label: "Recipes", icon: Globe },
  { href: "/my-recipes", label: "My Recipes", icon: BookOpen },
  { href: "/saved-recipes", label: "Saved Recipes", icon: Bookmark },
  { href: "/cookbooks", label: "Cookbooks", icon: BookOpen },
  { href: "/shopping-list", label: "Shopping List", icon: ShoppingBag },
  { href: "/chefs", label: "Chefs", icon: Users },
  { href: "/search", label: "Kitchen Search", icon: Search },
];

const pantryItemClassName =
  "flex min-h-12 items-center gap-2 rounded-[var(--sj-radius-control)] px-3 py-2 font-sj-ui text-sm font-bold text-[var(--sj-on-photo)] no-underline transition active:scale-[0.98]";
const pantryIconClassName = "h-4 w-4 shrink-0 text-[var(--sj-on-photo-soft)]";

interface MobileNavProps {
  isAuthenticated?: boolean;
}

export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const location = useLocation();
  const { config, actions, isSuppressed } = useDockContext();
  const [isPantryOpen, setIsPantryOpen] = useState(false);

  useEffect(() => {
    setIsPantryOpen(false);
  }, [location.pathname, location.search]);

  // Escape closes the pantry and returns focus to the button that opened it.
  useEffect(() => {
    if (!isPantryOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsPantryOpen(false);
      document.querySelector<HTMLElement>(`[aria-controls="${PANTRY_ID}"]`)?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isPantryOpen]);

  if (isSuppressed || shouldHideDock(location.pathname, isAuthenticated)) {
    return null;
  }

  const activeConfig = config ?? configFromActions(actions) ?? rootConfig(
    location.pathname,
    location.search,
    isAuthenticated,
    { isOpen: isPantryOpen, toggle: () => setIsPantryOpen((open) => !open) },
  );
  const tools = activeConfig.tools.slice(0, 3);

  // Center the primary on every page so it never jumps sideways between sections. A full
  // tools cluster (3) fits a centered side zone only from 370px up (three 44px targets and
  // two 2px gaps need 136px); narrower phones fall back to edge-to-edge.
  const centered = tools.length <= 2;
  const grow = centered ? "flex-1" : "min-[370px]:flex-1";

  return (
    <>
      <SpoonDock aria-label={activeConfig.ariaLabel ?? "Spoonjoy navigation"} centered={centered}>
        {/* When centered, the side zones grow (flex-1) so the place item and the
            tools fill the dock — no bare dock between items — and the equal zones
            leave the primary dead-center. */}
        <div className={clsx("flex min-w-0 justify-start", grow)}>
          <DockItem
            {...activeConfig.left}
            variant="place"
            className={grow}
            href={buttonHref(activeConfig.left)}
            onClick={buttonOnClick(activeConfig.left)}
          />
        </div>

        <div className="flex shrink-0 justify-center" data-testid="dock-center">
          <DockItem
            {...activeConfig.primary}
            variant="primary"
            tone={activeConfig.primary.tone ?? "primary"}
            href={buttonHref(activeConfig.primary)}
            onClick={buttonOnClick(activeConfig.primary)}
          />
        </div>

        <div className={clsx("flex justify-end", centered ? "gap-1" : "gap-1 min-[370px]:gap-0.5", grow)}>
          {tools.map((tool) => (
            <DockItem
              key={tool.id}
              {...tool}
              variant="tool"
              // A full cluster's tools start at 44px (not 50) so the zone fits its centered share.
              className={centered ? grow : clsx(grow, "min-[370px]:w-11")}
              href={buttonHref(tool)}
              onClick={buttonOnClick(tool)}
            />
          ))}
        </div>
      </SpoonDock>

      {/* The pantry comes after the dock in the document, although it shows above it, so the next
          thing after its button, for VoiceOver or the Tab key, is the pantry it just opened. Both
          it and its backdrop are position: fixed, so their place in the document moves nothing. */}
      {isPantryOpen ? (
        <>
          {/* A tap anywhere outside the pantry closes it without also activating what's under
              it. It sits under the dock (z-50), so the dock stays usable while the pantry is open. */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 lg:hidden"
            data-testid="mobile-pantry-backdrop"
            onClick={() => setIsPantryOpen(false)}
          />
          {/* Same solid charcoal surface as the dock, so no page content shows
              through behind the links. */}
          <div
            id={PANTRY_ID}
            className="fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-50 mx-auto max-w-lg rounded-[var(--sj-radius-surface)] border border-[var(--sj-photo-line)] bg-[var(--sj-photo-charcoal)] p-2 shadow-[0_18px_60px_rgba(31,26,20,0.26),inset_0_1px_0_color-mix(in_srgb,var(--sj-on-photo)_22%,transparent)] lg:hidden"
            data-testid="mobile-pantry"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {pantryLinks.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={pantryItemClassName}>
                  <Icon className={pantryIconClassName} aria-hidden="true" />
                  <span className="min-w-0 truncate">{label}</span>
                </Link>
              ))}
            </div>
            {/* The account and sign-out entries: the only way to either on a phone, where the
                desktop navigation's Account and Logout are hidden. A plain form post, so it works
                before the page hydrates and the next page loads fresh. */}
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 border-t border-[var(--sj-photo-line)] pt-1.5">
              <Link href="/account/settings" className={pantryItemClassName}>
                <User className={pantryIconClassName} aria-hidden="true" />
                <span className="min-w-0 truncate">Account</span>
              </Link>
              <form method="post" action="/logout" className="m-0 flex">
                <button type="submit" className={clsx(pantryItemClassName, "w-full bg-transparent text-left")}>
                  <LogOut className={pantryIconClassName} aria-hidden="true" />
                  <span className="min-w-0 truncate">Log out</span>
                </button>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
