// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "~/lib/account-deletion.server";
import { searchSpoonjoyFromD1 } from "~/lib/search.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";

// Issue #684: a deleted entity's search document goes, and so must its SearchDocumentKey row
// (`chef:<userId>`, `recipe:<id>`, ...). Runs on a database built from `migrations/`, with the
// search module's own tables and triggers, through the real account-deletion batch.

let database: MigratedSqlite;

function run(sql: string, ...values: unknown[]) {
  database.sqlite.prepare(sql).run(...values);
}

function keys(): string[] {
  return (database.sqlite.prepare(`SELECT "docKey" FROM "SearchDocumentKey" ORDER BY "docKey"`).all() as Array<{ docKey: string }>)
    .map((row) => row.docKey);
}

function documentKeys(): string[] {
  return (database.sqlite
    .prepare(`SELECT entityType || ':' || entityId AS "docKey" FROM "SearchDocument" ORDER BY 1`)
    .all() as Array<{ docKey: string }>).map((row) => row.docKey);
}

function queued(): number {
  return (database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "SearchDirtyEntity"`).get() as { n: number }).n;
}

function seedCook(id: string) {
  run(`INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`, id, `${id}@example.com`, id);
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "updatedAt") VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`, `${id}-recipe`, `Quince Tart ${id}`, id);
  run(`INSERT INTO "Cookbook" ("id", "title", "authorId", "updatedAt") VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`, `${id}-cookbook`, `Quince Book ${id}`, id);
  run(`INSERT INTO "IngredientRef" ("id", "name") VALUES ('quince', 'quince') ON CONFLICT DO NOTHING`);
  run(`INSERT INTO "ShoppingList" ("id", "authorId", "updatedAt") VALUES (?, ?, '2026-01-01T00:00:00.000Z')`, `${id}-list`, id);
  run(
    `INSERT INTO "ShoppingListItem" ("id", "shoppingListId", "ingredientRefId", "updatedAt") VALUES (?, ?, 'quince', '2026-01-01T00:00:00.000Z')`,
    `${id}-item`,
    `${id}-list`,
  );
}

describe("search keys of deleted entities", () => {
  beforeEach(() => {
    database = migratedSqliteD1();
  });

  afterEach(() => {
    database.close();
  });

  it("drops every key of a deleted account once the search queue drains", async () => {
    seedCook("leaving");
    seedCook("staying");
    await searchSpoonjoyFromD1(database.binding, { query: "quince" });
    expect(keys()).toEqual(expect.arrayContaining([
      "chef:leaving",
      "recipe:leaving-recipe",
      "cookbook:leaving-cookbook",
      "shopping-list-item:leaving-item",
    ]));

    await deleteAccount(database.binding, "leaving");
    expect(queued()).toBeGreaterThan(0);
    await searchSpoonjoyFromD1(database.binding, { query: "quince" });

    expect(queued()).toBe(0);
    expect(keys().filter((key) => key.includes("leaving"))).toEqual([]);
    expect(keys()).toEqual(documentKeys());
    expect(keys()).toEqual(expect.arrayContaining(["chef:staying", "recipe:staying-recipe", "cookbook:staying-cookbook"]));
  });

  it("keeps the rowid of an entity that is re-indexed, not deleted", async () => {
    seedCook("cook");
    await searchSpoonjoyFromD1(database.binding, { query: "quince" });
    const rowid = () => database.sqlite.prepare(`SELECT "docRowid" FROM "SearchDocumentKey" WHERE "docKey" = 'recipe:cook-recipe'`).get();
    const before = rowid();

    run(`UPDATE "Recipe" SET "title" = 'Quince Pie' WHERE "id" = 'cook-recipe'`);
    await expect(searchSpoonjoyFromD1(database.binding, { query: "quince pie", scope: "recipes" }))
      .resolves.toMatchObject([{ id: "cook-recipe" }]);

    expect(rowid()).toEqual(before);
    expect(keys()).toEqual(documentKeys());
  });

  it("clears keys an earlier index version left behind on its one upgrade rebuild", async () => {
    seedCook("cook");
    await searchSpoonjoyFromD1(database.binding, { query: "quince" });
    run(`INSERT INTO "SearchDocumentKey" ("docKey") VALUES ('chef:deleted-under-v1')`);
    run(`UPDATE "SearchIndexMetadata" SET "sourceFingerprint" = 'per-entity-triggers-v1'`);

    await searchSpoonjoyFromD1(database.binding, { query: "quince" });

    expect(keys()).not.toContain("chef:deleted-under-v1");
    expect(keys()).toEqual(documentKeys());
  });
});
