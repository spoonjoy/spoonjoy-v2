// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeMovedInRecipe, writeMovedInRecipes } from "~/domains/move-in/adapters/storage/recipe-writer.server";
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

  it("keeps each step's time, for a source that has one, and finds the recipe again by it", async () => {
    const timed = draft({ steps: [{ sourceKey: "step-1", title: null, text: "Rest the batter.", ingredientKeys: [], duration: 20 }] });
    const first = await write(timed);
    expect(all(`SELECT "duration" FROM "RecipeStep"`)).toEqual([{ duration: 20 }]);
    expect(await write(timed, "job-2")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
  });

  it("leaves a recipe moving back to its home here to the one-at-a-time writer, and claims a home only once", async () => {
    const first = await write(draft());
    database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-2', 'chef-1', 'spoonjoy', 'there', 'There')`).run();
    const back = (key: string) => ({ db: database.binding, sourceId: "source-2", jobId: "job-2", chefId: "chef-1", now, draft: draft({ sourceKey: key, home: { recipeId: first.recipeId, contentHash: null } }) });
    expect(await writeMovedInRecipes([back("there-1")])).toEqual([null]);
    expect(await writeMovedInRecipe(back("there-1"))).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "home" });
    // A second recipe there naming the same home can't share it: it comes in as a recipe of its own.
    expect(await writeMovedInRecipe(back("there-2"))).toMatchObject({ outcome: "created" });
  });

  it("links a step to the earlier steps whose output it uses, once each, and to no later or missing step", async () => {
    const linked = draft({ steps: [
      { sourceKey: "step-1", title: null, text: "Make the batter.", ingredientKeys: [], usesOutputOf: [2] },
      { sourceKey: "step-2", title: null, text: "Cook it.", ingredientKeys: [], usesOutputOf: [0, 1, 1, 2, 5] },
      { sourceKey: "step-3", title: null, text: "Serve both.", ingredientKeys: [], usesOutputOf: [2, 1] },
    ] });
    const first = await write(linked);
    expect(all(`SELECT "outputStepNum", "inputStepNum" FROM "StepOutputUse" ORDER BY "outputStepNum", "inputStepNum"`)).toEqual([
      { outputStepNum: 1, inputStepNum: 2 },
      { outputStepNum: 1, inputStepNum: 3 },
      { outputStepNum: 2, inputStepNum: 3 },
    ]);
    // The links are part of the recipe, so the same one moving in again is found unchanged.
    expect(await write(linked, "job-2")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
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
    expect(result).toEqual({ outcome: "created", recipeId: expect.any(String), title: "Pancakes (3)", renamedFrom: "Pancakes", warnings: [] });
  });

  it("moves in and numbers a title too long for a LIKE pattern on D1", async () => {
    // "<title> (%)" is over D1's 50-byte LIKE limit, which stopped these recipes on every try.
    const title = "Savory Tender Cantaloupe And Dried Chinese Broccoli Salad";
    database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', ?, 'chef-1'), ('mine-2', ?, 'chef-1'), ('other', 'Savory Tender', 'chef-1')`).run(title, `${title} (2)`);
    const result = await write(draft({ title }));
    expect(result).toEqual({ outcome: "created", recipeId: expect.any(String), title: `${title} (3)`, renamedFrom: title, warnings: [] });
  });

  describe("when the recipe moved in before", () => {
    const changed = () => draft({
      title: "Weekend pancakes",
      steps: [{ sourceKey: "step-1", title: null, text: "Whisk the flour and milk, then rest it.", ingredientKeys: ["r|flour", "r|milk"] }],
      ingredients: [ingredient("r|flour", { quantity: 2, unit: "Cup", food: "Flour", plainText: false }), ingredient("r|milk", { note: "1 cup milk" })],
      sourceUpdatedAt: "2026-02-01T09:00:00",
    });

    it("changes it in place when the backup changed it and the cook hasn't", async () => {
      const first = await write(draft());
      expect(await write(changed(), "job-2")).toEqual({ outcome: "updated", recipeId: first.recipeId });
      expect(all(`SELECT "id", "title", "description" FROM "Recipe"`)).toEqual([
        { id: first.recipeId, title: "Weekend pancakes", description: "Fluffy ones.\n\nStorage: Freezes well.\n\nKids love it." },
      ]);
      expect(all(`SELECT "stepNum", "description" FROM "RecipeStep"`)).toEqual([{ stepNum: 1, description: "Whisk the flour and milk, then rest it." }]);
      expect(all(`SELECT "quantity" FROM "Ingredient" ORDER BY "quantity"`)).toEqual([{ quantity: 1 }, { quantity: 2 }]);
      expect(all(`SELECT "sourceUpdatedAt", "lastJobId" FROM "SourceRecord"`)).toEqual([{ sourceUpdatedAt: "2026-02-01T09:00:00", lastJobId: "job-1" }]);
      // Moving the changed backup in once more finds it as it is now.
      expect(await write(changed(), "job-3")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    });

    it("keeps a numbered title's number while the name in the backup stays the same", async () => {
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Pancakes', 'chef-1')`).run();
      const first = await write(draft());
      expect(await write(draft({ description: "Fluffier ones." }), "job-2")).toEqual({ outcome: "updated", recipeId: first.recipeId });
      expect(all(`SELECT "title" FROM "Recipe" WHERE "id" = ?`, first.recipeId)).toEqual([{ title: "Pancakes (2)" }]);
    });

    it("numbers a new name the chef already uses", async () => {
      const first = await write(draft());
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Weekend pancakes', 'chef-1')`).run();
      await write(changed(), "job-2");
      expect(all(`SELECT "title" FROM "Recipe" WHERE "id" = ?`, first.recipeId)).toEqual([{ title: "Weekend pancakes (2)" }]);
    });

    it("keeps the cook's version when both the cook and the backup changed it", async () => {
      const first = await write(draft());
      database.sqlite.prepare(`UPDATE "Recipe" SET "description" = 'Mine now.'`).run();
      expect(await write(changed(), "job-2")).toEqual({
        outcome: "kept",
        recipeId: first.recipeId,
        reason: "Pancakes changed in the backup, but you've changed it in Spoonjoy too, so your version stays.",
      });
      expect(all(`SELECT "title", "description" FROM "Recipe"`)).toEqual([{ title: "Pancakes", description: "Mine now." }]);
    });

    it("leaves a recipe the cook changed when the backup didn't change it", async () => {
      const first = await write(draft());
      database.sqlite.prepare(`UPDATE "Recipe" SET "description" = 'Mine now.'`).run();
      expect(await write(draft(), "job-2")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    });

    it("finds a recipe the cook already changed to match the backup", async () => {
      const first = await write(draft());
      await write(changed(), "job-2");
      // As if the cook had typed the backup's changes in by hand before moving it in again.
      database.sqlite.prepare(`UPDATE "SourceRecord" SET "contentHash" = 'as it first moved in'`).run();
      expect(await write(changed(), "job-3")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    });

    it("leaves a recipe recorded without its content as it is", async () => {
      const first = await write(draft());
      database.sqlite.prepare(`UPDATE "SourceRecord" SET "contentHash" = NULL`).run();
      expect(await write(changed(), "job-2")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    });

    it("leaves the recipe alone when another run changed it first", async () => {
      const first = await write(draft());
      const db = {
        prepare: database.binding.prepare,
        batch: async (statements: Array<{ sql: string }>) => {
          if (statements.some((statement) => statement.sql.includes(`UPDATE "SourceRecord" SET "contentHash"`))) {
            database.sqlite.prepare(`UPDATE "SourceRecord" SET "contentHash" = 'theirs'`).run();
            database.sqlite.prepare(`UPDATE "Recipe" SET "description" = 'Theirs.'`).run();
          }
          return database.binding.batch(statements as never);
        },
      };
      const result = await writeMovedInRecipe({ db: db as never, sourceId: "source-1", jobId: "job-2", chefId: "chef-1", draft: changed(), now });
      expect(result).toMatchObject({ outcome: "kept", recipeId: first.recipeId });
      expect(all(`SELECT "description" FROM "Recipe"`)).toEqual([{ description: "Theirs." }]);
    });

    it("keeps an edit the cook saves while the backup's change is on its way", async () => {
      const first = await write(draft());
      const db = {
        prepare: database.binding.prepare,
        batch: async (statements: Array<{ sql: string }>) => {
          if (statements.some((statement) => statement.sql.includes(`UPDATE "SourceRecord" SET "contentHash"`))) {
            // The cook saves between the move-in's read and its write; their save bumps updatedAt.
            database.sqlite.prepare(`UPDATE "Recipe" SET "description" = 'Mine now.', "updatedAt" = '2026-11-23T12:00:05.000Z'`).run();
          }
          return database.binding.batch(statements as never);
        },
      };
      const result = await writeMovedInRecipe({ db: db as never, sourceId: "source-1", jobId: "job-2", chefId: "chef-1", draft: changed(), now });
      expect(result).toMatchObject({ outcome: "kept", recipeId: first.recipeId });
      expect(all(`SELECT "title", "description" FROM "Recipe"`)).toEqual([{ title: "Pancakes", description: "Mine now." }]);
    });

    it("counts a step's time or a step that uses another's output as the cook's change", async () => {
      const first = await write(draft());
      database.sqlite.prepare(`UPDATE "RecipeStep" SET "duration" = 10 WHERE "stepNum" = 1`).run();
      expect(await write(changed(), "job-2")).toMatchObject({ outcome: "kept" });
      database.sqlite.prepare(`UPDATE "RecipeStep" SET "duration" = NULL`).run();
      database.sqlite.prepare(`INSERT INTO "StepOutputUse" ("id", "recipeId", "outputStepNum", "inputStepNum") VALUES ('use-1', ?, 1, 2)`).run(first.recipeId);
      expect(await write(changed(), "job-2")).toMatchObject({ outcome: "kept" });
      expect(all(`SELECT "duration" FROM "RecipeStep" ORDER BY "stepNum"`)).toEqual([{ duration: null }, { duration: null }]);
      expect(all(`SELECT "id" FROM "StepOutputUse"`)).toEqual([{ id: "use-1" }]);
    });
  });

  describe("when another copy of the same kitchen moved in before", () => {
    // Another backup of the same kitchen, from a server whose ids differ (another version, or a fresh install).
    const writeFromCopy = (recipe: RecipeDraft, jobId = "job-2") =>
      writeMovedInRecipe({ db: database.binding, sourceId: "source-2", jobId, chefId: "chef-1", draft: recipe, now });

    beforeEach(() => {
      database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-2', 'chef-1', 'mealie-backup', 'other', 'Home')`).run();
    });

    it("finds a recipe with the same name and content, and adds nothing", async () => {
      const first = await write(draft());
      expect(await writeFromCopy(draft({ sourceKey: "copy-1" }))).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
      expect(all(`SELECT "id" FROM "Recipe"`)).toHaveLength(1);
      // The copy's recipe now points at it, so the next move-in of the copy finds it by its id.
      expect(all(`SELECT "sourceId", "targetId", "lastJobId" FROM "SourceRecord" WHERE "sourceKey" = 'copy-1'`)).toEqual([
        { sourceId: "source-2", targetId: first.recipeId, lastJobId: "job-1" },
      ]);
      expect(await writeFromCopy(draft({ sourceKey: "copy-1" }), "job-3")).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
    });

    it("finds it under its number", async () => {
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Pancakes', 'chef-1')`).run();
      const first = await write(draft());
      expect(await writeFromCopy(draft({ sourceKey: "copy-1" }))).toMatchObject({ outcome: "unchanged", recipeId: first.recipeId });
    });

    it("brings a different recipe with the same name under a number", async () => {
      await write(draft());
      expect(await writeFromCopy(draft({ sourceKey: "copy-1", description: "Thin ones." }))).toMatchObject({ outcome: "created", title: "Pancakes (2)", renamedFrom: "Pancakes" });
    });

    it("matches each earlier recipe once", async () => {
      await write(draft());
      await writeFromCopy(draft({ sourceKey: "copy-1" }));
      expect(await writeFromCopy(draft({ sourceKey: "copy-2" }))).toMatchObject({ outcome: "created", title: "Pancakes (2)" });
    });

    it("never takes a recipe the cook wrote for one that moved in", async () => {
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "description", "chefId") VALUES ('mine', 'Pancakes', 'Fluffy ones.', 'chef-1')`).run();
      expect(await writeFromCopy(draft({ sourceKey: "copy-1", steps: [], ingredients: [], notes: [] }))).toMatchObject({ outcome: "created", title: "Pancakes (2)" });
    });

    it("finds a recipe with a name too long for a LIKE pattern on D1", async () => {
      const title = "Creamy Crunchy Jerusalem Artichoke And Mangosteens Bowl";
      // Another of the cook's recipes, so the name is compared with one that isn't it.
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('other', 'Creamy Crunchy', 'chef-1')`).run();
      const first = await write(draft({ title }));
      expect(await writeFromCopy(draft({ sourceKey: "copy-1", title }))).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
      expect(all(`SELECT "title" FROM "Recipe" WHERE "id" != 'other'`)).toEqual([{ title }]);
    });

    it("finds a recipe whose own name ends in a number", async () => {
      const first = await write(draft({ title: "Soup (2)" }));
      expect(await writeFromCopy(draft({ sourceKey: "copy-1", title: "Soup (2)" }))).toEqual({ outcome: "unchanged", recipeId: first.recipeId, jobId: "job-1" });
      expect(all(`SELECT "title" FROM "Recipe"`)).toEqual([{ title: "Soup (2)" }]);
    });

    it("lets only one of two identical rows claim the earlier recipe when they arrive together", async () => {
      const first = await write(draft());
      // Another row of the copy claims the recipe between this row's read and its write.
      const db = {
        prepare: database.binding.prepare,
        batch: async (statements: Array<{ sql: string }>) => {
          if (statements.some((statement) => statement.sql.includes(`"targetType" = 'Recipe' AND "targetId" = ?)`)) && !all(`SELECT 1 FROM "SourceRecord" WHERE "sourceKey" = 'copy-2'`).length) {
            await writeFromCopy(draft({ sourceKey: "copy-2" }));
          }
          return database.binding.batch(statements as never);
        },
      };
      const result = await writeMovedInRecipe({ db: db as never, sourceId: "source-2", jobId: "job-2", chefId: "chef-1", draft: draft({ sourceKey: "copy-1" }), now });
      expect(result).toMatchObject({ outcome: "created", title: "Pancakes (2)" });
      expect(all(`SELECT "sourceKey", "targetId" FROM "SourceRecord" WHERE "sourceId" = 'source-2' ORDER BY "sourceKey"`)).toEqual([
        { sourceKey: "copy-1", targetId: (result as { recipeId: string }).recipeId },
        { sourceKey: "copy-2", targetId: first.recipeId },
      ]);
    });

    it("leaves a recipe the cook edits while a copy is matched to it", async () => {
      const first = await write(draft());
      const db = {
        prepare: database.binding.prepare,
        batch: async (statements: Array<{ sql: string }>) => {
          if (statements.some((statement) => statement.sql.includes(`"targetType" = 'Recipe' AND "targetId" = ?)`)) && !all(`SELECT 1 FROM "Recipe" WHERE "description" = 'Mine now.'`).length) {
            database.sqlite.prepare(`UPDATE "Recipe" SET "description" = 'Mine now.', "updatedAt" = '2026-11-23T12:00:05.000Z'`).run();
          }
          return database.binding.batch(statements as never);
        },
      };
      const result = await writeMovedInRecipe({ db: db as never, sourceId: "source-2", jobId: "job-2", chefId: "chef-1", draft: draft({ sourceKey: "copy-1" }), now });
      expect(result).toMatchObject({ outcome: "created", title: "Pancakes (2)" });
      expect(all(`SELECT "description" FROM "Recipe" WHERE "id" = ?`, first.recipeId)).toEqual([{ description: "Mine now." }]);
    });

    it("leaves recipes from the same kitchen to their own ids", async () => {
      await write(draft());
      expect(await write(draft({ sourceKey: "recipe-2" }))).toMatchObject({ outcome: "created", title: "Pancakes (2)" });
    });
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

describe("writeMovedInRecipes", () => {
  /** The binding, counting each round trip to the database, with `beforeWrite` run just before the second one. */
  function counted(beforeWrite?: () => void) {
    const binding = database.binding;
    let trips = 0;
    const db = {
      prepare: binding.prepare.bind(binding),
      batch: async (statements: Parameters<typeof binding.batch>[0]) => {
        if (++trips === 2) beforeWrite?.();
        return binding.batch(statements);
      },
    };
    return { db, trips: () => trips };
  }
  const chunk = (db: typeof database.binding, recipes: RecipeDraft[], jobId = "job-1") =>
    writeMovedInRecipes(recipes.map((recipe) => ({ db, sourceId: "source-1", jobId, chefId: "chef-1", draft: recipe, now })));
  const three = () => [
    draft(),
    draft({ sourceKey: "recipe-2", title: "Waffles" }),
    draft({ sourceKey: "recipe-3", title: "Crepes", steps: [], ingredients: [] }),
  ];

  it("writes a chunk's new recipes with one read and one write, as writing each alone would", async () => {
    const { db, trips } = counted();
    const results = await chunk(db as never, three());
    expect(trips()).toBe(2);
    expect(results).toEqual([
      { outcome: "created", recipeId: expect.any(String), title: "Pancakes", warnings: [] },
      { outcome: "created", recipeId: expect.any(String), title: "Waffles", warnings: [] },
      { outcome: "created", recipeId: expect.any(String), title: "Crepes", warnings: [] },
    ]);
    const together = {
      recipes: all(`SELECT "title", "description", "visibility" FROM "Recipe" ORDER BY "title"`),
      steps: all(`SELECT "stepNum", "description" FROM "RecipeStep" ORDER BY "recipeId", "stepNum"`).length,
      ingredients: all(`SELECT "id" FROM "Ingredient"`).length,
      records: all(`SELECT "sourceKey" FROM "SourceRecord" ORDER BY "sourceKey"`),
    };
    database.close();
    database = migratedSqliteD1();
    database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'chef@example.com', 'chef')`).run();
    database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-1', 'chef-1', 'mealie-backup', 'group', 'Home')`).run();
    for (const recipe of three()) await write(recipe);
    expect({
      recipes: all(`SELECT "title", "description", "visibility" FROM "Recipe" ORDER BY "title"`),
      steps: all(`SELECT "stepNum", "description" FROM "RecipeStep" ORDER BY "recipeId", "stepNum"`).length,
      ingredients: all(`SELECT "id" FROM "Ingredient"`).length,
      records: all(`SELECT "sourceKey" FROM "SourceRecord" ORDER BY "sourceKey"`),
    }).toEqual(together);
  });

  it("numbers a title the chef uses, and a title an earlier recipe in the chunk took", async () => {
    database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Pancakes', 'chef-1')`).run();
    const results = await chunk(database.binding, [draft(), draft({ sourceKey: "recipe-2" })]);
    expect(results.map((result) => result && "title" in result && result.title)).toEqual(["Pancakes (2)", "Pancakes (3)"]);
    expect(results[1]).toMatchObject({ renamedFrom: "Pancakes" });
  });

  it("leaves a recipe that moved in before, and one that may be from another copy, to be written alone", async () => {
    await write(draft());
    database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-2', 'chef-1', 'mealie-backup', 'other', 'Cabin')`).run();
    await writeMovedInRecipe({ db: database.binding, sourceId: "source-2", jobId: "job-0", chefId: "chef-1", draft: draft({ sourceKey: "cabin-1", title: "Waffles" }), now });
    const results = await chunk(database.binding, three(), "job-2");
    expect(results).toEqual([null, null, { outcome: "created", recipeId: expect.any(String), title: "Crepes", warnings: [] }]);
    expect(all(`SELECT "title" FROM "Recipe" ORDER BY "title"`)).toEqual([{ title: "Crepes" }, { title: "Pancakes" }, { title: "Waffles" }]);
  });

  it("writes nothing, and leaves each recipe to be written alone, when another write took a name first", async () => {
    const { db } = counted(() => {
      database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('mine', 'Waffles', 'chef-1')`).run();
    });
    expect(await chunk(db as never, three())).toEqual([null, null, null]);
    expect(all(`SELECT "title" FROM "Recipe"`)).toEqual([{ title: "Waffles" }]);
    expect(all(`SELECT "id" FROM "SourceRecord"`)).toEqual([]);
  });

  it("writes nothing when every recipe of the chunk is one to write alone", async () => {
    await write(draft());
    const { db, trips } = counted();
    expect(await chunk(db as never, [draft()], "job-2")).toEqual([null]);
    expect(trips()).toBe(1);
  });

  it("passes on an error that isn't a lost race", async () => {
    const { db } = counted(() => {
      throw new Error("D1 is down");
    });
    await expect(chunk(db as never, three())).rejects.toThrow("D1 is down");
    expect(all(`SELECT "id" FROM "Recipe"`)).toEqual([]);
  });

  it("asks the database nothing for an empty chunk", async () => {
    const { db, trips } = counted();
    expect(await chunk(db as never, [])).toEqual([]);
    expect(trips()).toBe(0);
  });
});
