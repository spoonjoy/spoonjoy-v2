import type { Route } from "./+types/root";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
  Form,
  Link as RouterLink,
  useLocation,
} from "react-router";
import { useEffect } from "react";
import { usePostHog } from "@posthog/react";
import * as Headless from "@headlessui/react";
import { getUserId } from "~/lib/session.server";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { toAnalyticsPageUrl } from "~/lib/analytics";
import { applyStorageSchemaMigration } from "~/lib/client-storage-schema";
import { registerServiceWorker } from "~/lib/push-client";
import { ThemeProvider } from "~/components/ui/theme-provider";
import { ToastProvider } from "~/components/ui/toast";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { MobileNav, DockContextProvider } from "~/components/navigation";
import { InstallPromptCard } from "~/components/pwa/InstallPromptCard";
import { Button } from "~/components/ui/button";
import { OAuthButtonGroup } from "~/components/ui/oauth";
import { SpoonjoyLogo } from "~/components/ui/spoonjoy-logo";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Text } from "~/components/ui/text";
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
  const oauthProviders = getConfiguredOAuthProviders(getOAuthEnv(context));
  return { userId, oauthProviders };
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
function LoginMenu({ oauthProviders }: { oauthProviders: OAuthProvider[] }) {
  return (
    <Headless.Menu as="div" className="relative">
      <Headless.MenuButton className="sj-desktop-nav-link">
        Login
      </Headless.MenuButton>
      <Headless.MenuItems
        anchor="bottom end"
        className="z-50 mt-3 w-80 border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-4 shadow-[var(--sj-shadow-soft)] focus:outline-none"
      >
        <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
          Sign in to SPOONJOY
        </p>
        {oauthProviders.length > 0 ? (
          <OAuthButtonGroup providers={oauthProviders} className="mt-4" />
        ) : (
          <p className="mt-4 text-sm/6 text-[var(--sj-ink-soft)]">
            OAuth is not configured here, but email and password sign-in is available.
          </p>
        )}
        <div className="mt-4 grid gap-2 border-t border-[var(--sj-border)] pt-4">
          <Button href="/login" plain>Use Password</Button>
          <Button href="/signup">Create Account</Button>
        </div>
      </Headless.MenuItems>
    </Headless.Menu>
  );
}

export function AppNavbar({
  userId,
  oauthProviders = [],
}: {
  userId: string | null;
  oauthProviders?: OAuthProvider[];
}) {
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
        <span className="sj-desktop-brand-word">SPOONJOY</span>
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
            <ThemeToggle />
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
            <ThemeToggle />
            <LoginMenu oauthProviders={oauthProviders} />
            <Button href="/signup">Sign Up</Button>
          </div>
        </>
      )}
    </nav>
  );
}

export default function App() {
  const { userId, oauthProviders } = useLoaderData<typeof loader>();
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
    <DockContextProvider>
      <ToastProvider>
        <div className="sj-app-shell relative isolate flex min-h-svh w-full flex-col">
          <header className="sj-desktop-topbar sticky top-0 z-30 hidden items-center px-4 lg:flex">
            <AppNavbar userId={userId} oauthProviders={oauthProviders} />
          </header>
          <main className="sj-desktop-surface sj-mobile-surface grow pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
            <Outlet />
          </main>
        </div>
        <MobileNav isAuthenticated={!!userId} />
        <InstallPromptCard />
      </ToastProvider>
    </DockContextProvider>
  );
}

/**
 * Layout wraps every render — App, ErrorBoundary, and HydrateFallback alike.
 * It owns the html/body chrome + theme so the site renders correctly even when
 * the root loader throws (in which case App is replaced by ErrorBoundary but
 * Layout still mounts). Anything depending on root loader data must live in
 * App, not here.
 */
export function Layout({ children }: { children: React.ReactNode }) {
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
        <ThemeProvider>{children}</ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Root ErrorBoundary — renders for any thrown Response or unhandled error from
 * any route's loader/action/render. Without this, React Router falls back to a
 * bare, unstyled error message; with it, every error becomes a Spoonjoy page.
 * Catch-all 404 routing for unmatched URLs still goes through `routes/$.tsx`;
 * this boundary handles thrown 404s (e.g. `throw new Response("...", {status:404})`).
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;

  let title = "Something went wrong.";
  let message = "We hit an unexpected snag. Try again in a moment.";
  if (status === 404) {
    title = "Page not found.";
    message = "The page you're looking for doesn't exist or may have moved.";
  } else if (status === 403) {
    title = "Not allowed.";
    message = "You don't have access to this page.";
  } else if (status === 401) {
    title = "Please sign in.";
    message = "You need to be signed in to view this page.";
  } else if (isResponse && status >= 400 && status < 500) {
    title = "We can't open that.";
    message = typeof error.data === "string" && error.data.trim()
      ? error.data
      : "Try again, or head back home.";
  }

  return (
    <main className="sj-mobile-surface grow">
      <CookbookPage>
        <CookbookHeader eyebrow="Spoonjoy" title={title}>
          <Text>{message}</Text>
        </CookbookHeader>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/">Go home</Button>
          {status === 401 ? <Button href="/login" plain>Log in</Button> : null}
        </div>
      </CookbookPage>
    </main>
  );
}
