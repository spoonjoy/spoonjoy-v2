// Plan to shopping list: puts what the planned meals need onto the cook's list. The list is a port, so Planning
// never reaches into the shopping list's storage; the shopping list scales each recipe and merges its ingredients.
import { addDays, type LocalDate } from "../model/local-date";
import { recipesToShop } from "../model/plan-entry";
import type { PlanStore } from "./plan";

export interface ShoppingListPort {
  /**
   * Adds a recipe's ingredients at a scale; false when the recipe is gone. The same `writeKey` sent again adds
   * nothing more, so a resubmitted form or a retry fills the list once.
   */
  addRecipe(recipeId: string, scaleFactor: number, writeKey: string): Promise<boolean>;
}

export type DaysToShop = { from: LocalDate; to: LocalDate };

/**
 * Adds every recipe planned from `days.from` to `days.to` (at most a week) to the shopping list, once per recipe
 * at the servings of all its meals together. `submissionKey` identifies the request, so repeating it adds nothing.
 */
export async function addPlannedMealsToList(
  store: PlanStore,
  list: ShoppingListPort,
  ownerId: string,
  days: DaysToShop,
  submissionKey: string,
): Promise<{ recipes: number; missing: number }> {
  if (days.to < days.from) throw new Error("The days to shop for must run from an earlier day to a later one.");
  if (days.to > addDays(days.from, 6)) throw new Error("Shop for a week at most.");
  const plan = await store.planFor(ownerId);
  let recipes = 0;
  let missing = 0;
  for (const recipe of recipesToShop(await store.entriesBetween(plan.id, days.from, days.to))) {
    if (await list.addRecipe(recipe.recipeId, recipe.scaleFactor, `${submissionKey}:${recipe.recipeId}`)) recipes += 1;
    else missing += 1;
  }
  return { recipes, missing };
}
