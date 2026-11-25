// Planned recipes onto a household shopping list, on D1. A household list holds lines of text, so the week's recipes
// are gathered first and each ingredient, scaled and combined with the same ingredient in the same unit across all of
// them, becomes one line: "6 cup chicken stock". The caller checks that the cook may change the list; this reads each
// recipe with the cook's own reading rights.
import { formatQuantity } from "~/domains/food-knowledge";
import { readableRecipeSqlForViewerId } from "~/domains/kitchen";
import { d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { d1WriteOnceClaim, d1WriteOnceKey } from "~/lib/d1-write-once.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { MAX_HOUSEHOLD_LIST_ITEM_LENGTH } from "../model/household-list";

const INGREDIENTS_SQL = `SELECT i."ingredientRefId", i."unitId", i."quantity", r."name" AS "ingredient", u."name" AS "unit"
  FROM "Ingredient" i
  JOIN "IngredientRef" r ON r."id" = i."ingredientRefId"
  JOIN "Unit" u ON u."id" = i."unitId"
  WHERE i."recipeId" = ?
  ORDER BY i."stepNum", i."id"`;

type Line = { quantity: number; unit: string; ingredient: string };

/** Adds `rows` to `lines` at `scaleFactor`: each ingredient once per unit, in the order the week first uses it. */
function combine(lines: Map<string, Line>, rows: D1Row[], scaleFactor: number) {
  for (const row of rows) {
    const key = `${row.ingredientRefId}\u0000${row.unitId}`;
    const line = lines.get(key) ?? { quantity: 0, unit: String(row.unit), ingredient: String(row.ingredient) };
    line.quantity += Number(row.quantity) * scaleFactor;
    lines.set(key, line);
  }
}

function text({ quantity, unit, ingredient }: Line): string {
  return (quantity > 0 ? `${formatQuantity(quantity)} ${unit} ${ingredient}` : ingredient).slice(0, MAX_HOUSEHOLD_LIST_ITEM_LENGTH);
}

/**
 * Gathers planned recipes for the household list `listId`, as `userId`, then adds their lines together.
 * `addRecipe` answers false when the recipe is gone or one the cook can't read, and adds nothing yet;
 * `addGathered` puts the gathered lines on the list once per write key, however often it is sent.
 */
export function d1HouseholdListRecipes(db: D1ReadDatabase, { listId, userId, now }: { listId: string; userId: string; now: Date }) {
  const lines = new Map<string, Line>();
  return {
    async addRecipe(recipeId: string, scaleFactor: number): Promise<boolean> {
      const readable = readableRecipeSqlForViewerId(undefined, userId);
      const [recipes, rows] = await d1ReadBatch(db, [
        [`SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL AND ${readable.sql}`, recipeId, ...readable.params],
        [INGREDIENTS_SQL, recipeId],
      ]);
      if (recipes.length === 0) return false;
      combine(lines, rows, scaleFactor);
      return true;
    },
    async addGathered(writeKey: string): Promise<void> {
      if (lines.size === 0) return;
      const texts = [...lines.values()].map(text);
      // The write key names every meal in the write, so it can run long: it goes in the hashed request, not the key itself.
      const key = await d1WriteOnceKey({ userId, operation: "household_list.add_recipes", token: "plan-meals", request: { listId, writeKey } });
      const at = d1Timestamp(now);
      // A retry builds a new claim; only the try that holds the key adds the lines.
      await retryD1Write({ scope: "household_list.add_recipes" }, () => {
        const claim = d1WriteOnceClaim(key, now);
        return d1WriteBatch(db, [
          ...claim.statements,
          // The guard sits on a plain SELECT: an aggregate over no rows would still answer one and insert it.
          ...texts.map((line) => [
            `INSERT INTO "HouseholdListItem" ("id", "listId", "text", "addedById", "sortIndex", "createdAt", "updatedAt")
             SELECT ?, ?, ?, ?, (SELECT COALESCE(MAX("sortIndex") + 1, 0) FROM "HouseholdListItem" WHERE "listId" = ?), ?, ?
             WHERE ${claim.guard}`,
            crypto.randomUUID(), listId, line, userId, listId, at, at, ...claim.guardValues,
          ] as [string, ...unknown[]]),
        ]);
      });
    },
  };
}
