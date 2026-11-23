// The recipe page's everyday actions on D1, without Prisma in the request: saving a recipe to a
// cookbook (an existing one, or a new one made from the Save dialog), taking it out again, and
// deleting a cook's log entry, plus the owner check ahead of the cover choices. Each is one batch, which D1 runs as one transaction: the batch reads
// what the checks need and its writes are guarded by the same conditions, so a request that fails
// a check changes nothing, and the answer comes from the rows read in that same transaction.
// Each runs again after a transient D1 error (retryD1Write): saving and taking out leave the same
// rows however often they run, and a new cookbook or a deleted cook checks whether the earlier try
// committed before running again.
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { SpoonAuthError, SpoonNotFoundError } from "~/lib/recipe-spoon.server";
import { readableRecipeSql } from "~/domains/kitchen";

// A recipe the chef may not read answers as one that is gone. Its placeholders are the recipe's
// id, then the chef's.
function activeRecipeFor(userId: string): { sql: string; params: unknown[] } {
  const readable = readableRecipeSql(undefined, { id: userId });
  return { sql: `"id" = ? AND "deletedAt" IS NULL AND ${readable.sql}`, params: readable.params };
}
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
  const membershipId = crypto.randomUUID();
  const active = activeRecipeFor(userId);
  const [cookbook, recipe] = await retryD1Write({ scope: "cookbook.add_recipe" }, () => d1WriteBatch(d1, [
    [`SELECT "authorId" FROM "Cookbook" WHERE "id" = ?`, cookbookId],
    [`SELECT "id" FROM "Recipe" WHERE ${active.sql}`, recipeId, ...active.params],
    [
      `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
       SELECT ?, ?, ?, ?, ?, ? WHERE ${OWNED_COOKBOOK} AND EXISTS (SELECT 1 FROM "Recipe" WHERE ${active.sql})
       ON CONFLICT ("cookbookId", "recipeId") DO NOTHING`,
      membershipId, cookbookId, recipeId, userId, now, now,
      cookbookId, userId, recipeId, ...active.params,
    ],
    [
      `UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ? AND "authorId" = ? AND EXISTS (SELECT 1 FROM "Recipe" WHERE ${active.sql})`,
      now, cookbookId, userId, recipeId, ...active.params,
    ],
  ]));
  assertCookbookChecks(cookbook.rows, userId, recipe.rows);
}

/** Takes the recipe out of one of the chef's cookbooks. A deleted recipe can still be taken out. */
export async function removeRecipeFromCookbookOnD1(
  d1: D1ReadDatabase,
  input: { userId: string; cookbookId: string; recipeId: string },
): Promise<void> {
  const now = d1Timestamp(new Date());
  const { userId, cookbookId, recipeId } = input;
  const [cookbook] = await retryD1Write({ scope: "cookbook.remove_recipe" }, () => d1WriteBatch(d1, [
    [`SELECT "authorId" FROM "Cookbook" WHERE "id" = ?`, cookbookId],
    [
      `DELETE FROM "RecipeInCookbook" WHERE "cookbookId" = ? AND "recipeId" = ? AND ${OWNED_COOKBOOK}`,
      cookbookId, recipeId, cookbookId, userId,
    ],
    [`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ? AND "authorId" = ?`, now, cookbookId, userId],
  ]));
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
  const membershipId = crypto.randomUUID();
  const { userId, recipeId, title } = input;
  // The cookbook's id is fixed before the first try, so a try that runs again after an ambiguous
  // failure finds the cookbook the earlier one made (the batch is atomic, so the recipe is in it).
  const made = await retryD1Write(
    {
      scope: "cookbook.create_with_recipe",
      applied: async () => {
        const [[row]] = await d1ReadBatch(d1, [[`SELECT 1 AS "made" FROM "Cookbook" WHERE "id" = ? AND "authorId" = ?`, cookbookId, userId]]);
        return row ? true : null;
      },
    },
    async () => {
      const active = activeRecipeFor(userId);
      const [recipe] = await d1WriteBatch(d1, [
        [`SELECT "id" FROM "Recipe" WHERE ${active.sql}`, recipeId, ...active.params],
        [
          `INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "Recipe" WHERE ${active.sql})`,
          cookbookId, title, userId, now, now, recipeId, ...active.params,
        ],
        [
          `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "Recipe" WHERE ${active.sql})`,
          membershipId, cookbookId, recipeId, userId, now, now, recipeId, ...active.params,
        ],
      ]);
      return recipe.rows.length > 0;
    },
  );
  if (!made) throw recipeNotFound();
  return { id: cookbookId, title };
}

/** Throws the Save dialog's 404 when the recipe is gone or the chef may not read it (it is checked before the title). */
export async function assertActiveRecipeOnD1(d1: D1ReadDatabase, recipeId: string, userId: string): Promise<void> {
  const active = activeRecipeFor(userId);
  const [recipe] = await d1WriteBatch(d1, [[`SELECT "id" FROM "Recipe" WHERE ${active.sql}`, recipeId, ...active.params]]);
  if (recipe.rows.length === 0) throw recipeNotFound();
}

/** Deletes one of the chef's own cook log entries, with deleteSpoon's errors. */
export async function deleteSpoonOnD1(d1: D1ReadDatabase, input: { userId: string; spoonId: string }): Promise<void> {
  const now = d1Timestamp(new Date());
  // A try that runs again after an ambiguous failure would find the cook already deleted; the
  // deletion time this request set says the earlier try committed, so it answers as that try would.
  // Only a later try may read it that way: another request in the same millisecond also sets it.
  let tries = 0;
  const row = await retryD1Write(
    {
      scope: "spoon.delete",
      applied: async () => {
        const [[deleted]] = await d1ReadBatch(d1, [[
          `SELECT "chefId" FROM "RecipeSpoon" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" = ?`,
          input.spoonId, input.userId, now,
        ]]);
        return deleted ? { chefId: input.userId, deletedAt: null } : null;
      },
    },
    async () => {
      tries += 1;
      const [spoon] = await d1WriteBatch(d1, [
        [`SELECT "chefId", "deletedAt" FROM "RecipeSpoon" WHERE "id" = ?`, input.spoonId],
        [
          `UPDATE "RecipeSpoon" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL`,
          now, now, input.spoonId, input.userId,
        ],
      ]);
      return spoon.rows[0] as { chefId: unknown; deletedAt: unknown } | undefined;
    },
  );
  if (!row) throw new SpoonNotFoundError(`Spoon ${input.spoonId} not found`);
  // Deleted at this request's own time on a later try: an earlier try of this request did it.
  const deletedByEarlierTry = tries > 1 && row.deletedAt === now;
  if (row.deletedAt != null && !deletedByEarlierTry) throw new SpoonNotFoundError(`Spoon ${input.spoonId} is deleted`);
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
