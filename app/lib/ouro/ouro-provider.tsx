"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { useMemo, type JSX, type ReactNode } from "react";
import { DefaultLink, OuroContext, type OuroContextValue, type OuroLinkComponent } from "~/lib/ouro/use-ouro";

export type { OuroContextValue, OuroLinkComponent } from "~/lib/ouro/use-ouro";

/** Props for {@link OuroProvider}. */
export interface OuroProviderProps {
  /** Your app, or the part of it that uses Ouro UI. */
  children: ReactNode;
  /** Renders internal `href`s, for example an adapter around a router's `Link`. */
  linkComponent?: OuroLinkComponent;
}

/**
 * Optional app-level provider that routes internal `href`s through your
 * router's link and groups tooltips: once one `Tooltip` shows, its neighbours open
 * instantly instead of each waiting its own delay. Ouro UI components work without it: they honor reduced motion
 * themselves, in CSS (`motion-reduce:` variants and `prefers-reduced-motion`
 * queries), and need no animation library. If your app animates with Motion,
 * wrap it in `<MotionConfig reducedMotion="user">` for the same behavior.
 *
 * It installs with every component that renders links (`Button`, `Link`, `Card`, `Item`,
 * `Table` and the navigation components) and with `Tooltip`. An app with none of those adds
 * it by name, `lib-ouro-provider`, at the release tag of your other components (the
 * README's Next.js steps show the command).
 * Type a custom adapter with `ComponentProps<OuroLinkComponent>` so it always
 * compiles, including under `exactOptionalPropertyTypes`.
 *
 * Every Ouro UI link takes `href`: `Link`, `Button`, `Card`, `Item` and `Table` rows. An
 * internal `href` (a path) renders through `linkComponent`; an absolute URL (`https:`,
 * `mailto:`) always renders a plain `<a>`. Without a provider, or without `linkComponent`,
 * internal links are plain `<a>` elements too, so they work but load the page.
 *
 * React Router's `Link` takes `to`, so it needs the adapter in the example, which maps
 * `href` to `to`. Wrap the app once, in the root route.
 *
 * In Next.js, `next/link`'s `Link` takes `href` and needs no adapter, but a Server
 * Component can't pass `Link`, a function, to a client component: render the provider from
 * a client file, `app/providers.tsx` in the example, and wrap the app in it from
 * `app/layout.tsx`, which stays a Server Component.
 *
 * @group App setup
 * @see https://ourostack.github.io/ouro-ui/docs/ouro-provider
 * @example
 * // React Router. app/components/ouro-router-link.tsx:
 * import type { ComponentProps } from "react";
 * import { Link } from "react-router";
 * import type { OuroLinkComponent } from "@/lib/ouro/use-ouro";
 *
 * export function OuroRouterLink({ href, ...props }: ComponentProps<OuroLinkComponent>) {
 *   return <Link to={href} {...props} />;
 * }
 *
 * // app/root.tsx:
 * import { Outlet } from "react-router";
 * import { OuroProvider } from "@/lib/ouro/ouro-provider";
 * import { OuroRouterLink } from "@/components/ouro-router-link";
 *
 * export default function App() {
 *   return (
 *     <OuroProvider linkComponent={OuroRouterLink}>
 *       <Outlet />
 *     </OuroProvider>
 *   );
 * }
 *
 * // Next.js App Router. app/providers.tsx:
 * "use client";
 *
 * import Link from "next/link";
 * import type { ReactNode } from "react";
 * import { OuroProvider } from "@/lib/ouro/ouro-provider";
 *
 * export function Providers({ children }: { children: ReactNode }) {
 *   return <OuroProvider linkComponent={Link}>{children}</OuroProvider>;
 * }
 *
 * // app/layout.tsx, a Server Component:
 * import type { ReactNode } from "react";
 * import { Providers } from "./providers";
 *
 * export default function RootLayout({ children }: { children: ReactNode }) {
 *   return (
 *     <html lang="en">
 *       <body>
 *         <Providers>{children}</Providers>
 *       </body>
 *     </html>
 *   );
 * }
 */
export function OuroProvider({ children, linkComponent }: OuroProviderProps): JSX.Element {
  const value = useMemo<OuroContextValue>(
    () => ({ linkComponent: linkComponent ?? DefaultLink }),
    [linkComponent],
  );
  return (
    <OuroContext.Provider value={value}>
      <Tooltip.Provider>{children}</Tooltip.Provider>
    </OuroContext.Provider>
  );
}
