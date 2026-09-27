// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import { getLocalDb } from "~/lib/db.server";
import { nativeSyncTombstoneUpsertStatement } from "~/lib/native-sync-invalidation.server";
import { coverInsertStatement } from "~/lib/recipe-cover.server";
import { createRecipeDraft, type RecipeStepDraft } from "~/lib/recipe-create.server";
import {
  addStepIngredientsOnD1,
  deleteRecipeStepOnD1,
  deleteStepIngredientOnD1,
  saveRecipeEditOnD1,
  swapRecipeStepsOnD1,
  updateRecipeStepOnD1,
} from "~/lib/recipe-d1-edits.server";
import { activeRecipeTitleFreeGuard } from "~/lib/recipe-d1-writes.server";
import { forkRecipe, ForkTitleExhaustedError } from "~/lib/recipe-fork.server";
import { ActiveRecipeTitleConflictError } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The D1 write batches against the unit-test database through the SQLite-backed fake D1
// binding (one SQLite transaction per batch, as D1 runs it). Where the Prisma version
// still exists (no binding), the same write through both paths must leave the same rows.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let friendId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

async function graph(recipeId: string) {
  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    include: {
      steps: {
        orderBy: { stepNum: "asc" },
        include: { ingredients: { include: { unit: true, ingredientRef: true } } },
      },
      covers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!recipe) return null;
  const uses = await db.stepOutputUse.findMany({
    where: { recipeId },
    orderBy: [{ outputStepNum: "asc" }, { inputStepNum: "asc" }],
  });
  return {
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chefId: recipe.chefId,
    sourceRecipeId: recipe.sourceRecipeId,
    sourceUrl: recipe.sourceUrl,
    coverMode: recipe.coverMode,
    activeCoverVariant: recipe.activeCoverVariant,
    activeCover: recipe.covers.findIndex((cover) => cover.id === recipe.activeCoverId),
    deleted: recipe.deletedAt !== null,
    steps: recipe.steps.map((step) => ({
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: step.ingredients
        .map((ingredient) => ({ quantity: ingredient.quantity, unit: ingredient.unit.name, name: ingredient.ingredientRef.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    })),
    uses: uses.map((use) => [use.outputStepNum, use.inputStepNum]),
    covers: recipe.covers.map((cover) => ({
      imageUrl: cover.imageUrl,
      stylizedImageUrl: cover.stylizedImageUrl,
      sourceType: cover.sourceType,
      sourceSpoonId: cover.sourceSpoonId,
      status: cover.status,
      createdById: cover.createdById,
      sourceImageUrl: cover.sourceImageUrl,
      generationStatus: cover.generationStatus,
      failureReason: cover.failureReason,
      promptVersion: cover.promptVersion,
      styleVersion: cover.styleVersion,
      archivedAt: cover.archivedAt,
    })),
  };
}

/** A recipe with three steps (step 3 uses step 1), in a cookbook of its chef. */
async function seedRecipe(title: string, owner = chefId) {
  const recipe = await db.recipe.create({
    data: { title, description: "Seeded", servings: "2", chefId: owner, updatedAt: OLD },
  });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const refs = await Promise.all(["flour", "milk", "egg", "salt"].map((name) =>
    db.ingredientRef.upsert({ where: { name }, update: {}, create: { name } })));
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    steps.push(await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it`, duration: stepNum * 5 },
    }));
  }
  const ingredients = [];
  for (const [stepNum, ref, quantity] of [[1, 0, 2], [1, 1, 1], [2, 2, 1]] as const) {
    ingredients.push(await db.ingredient.create({
      data: { recipeId: recipe.id, stepNum, quantity, unitId: cup.id, ingredientRefId: refs[ref]!.id },
    }));
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: owner, updatedAt: OLD } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: owner } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredients, cookbook, cup, refs };
}

/** The fake binding, with `before` run once just ahead of the first batch. */
function interleaved(before: () => Promise<unknown>): D1ReadDatabase {
  let pending = true;
  return {
    prepare: (sql) => d1.binding.prepare(sql),
    async batch(statements) {
      if (pending) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements as never);
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => {
    throw new Error("expected the write to fail");
  }, (error: unknown) => error);
}

const draftSteps: RecipeStepDraft[] = [
  {
    stepTitle: "Mix",
    description: "Mix the batter",
    duration: 5,
    ingredients: [
      { quantity: 2, unit: "Cup", ingredientName: "Flour" },
      { quantity: 1, unit: "cup", ingredientName: "Oat Milk" },
    ],
  },
  { stepTitle: null, description: "Cook", duration: null, ingredients: [{ quantity: 1, unit: "Tbsp", ingredientName: "Butter" }] },
];

describe("D1 recipe write batches", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
    friendId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  describe("d1WriteBatch", () => {
    const statement = { bind: () => statement };
    const stub = (results: unknown[]): D1ReadDatabase => ({
      prepare: () => statement,
      batch: async () => results as never,
    });

    it("returns each statement's rows and change count", async () => {
      await expect(d1WriteBatch(stub([{ results: [{ a: 1 }], meta: { changes: 0 } }]), [["SELECT 1"]]))
        .resolves.toEqual([{ rows: [{ a: 1 }], changes: 0 }]);
    });

    it("rejects a result count that does not match the statements", async () => {
      await expect(d1WriteBatch(stub([]), [["SELECT 1"]])).rejects.toThrow("D1 batch returned 0 results for 1 statements");
    });

    it.each([
      ["no result", undefined],
      ["no rows array", { meta: { changes: 1 } }],
      ["no change count", { results: [] }],
      ["no meta", { results: [], meta: undefined }],
    ])("rejects a statement result with %s", async (_label, result) => {
      await expect(d1WriteBatch(stub([result]), [["SELECT 1"]])).rejects.toThrow("D1 batch statement 0 returned no result");
    });

    it("recognizes a guard failure from its error or message only", async () => {
      const error = await rejection(d1WriteBatch(d1.binding, [d1Guard("1 = ?", 2)]));
      expect(isD1GuardFailure(error)).toBe(true);
      expect(isD1GuardFailure("D1_ERROR: malformed JSON: SQLITE_ERROR")).toBe(true);
      expect(isD1GuardFailure(new Error("UNIQUE constraint failed"))).toBe(false);
      expect(isD1GuardFailure(42)).toBe(false);
      await expect(d1WriteBatch(d1.binding, [d1Guard("1 = ?", 1)])).resolves.toEqual([{ rows: [{ guard: "0" }], changes: 0 }]);
      expect(d1Timestamp(OLD)).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("statement builders", () => {
    it("checks active titles, optionally excluding one recipe", async () => {
      const { recipe } = await seedRecipe("Taken");
      await expect(d1WriteBatch(d1.binding, [activeRecipeTitleFreeGuard(chefId, "Taken")])).rejects.toThrow("malformed JSON");
      await expect(d1WriteBatch(d1.binding, [activeRecipeTitleFreeGuard(chefId, "Taken", recipe.id)])).resolves.toHaveLength(1);
      await expect(d1WriteBatch(d1.binding, [activeRecipeTitleFreeGuard(friendId, "Taken")])).resolves.toHaveLength(1);
    });

    it("writes a cover row as createCover does, with its checks", async () => {
      const { recipe } = await seedRecipe("Covered");
      const archivedAt = new Date("2026-02-01T00:00:00.000Z");
      await d1WriteBatch(d1.binding, [
        coverInsertStatement({ id: "d1-cover-archived", recipeId: recipe.id, imageUrl: "https://example.com/a.jpg", sourceType: "chef-upload", archivedAt }, OLD),
        coverInsertStatement({ id: "d1-cover-plain", recipeId: recipe.id, imageUrl: "https://example.com/b.jpg", sourceType: "ai-placeholder", status: "processing", generationStatus: "processing" }, OLD),
      ]);
      await expect(db.recipeCover.findUniqueOrThrow({ where: { id: "d1-cover-archived" } })).resolves.toMatchObject({
        status: "ready", generationStatus: "none", archivedAt, createdAt: OLD, stylizedImageUrl: null,
      });
      await expect(db.recipeCover.findUniqueOrThrow({ where: { id: "d1-cover-plain" } })).resolves.toMatchObject({
        status: "processing", generationStatus: "processing", archivedAt: null,
      });
      expect(() => coverInsertStatement({ id: "x", recipeId: recipe.id, imageUrl: "", sourceType: "nope" as never }, OLD))
        .toThrow();
    });

    it("upserts native sync tombstones", async () => {
      const deletedAt = new Date("2026-03-01T00:00:00.000Z");
      await d1WriteBatch(d1.binding, [
        nativeSyncTombstoneUpsertStatement({ accountId: chefId, resourceType: "recipe", resourceId: "r1", deletedAt, updatedAt: deletedAt }),
        nativeSyncTombstoneUpsertStatement({
          accountId: chefId, resourceType: "recipe", resourceId: "r1", parentResourceId: "p1", title: "Gone", deletedAt, updatedAt: deletedAt,
        }),
      ]);
      await expect(db.nativeSyncTombstone.findMany({ where: { accountId: chefId } })).resolves.toEqual([
        expect.objectContaining({ resourceId: "r1", parentResourceId: "p1", title: "Gone", deletedAt, updatedAt: deletedAt }),
      ]);
    });
  });

  describe("createRecipeDraft", () => {
    it("writes the same recipe graph as the Prisma path, in one batch", async () => {
      const input = (id: string, title: string) => ({ id, title, description: "Brunch", servings: "3", chefId, steps: draftSteps });
      await createRecipeDraft(db, input("prisma-created", "Prisma Pancakes"));
      const before = d1.roundTrips();
      await expect(createRecipeDraft(db, input("d1-created", "D1 Pancakes"), d1.binding)).resolves.toEqual({ id: "d1-created" });

      expect(d1.roundTrips() - before).toBe(1);
      expect(await graph("d1-created")).toEqual({ ...(await graph("prisma-created")), title: "D1 Pancakes" });
    });

    it("reports a title another create took between the check and the write", async () => {
      const racing = interleaved(() => createRecipeDraft(db, { id: "first", title: "Race", description: null, servings: null, chefId, steps: [] }));
      const error = await rejection(createRecipeDraft(db, { id: "second", title: "Race", description: null, servings: null, chefId, steps: draftSteps }, racing));

      expect(error).toBeInstanceOf(ActiveRecipeTitleConflictError);
      expect(await graph("second")).toBeNull();
    });

    it("rethrows any other failure with nothing written", async () => {
      const error = await rejection(createRecipeDraft(db, {
        id: "orphan", title: "Orphan", description: null, servings: null, chefId: "no-such-chef", steps: draftSteps,
      }, d1.binding));

      expect(String(error)).toContain("FOREIGN KEY");
      await expect(db.unit.findUnique({ where: { name: "tbsp" } })).resolves.toBeNull();
    });
  });

  describe("forkRecipe", () => {
    async function seedSource() {
      const { recipe } = await seedRecipe("Loaf", friendId);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id, imageUrl: "https://example.com/loaf.jpg", stylizedImageUrl: "https://example.com/loaf-s.jpg",
          sourceType: "chef-upload", status: "ready", createdById: friendId, generationStatus: "succeeded",
          promptVersion: "p1", styleVersion: "s1", failureReason: null, sourceImageUrl: "https://example.com/raw.jpg",
        },
      });
      await db.recipe.update({ where: { id: recipe.id }, data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" } });
      return recipe;
    }

    it("writes the same fork as the Prisma path, cover included, in one batch", async () => {
      const source = await seedSource();
      const viaPrisma = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "Prisma Loaf" });
      const before = d1.roundTrips();
      const viaD1 = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "D1 Loaf", recipeId: "d1-fork" }, d1.binding);

      expect(d1.roundTrips() - before).toBe(1);
      expect(viaD1).toMatchObject({ appliedTitle: "D1 Loaf", titleWasSuffixed: false, attribution: viaPrisma.attribution });
      expect(await graph("d1-fork")).toEqual({ ...(await graph(viaPrisma.recipe.id)), title: "D1 Loaf" });
      expect((await graph("d1-fork"))!.covers).toHaveLength(1);
    });

    it("writes the same no-cover and uncopyable-cover forks as the Prisma path", async () => {
      const source = await seedSource();
      await db.recipe.update({ where: { id: source.id }, data: { coverMode: "none", activeCoverId: null, activeCoverVariant: null } });
      const noCoverPrisma = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "A" });
      const noCoverD1 = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "B" }, d1.binding);
      expect(await graph(noCoverD1.recipe.id)).toEqual({ ...(await graph(noCoverPrisma.recipe.id)), title: "B" });

      await db.recipe.update({ where: { id: source.id }, data: { coverMode: "auto" } });
      const autoPrisma = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "C" });
      await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, titleOverride: "D", recipeId: "d1-auto" }, d1.binding);
      expect(await graph("d1-auto")).toEqual({ ...(await graph(autoPrisma.recipe.id)), title: "D" });
      expect((await graph("d1-auto"))!.coverMode).toBe("auto");
    });

    it("picks the next free title when another fork takes it before the write", async () => {
      const source = await seedSource();
      const racing = interleaved(() => forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, recipeId: "first-fork" }, d1.binding));
      const second = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, recipeId: "second-fork" }, racing);

      expect(second).toMatchObject({ appliedTitle: "Loaf (variation 2)", titleWasSuffixed: true });
      expect((await graph("first-fork"))!.title).toBe("Loaf");
    });

    it("gives up after three lost title races", async () => {
      const source = await seedSource();
      let taken = 0;
      const alwaysRacing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          taken += 1;
          await db.recipe.create({ data: { title: taken === 1 ? "Loaf" : `Loaf (variation ${taken})`, chefId } });
          return d1.binding.batch(statements as never);
        },
      };

      await expect(forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, recipeId: "never" }, alwaysRacing))
        .rejects.toBeInstanceOf(ForkTitleExhaustedError);
      expect(taken).toBe(3);
      expect(await graph("never")).toBeNull();
    });

    it("rethrows any other failure with nothing written", async () => {
      const source = await seedSource();
      const failing: D1ReadDatabase = { prepare: (sql) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 is down"); } };
      await expect(forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefId, recipeId: "down" }, failing)).rejects.toThrow("D1 is down");
      expect(await graph("down")).toBeNull();
    });
  });

  describe("recipe editor batches", () => {
    it("saves fields with an uploaded, a cleared or an unchanged cover", async () => {
      const { recipe, cookbook } = await seedRecipe("Editable");
      await saveRecipeEditOnD1(d1.binding, {
        recipeId: recipe.id,
        chefId,
        fields: { title: "Edited", description: null, servings: "5" },
        cover: { kind: "upload", coverId: "d1-upload", imageUrl: "https://example.com/u.jpg", createdById: chefId },
      });
      expect(await graph(recipe.id)).toMatchObject({
        title: "Edited", description: null, servings: "5", coverMode: "manual", activeCoverVariant: "image", activeCover: 0,
        covers: [expect.objectContaining({ sourceType: "chef-upload", status: "ready", generationStatus: "none", sourceImageUrl: "https://example.com/u.jpg" })],
      });
      expect((await db.cookbook.findUniqueOrThrow({ where: { id: cookbook.id } })).updatedAt.getTime()).toBeGreaterThan(OLD.getTime());

      await saveRecipeEditOnD1(d1.binding, { recipeId: recipe.id, chefId, fields: { title: "Edited", description: "Back", servings: null }, cover: null });
      expect(await graph(recipe.id)).toMatchObject({ description: "Back", coverMode: "manual", activeCover: 0 });

      await saveRecipeEditOnD1(d1.binding, { recipeId: recipe.id, chefId, fields: { title: "Edited", description: "Back", servings: null }, cover: { kind: "clear" } });
      expect(await graph(recipe.id)).toMatchObject({ coverMode: "none", activeCoverVariant: null, activeCover: -1 });
    });

    it("fails a save for a recipe that is gone, and one whose title was taken", async () => {
      await expect(saveRecipeEditOnD1(d1.binding, {
        recipeId: "missing", chefId, fields: { title: "Whatever", description: null, servings: null }, cover: null,
      })).rejects.toThrow("Recipe to update was not found");

      const { recipe } = await seedRecipe("Mine");
      await seedRecipe("Other");
      const error = await rejection(saveRecipeEditOnD1(d1.binding, {
        recipeId: recipe.id, chefId, fields: { title: "Other", description: null, servings: null }, cover: null,
      }));
      expect(isD1GuardFailure(error)).toBe(true);
      expect((await graph(recipe.id))!.title).toBe("Mine");
    });

    it("swaps, deletes and saves steps, refusing when the steps changed", async () => {
      const { recipe, steps } = await seedRecipe("Steps");
      const swap = { recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, targetStepId: steps[0]!.id, targetStepNum: 1 };
      expect(isD1GuardFailure(await rejection(swapRecipeStepsOnD1(d1.binding, { ...swap, targetStepNum: 3 })))).toBe(true);
      await swapRecipeStepsOnD1(d1.binding, swap);
      expect((await graph(recipe.id))!.steps.map((step) => step.stepTitle)).toEqual(["Rest", "Mix", "Bake"]);

      expect(isD1GuardFailure(await rejection(deleteRecipeStepOnD1(d1.binding, { recipeId: recipe.id, stepId: steps[0]!.id, stepNum: 2 })))).toBe(true);
      await deleteRecipeStepOnD1(d1.binding, { recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 1 });
      expect((await graph(recipe.id))!.steps.map((step) => step.stepNum)).toEqual([2, 3]);

      await updateRecipeStepOnD1(d1.binding, {
        recipeId: recipe.id, stepId: steps[0]!.id, stepNum: 2, stepTitle: null, description: "Mixed", usesSteps: [],
      });
      expect((await graph(recipe.id))!.steps[0]).toMatchObject({ stepTitle: null, description: "Mixed" });
      await updateRecipeStepOnD1(d1.binding, {
        recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3, stepTitle: "Bake", description: "Bake it", usesSteps: [2, 2],
      });
      expect((await graph(recipe.id))!.uses).toEqual([[2, 3]]);
      expect(isD1GuardFailure(await rejection(updateRecipeStepOnD1(d1.binding, {
        recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3, stepTitle: null, description: "Empty", usesSteps: [],
      })))).toBe(true);
    });

    it("adds and deletes step ingredients", async () => {
      const { recipe, steps, ingredients, cup, refs } = await seedRecipe("Ingredients");
      await addStepIngredientsOnD1(d1.binding, {
        recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3, rows: [{ quantity: 4, unitId: cup.id, ingredientRefId: refs[3]!.id }],
      });
      expect((await graph(recipe.id))!.steps[2]!.ingredients).toEqual([{ quantity: 4, unit: "cup", name: "salt" }]);

      await expect(deleteStepIngredientOnD1(d1.binding, { recipeId: recipe.id, stepNum: 3, ingredientId: ingredients[0]!.id })).resolves.toBe(false);
      await expect(deleteStepIngredientOnD1(d1.binding, { recipeId: recipe.id, stepNum: 1, ingredientId: ingredients[0]!.id })).resolves.toBe(true);
      expect((await graph(recipe.id))!.steps[0]!.ingredients.map((row) => row.name)).toEqual(["milk"]);
    });
  });
});
