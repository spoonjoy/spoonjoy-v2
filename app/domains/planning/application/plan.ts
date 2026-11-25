// Planning use cases. They take a PlanStore port, so the same rules run against D1 in the Worker, SQLite in tests
// and the local adapter a self-hosted server uses.
import { parseLocalDate, startOfWeek, todayIn, type LocalDate } from "../model/local-date";
import { parseMealType, type MealType } from "../model/meal-type";
import { planWeek, validateEntryInput, type PlanDay, type PlanEntry, type PlanEntryInput, type Validated } from "../model/plan-entry";

/**
 * Whose plan a use case works on: a cook's own, or a household's, changed by one of its cooks. The acting cook is who
 * adds entries, whose cooks count as last made and whose read rights decide which recipes may be planned. On a
 * household's plan, `householdChefIds` are the cooks who share a household with the acting cook (Households works them
 * out; Planning never asks it): their recipes are offered too, and their household recipes become readable.
 */
export type PlanScope = { cook: string } | { household: string; actingCook: string; householdChefIds?: ReadonlySet<string> };

export function actingCookOf(scope: PlanScope): string {
  return "cook" in scope ? scope.cook : scope.actingCook;
}

/** A plan as its store hands it out. The store's other methods take it back, so they know which plan it is. */
export type PlanSettings = { id: string; scope: PlanScope; firstDayOfWeek: number; timeZone: string };

export type StoredEntry = { entry: PlanEntry; removed: boolean };

export interface PlanStore {
  /** The scope's plan, made on first use. */
  planFor(scope: PlanScope): Promise<PlanSettings>;
  /** The plan's live entries from `from` to `to`, both days included. */
  entriesBetween(plan: PlanSettings, from: LocalDate, to: LocalDate): Promise<PlanEntry[]>;
  /** The title of a recipe the scope's acting cook may plan (one they can read that isn't deleted), or null. */
  plannableRecipeTitle(scope: PlanScope, recipeId: string): Promise<string | null>;
  /**
   * The recipes the acting cook may plan that are theirs, saved in their cookbooks or, on a household's plan, by the
   * household's cooks, by title, at most `limit`.
   */
  listPlannableRecipes(scope: PlanScope, limit: number): Promise<PlannableRecipe[]>;
  /** The entry with this id in this plan, removed ones included. */
  findEntry(plan: PlanSettings, entryId: string): Promise<StoredEntry | null>;
  insertEntry(plan: PlanSettings, addedById: string, entry: PlanEntry): Promise<void>;
  /** Marks a live entry of this plan removed; false when there was none. */
  removeEntry(plan: PlanSettings, entryId: string): Promise<boolean>;
  /** Sets where each of these entries of this plan sits: its day, meal type and order. */
  placeEntries(plan: PlanSettings, placements: readonly EntryPlacement[]): Promise<void>;
  /** Records the scale each of these entries of this plan is on a shopping list at. */
  markListed(plan: PlanSettings, listed: ReadonlyArray<{ id: string; listedScale: number }>): Promise<void>;
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
export async function getWeek(store: PlanStore, scope: PlanScope, date: LocalDate | null, now: Date = new Date()): Promise<PlanWeek> {
  const plan = await store.planFor(scope);
  const today = todayIn(plan.timeZone, now);
  const start = startOfWeek(date ?? today, plan.firstDayOfWeek);
  const days = planWeek(await store.entriesBetween(plan, start, planWeek([], start)[6].date), start);
  const recipeIds = [...new Set(days.flatMap((day) => day.entries.flatMap((entry) => (entry.recipeId ? [entry.recipeId] : []))))];
  const cooked = recipeIds.length ? await store.lastCooked(actingCookOf(scope), recipeIds) : [];
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
export async function addEntry(store: PlanStore, scope: PlanScope, entryId: string, raw: Record<string, unknown>): Promise<Validated<PlanEntry>> {
  const plan = await store.planFor(scope);
  const cook = actingCookOf(scope);
  const existing = await store.findEntry(plan, entryId);
  if (existing) {
    return existing.removed ? { ok: false, error: "That meal was removed from the plan." } : { ok: true, value: existing.entry };
  }
  const input = validateEntryInput(raw);
  if (!input.ok) return input;
  const recipeTitle = input.value.recipeId ? await store.plannableRecipeTitle(scope, input.value.recipeId) : null;
  if (input.value.recipeId && recipeTitle === null) return { ok: false, error: "That recipe isn't available to plan." };
  const sameDay = await store.entriesBetween(plan, input.value.date, input.value.date);
  const entry: PlanEntry = { id: entryId, ...input.value, position: nextPosition(sameDay, input.value), recipeTitle, listedScale: 0 };
  await store.insertEntry(plan, cook, entry);
  return { ok: true, value: entry };
}

export async function removeEntry(store: PlanStore, scope: PlanScope, entryId: string): Promise<boolean> {
  const plan = await store.planFor(scope);
  return store.removeEntry(plan, entryId);
}

/**
 * Moves an entry to a day and meal type, at `index` among that slot's entries (clamped to the slot), and numbers the
 * slot's entries in their new order. Drag and drop on the plan page calls it; the slot it left keeps its order.
 */
export async function moveEntry(
  store: PlanStore,
  scope: PlanScope,
  entryId: string,
  to: { date: unknown; mealType: unknown; index: number },
): Promise<Validated<PlanEntry>> {
  const plan = await store.planFor(scope);
  const found = await store.findEntry(plan, entryId);
  if (!found || found.removed) return { ok: false, error: "That meal isn't on your plan." };
  const date = parseLocalDate(to.date);
  if (!date) return { ok: false, error: "Choose a day for this meal." };
  const mealType = parseMealType(to.mealType);
  if (!mealType) return { ok: false, error: "Choose a meal type." };

  // planWeek orders the day's entries as the page shows them.
  const others = planWeek(await store.entriesBetween(plan, date, date), date)[0].entries
    .filter((entry) => entry.mealType === mealType && entry.id !== entryId);
  const index = Math.min(Math.max(Math.trunc(to.index) || 0, 0), others.length);
  const ordered = [...others.slice(0, index), found.entry, ...others.slice(index)];
  const placements = ordered.map((entry, position) => ({ id: entry.id, date, mealType, position }));
  await store.placeEntries(plan, placements);
  return { ok: true, value: { ...found.entry, date, mealType, position: index } };
}

/** How many recipes the plan page offers to pick from. */
export const PLANNABLE_RECIPE_LIMIT = 500;

/**
 * The recipes the plan page offers: the acting cook's own, those saved in their cookbooks and, on a household's plan,
 * the household's cooks' recipes they can read, by title. A recipe asked for by link (`?recipe=`) goes first when the
 * cook may plan it, and is ignored when they may not.
 */
export async function plannableRecipes(
  store: PlanStore,
  scope: PlanScope,
  chosenId: string | null,
): Promise<{ recipes: PlannableRecipe[]; chosenRecipeId: string | null }> {
  const [listed, chosenTitle] = await Promise.all([
    store.listPlannableRecipes(scope, PLANNABLE_RECIPE_LIMIT),
    chosenId ? store.plannableRecipeTitle(scope, chosenId) : null,
  ]);
  if (!chosenId || chosenTitle === null) return { recipes: listed, chosenRecipeId: null };
  return { recipes: [{ id: chosenId, title: chosenTitle }, ...listed.filter((recipe) => recipe.id !== chosenId)], chosenRecipeId: chosenId };
}
