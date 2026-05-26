import type { Route } from "./+types/root";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  Form,
  Link as RouterLink,
  useLocation,
} from "react-router";
import { useEffect } from "react";
import { usePostHog } from "@posthog/react";
import { getUserId } from "~/lib/session.server";
import { toAnalyticsPageUrl } from "~/lib/analytics";
import { applyStorageSchemaMigration } from "~/lib/client-storage-schema";
import { registerServiceWorker } from "~/lib/push-client";
import { ThemeProvider } from "~/components/ui/theme-provider";
import { ToastProvider } from "~/components/ui/toast";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { MobileNav, DockContextProvider } from "~/components/navigation";
import { StackedLayout } from "~/components/ui/stacked-layout";
import {
  Sidebar,
  SidebarBody,
  SidebarHeader,
  SidebarSection,
  SidebarItem,
  SidebarLabel,
  SidebarFooter,
} from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { SpoonjoyLogo } from "~/components/ui/spoonjoy-logo";
import { BookOpen, Book, ShoppingCart, User, Home, Settings, LogOut, Search } from "lucide-react";
import "./styles/tailwind.css";

export function links() {
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,500..900,60..100,0..1&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400..800&display=swap",
    },
    { rel: "icon", href: "/logos/sj_black.svg", type: "image/svg+xml" },
    { rel: "apple-touch-icon", href: "/logos/sj_black.svg" },
    { rel: "manifest", href: "/manifest.webmanifest" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  return { userId };
}

/**
 * Determine which nav item is active based on current path
 */
function getActiveNav(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/recipes")) return "recipes";
  if (pathname.startsWith("/cookbooks")) return "cookbooks";
  if (pathname.startsWith("/shopping-list")) return "shopping";
  if (pathname.startsWith("/account")) return "account";
  return null;
}

/**
 * Desktop Navbar component - shown in StackedLayout header
 */
export function AppNavbar({ userId }: { userId: string | null }) {
  const location = useLocation();
  const currentNav = getActiveNav(location.pathname);
  const navLinkClass = "sj-desktop-nav-link";

  return (
    <nav className="sj-desktop-nav" aria-label="Main navigation">
      <RouterLink to="/" className="sj-desktop-brand" data-current={currentNav === "home"}>
        <SpoonjoyLogo
          width={42}
          height={26}
          className="sj-desktop-brand-logo"
          aria-hidden="true"
        />
        <span className="sj-desktop-brand-word">Spoonjoy</span>
      </RouterLink>
      {userId ? (
        <>
          <div className="sj-desktop-nav-center">
            <RouterLink to="/search" className={navLinkClass} data-current={currentNav === "search"}>Search</RouterLink>
            <RouterLink to="/recipes" className={navLinkClass} data-current={currentNav === "recipes"}>Recipes</RouterLink>
            <RouterLink to="/cookbooks" className={navLinkClass} data-current={currentNav === "cookbooks"}>Cookbooks</RouterLink>
            <RouterLink to="/shopping-list" className={navLinkClass} data-current={currentNav === "shopping"}>List</RouterLink>
          </div>
          <div className="sj-desktop-nav-actions">
            <span className="inline-flex items-center gap-1.5 text-[var(--sj-ink-soft)]">
              <ThemeToggle />
              <span>Display</span>
            </span>
            <RouterLink to="/account/settings" className={navLinkClass} data-current={currentNav === "account"}>Account</RouterLink>
            <Form method="post" action="/logout" className="m-0">
              <button type="submit" className={navLinkClass} aria-label="Log out">
                Logout
              </button>
            </Form>
          </div>
        </>
      ) : (
        <>
          <div className="sj-desktop-nav-center">
            <RouterLink to="/search" className={navLinkClass} data-current={currentNav === "search"}>Search</RouterLink>
            <RouterLink to="/recipes" className={navLinkClass} data-current={currentNav === "recipes"}>Recipes</RouterLink>
            <RouterLink to="/cookbooks" className={navLinkClass} data-current={currentNav === "cookbooks"}>Cookbooks</RouterLink>
          </div>
          <div className="sj-desktop-nav-actions">
            <span className="inline-flex items-center gap-1.5 text-[var(--sj-ink-soft)]">
              <ThemeToggle />
              <span>Display</span>
            </span>
            <RouterLink to="/login" className={navLinkClass}>Login</RouterLink>
            <Button href="/signup">Sign Up</Button>
          </div>
        </>
      )}
    </nav>
  );
}

/**
 * Mobile Sidebar component - shown when hamburger menu is clicked
 */
function AppSidebar({ userId }: { userId: string | null }) {
  const location = useLocation();
  const currentNav = getActiveNav(location.pathname);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarItem href="/">
          <SpoonjoyLogo />
          <SidebarLabel>Spoonjoy</SidebarLabel>
        </SidebarItem>
      </SidebarHeader>
      <SidebarBody>
        {userId ? (
          <SidebarSection>
            <SidebarItem href="/" current={currentNav === "home"}>
              <Home data-slot="icon" />
              <SidebarLabel>Home</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/search" current={currentNav === "search"}>
              <Search data-slot="icon" />
              <SidebarLabel>Search</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/recipes" current={currentNav === "recipes"}>
              <BookOpen data-slot="icon" />
              <SidebarLabel>Recipes</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/cookbooks" current={currentNav === "cookbooks"}>
              <Book data-slot="icon" />
              <SidebarLabel>Cookbooks</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/shopping-list" current={currentNav === "shopping"}>
              <ShoppingCart data-slot="icon" />
              <SidebarLabel>Shopping List</SidebarLabel>
            </SidebarItem>
          </SidebarSection>
        ) : (
          <SidebarSection>
            <SidebarItem href="/" current={currentNav === "home"}>
              <Home data-slot="icon" />
              <SidebarLabel>Home</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/search" current={currentNav === "search"}>
              <Search data-slot="icon" />
              <SidebarLabel>Search</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/login">
              <User data-slot="icon" />
              <SidebarLabel>Login</SidebarLabel>
            </SidebarItem>
          </SidebarSection>
        )}
      </SidebarBody>
      <SidebarFooter>
        {userId ? (
          <>
            <SidebarItem href="/account/settings" current={currentNav === "account"}>
              <Settings data-slot="icon" />
              <SidebarLabel>Settings</SidebarLabel>
            </SidebarItem>
            <Form method="post" action="/logout" className="w-full">
              <Button type="submit" variant="destructive" className="w-full justify-start">
                <LogOut data-slot="icon" />
                Logout
              </Button>
            </Form>
          </>
        ) : (
          <SidebarItem href="/signup">
            <User data-slot="icon" />
            <SidebarLabel>Sign Up</SidebarLabel>
          </SidebarItem>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export default function App() {
  const { userId } = useLoaderData<typeof loader>();
  const location = useLocation();
  const posthog = usePostHog();

  // Apply storage schema migration after hydration (client-side only)
  useEffect(() => {
    applyStorageSchemaMigration();
    void registerServiceWorker();
  }, []);

  // Track page views on route changes
  useEffect(() => {
    if (posthog) {
      posthog.capture("$pageview", {
        $current_url: toAnalyticsPageUrl(window.location),
      });
    }
  }, [location.pathname, posthog]);

  // Identify user when logged in
  useEffect(() => {
    if (posthog && userId) {
      posthog.identify(userId);
    }
  }, [userId, posthog]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#fbfaf6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <Meta />
        <Links />
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const stored = localStorage.getItem('spoonjoy-theme');
                const theme = stored === 'light' || stored === 'dark'
                  ? stored
                  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.documentElement.classList.add(theme);
              })();
            `,
          }}
        />
      </head>
      <body className="m-0 bg-[var(--sj-page)] p-0 text-[var(--sj-ink)] antialiased">
        <ThemeProvider>
          <DockContextProvider>
            <ToastProvider>
              {/* Desktop: StackedLayout */}
              <div className="hidden lg:block">
                <StackedLayout
                  navbar={<AppNavbar userId={userId} />}
                  sidebar={<AppSidebar userId={userId} />}
                >
                  <Outlet />
                </StackedLayout>
              </div>

              {/* Mobile: Content only */}
              <div className="lg:hidden">
                <main className="sj-mobile-surface pb-[calc(5rem+env(safe-area-inset-bottom))]">
                  <Outlet />
                </main>
              </div>

              {/* SpoonDock - mobile only (MobileNav has lg:hidden) */}
              <MobileNav isAuthenticated={!!userId} />
            </ToastProvider>
          </DockContextProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
