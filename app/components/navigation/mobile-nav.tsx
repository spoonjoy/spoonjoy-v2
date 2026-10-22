import { useLocation } from "react-router";
import { BookOpen, Globe, Home, Library, LogIn, Search, ShoppingBag } from "lucide-react";
import { useDockContext } from "./dock-context";
import { TabBar, type TabBarItem } from "~/components/ouro/tab-bar/tab-bar";
import { Toaster } from "~/components/ouro/toast/toaster";

/**
 * The phone tab bar. It is navigation only, and it is the same on every page: a row of equal
 * tabs, each an icon over a short label, plus Search in its own circle beside them (the
 * iOS 26 tab bar pattern the Spoonjoy iPhone app uses too). Page actions such as create, add,
 * share, edit and cook live on the page itself, never in the tab bar, so a tab never changes
 * meaning between pages.
 */

const signedInTabs: TabBarItem[] = [
  // Kitchen also owns the pages reached from it: account settings, chefs and profiles.
  { label: "Kitchen", href: "/", icon: <Home />, paths: ["/account", "/chefs", "/users"] },
  { label: "Recipes", href: "/my-recipes", icon: <BookOpen />, paths: ["/recipes", "/saved-recipes"] },
  { label: "Cookbooks", href: "/cookbooks", icon: <Library /> },
  { label: "Shopping", href: "/shopping-list", icon: <ShoppingBag /> },
];

const signedOutTabs: TabBarItem[] = [
  { label: "Home", href: "/", icon: <Home /> },
  { label: "Recipes", href: "/recipes", icon: <Globe /> },
  { label: "Log in", href: "/login", icon: <LogIn /> },
];

function shouldHideTabBar(pathname: string, isAuthenticated: boolean) {
  // The connector consent screen and the "Log out?" confirmation are single-decision pages: the
  // bar would only cover their last choice ("Stay signed in" on /logout sat at its top edge).
  if (pathname === "/oauth/authorize" || pathname === "/logout") {
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

  // /recipes/:id/edit and /recipes/:id/steps/...; compare segments, so a recipe id that merely
  // starts with "edit" keeps the tab bar.
  const [, section, , subpage] = pathname.split("/");
  return section === "recipes" && (subpage === "edit" || subpage === "steps");
}

interface MobileNavProps {
  isAuthenticated?: boolean;
}

/** Auth/path/suppression eligibility; CSS still owns the screen/print breakpoint. */
export function useMobileNavEligibility(isAuthenticated: boolean) {
  const { pathname } = useLocation();
  const { isSuppressed } = useDockContext();
  return !isSuppressed && !shouldHideTabBar(pathname, isAuthenticated);
}

/**
 * HX's Toaster, raised on phones above the tab bar while it shows (its 4rem bar, the gap below
 * it and a 1.25rem gap above), so a toast never covers a tab.
 */
export function MobileNavToaster({ isAuthenticated }: { isAuthenticated: boolean }) {
  const clearsTabBar = useMobileNavEligibility(isAuthenticated);
  return <Toaster className={clearsTabBar ? "max-lg:bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)]" : undefined} />;
}

/** HX's tab bar on phones, below the lg breakpoint where the desktop Navbar takes over. */
export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const { pathname } = useLocation();
  const isEligible = useMobileNavEligibility(isAuthenticated);

  if (!isEligible) {
    return null;
  }

  return (
    <TabBar
      label="Spoonjoy navigation"
      currentPath={pathname}
      hideFrom="lg"
      items={isAuthenticated ? signedInTabs : signedOutTabs}
      accessory={{ label: "Search", href: "/search", icon: <Search /> }}
    />
  );
}
