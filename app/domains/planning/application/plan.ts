// Planning use cases. They take a PlanStore port, so the same rules run against D1 in the Worker, SQLite in tests
// and the local adapter a self-hosted server uses.
import { parseLocalDate, startOfWeek, todayIn, type LocalDate } from "../model/local-date";
import { parseMealType, type MealType } from "../model/meal-type";
import { planWeek, validateEntryInput, type PlanDay, type PlanEntry, type PlanEntryInput, type Validated } from "../model/plan-entry";

export type PlanSettings = { id: string; firstDayOfWeek: number; timeZone: string };

export type StoredEntry = { entry: PlanEntry; planId: string; removed: boolean };

export interface PlanStore {
  /** The cook's plan, made on first use. */
  planFor(ownerId: string): Promise<PlanSettings>;
  /** The plan's live entries from `from` to `to`, both days included. */
  entriesBetween(planId: string, from: LocalDate, to: LocalDate): Promise<PlanEntry[]>;
  /** The title of a recipe the cook may plan (one they can read that isn't deleted), or null when there is none. */
  plannableRecipeTitle(ownerId: string, recipeId: string): Promise<string | null>;
  /** The recipes the cook may plan that are theirs or saved in their cookbooks, by title, at most `limit`. */
  ownAndSavedRecipes(ownerId: string, limit: number): Promise<PlannableRecipe[]>;
  /** The entry with this id in any plan, removed ones included. */
  findEntry(entryId: string): Promise<StoredEntry | null>;
  insertEntry(planId: string, addedById: string, entry: PlanEntry): Promise<void>;
  /** Marks a live entry of this plan removed; false when there was none. */
  removeEntry(planId: string, entryId: string): Promise<boolean>;
  /** Sets where each of these entries of this plan sits: its day, meal type and order. */
  placeEntries(planId: string, placements: readonly EntryPlacement[]): Promise<void>;
  /** When the cook last logged a live cook of each of these recipes; a recipe they never cooked is left out. */
  lastCooked(chefId: string, recipeIds: readonly string[]): Promise<Array<{ recipeId: string; cookedAt: Date }>>;
}

export type EntryPlacement = { id: string; date: LocalDate; mealType: MealType; position: number };

export type PlannableRecipe = { id: string; title: string };

export type PlanWeek = {
  today: LocalDate;
  start: LocalDate;
  firstDayOfWeek: number;
  timeZone: string;
  days: PlanDay[];
  /** The day, in the plan's time zone, the cook last made each recipe planned this week, by recipe id. */
  lastMade: Record<string, LocalDate>;
};

/** The week holding `date`, or this week where the plan lives when `date` is null. */
export async function getWeek(store: PlanStore, ownerId: string, date: LocalDate | null, now: Date = new Date()): Promise<PlanWeek> {
  const plan = await store.planFor(ownerId);
  const today = todayIn(plan.timeZone, now);
  const start = startOfWeek(date ?? today, plan.firstDayOfWeek);
  const days = planWeek(await store.entriesBetween(plan.id, start, planWeek([], start)[6].date), start);
  const recipeIds = [...new Set(days.flatMap((day) => day.entries.flatMap((entry) => (entry.recipeId ? [entry.recipeId] : []))))];
  const cooked = recipeIds.length ? await store.lastCooked(ownerId, recipeIds) : [];
  const lastMade = Object.fromEntries(cooked.map(({ recipeId, cookedAt }) => [recipeId, todayIn(plan.timeZone, cookedAt)]));
  return { today, start, firstDayOfWeek: plan.firstDayOfWeek, timeZone: plan.timeZone, days, lastMade };
}

function nextPosition(entries: readonly PlanEntry[], input: PlanEntryInput): number {
  return entries.filter((planned) => planned.mealType === input.mealType).reduce((max, planned) => Math.max(max, planned.position + 1), 0);
}

/**
 * Plans a recipe or a note. `entryId` comes from the caller (a form token, an idempotency key), so sending the same
 * add again returns the entry the first one made instead of planning the meal twice.
 */
export async function addEntry(store: PlanStore, ownerId: string, entryId: string, raw: Record<string, unknown>): Promise<Validated<PlanEntry>> {
  const plan = await store.planFor(ownerId);
  const existing = await store.findEntry(entryId);
  if (existing && existing.planId === plan.id) {
    return existing.removed ? { ok: false, error: "That meal was removed from the plan." } : { ok: true, value: existing.entry };
  }
  const input = validateEntryInput(raw);
  if (!input.ok) return input;
  const recipeTitle = input.value.recipeId ? await store.plannableRecipeTitle(ownerId, input.value.recipeId) : null;
  if (input.value.recipeId && recipeTitle === null) return { ok: false, error: "That recipe isn't available to plan." };
  const sameDay = await store.entriesBetween(plan.id, input.value.date, input.value.date);
  const entry: PlanEntry = { id: entryId, ...input.value, position: nextPosition(sameDay, input.value), recipeTitle };
  await store.insertEntry(plan.id, ownerId, entry);
  return { ok: true, value: entry };
}

export async function removeEntry(store: PlanStore, ownerId: string, entryId: string): Promise<boolean> {
  const plan = await store.planFor(ownerId);
  return store.removeEntry(plan.id, entryId);
}

/**
 * Moves an entry to a day and meal type, at `index` among that slot's entries (clamped to the slot), and numbers the
 * slot's entries in their new order. Drag and drop on the plan page calls it; the slot it left keeps its order.
 */
export async function moveEntry(
  store: PlanStore,
  ownerId: string,
  entryId: string,
  to: { date: unknown; mealType: unknown; index: number },
): Promise<Validated<PlanEntry>> {
  const plan = await store.planFor(ownerId);
  const found = await store.findEntry(entryId);
  if (!found || found.planId !== plan.id || found.removed) return { ok: false, error: "That meal isn't on your plan." };
  const date = parseLocalDate(to.date);
  if (!date) return { ok: false, error: "Choose a day for this meal." };
  const mealType = parseMealType(to.mealType);
  if (!mealType) return { ok: false, error: "Choose a meal type." };

  // planWeek orders the day's entries as the page shows them.
  const others = planWeek(await store.entriesBetween(plan.id, date, date), date)[0].entries
    .filter((entry) => entry.mealType === mealType && entry.id !== entryId);
  const index = Math.min(Math.max(Math.trunc(to.index) || 0, 0), others.length);
  const ordered = [...others.slice(0, index), found.entry, ...others.slice(index)];
  const placements = ordered.map((entry, position) => ({ id: entry.id, date, mealType, position }));
  await store.placeEntries(plan.id, placements);
  return { ok: true, value: { ...found.entry, date, mealType, position: index } };
}

/** How many recipes the plan page offers to pick from. */
export const PLANNABLE_RECIPE_LIMIT = 500;

/**
 * The recipes the plan page offers: the cook's own and those saved in their cookbooks, by title. A recipe asked for by
 * link (`?recipe=`) goes first when the cook may plan it, and is ignored when they may not.
 */
export async function plannableRecipes(
  store: PlanStore,
  ownerId: string,
  chosenId: string | null,
): Promise<{ recipes: PlannableRecipe[]; chosenRecipeId: string | null }> {
  const [listed, chosenTitle] = await Promise.all([
    store.ownAndSavedRecipes(ownerId, PLANNABLE_RECIPE_LIMIT),
    chosenId ? store.plannableRecipeTitle(ownerId, chosenId) : null,
  ]);
  if (!chosenId || chosenTitle === null) return { recipes: listed, chosenRecipeId: null };
  return { recipes: [{ id: chosenId, title: chosenTitle }, ...listed.filter((recipe) => recipe.id !== chosenId)], chosenRecipeId: chosenId };
}
