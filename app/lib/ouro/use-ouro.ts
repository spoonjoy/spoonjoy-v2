import { createContext, createElement, useContext, type AnchorHTMLAttributes, type ComponentType, type Ref } from "react";

// The OuroProvider context and its hook, apart from the provider so ouro-provider.tsx
// exports only components (React Fast Refresh).

/** A component that renders an internal link, such as a router's `Link`. */
export type OuroLinkComponent = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; ref?: Ref<HTMLAnchorElement> }
>;

export interface OuroContextValue {
  /** Renders internal links. Defaults to a plain `<a>`. */
  linkComponent: OuroLinkComponent;
}

/**
 * The link `OuroProvider` uses without a `linkComponent`: a plain `<a>`.
 *
 * @internal
 */
export const DefaultLink: OuroLinkComponent = (props) => createElement("a", props);

/**
 * The settings `OuroProvider` provides.
 *
 * @internal
 */
export const OuroContext = createContext<OuroContextValue>({ linkComponent: DefaultLink });

/** Reads the `OuroProvider` settings; returns defaults when there is no provider. */
export function useOuro(): OuroContextValue {
  return useContext(OuroContext);
}
