"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FocusEvent, PointerEvent, TouchEvent } from "react";

/** Options for {@link usePrefetchIntent}. */
export interface PrefetchIntentOptions {
  /** How long a mouse or pen rests on the target before it counts as intent, in milliseconds. @default 65 */
  delay?: number | undefined;
  /** How many prefetches the app's function may have running at once, shared by the targets that use the same function. @default 2 */
  maxInflight?: number | undefined;
  /** How long a prefetched key stays fresh, in milliseconds; after that the next intent prefetches it again. @default 30000 */
  staleAfter?: number | undefined;
}

/** The handlers {@link usePrefetchIntent} returns; spread them on the element. */
export interface PrefetchIntentHandlers {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
}

interface Gate {
  inflight: number;
  fetched: Map<string, number>;
}

// One gate per app function, so every target that shares it shares one budget.
const gates = new WeakMap<(key: string) => unknown, Gate>();

function saveData(): boolean {
  // Stryker disable next-line ConditionalExpression,StringLiteral: the typeof guard only matters where there is no navigator (server rendering), which no browser test reaches
  return typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

function prefetchOnce(prefetch: (key: string) => unknown, key: string, maxInflight: number, staleAfter: number): void {
  let gate = gates.get(prefetch);
  if (!gate) gates.set(prefetch, (gate = { inflight: 0, fetched: new Map() }));
  const at = gate.fetched.get(key);
  // Stryker disable next-line ConditionalExpression: with no earlier fetch the age is NaN and compares false, so the undefined guard cannot change the outcome
  if (saveData() || gate.inflight >= maxInflight || (at !== undefined && Date.now() - at < staleAfter)) return;
  gate.fetched.set(key, Date.now());
  gate.inflight++;
  const done = (failed: boolean) => {
    gate.inflight--;
    if (failed) gate.fetched.delete(key);
  };
  try {
    Promise.resolve(prefetch(key)).then(
      () => done(false),
      () => done(true),
    );
  } catch {
    done(true);
  }
}

/**
 * Calls the app's `prefetch(key)` when a person shows intent to open something: a mouse or pen
 * resting on it, keyboard focus, or a touch beginning. Ouro owns the intent and the budget; the
 * app owns what is fetched and where it is kept, so any data layer fits.
 *
 * The budget: a key is prefetched once until it goes stale, at most `maxInflight` prefetches run
 * at once across the targets that share the function, a refused or skipped one is retried by the
 * next intent, and nothing is prefetched when the browser asks to save data. The function's errors
 * are swallowed, so a failed prefetch never breaks the page.
 *
 * Spread it on a `Link` for a route: Link passes the handlers to its anchor. Use the Speculation Rules API
 * instead when the browser should prerender whole documents.
 *
 * @group Navigation
 * @see https://ui.ouroboros.bot/docs/link
 *
 * @example
 * const intent = usePrefetchIntent((id) => queryClient.prefetchQuery(recipe(id)), recipeId);
 * <a href={`/recipes/${recipeId}`} {...intent}>Pancakes</a>
 * @claim "a key is prefetched once until it goes stale" registry/ouro/lib/ouro/use-prefetch-intent.test.tsx verify:testExists(registry/ouro/lib/ouro/use-prefetch-intent.test.tsx::usePrefetchIntent > prefetches a key once until it goes stale, then again)
 * @claim "at most `maxInflight` prefetches run" registry/ouro/lib/ouro/use-prefetch-intent.test.tsx verify:testExists(registry/ouro/lib/ouro/use-prefetch-intent.test.tsx::usePrefetchIntent > runs at most maxInflight prefetches at once and lets the next intent retry the one it skipped)
 * @claim "nothing is prefetched when the browser asks to save data" registry/ouro/lib/ouro/use-prefetch-intent.test.tsx verify:testExists(registry/ouro/lib/ouro/use-prefetch-intent.test.tsx::usePrefetchIntent > prefetches nothing when the browser asks to save data)
 * @claim "a failed prefetch never breaks the page" registry/ouro/lib/ouro/use-prefetch-intent.test.tsx verify:testExists(registry/ouro/lib/ouro/use-prefetch-intent.test.tsx::usePrefetchIntent > swallows a failed prefetch, and retries it on the next intent)
 */
export function usePrefetchIntent(
  prefetch: ((key: string) => unknown) | undefined,
  key: string,
  options: PrefetchIntentOptions = {},
): PrefetchIntentHandlers {
  const { delay = 65, maxInflight = 2, staleAfter = 30_000 } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Stryker disable next-line ArrayDeclaration: a constant dependency array behaves as the empty one, so cleanup still runs once on unmount
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(() => {
    const go = () => {
      if (prefetch) prefetchOnce(prefetch, key, maxInflight, staleAfter);
    };
    const stop = () => clearTimeout(timer.current);
    return {
      onPointerEnter: (event) => {
        if (event.pointerType === "touch") return;
        stop();
        timer.current = setTimeout(go, delay);
      },
      onPointerLeave: stop,
      onFocus: go,
      onTouchStart: go,
    };
  }, [prefetch, key, delay, maxInflight, staleAfter]);
}
