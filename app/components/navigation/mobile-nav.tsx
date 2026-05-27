import { useLocation } from "react-router";
import {
  ArrowLeft,
  Home,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  User,
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

function shouldHideDock(pathname: string, isAuthenticated: boolean) {
  if (!isAuthenticated) {
    return pathname === "/login" || pathname === "/signup";
  }

  if (pathname === "/recipes/new" || pathname === "/cookbooks/new" || pathname.startsWith("/cookbooks/")) {
    return true;
  }

  return pathname.startsWith("/recipes/");
}

function rootConfig(pathname: string, isAuthenticated: boolean): DockConfig {
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
        sublabel: "index",
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
        label: "List",
        sublabel: "market",
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
        icon: Settings,
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
        icon: Home,
        label: "Shelf",
        sublabel: "cookbooks",
        onAction: "/cookbooks",
        active: true,
      },
      primary: { id: "new-cookbook", icon: Plus, label: "+", ariaLabel: "Create cookbook", onAction: "/cookbooks/new" },
      tools: [
        { id: "search", icon: Search, label: "Search", onAction: "/search" },
        { id: "shopping", icon: ShoppingBag, label: "Shopping list", onAction: "/shopping-list" },
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
      label: "Kitchen",
      sublabel: "home",
      onAction: "/",
      active: pathname === "/",
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

  const activeConfig = config ?? configFromActions(actions) ?? rootConfig(location.pathname, isAuthenticated);
  const tools = activeConfig.tools.slice(0, 2);

  return (
    <SpoonDock aria-label={activeConfig.ariaLabel ?? "Spoonjoy navigation"}>
      <div className="flex min-w-0 justify-start">
        <DockItem
          {...activeConfig.left}
          variant="place"
          href={buttonHref(activeConfig.left)}
          onClick={buttonOnClick(activeConfig.left)}
        />
      </div>

      <div className="flex justify-center" data-testid="dock-center">
        <DockItem
          {...activeConfig.primary}
          variant="primary"
          tone={activeConfig.primary.tone ?? "primary"}
          href={buttonHref(activeConfig.primary)}
          onClick={buttonOnClick(activeConfig.primary)}
        />
      </div>

      <div className="flex justify-end gap-1">
        {tools.map((tool) => (
          <DockItem
            key={tool.id}
            {...tool}
            variant="tool"
            href={buttonHref(tool)}
            onClick={buttonOnClick(tool)}
          />
        ))}
      </div>
    </SpoonDock>
  );
}
