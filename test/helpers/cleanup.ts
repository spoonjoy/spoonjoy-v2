import { getLocalDb } from "~/lib/db.server";

/**
 * Clean up all test data in the correct order to respect foreign key constraints.
 * Call this in afterEach hooks.
 */
export async function cleanupDatabase() {
  const db = await getLocalDb();
  
  // Enable foreign keys for proper cascading
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

  // Delete data in order from most dependent to least dependent
  // Things that reference other things must be deleted first

  await db.shoppingListItem.deleteMany({});
  await db.shoppingList.deleteMany({});
  await db.stepOutputUse.deleteMany({});
  await db.ingredient.deleteMany({});
  await db.recipeStep.deleteMany({});
  await db.recipeInCookbook.deleteMany({});
  await db.cookbook.deleteMany({});
  // Clear fork attribution before deleting recipes (Recipe.sourceRecipe uses onDelete: Restrict).
  await db.recipe.updateMany({ data: { sourceRecipeId: null } });
  await db.recipe.deleteMany({});
  await db.ingredientRef.deleteMany({});
  await db.unit.deleteMany({});
  await db.apiCredential.deleteMany({});
  await db.userCredential.deleteMany({});
  await db.oAuth.deleteMany({});
  await db.user.deleteMany({});
}
