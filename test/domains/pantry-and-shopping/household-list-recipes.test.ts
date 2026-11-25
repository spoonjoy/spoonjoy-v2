// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { d1HouseholdListRecipes } from "~/domains/pantry-and-shopping";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

// Putting a planned recipe on a household shopping list: its ingredients, scaled and combined, each become a line of
// text on the list, combined across the week's recipes, added by the cook who sent them, once per write key.

let database: MigratedSqlite;
const now = new Date("2026-11-24T12:00:00.000Z");
const run = (sql: string) => database.sqlite.prepare(sql).run();

function items() {
  return database.sqlite.prepare(`SELECT "text", "addedById", "sortIndex" FROM "HouseholdListItem" WHERE "listId" = 'l1' ORDER BY "sortIndex"`).all();
}

function adder(userId = "ben") {
  return d1HouseholdListRecipes(database.binding, { listId: "l1", userId, now });
}

beforeEach(() => {
  database = migratedSqliteD1();
  for (const id of ["ann", "ben", "dee"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${id}', '${id}@example.com', '${id}_cooks')`);
  }
  run(`INSERT INTO "Household" ("id", "name") VALUES ('h1', 'Home')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ann', 'owner')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ben', 'member')`);
  run(`INSERT INTO "HouseholdList" ("id", "householdId", "name", "createdById") VALUES ('l1', 'h1', 'Groceries', 'ann')`);
  run(`INSERT INTO "HouseholdListItem" ("id", "listId", "text", "sortIndex", "addedById") VALUES ('x1', 'l1', 'Milk', 0, 'ann')`);
  // The migrations may already hold these units and ingredients; the recipe uses whichever rows have these names.
  run(`INSERT OR IGNORE INTO "Unit" ("id", "name") VALUES ('u-cup', 'cup'), ('u-whole', 'whole')`);
  run(`INSERT OR IGNORE INTO "IngredientRef" ("id", "name") VALUES ('i-rice', 'rice'), ('i-onion', 'onion'), ('i-salt', 'salt')`);
  // Ann keeps her stew to the household; Dee, outside it, keeps her pie to herself.
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "visibility") VALUES ('r-stew', 'Stew', 'ann', 'household')`);
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "visibility") VALUES ('r-pie', 'Pie', 'dee', 'private')`);
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "visibility") VALUES ('r-toast', 'Toast', 'ann', 'public')`);
  run(`INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description") VALUES ('s1', 'r-stew', 1, 'Cook'), ('s2', 'r-stew', 2, 'Serve'), ('s3', 'r-pie', 1, 'Bake')`);
  const unit = (name: string) => `(SELECT "id" FROM "Unit" WHERE "name" = '${name}')`;
  const ingredient = (name: string) => `(SELECT "id" FROM "IngredientRef" WHERE "name" = '${name}')`;
  for (const [id, recipe, step, quantity, unitName, name] of [
    ["g1", "r-stew", 1, 1, "cup", "rice"],
    ["g2", "r-stew", 2, 0.5, "cup", "rice"],
    ["g3", "r-stew", 1, 1, "whole", "onion"],
    ["g4", "r-stew", 2, 0, "whole", "salt"],
    ["g5", "r-pie", 1, 2, "cup", "rice"],
  ] as const) {
    run(`INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId")
      VALUES ('${id}', '${recipe}', ${step}, ${quantity}, ${unit(unitName)}, ${ingredient(name)})`);
  }
});

afterEach(() => database.close());

describe("a planned recipe on a household shopping list", () => {
  it("adds the recipe's ingredients, scaled and combined, after what the list already has", async () => {
    const list = adder();
    expect(await list.addRecipe("r-stew", 2)).toBe(true);
    expect(items()).toHaveLength(1);
    await list.addGathered("week-1");
    expect(items()).toEqual([
      { text: "Milk", addedById: "ann", sortIndex: 0 },
      { text: "3 cup rice", addedById: "ben", sortIndex: 1 },
      { text: "2 whole onion", addedById: "ben", sortIndex: 2 },
      { text: "salt", addedById: "ben", sortIndex: 3 },
    ]);
  });

  it("combines the same ingredient in the same unit across the week's recipes into one line", async () => {
    run(`UPDATE "Recipe" SET "visibility" = 'public' WHERE "id" = 'r-pie'`);
    const list = adder();
    expect(await list.addRecipe("r-stew", 1)).toBe(true);
    expect(await list.addRecipe("r-pie", 1)).toBe(true);
    await list.addGathered("week-1");
    expect(items().map((item) => (item as { text: string }).text)).toEqual(["Milk", "3 ½ cup rice", "1 whole onion", "salt"]);
  });

  it("adds them once per write key, however many times it is sent", async () => {
    const send = async (writeKey: string) => {
      const list = adder();
      await list.addRecipe("r-stew", 1);
      await list.addGathered(writeKey);
    };
    await send("week-1");
    await send("week-1");
    expect(items()).toHaveLength(4);
    await send("week-2");
    expect(items()).toHaveLength(7);
  });

  it("adds nothing for a recipe the cook can't read, or one that's gone, and says so", async () => {
    const list = adder();
    expect(await list.addRecipe("r-pie", 1)).toBe(false);
    expect(await list.addRecipe("r-missing", 1)).toBe(false);
    run(`UPDATE "Recipe" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "id" = 'r-stew'`);
    expect(await list.addRecipe("r-stew", 1)).toBe(false);
    await list.addGathered("week-1");
    expect(items()).toHaveLength(1);
  });

  it("counts a recipe with no ingredients as added, and adds nothing", async () => {
    const list = adder();
    expect(await list.addRecipe("r-toast", 1)).toBe(true);
    await list.addGathered("week-1");
    expect(items()).toHaveLength(1);
  });
});
