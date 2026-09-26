import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";

/**
 * Session-scoped record of which path each React Router history entry showed, keyed by the
 * entry's history index. React Router's browser history stores an `idx` in
 * `window.history.state`: 0 for the entry the app loaded on, +1 for every in-app push. The
 * browser does not expose earlier entries' URLs, so the app records them itself as the cook
 * moves around; recipe "Back" controls read the record to skip entries that are the same
 * recipe (its edit form, step editors, cook mode) or the create form.
 */
export const HISTORY_TRAIL_KEY = "spoonjoy-history-trail";

export interface HistoryTrailEntry {
  path: string;
  /** The entry showed the page with the `#cook` hash (cook mode). */
  cook: boolean;
}

type HistoryTrail = Record<string, HistoryTrailEntry>;

// Entries more than this far behind the current one are dropped when recording, so the record
// stays small however long a session runs.
const MAX_TRAIL_LENGTH = 100;

/** The current entry's React Router history index, or null when it has none. */
export function currentHistoryIndex(): number | null {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object") return null;
  const idx = (state as { idx?: unknown }).idx;
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
}

function isTrailEntry(value: unknown): value is HistoryTrailEntry {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { cook?: unknown }).cook === "boolean"
  );
}

/** Reads the record; storage that is unavailable or holds something else reads as empty. */
function readTrail(): HistoryTrail {
  try {
    const raw = window.sessionStorage.getItem(HISTORY_TRAIL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as HistoryTrail) : {};
  } catch {
    return {};
  }
}

/**
 * Records what the current history entry shows. A push replaces everything after it (the
 * browser drops those forward entries), so the record drops them too.
 */
export function recordHistoryEntry(pathname: string, hash: string, isPush: boolean): void {
  const idx = currentHistoryIndex();
  if (idx === null) return;

  const trail = readTrail();
  const kept: HistoryTrail = {};
  for (const [key, entry] of Object.entries(trail)) {
    const entryIdx = Number(key);
    if (entryIdx < idx - MAX_TRAIL_LENGTH) continue;
    if (isPush && entryIdx > idx) continue;
    kept[key] = entry;
  }
  kept[String(idx)] = { path: pathname, cook: hash === "#cook" };

  try {
    window.sessionStorage.setItem(HISTORY_TRAIL_KEY, JSON.stringify(kept));
  } catch {
    // Storage may be unavailable (private mode, quota); Back then follows its href.
  }
}

/** Records every location the app shows. Mount once, at the root. */
export function useHistoryTrail(): void {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    recordHistoryEntry(location.pathname, location.hash, navigationType === "PUSH");
  }, [location.key, location.pathname, location.hash, navigationType]);
}

// This recipe itself (including cook mode), its sub-routes (edit form, step editors) and the
// create form are not places "Back" should land on.
function isPartOfRecipe(path: string, recipePath: string): boolean {
  return path === recipePath || path.startsWith(`${recipePath}/`) || path === "/recipes/new";
}

/**
 * How many entries to go back to reach the nearest earlier page that is not this recipe, its
 * sub-routes or the create form, or null when no such entry is known (the recipe was opened
 * directly, the record has a gap, or storage is unavailable).
 */
export function findBackDistance(recipePath: string): number | null {
  const idx = currentHistoryIndex();
  if (idx === null) return null;

  const trail = readTrail();
  for (let entryIdx = idx - 1; entryIdx >= 0; entryIdx -= 1) {
    const entry: unknown = trail[String(entryIdx)];
    if (!isTrailEntry(entry)) return null;
    if (!isPartOfRecipe(entry.path, recipePath)) return idx - entryIdx;
  }
  return null;
}

function isPlainPrimaryClick(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

/**
 * Click handler for a recipe's "back to the list" link. The link keeps a real `href` (for no-JS,
 * middle click and open-in-new-tab). On a plain primary click it returns to the nearest earlier
 * in-app page that is not this recipe, its edit or step forms, cook mode or the create form;
 * when no such page is known the click is left to the link, so it goes to its `href`.
 */
export function useBackNavigation(): (event: MouseEvent<HTMLElement>) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Read at click time: the dock keeps the handler from its first registration.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!isPlainPrimaryClick(event)) return;
      const distance = findBackDistance(pathnameRef.current);
      if (distance === null) return;
      event.preventDefault();
      void navigate(-distance);
    },
    [navigate],
  );
}
