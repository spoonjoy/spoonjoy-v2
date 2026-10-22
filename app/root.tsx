import type { Route } from "./+types/root";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
  useNavigation,
  Form,
  useLocation,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { useContext, useEffect } from "react";
import { usePostHog } from "~/lib/use-posthog";
import { getUserId } from "~/lib/session.server";
import { NonceContext } from "~/lib/nonce";
import { revalidateUnlessHashOnly } from "~/lib/hash-only-revalidation";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { toAnalyticsPageUrl } from "~/lib/analytics";
import { applyStorageSchemaMigration, THEME_STORAGE_KEY } from "~/lib/client-storage-schema";
import { clearCookProgressCache } from "~/lib/cook-session-sync";
import { useCookProgressCacheOwner } from "~/hooks/use-cook-session-sync";
import { registerServiceWorkerOnPageLoad } from "~/lib/push-client";
import { ColorSchemeProvider } from "~/lib/ouro/color-scheme";
import { colorSchemeScript } from "~/lib/ouro/color-scheme-script";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { ColorSchemeToggle } from "~/components/ouro/color-scheme-toggle/color-scheme-toggle";
import { OuroRouterLink } from "~/components/navigation/ouro-router-link";
import { Link } from "~/components/ouro/link/link";
import { Navbar } from "~/components/ouro/navbar/navbar";
import { Popover } from "~/components/ouro/popover/popover";
import { Text } from "~/components/ouro/text/text";
import { MobileNav, MobileNavToaster, DockContextProvider } from "~/components/navigation";
import { InstallPromptCard } from "~/components/pwa/InstallPromptCard";
import { Button } from "~/components/button";
import { OAuthButtonGroup } from "~/components/oauth";
import { SpoonjoyLogo } from "~/components/spoonjoy-logo";
import { SkipLink } from "~/components/navigation/skip-link";
import { RouteErrorContent } from "~/components/errors/route-error";
import { PhoneBrandBar } from "~/components/navigation/phone-brand-bar";
import { useHistoryTrail } from "~/hooks/use-back-navigation";
import { useUnsavedFormGuard } from "~/hooks/use-unsaved-form-guard";
import "./styles/tailwind.css";

/**
 * Default document title for every route. React Router only calls a route's
 * own `meta` when that route module exports one; a route with no `meta`
 * inherits this root export instead, so no page ever renders without a
 * `<title>` (axe: document-title). Any route that exports its own `meta`
 * fully replaces this — none of the existing route `meta` functions merge
 * with the parent's via `matches`, so this addition doesn't change their
 * output.
 */
export function meta() {
  return [{ title: "Spoonjoy" }];
}

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

// Hash-only navigations (entering or leaving cook mode) keep the loaded data.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateUnlessHashOnly(args);
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
  if (pathname === "/" || pathname === "") return "kitchen";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/my-recipes")) return "my-recipes";
  if (pathname.startsWith("/saved-recipes")) return "saved-recipes";
  if (pathname.startsWith("/cookbooks")) return "cookbooks";
  if (pathname.startsWith("/shopping-list")) return "shopping";
  if (pathname.startsWith("/chefs")) return "chefs";
  if (pathname.startsWith("/recipes")) return "recipes";
  if (pathname.startsWith("/account")) return "account";
  return null;
}

const signedInLinks = [
  { label: "Kitchen", href: "/", nav: "kitchen" },
  { label: "Recipes", href: "/recipes", nav: "recipes" },
  { label: "My Recipes", href: "/my-recipes", nav: "my-recipes" },
  { label: "Saved", href: "/saved-recipes", nav: "saved-recipes" },
  { label: "Cookbooks", href: "/cookbooks", nav: "cookbooks" },
  { label: "Shopping List", href: "/shopping-list", nav: "shopping" },
  { label: "Chefs", href: "/chefs", nav: "chefs" },
  { label: "Kitchen Search", href: "/search", nav: "search" },
];

const signedOutLinks = [
  { label: "Search", href: "/search", nav: "search" },
  { label: "Recipes", href: "/recipes", nav: "recipes" },
  { label: "Cookbooks", href: "/cookbooks", nav: "cookbooks" },
];

/** Signing in from the desktop bar: an HX Popover with the providers, the password form and signup. */
function LoginPopover({ oauthProviders }: { oauthProviders: OAuthProvider[] }) {
  return (
    <Popover title="Sign in to SPOONJOY" align="end" trigger={<Button plain>Log in</Button>}>
      {oauthProviders.length > 0 ? (
        <OAuthButtonGroup providers={oauthProviders} />
      ) : (
        <Text tone="muted" size="sm">OAuth is not configured here, but email and password sign-in is available.</Text>
      )}
      <div className="mt-4 grid gap-2">
        <Button href="/login" plain>Use Password</Button>
        <Button href="/signup">Create Account</Button>
      </div>
    </Popover>
  );
}

/** The desktop bar: HX Navbar with Spoonjoy's links, the current one marked, and the account actions. */
export function AppNavbar({
  userId,
  oauthProviders = [],
}: {
  userId: string | null;
  oauthProviders?: OAuthProvider[];
}) {
  const location = useLocation();
  const currentNav = getActiveNav(location.pathname);
  const links = userId ? signedInLinks : signedOutLinks;

  return (
    <Navbar
      label="Main navigation"
      brand={
        <Link href="/" tone="secondary" inline={false} aria-label="Spoonjoy kitchen" className="inline-flex items-center gap-4">
          <SpoonjoyLogo width={42} height={26} aria-hidden="true" />
          <span className="font-sj-display text-lg font-extrabold">SPOONJOY</span>
        </Link>
      }
      items={links.map(({ label, href, nav }) => ({ label, href, current: currentNav === nav }))}
      actions={userId ? (
        <>
          <ColorSchemeToggle />
          <Button href="/account/settings" plain aria-current={currentNav === "account" ? "page" : undefined}>Account</Button>
          <Form method="post" action="/logout" className="m-0" onSubmit={clearCookProgressCache}>
            <Button type="submit" plain>Log out</Button>
          </Form>
        </>
      ) : (
        <>
          <ColorSchemeToggle />
          <LoginPopover oauthProviders={oauthProviders} />
          <Button href="/signup">Sign up</Button>
        </>
      )}
    />
  );
}

export default function App() {
  const { userId, oauthProviders } = useLoaderData<typeof loader>();
  const location = useLocation();
  const posthog = usePostHog();

  // Apply storage schema migration after hydration (client-side only)
  useEffect(() => {
    applyStorageSchemaMigration();
    void registerServiceWorkerOnPageLoad();
  }, []);

  // Record which page each history entry shows, for recipe "Back" (after the migration above,
  // which may clear app session storage on a schema change).
  useHistoryTrail();

  // Warn before a full page unload drops unsaved form input (reloads, and the reload after a
  // route chunk fails to load across a release).
  useUnsavedFormGuard();

  // Track page views on route changes
  useEffect(() => {
    if (posthog) {
      posthog.capture("$pageview", {
        $current_url: toAnalyticsPageUrl(window.location),
      });
    }
  }, [location.pathname, posthog]);

  // Cached cook progress never outlives its account in this browser (the logout forms clear it
  // all; this catches sessions that end any other way).
  useCookProgressCacheOwner(userId);

  // Identify user when logged in
  useEffect(() => {
    if (posthog && userId) {
      posthog.identify(userId);
    }
  }, [userId, posthog]);

  return (
    <DockContextProvider>
      <RouteTransitionIndicator />
      <div className="sj-app-shell relative isolate flex min-h-svh w-full flex-col">
        {userId ? null : <PhoneBrandBar />}
        <div className="sj-desktop-topbar sticky top-0 z-30 hidden lg:block">
          <AppNavbar userId={userId} oauthProviders={oauthProviders} />
        </div>
        {/* The bottom padding clears the phone tab bar (MobileNav): its bottom margin,
            max(1rem, safe-area inset), plus its 4rem height and a gap, so the last thing on a
            page never sits under it. */}
        <main
          id="main"
          tabIndex={-1}
          className="sj-desktop-surface sj-mobile-surface grow"
        >
          <Outlet />
        </main>
      </div>
      <MobileNav isAuthenticated={!!userId} />
      <InstallPromptCard />
      <MobileNavToaster isAuthenticated={!!userId} />
    </DockContextProvider>
  );
}

// TODO(ouro-hx: route-progress): The bar that shows a navigation in progress becomes HX's route progress once it ships.
/**
 * Thin top-of-page brass bar that appears while React Router is loading a new
 * route or submitting a form. One global affordance covers every action that
 * used to feel "frozen" between click and response — Fork, Log-cook, account
 * settings, shopping-list submits, cookbook deletes — without each having to
 * wire its own pending UI. Disappears the moment navigation returns to idle.
 */
function RouteTransitionIndicator() {
  const navigation = useNavigation();
  const isActive = navigation.state !== "idle";
  if (!isActive) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="sj-route-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] motion-reduce:animate-none"
    />
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
  // Per-request CSP nonce (server-provided via NonceContext in entry.server).
  // Applied to every inline <script> below so script-src can drop 'unsafe-inline'.
  const nonce = useContext(NonceContext);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        {/* viewport-fit=cover lets iOS report its safe-area insets (the home indicator, the
            notch in landscape) to env(safe-area-inset-*), which the phone tab bar and the page
            padding use; without it they are all 0. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#fbfaf6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <Meta />
        <Links />
        {/* Applies the kept colour scheme before the page paints, so a reload never flashes the wrong one. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: colorSchemeScript({ storageKey: THEME_STORAGE_KEY }) }} />
      </head>
      <body className="m-0 bg-[var(--sj-page)] p-0 text-[var(--sj-ink)] antialiased">
        <ColorSchemeProvider storageKey={THEME_STORAGE_KEY}>
          {/* Ouro UI's links and link buttons navigate through React Router. */}
          <OuroProvider linkComponent={OuroRouterLink}>
            <SkipLink />
            {children}
          </OuroProvider>
        </ColorSchemeProvider>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
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
  return (
    <main id="main" tabIndex={-1} className="sj-mobile-surface grow">
      <RouteErrorContent error={error} />
    </main>
  );
}
