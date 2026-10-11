import { useEffect, useRef } from "react";
import { devWarn } from "~/lib/ouro/dev";

/** A dev message as `[problem, fix]`, or a falsy value when that check passes. */
export type DevWarning = readonly [problem: string, fix: string] | false | undefined;

/**
 * Development-only prop checks for a component. `collect` returns the messages
 * for the current props; each one is logged once per component instance, after
 * render, so server rendering never warns.
 *
 * Pass `collect` only in development so its strings are stripped from
 * production builds:
 *
 * @example
 * useDevWarnings(
 *   "Button",
 *   process.env.NODE_ENV !== "production"
 *     ? () => [isLoading !== undefined && ["isLoading is not a prop", "<Button loading>"]]
 *     : undefined,
 * );
 */
export function useDevWarnings(component: string, collect: (() => DevWarning[]) | undefined): void {
  const key = useRef({});
  useEffect(() => {
    // The else path only exists in production bundles; scripts/dev-strip.test.mjs covers it.
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== "production") {
      // Components pass `collect` in every development render.
      /* istanbul ignore if */
      if (!collect) return;
      for (const warning of collect()) {
        if (warning) devWarn(component, warning[0], warning[1], key.current);
      }
    }
  });
}
