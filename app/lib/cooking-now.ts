// Cooking now in the browser: the shape of a Cooking now entry as GET /api/v1/cooking-now answers
// it, the signed-out list kept in this browser's localStorage, and what the Kitchen's "Back to"
// banner offers. The signed-in list is the account's (app/lib/cooking-now.server.ts); the rules
// here are the same ones, so a signed-out cook sees the same list behave the same way.

/** A recipe untouched this long leaves the list (the server's COOKING_NOW_IDLE_MS). */
export const COOKING_NOW_IDLE_MS = 3 * 24 * 60 * 60 * 1000;
/** A recipe with everything checked leaves the list this long after (COOKING_NOW_DONE_MS). */
export const COOKING_NOW_DONE_MS = 30 * 60 * 1000;
/** The Kitchen offers "Back to <recipe>" when exactly one recipe was touched this recently. */
export const COOKING_NOW_RECENT_MS = 2 * 60 * 60 * 1000;
const COOKING_NOW_LIMIT = 50;

export const COOKING_NOW_LOCAL_STORAGE_KEY = "spoonjoy-cooking-now:v1";
/** Sent on this window when the signed-out list changes, so the nav pill updates at once. */
export const COOKING_NOW_CHANGED_EVENT = "spoonjoy:cooking-now-changed";

export interface CookingNowEntry {
  recipe: { id: string; title: string; coverImageUrl: string | null; href: string };
  activeStepId: string | null;
  activeStepIndex: number;
  stepCount: number;
  checkedCount: number;
  totalCount: number;
  allCheckedAt: string | null;
  touchedAt: string;
  expiresAt: string;
}

/** "Step 3 of 7": the step a card shows, counted from one. */
export function cookingNowStepLabel(entry: Pick<CookingNowEntry, "activeStepIndex" | "stepCount">): string | null {
  if (entry.stepCount <= 0) return null;
  return `Step ${Math.min(entry.activeStepIndex, entry.stepCount - 1) + 1} of ${entry.stepCount}`;
}

/** How much is checked, from 0 to 1. */
export function cookingNowProgress(entry: Pick<CookingNowEntry, "checkedCount" | "totalCount">): number {
  if (entry.totalCount <= 0) return 0;
  return Math.min(1, entry.checkedCount / entry.totalCount);
}

/** The one recipe to offer "Back to", when exactly one was touched in the last two hours. */
export function cookingNowBannerEntry(entries: readonly CookingNowEntry[], now: number): CookingNowEntry | null {
  const recent = entries.filter((entry) => now - Date.parse(entry.touchedAt) < COOKING_NOW_RECENT_MS);
  return recent.length === 1 ? recent[0] : null;
}

/** One progress write on the recipe page, as the signed-out list records it. */
export interface LocalCookingNowWrite {
  recipe: { id: string; title: string; coverImageUrl: string | null };
  activeStepId: string | null;
  activeStepIndex: number;
  stepCount: number;
  checkedIds: readonly string[];
  totalCount: number;
  now: number;
}

interface LocalCookingNowRow {
  recipe: { id: string; title: string; coverImageUrl: string | null };
  listed: boolean;
  activeStepId: string | null;
  activeStepIndex: number;
  stepCount: number;
  checkedCount: number;
  totalCount: number;
  allCheckedAt: number | null;
  touchedAt: number;
  /** The step and checked items the row last saw, so opening a recipe without changing it is not a touch. */
  progressKey: string;
}

type LocalCookingNowRows = Record<string, LocalCookingNowRow>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRow(value: unknown): LocalCookingNowRow | null {
  if (!isRecord(value) || !isRecord(value.recipe)) return null;
  const { recipe } = value;
  if (typeof recipe.id !== "string" || typeof recipe.title !== "string") return null;
  if (![value.activeStepIndex, value.stepCount, value.checkedCount, value.totalCount, value.touchedAt].every(finite)) return null;
  return {
    recipe: { id: recipe.id, title: recipe.title, coverImageUrl: typeof recipe.coverImageUrl === "string" ? recipe.coverImageUrl : null },
    listed: value.listed === true,
    activeStepId: typeof value.activeStepId === "string" ? value.activeStepId : null,
    activeStepIndex: value.activeStepIndex as number,
    stepCount: value.stepCount as number,
    checkedCount: value.checkedCount as number,
    totalCount: value.totalCount as number,
    allCheckedAt: finite(value.allCheckedAt) ? value.allCheckedAt : null,
    touchedAt: value.touchedAt as number,
    progressKey: typeof value.progressKey === "string" ? value.progressKey : "",
  };
}

/** The stored rows; anything malformed is dropped rather than trusted. */
export function parseLocalCookingNow(raw: string | null): LocalCookingNowRows {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    const rows: LocalCookingNowRows = {};
    for (const [recipeId, value] of Object.entries(parsed)) {
      const row = parseRow(value);
      if (row && row.recipe.id === recipeId) rows[recipeId] = row;
    }
    return rows;
  } catch {
    return {};
  }
}

function live(row: LocalCookingNowRow, now: number) {
  return row.touchedAt > now - COOKING_NOW_IDLE_MS && (row.allCheckedAt === null || row.allCheckedAt > now - COOKING_NOW_DONE_MS);
}

/**
 * The rows after one write, by the server's rules: checking something lists the recipe, going
 * from some checked to none (Clear progress) unlists it, and moving to another step lists it
 * again. A write that changes neither the step nor the checked items is not a touch.
 */
export function applyLocalCookingNowWrite(rows: LocalCookingNowRows, write: LocalCookingNowWrite): LocalCookingNowRows {
  const { recipe, now } = write;
  const checkedCount = Math.min(write.checkedIds.length, write.totalCount);
  const progressKey = JSON.stringify([write.activeStepId, write.activeStepIndex, [...write.checkedIds].sort()]);
  const previous = rows[recipe.id];
  const next: LocalCookingNowRows = {};
  for (const [id, row] of Object.entries(rows)) {
    if (id !== recipe.id && live(row, now)) next[id] = row;
  }

  if (previous && previous.progressKey === progressKey) {
    // Nothing the cook did; keep the row (refreshing what the card shows) without touching it.
    if (live(previous, now)) next[recipe.id] = { ...previous, recipe, stepCount: write.stepCount, totalCount: write.totalCount };
    return next;
  }

  // As on the server, a step id appearing or disappearing at the same position is not a move.
  const stepChanged = previous !== undefined && (
    previous.activeStepIndex !== write.activeStepIndex ||
    (previous.activeStepId !== null && write.activeStepId !== null && previous.activeStepId !== write.activeStepId)
  );
  const listed = checkedCount > 0
    ? true
    : previous === undefined
      ? write.activeStepIndex > 0
      : previous.checkedCount > 0
        ? false
        : stepChanged || previous.listed;
  const allChecked = write.totalCount > 0 && checkedCount >= write.totalCount;
  next[recipe.id] = {
    recipe,
    listed,
    activeStepId: write.activeStepId,
    activeStepIndex: write.activeStepIndex,
    stepCount: write.stepCount,
    checkedCount,
    totalCount: write.totalCount,
    allCheckedAt: allChecked ? previous?.allCheckedAt ?? now : null,
    touchedAt: Math.max(now, previous?.touchedAt ?? now),
    progressKey,
  };
  return next;
}

/** The signed-out list, newest touch first, as the API would answer it. */
export function localCookingNowEntries(rows: LocalCookingNowRows, now: number): CookingNowEntry[] {
  return Object.values(rows)
    .filter((row) => row.listed && live(row, now))
    .sort((a, b) => b.touchedAt - a.touchedAt || (a.recipe.id < b.recipe.id ? -1 : 1))
    .slice(0, COOKING_NOW_LIMIT)
    .map((row) => ({
      recipe: { ...row.recipe, href: `/recipes/${row.recipe.id}` },
      activeStepId: row.activeStepId,
      activeStepIndex: row.activeStepIndex,
      stepCount: row.stepCount,
      checkedCount: row.checkedCount,
      totalCount: row.totalCount,
      allCheckedAt: row.allCheckedAt === null ? null : new Date(row.allCheckedAt).toISOString(),
      touchedAt: new Date(row.touchedAt).toISOString(),
      expiresAt: new Date(Math.min(
        row.touchedAt + COOKING_NOW_IDLE_MS,
        row.allCheckedAt === null ? Infinity : row.allCheckedAt + COOKING_NOW_DONE_MS,
      )).toISOString(),
    }));
}

/** This browser's signed-out list. Unavailable storage reads as an empty list. */
export function readLocalCookingNow(now: number = Date.now()): CookingNowEntry[] {
  try {
    return localCookingNowEntries(parseLocalCookingNow(window.localStorage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY)), now);
  } catch {
    return [];
  }
}

/** Records one signed-out progress write and tells this window's listeners when the list changed. */
export function recordLocalCookingNow(write: LocalCookingNowWrite): void {
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY);
    const before = parseLocalCookingNow(raw);
    const after = JSON.stringify(applyLocalCookingNowWrite(before, write));
    if (after === (raw ?? "{}")) return;
    storage.setItem(COOKING_NOW_LOCAL_STORAGE_KEY, after);
    window.dispatchEvent(new Event(COOKING_NOW_CHANGED_EVENT));
  } catch {
    // Unavailable storage only costs the list; the recipe page keeps working.
  }
}
