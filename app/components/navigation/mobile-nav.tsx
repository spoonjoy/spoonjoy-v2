import { useLocation } from "react-router";
import { BookOpen, Globe, Home, Library, LogIn, Search, ShoppingBag } from "lucide-react";
import { useDockContext } from "./dock-context";
import { TabBar, type TabBarItem } from "~/components/ouro/tab-bar/tab-bar";
import { InstallPrompt } from "~/components/ouro/install-prompt/install-prompt";
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
  /** How many recipes the cook has in progress, shown on the home tab. */
  cookingNowCount?: number;
}

/**
 * The home tab's icon with the Cooking now count on it, since the home tab opens the Kitchen's
 * Cooking now strip. The count is hidden from screen readers, as the icon is; the strip says it.
 */
function homeIconWithCount(count: number) {
  return (
    <span className="relative grid size-full">
      <Home className="size-full" />
      <span
        data-testid="tab-cooking-now-count"
        className="absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--sj-brass)] px-1 font-sj-ui text-[0.625rem] font-bold leading-4 text-[var(--sj-paper)]"
      >
        {count}
      </span>
    </span>
  );
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

/**
 * HX's install offer, floating above the phone's tab bar (its bottom margin, max(1rem, safe-area
 * inset), plus its 4rem height and a gap). It shows only where the tab bar does, so it never covers
 * sign-in, sign-up, a form or a single-decision page, where nothing below it makes room. Keeps
 * Spoonjoy's earlier dismissal key, so a "Not now" stands.
 */
export function MobileNavInstallPrompt({ isAuthenticated }: { isAuthenticated: boolean }) {
  if (!useMobileNavEligibility(isAuthenticated)) return null;
  return (
    <InstallPrompt
      title="Install Spoonjoy"
      description="Add Spoonjoy to your home screen for faster access and a more native feel."
      storageKey="spoonjoy.pwa-install.dismissed-at"
      className="fixed inset-x-4 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] z-40 mx-auto max-w-md print:hidden"
    />
  );
}

/** HX's tab bar on phones, below the lg breakpoint where the desktop Navbar takes over. */
export function MobileNav({ isAuthenticated = true, cookingNowCount = 0 }: MobileNavProps) {
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
      className="sj-tab-bar"
      items={(isAuthenticated ? signedInTabs : signedOutTabs).map((tab) =>
        tab.href === "/" && cookingNowCount > 0 ? { ...tab, icon: homeIconWithCount(cookingNowCount) } : tab)}
      accessory={{ label: "Search", href: "/search", icon: <Search /> }}
    />
  );
}
