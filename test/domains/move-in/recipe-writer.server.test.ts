// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeMovedInRecipe } from "~/domains/move-in/adapters/storage/recipe-writer.server";
import type { IngredientDraft, RecipeDraft } from "~/domains/move-in/model/recipe-draft";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");

function all<T>(sql: string, ...values: unknown[]): T[] {
  return database.sqlite.prepare(sql).all(...values) as T[];
}

function ingredient(key: string, fields: Partial<IngredientDraft>): IngredientDraft {
  return { sourceKey: key, section: null, quantity: null, unit: null, food: null, note: null, originalText: null, plainText: true, ...fields };
}

function draft(fields: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    sourceKey: "recipe-1",
    ownerKey: "owner",
    sourceUpdatedAt: "2026-01-05T10:00:00",
    title: "Pancakes",
    description: "Fluffy ones.",
    servings: "4 servings",
    sourceUrl: "https://example.com/pancakes",
    photoPath: "data/recipes/recipe-1/images/original.webp",
    steps: [
      { sourceKey: "step-1", title: "Batter", text: "Whisk the flour and milk.", ingredientKeys: ["r|flour", "r|milk"] },
      { sourceKey: "step-2", title: null, text: "Cook in butter, then add the salt.", ingredientKeys: ["r|flour"] },
    ],
    ingredients: [
      ingredient("r|flour", { quantity: 1.5, unit: "Cup", food: "Flour", note: "sifted", plainText: false }),
      ingredient("r|milk", { note: "1 cup milk" }),
      ingredient("r|butter", { quantity: null, unit: null, food: "butter", plainText: false }),
      ingredient("r|salt", { originalText: "salt to taste" }),
    ],
    notes: [{ title: "Storage", text: "Freezes well." }, { title: null, text: "Kids love it." }],
    tags: [],
    categories: [],
    tools: [],
    warnings: [],
    ...fields,
  };
}

const write = (recipe: RecipeDraft, jobId = "job-1") =>
  writeMovedInRecipe({ db: database.binding, sourceId: "source-1", jobId, chefId: "chef-1", draft: recipe, now });

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'chef@example.com', 'chef')`).run();
  database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-1', 'chef-1', 'mealie-backup', 'group', 'Home')`).run();
});

afterEach(() => database.close());

describe("writeMovedInRecipe", () => {
  it("writes the recipe, its steps and its ingredients on the steps that use them", async () => {
    const result = await write(draft());
    expect(result).toMatchObject({ outcome: "created", title: "Pancakes", warnings: [] });
    const [recipe] = all<Record<string, unknown>>(`SELECT * FROM "Recipe"`);
    expect(recipe).toMatchObject({
      id: result.recipeId,
      chefId: "chef-1",
      title: "Pancakes",
      description: "Fluffy ones.\n\nStorage: Freezes well.\n\nKids love it.",
      servings: "4 servings",
      sourceUrl: "https://example.com/pancakes",
    });
    expect(all(`SELECT "stepNum", "stepTitle", "description" FROM "RecipeStep" ORDER BY "stepNum"`)).toEqual([
      { stepNum: 1, stepTitle: "Batter", description: "Whisk the flour and milk." },
      { stepNum: 2, stepTitle: null, description: "Cook in butter, then add the salt." },
    ]);
    expect(all(`SELECT i."stepNum", i."quantity", u."name" AS unit, r."name" AS name FROM "Ingredient" i
      JOIN "Unit" u ON u."id" = i."unitId" JOIN "IngredientRef" r ON r."id" = i."ingredientRefId" ORDER BY i."rowid"`)).toEqual([
      { stepNum: 1, quantity: 1.5, unit: "cup", name: "flour, sifted" },
      { stepNum: 1, quantity: 1, unit: "cup", name: "milk" },
      { stepNum: 2, quantity: 1, unit: "whole", name: "butter" },
      { stepNum: 1, quantity: 1, unit: "whole", name: "salt to taste" },
    ]);
    expect(all(`SELECT "sourceTable", "sourceKey", "targetType", "targetId", "sourceUpdatedAt", "lastJobId" FROM "SourceRecord"`)).toEqual([
      { sourceTable: "recipes", sourceKey: "recipe-1", targetType: "Recipe", targetId: result.recipeId, sourceUpdatedAt: "2026-01-05T10:00:00", lastJobId: "job-1" },
    ]);
  });

  it("keeps a moved-in recipe private, for its cook to share when ready", async () => {
    const result = await write(draft());
    expect(all(`SELECT "visibility" FROM "Recipe" WHERE "id" = '${result.recipeId}'`)).toEqual([{ visibility: "private" }]);
  });

  it("adds nothing when the same recipe moves in again", async () => {
    const first = await write(draft());
    expect(await write(draft(), "job-2")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    expect(all(`SELECT "id" FROM "Recipe"`)).toHaveLength(1);
    expect(all(`SELECT "id" FROM "Ingredient"`)).toHaveLength(4);
  });

  it("leaves a recipe the person deleted after moving in", async () => {
    const first = await write(draft());
    database.sqlite.prepare(`UPDATE "Recipe" SET "deletedAt" = '2026-11-23T13:00:00.000Z'`).run();
    expect(await write(draft(), "job-2")).toEqual({ outcome: "skipped", recipeId: first.recipeId, reason: "You deleted this recipe in Spoonjoy after it moved in." });
    database.sqlite.prepare(`DELETE FROM "Recipe"`).run();
    expect((await write(draft(), "job-3")).outcome).toBe("skipped");
    expect(all(`SELECT "id" FROM "Recipe"`)).toHaveLength(0);
  });

  it("numbers a title the chef already uses", async () => {
    database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Pancakes', 'chef-1'), ('mine-2', 'Pancakes (2)', 'chef-1')`).run();
    const result = await write(draft());
    expect(result).toMatchObject({ outcome: "created", title: "Pancakes (3)", warnings: ["You already had a recipe called \"Pancakes\", so this one is \"Pancakes (3)\"."] });
  });

  it("puts ingredients of a recipe with no steps on one step", async () => {
    await write(draft({ steps: [], ingredients: [ingredient("r|flour", { note: "2 cups flour" })] }));
    expect(all(`SELECT "stepNum", "description" FROM "RecipeStep"`)).toEqual([{ stepNum: 1, description: "Gather the ingredients." }]);
    expect(all(`SELECT "stepNum" FROM "Ingredient"`)).toEqual([{ stepNum: 1 }]);
  });

  it("writes a recipe with neither steps nor ingredients as it is", async () => {
    await write(draft({ steps: [], ingredients: [], notes: [], description: null }));
    expect(all(`SELECT "description" FROM "Recipe"`)).toEqual([{ description: null }]);
    expect(all(`SELECT "id" FROM "RecipeStep"`)).toEqual([]);
  });

  it("leaves out a line it cannot read and says so", async () => {
    const result = await write(draft({ ingredients: [ingredient("r|x", { note: "2 cups" }), ingredient("r|y", { originalText: "3 tbsp" })] }));
    expect(result).toMatchObject({
      outcome: "created",
      warnings: [
        "\"2 cups\" has no ingredient name after its amount, so it was left out.",
        "\"3 tbsp\" has no ingredient name after its amount, so it was left out.",
      ],
    });
    expect(all(`SELECT "id" FROM "Ingredient"`)).toEqual([]);
  });

  it("starts notes as the description when there was none", async () => {
    await write(draft({ description: null, notes: [{ title: "Storage", text: "Freezes well." }] }));
    expect(all(`SELECT "description" FROM "Recipe"`)).toEqual([{ description: "Storage: Freezes well." }]);
  });

  describe("when another run writes at the same moment", () => {
    // A binding that lets `beforeWrite` change the database just before each recipe batch runs.
    function racing(beforeWrite: (attempt: number) => void) {
      let attempt = 0;
      return {
        prepare: database.binding.prepare,
        batch: async (statements: Array<{ sql: string }>) => {
          if (statements.some((statement) => statement.sql.includes(`INSERT INTO "Recipe"`))) beforeWrite(++attempt);
          return database.binding.batch(statements as never);
        },
      };
    }

    it("finds the recipe the other run wrote and adds nothing", async () => {
      const db = racing(() => {
        database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('theirs', 'Pancakes from them', 'chef-1')`).run();
        database.sqlite.prepare(`INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "lastJobId")
          VALUES ('record', 'source-1', 'recipes', 'recipe-1', 'Recipe', 'theirs', 'job-0')`).run();
      });
      const result = await writeMovedInRecipe({ db: db as never, sourceId: "source-1", jobId: "job-1", chefId: "chef-1", draft: draft(), now });
      expect(result).toEqual({ outcome: "unchanged", recipeId: "theirs", jobId: "job-0" });
      expect(all(`SELECT "id" FROM "Recipe"`)).toEqual([{ id: "theirs" }]);
    });

    it("gives up after losing the title three times", async () => {
      const db = racing((attempt) => {
        const title = attempt === 1 ? "Pancakes" : `Pancakes (${attempt})`;
        database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES (?, ?, 'chef-1')`).run(`taken-${attempt}`, title);
      });
      await expect(writeMovedInRecipe({ db: db as never, sourceId: "source-1", jobId: "job-1", chefId: "chef-1", draft: draft(), now }))
        .rejects.toThrow("Moving in recipe recipe-1 lost a race three times.");
    });

    it("passes on errors that are not races", async () => {
      const db = { prepare: database.binding.prepare, batch: async () => Promise.reject(new Error("D1 is down")) };
      await expect(writeMovedInRecipe({ db: db as never, sourceId: "source-1", jobId: "job-1", chefId: "chef-1", draft: draft(), now }))
        .rejects.toThrow("D1 is down");
    });
  });
});
