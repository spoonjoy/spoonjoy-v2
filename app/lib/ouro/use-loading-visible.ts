"use client";

import { useEffect, useRef, useState } from "react";

/** Options for {@link useLoadingVisible}. */
export interface LoadingVisibleOptions {
  /** How long a load runs before its placeholder shows, in milliseconds. @default 200 */
  delay?: number | undefined;
  /** How long a placeholder that has shown stays, in milliseconds. @default 500 */
  minVisible?: number | undefined;
}

/**
 * Whether a loading placeholder should show: not until the load has run for `delay`, and, once shown, for at least `minVisible`.
 * A load that ends within `delay` shows nothing, and a placeholder that shows stays for `minVisible`.
 *
 * Use it to time a placeholder of your own; `Skeleton` carries no timing of its own, so an app that skips the hook pays no bytes. Use `Button`'s `loading` instead for an action in progress.
 *
 * @group Feedback
 * @see https://ui.ouroboros.bot/docs/skeleton
 * @claim "A load that ends within `delay` shows nothing" registry/ouro/lib/ouro/use-loading-visible.test.tsx verify:testExists(registry/ouro/lib/ouro/use-loading-visible.test.tsx::useLoadingVisible > shows nothing for a load that ends within the delay)
 * @claim "once shown, for at least `minVisible`" registry/ouro/lib/ouro/use-loading-visible.test.tsx verify:testExists(registry/ouro/lib/ouro/use-loading-visible.test.tsx::useLoadingVisible > keeps a shown placeholder until it has been up for the minimum, then hides it)
 *
 * @example
 * const visible = useLoadingVisible(query.isPending);
 * return visible ? <Skeleton shape="row" count={6} /> : query.data ? <List data={query.data} /> : null;
 */
export function useLoadingVisible(loading: boolean, options: LoadingVisibleOptions = {}): boolean {
  const { delay = 200, minVisible = 500 } = options;
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading) {
      if (visible) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    // Stryker disable next-line ConditionalExpression: without the guard an idle placeholder schedules a hide that sets false over false, which changes nothing
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), Math.max(0, minVisible - (Date.now() - shownAt.current)));
    return () => clearTimeout(timer);
  }, [loading, visible, delay, minVisible]);
  return visible;
}
