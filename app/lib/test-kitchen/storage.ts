import type { CookProgress, CookProgressStorage } from "~/lib/cook/local-cook-controller";

/** Where the Test Kitchen keeps a visitor's progress in their browser. */
export const TEST_KITCHEN_STORAGE_KEY = "spoonjoy:test-kitchen";

/** Everything the Test Kitchen remembers: each recipe's progress, by recipe id. */
export interface TestKitchenState {
  version: 1;
  recipes: Record<string, CookProgress>;
}

const fresh = (): TestKitchenState => ({ version: 1, recipes: {} });

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");

function isProgress(value: unknown): value is CookProgress {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as Record<string, unknown>;
  return isIdList(progress.checkedIngredientIds) &&
    isIdList(progress.checkedStepOutputIds) &&
    Number.isInteger(progress.activeStepIndex) && (progress.activeStepIndex as number) >= 0 &&
    typeof progress.scaleFactor === "number" && Number.isFinite(progress.scaleFactor) && progress.scaleFactor > 0;
}

/**
 * The visitor's saved Test Kitchen, or a fresh one when storage is unavailable, throws, or holds
 * another version or anything this version cannot read. A recipe whose progress is unreadable is
 * dropped; the others are kept.
 */
export function readTestKitchen(): TestKitchenState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TEST_KITCHEN_STORAGE_KEY);
  } catch {
    return fresh();
  }
  if (raw === null) return fresh();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (typeof parsed !== "object" || parsed === null) return fresh();
  const { version, recipes } = parsed as Record<string, unknown>;
  if (version !== 1 || typeof recipes !== "object" || recipes === null || Array.isArray(recipes)) return fresh();
  return {
    version: 1,
    recipes: Object.fromEntries(Object.entries(recipes).filter(([, progress]) => isProgress(progress))),
  };
}

/** Saves the Test Kitchen. A full or unavailable storage keeps the page working in memory. */
export function writeTestKitchen(state: TestKitchenState): void {
  try {
    window.localStorage.setItem(TEST_KITCHEN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded, or storage disabled: the progress lives on in the page until it closes.
  }
}

/** Forgets everything the Test Kitchen saved. */
export function resetTestKitchen(): void {
  try {
    window.localStorage.removeItem(TEST_KITCHEN_STORAGE_KEY);
  } catch {
    // Nothing could be saved either, so there is nothing to forget.
  }
}

/** One recipe's progress, read from and written to the Test Kitchen's saved state. */
export const testKitchenProgressStorage: CookProgressStorage = {
  read: (recipeId) => readTestKitchen().recipes[recipeId] ?? null,
  write: (recipeId, progress) => {
    const state = readTestKitchen();
    writeTestKitchen({ ...state, recipes: { ...state.recipes, [recipeId]: progress } });
  },
};
