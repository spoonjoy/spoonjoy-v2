// Plan to shopping list: puts what the planned meals need onto a shopping list. The list is a port, so Planning never
// reaches into the shopping list's storage; the shopping list scales each recipe and merges its ingredients. Each meal
// records the scale it went on the list at, so adding the week again adds only the meals not yet on it, after a reload
// or on another device as well.
import { addDays, type LocalDate } from "../model/local-date";
import { scaleToList } from "../model/plan-entry";
import type { PlanScope, PlanStore } from "./plan";

export interface ShoppingListPort {
  /**
   * Adds a recipe's ingredients at a scale; false when the recipe is gone. The same `writeKey` sent again adds
   * nothing more, so a resubmitted form or a retry fills the list once.
   */
  addRecipe(recipeId: string, scaleFactor: number, writeKey: string): Promise<boolean>;
  /**
   * For a list that writes the meals together, so the same ingredient in two of them is one line: writes what
   * `addRecipe` gathered. `writeKey` names these meals at these scales, so sending it again writes nothing more.
   */
  addGathered?(writeKey: string): Promise<void>;
}

export type DaysToShop = { from: LocalDate; to: LocalDate };

/**
 * Adds the meals planned from `days.from` to `days.to` (at most a week) that are not on the list yet, each at its
 * scale, or only what its scale grew by since it went on. A meal whose recipe is gone counts as missing and is not
 * offered again. The meals record their scales only once the list has them, so a failed write is tried again.
 */
export async function addPlannedMealsToList(
  store: PlanStore,
  list: ShoppingListPort,
  scope: PlanScope,
  days: DaysToShop,
): Promise<{ meals: number; missing: number }> {
  if (days.to < days.from) throw new Error("The days to shop for must run from an earlier day to a later one.");
  if (days.to > addDays(days.from, 6)) throw new Error("Shop for a week at most.");
  const plan = await store.planFor(scope);
  const toAdd = (await store.entriesBetween(plan, days.from, days.to)).filter((meal) => scaleToList(meal) > 0);
  let meals = 0;
  let missing = 0;
  const writeKeys: string[] = [];
  for (const meal of toAdd) {
    // Keyed by the meal and the scales it goes between, so two tries at once add it once.
    const writeKey = `plan-entry:${meal.id}:${meal.listedScale}:${meal.scaleFactor}`;
    writeKeys.push(writeKey);
    // scaleToList is above 0 only for a recipe, so recipeId is set.
    if (await list.addRecipe(meal.recipeId as string, scaleToList(meal), writeKey)) meals += 1;
    else missing += 1;
  }
  if (toAdd.length === 0) return { meals, missing };
  await list.addGathered?.(writeKeys.join(","));
  await store.markListed(plan, toAdd.map(({ id, scaleFactor }) => ({ id, listedScale: scaleFactor })));
  return { meals, missing };
}
