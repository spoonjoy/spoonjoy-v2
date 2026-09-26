import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Keeps an uncontrolled input (`defaultValue`) in step with the page's URL-driven value.
 *
 * After each navigation (a new search, Back or Forward) the input is set to `value`, so the box
 * never shows newer text than the results below it. It does nothing on the first render and on
 * re-renders within the same history entry, so text typed before hydration or while the page
 * sits still is left alone. The input stays uncontrolled on purpose: a controlled input would
 * wipe text typed before hydration.
 */
export function useUrlSyncedInput(value: string) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { key } = useLocation();
  const syncedKey = useRef(key);

  useEffect(() => {
    if (syncedKey.current === key) return;
    syncedKey.current = key;
    inputRef.current!.value = value;
  }, [key, value]);

  return inputRef;
}
