import clsx from "clsx";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Home,
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
  return typeof action.onAction === "function" ? action.onAction : undefined;
}

function isPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function hasExplicitChefSearch(search: string) {
  const params = new URLSearchParams(search);
  return params.has("chef") || params.has("chefId");
}

function shouldHideDock(pathname: string, isAuthenticated: boolean) {
  if (!isAuthenticated) {
    return pathname === "/login" || pathname === "/signup";
  }

  if (pathname === "/recipes/new" || pathname === "/cookbooks/new" || pathname.startsWith("/cookbooks/")) {
    return true;
  }

  return pathname.startsWith("/recipes/") && (
    pathname.includes("/edit") ||
    pathname.includes("/steps/")
  );
}

function rootConfig(pathname: string, search: string, isAuthenticated: boolean, openPantry: () => void): DockConfig {
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
      { id: "pantry", icon: Menu, label: "Pantry", ariaLabel: "Open pantry navigation", onAction: openPantry },
    ],
  };
}

const pantryLinks = [
  { href: "/my-recipes", label: "My Recipes", icon: BookOpen },
  { href: "/saved-recipes", label: "Saved Recipes", icon: Bookmark },
  { href: "/cookbooks", label: "Cookbooks", icon: BookOpen },
  { href: "/shopping-list", label: "Shopping List", icon: ShoppingBag },
  { href: "/chefs", label: "Chefs", icon: Users },
  { href: "/search", label: "Kitchen Search", icon: Search },
];

interface MobileNavProps {
  isAuthenticated?: boolean;
}

export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const location = useLocation();
  const { config, actions } = useDockContext();
  const [isPantryOpen, setIsPantryOpen] = useState(false);

  useEffect(() => {
    setIsPantryOpen(false);
  }, [location.pathname, location.search]);

  if (shouldHideDock(location.pathname, isAuthenticated)) {
    return null;
  }

  const activeConfig = config ?? configFromActions(actions) ?? rootConfig(
    location.pathname,
    location.search,
    isAuthenticated,
    () => setIsPantryOpen((open) => !open),
  );
  const tools = activeConfig.tools.slice(0, 3);

  // Center the primary unless the tools cluster is full (3), where there's no
  // room to grow + center without squishing touch targets below 44px.
  const centered = tools.length <= 2;

  return (
    <>
      {isPantryOpen ? (
        <div
          className="fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-50 mx-auto max-w-lg rounded-[var(--sj-radius-surface)] border border-[var(--sj-photo-line)] bg-[color-mix(in_srgb,var(--sj-photo-charcoal)_72%,transparent)] p-2 shadow-[0_18px_60px_rgba(31,26,20,0.26),inset_0_1px_0_color-mix(in_srgb,var(--sj-on-photo)_22%,transparent)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--sj-photo-charcoal)_60%,transparent)] lg:hidden"
          data-testid="mobile-pantry"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {pantryLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-12 items-center gap-2 rounded-[var(--sj-radius-control)] px-3 py-2 font-sj-ui text-sm font-bold text-[var(--sj-on-photo)] no-underline transition active:scale-[0.98]"
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--sj-on-photo-soft)]" aria-hidden="true" />
                <span className="min-w-0 truncate">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <SpoonDock aria-label={activeConfig.ariaLabel ?? "Spoonjoy navigation"} centered={centered}>
        {/* When centered, the side zones grow (flex-1) so the place item and the
            tools fill the dock — no bare dock between items — and the equal zones
            leave the primary dead-center. */}
        <div className={clsx("flex min-w-0 justify-start", centered && "flex-1")}>
          <DockItem
            {...activeConfig.left}
            variant="place"
            className={centered ? "flex-1" : undefined}
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

        <div className={clsx("flex justify-end gap-1", centered && "flex-1")}>
          {tools.map((tool) => (
            <DockItem
              key={tool.id}
              {...tool}
              variant="tool"
              className={centered ? "flex-1" : undefined}
              href={buttonHref(tool)}
              onClick={buttonOnClick(tool)}
            />
          ))}
        </div>
      </SpoonDock>
    </>
  );
}
