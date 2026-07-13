import clsx from "clsx";
import { useLocation } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Home,
  Plus,
  Search,
  ShoppingBag,
  User,
  Users,
} from "lucide-react";
import { SpoonDock } from "./spoon-dock";
import { DockItem } from "./dock-item";
import { configFromActions, useDockContext, type DockButton, type DockConfig } from "./dock-context";

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

function rootConfig(pathname: string, search: string, isAuthenticated: boolean): DockConfig {
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
      { id: "search", icon: Search, label: "Search", onAction: "/search" },
      { id: "shopping", icon: ShoppingBag, label: "Shopping list", onAction: "/shopping-list" },
    ],
  };
}

interface MobileNavProps {
  isAuthenticated?: boolean;
}

export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const location = useLocation();
  const { config, actions } = useDockContext();

  if (shouldHideDock(location.pathname, isAuthenticated)) {
    return null;
  }

  const activeConfig = config ?? configFromActions(actions) ?? rootConfig(location.pathname, location.search, isAuthenticated);
  const tools = activeConfig.tools.slice(0, 3);

  // Center the primary unless the tools cluster is full (3), where there's no
  // room to grow + center without squishing touch targets below 44px.
  const centered = tools.length <= 2;

  return (
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
  );
}
