import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. Returns `serverDefault` during server
 * rendering and hydration, then the live value, so there is no hydration
 * mismatch. Where `matchMedia` does not exist (for example jsdom), it always
 * returns `serverDefault`.
 *
 * @example
 * const isWide = useMediaQuery("(min-width: 640px)", true);
 */
export function useMediaQuery(query: string, serverDefault: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : serverDefault),
    [query, serverDefault],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => serverDefault);
}
