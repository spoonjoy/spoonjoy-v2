import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Keeps an uncontrolled input (`defaultValue`) in step with the page's URL-driven value.
 *
 * After each navigation (a new search, Back or Forward) the input is set to `value` in the same
 * commit that renders the new results, before the browser paints, so the box never shows
 * different text from the results below it. It does nothing on the first render and on
 * re-renders within the same history entry, so text typed before hydration or while the page
 * sits still is left alone. The input stays uncontrolled on purpose: a controlled input would
 * wipe text typed before hydration.
 *
 * When the browser restores the page from its back/forward cache (`pageshow` with `persisted`),
 * the input is reset to `value` too: the cached page can carry newer text typed just before a
 * full-document search left it.
 */
export function useUrlSyncedInput(value: string) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { key } = useLocation();
  const syncedKey = useRef(key);

  useLayoutEffect(() => {
    if (syncedKey.current === key) return;
    syncedKey.current = key;
    inputRef.current!.value = value;
  }, [key, value]);

  useEffect(() => {
    const resetAfterCacheRestore = (event: PageTransitionEvent) => {
      if (event.persisted) inputRef.current!.value = value;
    };
    window.addEventListener("pageshow", resetAfterCacheRestore);
    return () => window.removeEventListener("pageshow", resetAfterCacheRestore);
  }, [value]);

  return inputRef;
}
