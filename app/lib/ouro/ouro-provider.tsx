"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { useMemo, type JSX, type ReactNode, type RefObject } from "react";
import { DefaultLink, OuroContext, useOuro, type OuroContextValue, type OuroLinkComponent } from "~/lib/ouro/use-ouro";

export type { OuroContextValue, OuroLinkComponent } from "~/lib/ouro/use-ouro";

/** Props for {@link OuroProvider}. */
export interface OuroProviderProps {
  /** Your app, or the part of it that uses Ouro UI. */
  children: ReactNode;
  /** Renders internal `href`s, for example an adapter around a router's `Link`. */
  linkComponent?: OuroLinkComponent;
  /**
   * The element floating popups render into: the lists of `Select` and `Combobox`, and
   * `Menu`, `Popover`, `DatePicker`, `Tooltip`, `HoverCard` and `NavigationMenu`. Unset,
   * they render at the end of `<body>`, outside every landmark, where screen reader users
   * who move by landmark miss them. Pass an element, or a ref to one, inside `<main>` that
   * does not clip what it holds (no `overflow` other than `visible`) and is not inside an
   * element with a `transform`, `filter` or `contain`, which would hold the phone sheets'
   * `position: fixed`. Render it last in `<main>`, after the content, so popups stack over the
   * page; a ref works even when the element comes after a popup that is open at once. A
   * provider inside another keeps the outer one's container when it sets none, and `null`
   * gives popups Base UI's place again: wrap the content of a dialog that is not Ouro UI's in
   * `<OuroProvider portalContainer={null}>` so its popups open inside it. Dialogs, sheets and
   * toasts stay at the end of `<body>`: a dialog is announced when it opens, and the toasts
   * are a landmark of their own.
   * @claim "Unset, they render at the end of" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > leaves a popup at the end of <body>, Base UI's default, without a portalContainer)
   * @claim "Pass an element, or a ref to" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > renders a popup into OuroProvider's portalContainer, given as an element)
   * @claim "Pass an element, or a ref to" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > renders a popup into OuroProvider's portalContainer, given as a ref)
   * @claim "a ref works even when the" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > renders a popup open on the first render into a portalContainer ref whose element comes later in the page)
   * @claim "A provider inside another keeps the" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > keeps the portalContainer of an outer OuroProvider inside one that does not set it)
   * @claim "A provider inside another keeps the" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > gives popups Base UI's own place again inside an OuroProvider whose portalContainer is null, as an app's own dialog needs)
   */
  portalContainer?: HTMLElement | RefObject<HTMLElement | null> | null | undefined;
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
 * @see https://ui.ouro.bot/docs/ouro-provider
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
 * @claim "An app with none of those" scripts/registry.mts verify:fileLine(scripts/registry.mts, /entry\.name === "lib-router-link" \|\| entry\.name === "tooltip"\) registryDeps\.add\("lib-ouro-provider"\)/)
 * @claim "Optional app-level provider that routes internal" registry/ouro/components/ouro/link/link.test-d.ts verify:fileLine(registry/ouro/components/ouro/link/link.test-d.ts, /expectTypeOf<\{\shref:\s"\/recipes";\schildren:\s"Recipes"\s\}>\(\)\.toExtend<LinkProps>/)
 * @claim "Every Ouro UI link takes `href`" registry/ouro/components/ouro/link/link.test-d.ts verify:fileLine(registry/ouro/components/ouro/link/link.test-d.ts, /expectTypeOf<\{\shref:\s"\/recipes";\schildren:\s"Recipes"\s\}>\(\)\.toExtend<LinkProps>/)
 * @claim "An internal `href` (a path) renders" registry/ouro/components/ouro/link/link.test-d.ts verify:fileLine(registry/ouro/components/ouro/link/link.test-d.ts, /expectTypeOf<\{\shref:\s"\/recipes";\schildren:\s"Recipes"\s\}>\(\)\.toExtend<LinkProps>/)
 * @claim "In Next.js, `next/link`'s `Link` takes `href`" registry/ouro/components/ouro/link/link.test-d.ts verify:fileLine(registry/ouro/components/ouro/link/link.test-d.ts, /expectTypeOf<\{\shref:\s"\/recipes";\schildren:\s"Recipes"\s\}>\(\)\.toExtend<LinkProps>/)
 * @claim "Ouro UI components work without it" registry/ouro/lib/ouro/ouro-provider.test.tsx verify:testExists(registry/ouro/lib/ouro/ouro-provider.test.tsx::OuroProvider and useOuro > defaults to a plain anchor without a provider)
 * @claim "Ouro UI components work without it" scripts/registry.test.mjs verify:testExists(scripts/registry.test.mjs::npm dependencies are pinned to the ranges this repository tests)
 * @claim "It installs with every component that" scripts/registry.test.mjs verify:testExists(scripts/registry.test.mjs::registryDependencies are the same-repo items each item imports, as full unpinned addresses)
 */
export function OuroProvider({ children, linkComponent, portalContainer }: OuroProviderProps): JSX.Element {
  const outer = useOuro();
  const container = portalContainer === undefined ? outer.portalContainer : (portalContainer ?? undefined);
  const value = useMemo<OuroContextValue>(
    () => ({ linkComponent: linkComponent ?? DefaultLink, ...(container ? { portalContainer: container } : {}) }),
    [linkComponent, container],
  );
  return (
    <OuroContext.Provider value={value}>
      <Tooltip.Provider>{children}</Tooltip.Provider>
    </OuroContext.Provider>
  );
}
