/**
 * SQLite triggers that keep the search index current one entity at a time.
 *
 * Every write to a table a search document is built from records the documents it
 * affects in "SearchDirtyEntity" (one row per entity, re-stamped with a higher `seq`
 * from "SearchDirtyClock" on every write). A search re-indexes just those entities, so a search no longer
 * scans every source table to decide whether the index is stale, and a write no
 * longer forces a rebuild of every document.
 *
 * The triggers live in the database rather than in each write path, so every writer
 * (web routes, the REST API, MCP tools, scripts, cascading deletes) is covered without
 * having to remember to call anything. The search module installs them, like the
 * search tables themselves, and reinstalls them (with a full rebuild) whenever one is
 * missing, for example after a migration rebuilds a table and SQLite drops its
 * triggers.
 *
 * To remove them by hand: `DROP TRIGGER IF EXISTS "<name>"` for each name in
 * SEARCH_TRIGGERS, then `DROP TABLE IF EXISTS "SearchDirtyEntity"` and
 * `DROP TABLE IF EXISTS "SearchDirtyClock"`. Search then falls
 * back to reinstalling them on the next request, so remove the search module's call
 * first if they must stay gone.
 */

export const SEARCH_DIRTY_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS "SearchDirtyEntity" (
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  PRIMARY KEY ("entityType", "entityId")
)`;

export const SEARCH_DIRTY_SEQ_INDEX_SQL = `CREATE INDEX IF NOT EXISTS "SearchDirtyEntity_seq_idx" ON "SearchDirtyEntity" ("seq")`;

// A single-row counter. Every queued write takes the next value, so a write that lands after
// a search read the queue always carries a higher seq than anything that search saw.
export const SEARCH_DIRTY_CLOCK_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS "SearchDirtyClock" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "seq" INTEGER NOT NULL
)`;

export const SEARCH_DIRTY_CLOCK_SEED_SQL = `INSERT INTO "SearchDirtyClock" ("id", "seq") VALUES (1, 0) ON CONFLICT("id") DO NOTHING`;

type DirtyType = "recipe" | "cookbook" | "chef" | "shopping-list-item";

// Queue (or re-stamp) entities with the next clock value, so a search that read the queue
// before this write never clears it. This uses an upsert, not INSERT OR REPLACE: inside a
// trigger fired by a foreign-key cascade, SQLite applies the outer statement's ABORT policy
// in place of OR REPLACE, so a second mark of the same entity would fail the user's write.
const TICK = `UPDATE "SearchDirtyClock" SET "seq" = "seq" + 1 WHERE "id" = 1;`;
const UPSERT_TAIL = `ON CONFLICT("entityType", "entityId") DO UPDATE SET "seq" = excluded."seq";`;

function mark(type: DirtyType, idExpression: string): string {
  return `${TICK}
  INSERT INTO "SearchDirtyEntity" ("entityType", "entityId", "seq")
    SELECT '${type}', ${idExpression}, COALESCE((SELECT "seq" FROM "SearchDirtyClock" WHERE "id" = 1), 0) WHERE ${idExpression} IS NOT NULL
    ${UPSERT_TAIL}`;
}

function markSelect(type: DirtyType, selectSql: string): string {
  return `${TICK}
  INSERT INTO "SearchDirtyEntity" ("entityType", "entityId", "seq")
    SELECT '${type}', id, COALESCE((SELECT "seq" FROM "SearchDirtyClock" WHERE "id" = 1), 0) FROM (${selectSql}) WHERE id IS NOT NULL
    ${UPSERT_TAIL}`;
}

interface TriggerSpec {
  name: string;
  sql: string;
}

function trigger(name: string, timing: string, when: string | null, body: string[]): TriggerSpec {
  const fullName = `SearchDirty_${name}`;
  return {
    name: fullName,
    sql: `CREATE TRIGGER IF NOT EXISTS "${fullName}" ${timing}${when ? ` WHEN ${when}` : ""}
BEGIN
  ${body.join("\n  ")}
END`,
  };
}

// For each row-level event: which documents it can change. Documents depend on:
// - recipe: the recipe, its chef's username, its covers, steps, ingredients (with unit
//   and ingredient names) and the titles of the cookbooks it is in;
// - cookbook: the cookbook, its author's username and the titles of its live recipes;
// - chef: the user and how many recipes and cookbooks they have;
// - shopping-list-item: the item, its unit and ingredient names and its owner.
export const SEARCH_TRIGGERS: readonly TriggerSpec[] = [
  // Recipe
  trigger("Recipe_insert", `AFTER INSERT ON "Recipe"`, null, [
    mark("recipe", `NEW."id"`),
    mark("chef", `NEW."chefId"`),
  ]),
  trigger("Recipe_update", `AFTER UPDATE ON "Recipe"`, null, [mark("recipe", `NEW."id"`)]),
  trigger(
    "Recipe_update_listing",
    `AFTER UPDATE OF "title", "deletedAt" ON "Recipe"`,
    `OLD."title" IS NOT NEW."title" OR OLD."deletedAt" IS NOT NEW."deletedAt"`,
    [markSelect("cookbook", `SELECT "cookbookId" AS id FROM "RecipeInCookbook" WHERE "recipeId" = NEW."id"`)],
  ),
  trigger("Recipe_update_chef", `AFTER UPDATE OF "chefId" ON "Recipe"`, `OLD."chefId" IS NOT NEW."chefId"`, [
    mark("chef", `OLD."chefId"`),
    mark("chef", `NEW."chefId"`),
  ]),
  trigger("Recipe_delete", `AFTER DELETE ON "Recipe"`, null, [
    mark("recipe", `OLD."id"`),
    mark("chef", `OLD."chefId"`),
  ]),

  // Rows that belong to one recipe.
  ...(["RecipeCover", "RecipeStep", "Ingredient"] as const).flatMap((table) => [
    trigger(`${table}_insert`, `AFTER INSERT ON "${table}"`, null, [mark("recipe", `NEW."recipeId"`)]),
    trigger(`${table}_update`, `AFTER UPDATE ON "${table}"`, null, [
      mark("recipe", `OLD."recipeId"`),
      mark("recipe", `NEW."recipeId"`),
    ]),
    trigger(`${table}_delete`, `AFTER DELETE ON "${table}"`, null, [mark("recipe", `OLD."recipeId"`)]),
  ]),

  // Shared names used by ingredients and shopping list items.
  ...([
    ["Unit", "unitId"],
    ["IngredientRef", "ingredientRefId"],
  ] as const).map(([table, column]) =>
    trigger(`${table}_rename`, `AFTER UPDATE OF "name" ON "${table}"`, `OLD."name" IS NOT NEW."name"`, [
      markSelect("recipe", `SELECT DISTINCT "recipeId" AS id FROM "Ingredient" WHERE "${column}" = NEW."id"`),
      markSelect("shopping-list-item", `SELECT "id" AS id FROM "ShoppingListItem" WHERE "${column}" = NEW."id"`),
    ]),
  ),

  // Cookbook
  trigger("Cookbook_insert", `AFTER INSERT ON "Cookbook"`, null, [
    mark("cookbook", `NEW."id"`),
    mark("chef", `NEW."authorId"`),
  ]),
  trigger("Cookbook_update", `AFTER UPDATE ON "Cookbook"`, null, [mark("cookbook", `NEW."id"`)]),
  trigger("Cookbook_update_title", `AFTER UPDATE OF "title" ON "Cookbook"`, `OLD."title" IS NOT NEW."title"`, [
    markSelect("recipe", `SELECT "recipeId" AS id FROM "RecipeInCookbook" WHERE "cookbookId" = NEW."id"`),
  ]),
  trigger("Cookbook_update_author", `AFTER UPDATE OF "authorId" ON "Cookbook"`, `OLD."authorId" IS NOT NEW."authorId"`, [
    mark("chef", `OLD."authorId"`),
    mark("chef", `NEW."authorId"`),
  ]),
  trigger("Cookbook_delete", `AFTER DELETE ON "Cookbook"`, null, [
    mark("cookbook", `OLD."id"`),
    mark("chef", `OLD."authorId"`),
  ]),

  // RecipeInCookbook
  trigger("RecipeInCookbook_insert", `AFTER INSERT ON "RecipeInCookbook"`, null, [
    mark("recipe", `NEW."recipeId"`),
    mark("cookbook", `NEW."cookbookId"`),
  ]),
  trigger("RecipeInCookbook_update", `AFTER UPDATE ON "RecipeInCookbook"`, null, [
    mark("recipe", `OLD."recipeId"`),
    mark("recipe", `NEW."recipeId"`),
    mark("cookbook", `OLD."cookbookId"`),
    mark("cookbook", `NEW."cookbookId"`),
  ]),
  trigger("RecipeInCookbook_delete", `AFTER DELETE ON "RecipeInCookbook"`, null, [
    mark("recipe", `OLD."recipeId"`),
    mark("cookbook", `OLD."cookbookId"`),
  ]),

  // User
  trigger("User_insert", `AFTER INSERT ON "User"`, null, [mark("chef", `NEW."id"`)]),
  trigger("User_update", `AFTER UPDATE ON "User"`, null, [mark("chef", `NEW."id"`)]),
  trigger("User_rename", `AFTER UPDATE OF "username" ON "User"`, `OLD."username" IS NOT NEW."username"`, [
    markSelect("recipe", `SELECT "id" AS id FROM "Recipe" WHERE "chefId" = NEW."id"`),
    markSelect("cookbook", `SELECT "id" AS id FROM "Cookbook" WHERE "authorId" = NEW."id"`),
    markSelect(
      "shopping-list-item",
      `SELECT sli."id" AS id FROM "ShoppingListItem" sli JOIN "ShoppingList" sl ON sl."id" = sli."shoppingListId" WHERE sl."authorId" = NEW."id"`,
    ),
  ]),
  trigger("User_delete", `AFTER DELETE ON "User"`, null, [mark("chef", `OLD."id"`)]),

  // Shopping list
  trigger("ShoppingList_update_author", `AFTER UPDATE OF "authorId" ON "ShoppingList"`, `OLD."authorId" IS NOT NEW."authorId"`, [
    markSelect("shopping-list-item", `SELECT "id" AS id FROM "ShoppingListItem" WHERE "shoppingListId" = NEW."id"`),
  ]),
  trigger("ShoppingListItem_insert", `AFTER INSERT ON "ShoppingListItem"`, null, [mark("shopping-list-item", `NEW."id"`)]),
  trigger("ShoppingListItem_update", `AFTER UPDATE ON "ShoppingListItem"`, null, [mark("shopping-list-item", `NEW."id"`)]),
  trigger("ShoppingListItem_delete", `AFTER DELETE ON "ShoppingListItem"`, null, [mark("shopping-list-item", `OLD."id"`)]),
];

export const SEARCH_TRIGGER_NAMES = SEARCH_TRIGGERS.map((spec) => spec.name);

/** How many of the search triggers exist; anything short of all of them means reinstall. */
export const SEARCH_TRIGGER_COUNT_SQL = `SELECT COUNT(*) AS triggerCount FROM sqlite_master WHERE type = 'trigger' AND name IN (${SEARCH_TRIGGER_NAMES.map((name) => `'${name}'`).join(", ")})`;

/** Drop and recreate every search trigger, so a changed definition replaces the old one. */
export function searchTriggerInstallStatements(): string[] {
  return [
    SEARCH_DIRTY_SCHEMA_SQL,
    SEARCH_DIRTY_SEQ_INDEX_SQL,
    SEARCH_DIRTY_CLOCK_SCHEMA_SQL,
    SEARCH_DIRTY_CLOCK_SEED_SQL,
    ...SEARCH_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS "${name}"`),
    ...SEARCH_TRIGGERS.map((spec) => spec.sql),
  ];
}
