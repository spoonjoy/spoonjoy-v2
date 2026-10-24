import { useEffect, useState } from "react";
import {
  COOKING_NOW_CHANGED_EVENT,
  COOKING_NOW_LOCAL_STORAGE_KEY,
  readLocalCookingNow,
  type CookingNowEntry,
} from "~/lib/cooking-now";

export interface CookingNowState {
  entries: CookingNowEntry[];
  /** When the list was read, for the "touched in the last two hours" banner. */
  now: number;
}

function isEntryList(value: unknown): value is CookingNowEntry[] {
  return Array.isArray(value) && value.every((entry) =>
    typeof entry === "object" && entry !== null &&
    typeof (entry as CookingNowEntry).recipe?.id === "string" &&
    typeof (entry as CookingNowEntry).touchedAt === "string");
}

/** The signed-in cook's list, from the account; an empty list when it cannot be read. */
export async function fetchCookingNow(fetcher: typeof fetch = fetch): Promise<CookingNowEntry[]> {
  try {
    const response = await fetcher("/cooking-now.json", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { recipes?: unknown } };
    return isEntryList(body.data?.recipes) ? body.data.recipes : [];
  } catch {
    return [];
  }
}

/**
 * The cook's Cooking now list in the browser: the account's when signed in (read again whenever the
 * page becomes visible again), this browser's when signed out (read again whenever it changes here or in
 * another tab). A new `refreshKey` (such as the page's path) reads it again. Empty until
 * hydration, since the server render has no browser to read.
 */
export function useCookingNow(signedIn: boolean, refreshKey: string = ""): CookingNowState {
  const [state, setState] = useState<CookingNowState>({ entries: [], now: 0 });

  useEffect(() => {
    let cancelled = false;
    const read = signedIn
      ? async () => {
        const entries = await fetchCookingNow();
        if (!cancelled) setState({ entries, now: Date.now() });
      }
      : async () => {
        const now = Date.now();
        setState({ entries: readLocalCookingNow(now), now });
      };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === COOKING_NOW_LOCAL_STORAGE_KEY) void read();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };

    void read();
    document.addEventListener("visibilitychange", onVisible);
    if (!signedIn) {
      window.addEventListener("storage", onStorage);
      window.addEventListener(COOKING_NOW_CHANGED_EVENT, read);
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COOKING_NOW_CHANGED_EVENT, read);
    };
  }, [signedIn, refreshKey]);

  return state;
}
