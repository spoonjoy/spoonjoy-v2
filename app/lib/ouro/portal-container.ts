"use client";

export { PortalScope, usePortalContainer };
export type { PortalContainerProps };

import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type JSX, type ReactNode, type RefObject } from "react";
import { devWarn } from "~/lib/ouro/dev";
import { useOuro } from "~/lib/ouro/use-ouro";

// Where a floating layer (Select, Menu, Combobox, Popover, Tooltip, HoverCard,
// NavigationMenu) portals to: OuroProvider's portalContainer, so it can sit inside a
// landmark, unless it opens from inside another Ouro UI portal. A Base UI `container`
// overrides its own nesting, which keeps a popup opened in a dialog inside that dialog.

/** True inside an Ouro UI portal. */
const InsidePortal = createContext(false);

/**
 * Wraps what renders inside an Ouro UI portal, so a popup opened from it portals into it
 * rather than into the app's portalContainer.
 *
 * @internal
 */
function PortalScope({ children }: { children: ReactNode }): JSX.Element {
  return createElement(InsidePortal.Provider, { value: true }, children);
}

/** The props {@link usePortalContainer} gives a Base UI `Portal`. */
interface PortalContainerProps {
  container?: HTMLElement;
  ref?: (node: HTMLDivElement | null) => void;
}

// Nothing announces a ref's element, so the subscription does nothing; its cleanup does nothing either.
// Stryker disable next-line ArrowFunction: React only calls the cleanup, so one that returns undefined behaves the same.
const subscribeNever = () => () => {};

const resolve = (container: HTMLElement | RefObject<HTMLElement | null> | undefined) => (container && "current" in container ? (container.current ?? undefined) : container);

/**
 * What landmarks are made of: an element in one of them is reached by moving by landmark. A
 * header or footer inside an article, aside, main, nav or section is not one. A dialog is exempt,
 * as it is announced when it opens.
 */
const landmark =
  'main, nav, aside, header:not(:is(article, aside, main, nav, section) header), footer:not(:is(article, aside, main, nav, section) footer), form[aria-label], form[aria-labelledby], section[aria-label], section[aria-labelledby], [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="region"], [role="search"], [role="form"], [role="dialog"], [role="alertdialog"]';

/**
 * The props for a floating layer's Base UI `Portal`: OuroProvider's `portalContainer`, and
 * in development a ref that warns when the open popup lands outside every landmark of a
 * page that has a `<main>`. Inside another Ouro UI portal it gives neither.
 *
 * @internal
 * @claim "The props for a floating layer's" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > renders a popup into OuroProvider's portalContainer, given as an element)
 * @claim "The props for a floating layer's" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > warns once, in development, when a popup opens outside every landmark of a page that has a main)
 * @claim "Inside another Ouro UI portal it" registry/ouro/lib/ouro/portal-container.test.tsx verify:testExists(registry/ouro/lib/ouro/portal-container.test.tsx::usePortalContainer > renders a popup opened from inside another popup into that popup's portal, not the portalContainer)
 */
function usePortalContainer(component: string): PortalContainerProps {
  const { portalContainer } = useOuro();
  const nested = useContext(InsidePortal);
  // Base UI reads its container once, as the portal mounts. A ref's element can commit after this
  // popup's portal (a popup open at once, ahead of <div ref={popups} /> in the page), so the element
  // is passed, and passed again once the ref holds it: React reads the snapshot again after commit
  // and renders again when it changed.
  const container = useSyncExternalStore(
    subscribeNever,
    () => resolve(portalContainer),
    () => undefined,
  );
  const check = useCallback(
    (node: HTMLDivElement | null) => {
      /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
      if (process.env.NODE_ENV !== "production") {
        if (!node || !document.querySelector('main, [role="main"]') || node.parentElement!.closest(landmark)) return;
        devWarn(
          component,
          "the open popup renders outside every landmark, so screen reader users who move by landmark miss it",
          "<OuroProvider portalContainer={popups}> around the app, with <div ref={popups} /> inside <main>",
        );
      }
    },
    [component],
  );
  if (nested) return {};
  return {
    ...(container ? { container } : {}),
    ...(process.env.NODE_ENV !== "production" ? { ref: check } : /* istanbul ignore next @preserve -- production only */ {}),
  };
}
