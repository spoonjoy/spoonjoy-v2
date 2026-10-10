// The recipe page's everyday actions on D1, without Prisma in the request: saving a recipe to a
// cookbook (an existing one, or a new one made from the Save dialog), taking it out again, and
// deleting a cook's log entry, plus the owner check ahead of the cover choices. Each is one batch, which D1 runs as one transaction: the batch reads
// what the checks need and its writes are guarded by the same conditions, so a request that fails
// a check changes nothing, and the answer comes from the rows read in that same transaction.
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { SpoonAuthError, SpoonNotFoundError } from "~/lib/recipe-spoon.server";

const ACTIVE_RECIPE = `EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL)`;
const OWNED_COOKBOOK = `EXISTS (SELECT 1 FROM "Cookbook" WHERE "id" = ? AND "authorId" = ?)`;

function recipeNotFound(): Response {
  return new Response("Recipe not found", { status: 404 });
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 403 });
}

// Answers as the Prisma path does: the cookbook's owner is checked before the recipe.
function assertCookbookChecks(
  cookbookRows: Record<string, unknown>[],
  userId: string,
  recipeRows?: Record<string, unknown>[],
): void {
  if (cookbookRows[0]?.authorId !== userId) throw unauthorized();
  if (recipeRows && recipeRows.length === 0) throw recipeNotFound();
}

/** Saves the recipe to one of the chef's cookbooks; saving it again only touches the cookbook. */
export async function addRecipeToCookbookOnD1(
  d1: D1ReadDatabase,
  input: { userId: string; cookbookId: string; recipeId: string },
): Promise<void> {
  const now = d1Timestamp(new Date());
  const { userId, cookbookId, recipeId } = input;
  const [cookbook, recipe] = await d1WriteBatch(d1, [
    [`SELECT "authorId" FROM "Cookbook" WHERE "id" = ?`, cookbookId],
    [`SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`, recipeId],
    [
      `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
       SELECT ?, ?, ?, ?, ?, ? WHERE ${OWNED_COOKBOOK} AND ${ACTIVE_RECIPE}
       ON CONFLICT ("cookbookId", "recipeId") DO NOTHING`,
      crypto.randomUUID(), cookbookId, recipeId, userId, now, now,
      cookbookId, userId, recipeId,
    ],
    [
      `UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ? AND "authorId" = ? AND ${ACTIVE_RECIPE}`,
      now, cookbookId, userId, recipeId,
    ],
  ]);
  assertCookbookChecks(cookbook.rows, userId, recipe.rows);
}

/** Takes the recipe out of one of the chef's cookbooks. A deleted recipe can still be taken out. */
export async function removeRecipeFromCookbookOnD1(
  d1: D1ReadDatabase,
  input: { userId: string; cookbookId: string; recipeId: string },
): Promise<void> {
  const now = d1Timestamp(new Date());
  const { userId, cookbookId, recipeId } = input;
  const [cookbook] = await d1WriteBatch(d1, [
    [`SELECT "authorId" FROM "Cookbook" WHERE "id" = ?`, cookbookId],
    [
      `DELETE FROM "RecipeInCookbook" WHERE "cookbookId" = ? AND "recipeId" = ? AND ${OWNED_COOKBOOK}`,
      cookbookId, recipeId, cookbookId, userId,
    ],
    [`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ? AND "authorId" = ?`, now, cookbookId, userId],
  ]);
  assertCookbookChecks(cookbook.rows, userId);
}

/**
 * Makes a cookbook with this recipe in it. A title the chef already uses fails the batch with
 * D1's unique-constraint error, which the caller answers as the Save dialog's error; nothing is
 * written then, or when the recipe is gone.
 */
export async function createCookbookWithRecipeOnD1(
  d1: D1ReadDatabase,
  input: { userId: string; recipeId: string; title: string },
): Promise<{ id: string; title: string }> {
  const now = d1Timestamp(new Date());
  const cookbookId = crypto.randomUUID();
  const { userId, recipeId, title } = input;
  const [recipe] = await d1WriteBatch(d1, [
    [`SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`, recipeId],
    [
      `INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
       SELECT ?, ?, ?, ?, ? WHERE ${ACTIVE_RECIPE}`,
      cookbookId, title, userId, now, now, recipeId,
    ],
    [
      `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
       SELECT ?, ?, ?, ?, ?, ? WHERE ${ACTIVE_RECIPE}`,
      crypto.randomUUID(), cookbookId, recipeId, userId, now, now, recipeId,
    ],
  ]);
  if (recipe.rows.length === 0) throw recipeNotFound();
  return { id: cookbookId, title };
}

/** Throws the Save dialog's 404 when the recipe is gone (it is checked before the title). */
export async function assertActiveRecipeOnD1(d1: D1ReadDatabase, recipeId: string): Promise<void> {
  const [recipe] = await d1WriteBatch(d1, [[`SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`, recipeId]]);
  if (recipe.rows.length === 0) throw recipeNotFound();
}

/** Deletes one of the chef's own cook log entries, with deleteSpoon's errors. */
export async function deleteSpoonOnD1(d1: D1ReadDatabase, input: { userId: string; spoonId: string }): Promise<void> {
  const now = d1Timestamp(new Date());
  const [spoon] = await d1WriteBatch(d1, [
    [`SELECT "chefId", "deletedAt" FROM "RecipeSpoon" WHERE "id" = ?`, input.spoonId],
    [
      `UPDATE "RecipeSpoon" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL`,
      now, now, input.spoonId, input.userId,
    ],
  ]);
  const row = spoon.rows[0];
  if (!row) throw new SpoonNotFoundError(`Spoon ${input.spoonId} not found`);
  if (row.deletedAt != null) throw new SpoonNotFoundError(`Spoon ${input.spoonId} is deleted`);
  if (row.chefId !== input.userId) throw new SpoonAuthError("Spoon is not owned by requesting user");
}

/** The recipe owner's checks for the cover choices: 404 for a missing or deleted recipe, then 403. */
export async function assertOwnedActiveRecipeOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; userId: string },
): Promise<{ title: string }> {
  const [recipe] = await d1ReadBatch(d1, [[`SELECT "chefId", "deletedAt", "title" FROM "Recipe" WHERE "id" = ?`, input.recipeId]]);
  const row = recipe[0];
  if (!row || row.deletedAt != null) throw recipeNotFound();
  if (row.chefId !== input.userId) throw unauthorized();
  if (typeof row.title !== "string") throw new Error("D1 column title is not text");
  return { title: row.title };
}
