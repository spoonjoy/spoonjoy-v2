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
 * router's link. Ouro UI components work without it: they honor reduced motion
 * themselves, in CSS (`motion-reduce:` variants and `prefers-reduced-motion`
 * queries), and need no animation library. If your app animates with Motion,
 * wrap it in `<MotionConfig reducedMotion="user">` for the same behavior.
 *
 * Type a custom adapter with `ComponentProps<OuroLinkComponent>` so it always
 * compiles, including under `exactOptionalPropertyTypes`.
 *
 * @example
 * const RouterLink = (props: ComponentProps<OuroLinkComponent>) => <Link to={props.href} {...props} />;
 * <OuroProvider linkComponent={RouterLink}><App /></OuroProvider>
 */
export function OuroProvider({ children, linkComponent }: OuroProviderProps): JSX.Element {
  const value = useMemo<OuroContextValue>(
    () => ({ linkComponent: linkComponent ?? DefaultLink }),
    [linkComponent],
  );
  return <OuroContext.Provider value={value}>{children}</OuroContext.Provider>;
}
