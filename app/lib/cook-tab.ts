// What this browser tab is cooking: its recipe, whether cook mode is open and its step. It lives in
// sessionStorage, which every tab has its own copy of and which survives a reload, so two tabs on
// the same recipe each come back to their own step instead of whichever tab saved last.

export const COOK_TAB_STORAGE_KEY = "spoonjoy-cook-tab:v1";

export type CookTabMode = "read" | "cook";

export interface CookTabState {
  recipeId: string;
  mode: CookTabMode;
  activeStepIndex: number;
  activeStepId: string | null;
}

export function parseCookTabState(raw: string | null): CookTabState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      typeof value !== "object" || value === null ||
      typeof value.recipeId !== "string" ||
      (value.mode !== "read" && value.mode !== "cook") ||
      typeof value.activeStepIndex !== "number" || !Number.isInteger(value.activeStepIndex) || value.activeStepIndex < 0
    ) {
      return null;
    }
    return {
      recipeId: value.recipeId,
      mode: value.mode,
      activeStepIndex: value.activeStepIndex,
      activeStepId: typeof value.activeStepId === "string" ? value.activeStepId : null,
    };
  } catch {
    return null;
  }
}

/** This tab's state for `recipeId`, or null when the tab was last on another recipe or on none. */
export function readCookTab(recipeId: string): CookTabState | null {
  try {
    const state = parseCookTabState(window.sessionStorage.getItem(COOK_TAB_STORAGE_KEY));
    return state?.recipeId === recipeId ? state : null;
  } catch {
    return null;
  }
}

export function writeCookTab(state: CookTabState): void {
  try {
    window.sessionStorage.setItem(COOK_TAB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Unavailable storage only costs this tab's restore.
  }
}

/** The step to restore from this tab's state: by id when the recipe still has it, else by index. */
export function cookTabStepIndex(state: CookTabState, stepIds: readonly string[]): number | null {
  if (stepIds.length === 0) return null;
  if (state.activeStepId !== null) {
    const byId = stepIds.indexOf(state.activeStepId);
    if (byId >= 0) return byId;
  }
  return Math.min(state.activeStepIndex, stepIds.length - 1);
}
