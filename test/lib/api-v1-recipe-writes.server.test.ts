import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import {
  createNativeRecipe,
  deleteNativeRecipe,
  forkNativeRecipe,
  parseNativeRecipeCreateBody,
  parseNativeRecipeDeleteBody,
  parseNativeRecipeForkBody,
  parseNativeRecipePatchBody,
  updateNativeRecipe,
  type ApiV1RecipeWriteResult,
} from "~/lib/api-v1-recipe-writes.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function expectOk<T>(result: ApiV1RecipeWriteResult<T>) {
  expect(result.ok).toBe(true);
  return result as Extract<ApiV1RecipeWriteResult<T>, { ok: true }>;
}

function expectValidationFailure<T>(result: ApiV1RecipeWriteResult<T>) {
  expect(result).toMatchObject({ ok: false, code: "validation_error" });
}

function expectFailure<T>(result: ApiV1RecipeWriteResult<T>, code: string) {
  expect(result).toMatchObject({ ok: false, code });
}

function validStep() {
  return {
    stepTitle: " Prep ",
    description: " Mix everything. ",
    duration: "5",
    ingredients: [{ quantity: "2", unit: " cups ", name: " flour " }],
  };
}

async function createUser(db: LocalDb) {
  return await db.user.create({ data: createTestUser() });
}

async function createRecipe(db: LocalDb, chefId: string, title = `API Helper ${faker.string.alphanumeric(8)}`) {
  return await db.recipe.create({
    data: {
      ...createTestRecipe(chefId),
      title,
    },
  });
}

async function seedForkTitleCollisions(db: LocalDb, chefId: string, baseTitle: string) {
  await createRecipe(db, chefId, baseTitle);
  for (let n = 2; n <= 100; n += 1) {
    await createRecipe(db, chefId, `${baseTitle} (variation ${n})`);
  }
}

describe("API v1 recipe write body parsers", () => {
  it("normalizes valid create, patch, delete, and fork bodies", () => {
    const create = expectOk(parseNativeRecipeCreateBody({
      clientMutationId: " create-1 ",
      title: " Pasta ",
      description: " ",
      servings: " 4 ",
      steps: [validStep()],
    }));
    expect(create.data).toMatchObject({
      clientMutationId: "create-1",
      title: "Pasta",
      description: null,
      servings: "4",
      steps: [{
        stepTitle: "Prep",
        description: "Mix everything.",
        duration: 5,
        ingredients: [{ quantity: 2, unit: "cups", ingredientName: "flour" }],
      }],
    });
    const noIngredientStep = expectOk(parseNativeRecipeCreateBody({
      clientMutationId: "create-no-ingredients",
      title: "Toast",
      steps: [{ description: "Toast bread.", duration: null }],
    }));
    expect(noIngredientStep.data.steps[0].ingredients).toEqual([]);

    const patch = expectOk(parseNativeRecipePatchBody({
      clientMutationId: " patch-1 ",
      title: " New Pasta ",
      description: null,
      servings: "",
    }));
    expect(patch.data).toEqual({
      clientMutationId: "patch-1",
      fields: { title: "New Pasta", description: null, servings: null },
    });

    expectOk(parseNativeRecipePatchBody({ clientMutationId: "patch-empty" }));
    expectOk(parseNativeRecipeDeleteBody({}, " delete-fallback "));
    expectOk(parseNativeRecipeForkBody({ clientMutationId: "fork-null", title: null }));
    expectOk(parseNativeRecipeForkBody({ clientMutationId: "fork-empty", title: "" }));
  });

  it("rejects malformed create body fields and nested step data", () => {
    const invalidCreateBodies: Record<string, unknown>[] = [
      { clientMutationId: "bad-extra", title: "Soup", extra: true },
      { clientMutationId: 123, title: "Soup" },
      { clientMutationId: "bad-title", title: " " },
      { clientMutationId: "bad-description-type", title: "Soup", description: 12 },
      { clientMutationId: "bad-description-value", title: "Soup", description: "x".repeat(2001) },
      { clientMutationId: "bad-servings-type", title: "Soup", servings: 4 },
      { clientMutationId: "bad-servings-value", title: "Soup", servings: "x".repeat(101) },
      { clientMutationId: "bad-steps", title: "Soup", steps: "not-array" },
      { clientMutationId: "bad-step-object", title: "Soup", steps: [null] },
      { clientMutationId: "bad-step-extra", title: "Soup", steps: [{ ...validStep(), extra: true }] },
      { clientMutationId: "bad-step-title-type", title: "Soup", steps: [{ ...validStep(), stepTitle: 42 }] },
      { clientMutationId: "bad-step-title-value", title: "Soup", steps: [{ ...validStep(), stepTitle: "x".repeat(1001) }] },
      { clientMutationId: "bad-step-description-type", title: "Soup", steps: [{ ...validStep(), description: 42 }] },
      { clientMutationId: "bad-step-description-value", title: "Soup", steps: [{ ...validStep(), description: " " }] },
      { clientMutationId: "bad-duration", title: "Soup", steps: [{ ...validStep(), duration: 0 }] },
      { clientMutationId: "bad-duration-type", title: "Soup", steps: [{ ...validStep(), duration: {} }] },
      { clientMutationId: "bad-ingredients", title: "Soup", steps: [{ ...validStep(), ingredients: "nope" }] },
      { clientMutationId: "bad-ingredient-object", title: "Soup", steps: [{ ...validStep(), ingredients: [null] }] },
      { clientMutationId: "bad-ingredient-extra", title: "Soup", steps: [{ ...validStep(), ingredients: [{ ...validStep().ingredients[0], extra: true }] }] },
      { clientMutationId: "bad-quantity", title: "Soup", steps: [{ ...validStep(), ingredients: [{ ...validStep().ingredients[0], quantity: 0 }] }] },
      { clientMutationId: "bad-quantity-type", title: "Soup", steps: [{ ...validStep(), ingredients: [{ ...validStep().ingredients[0], quantity: {} }] }] },
      { clientMutationId: "bad-unit", title: "Soup", steps: [{ ...validStep(), ingredients: [{ ...validStep().ingredients[0], unit: "" }] }] },
      { clientMutationId: "bad-name", title: "Soup", steps: [{ ...validStep(), ingredients: [{ ...validStep().ingredients[0], name: "" }] }] },
    ];

    for (const body of invalidCreateBodies) {
      expectValidationFailure(parseNativeRecipeCreateBody(body));
    }
  });

  it("rejects malformed patch, delete, and fork bodies", () => {
    for (const body of [
      { clientMutationId: "patch-extra", extra: true },
      { title: "No client mutation" },
      { clientMutationId: "patch-title-type", title: 42 },
      { clientMutationId: "patch-title-value", title: " " },
      { clientMutationId: "patch-description-type", description: 42 },
      { clientMutationId: "patch-description-value", description: "x".repeat(2001) },
      { clientMutationId: "patch-servings-type", servings: 4 },
      { clientMutationId: "patch-servings-value", servings: "x".repeat(101) },
    ]) {
      expectValidationFailure(parseNativeRecipePatchBody(body));
    }

    expectValidationFailure(parseNativeRecipeDeleteBody({ extra: true }, "delete-extra"));
    expectValidationFailure(parseNativeRecipeDeleteBody({}, ""));

    for (const body of [
      { clientMutationId: "fork-extra", extra: true },
      { title: "No client mutation" },
      { clientMutationId: " ", title: "Fork" },
      { clientMutationId: "fork-title-type", title: 42 },
      { clientMutationId: "fork-title-value", title: "x".repeat(201) },
    ]) {
      expectValidationFailure(parseNativeRecipeForkBody(body));
    }
  });
});

describe("API v1 recipe write helpers", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("creates recipes, rejects duplicate titles, and uses caller-provided ids when present", async () => {
    const chef = await createUser(db);
    const create = expectOk(await createNativeRecipe(db, chef.id, {
      clientMutationId: "create-helper",
      title: "Helper Dinner",
      description: null,
      servings: null,
      steps: [{ stepTitle: null, description: "Cook.", duration: null, ingredients: [] }],
    }, { recipeId: "recipe_helper_fixed" }));
    expect(create.status).toBe(201);
    expect(create.data.recipeId).toBe("recipe_helper_fixed");

    const generated = expectOk(await createNativeRecipe(db, chef.id, {
      clientMutationId: "create-helper-generated",
      title: "Helper Lunch",
      description: "Food",
      servings: "2",
      steps: [],
    }));
    expect(generated.data.recipeId).toEqual(expect.any(String));

    expectValidationFailure(await createNativeRecipe(db, chef.id, {
      clientMutationId: "create-helper-duplicate",
      title: "Helper Lunch",
      description: null,
      servings: null,
      steps: [],
    }));
  });

  it("updates recipes across ownership, tombstone, no-op, duplicate, and success paths", async () => {
    const chef = await createUser(db);
    const other = await createUser(db);
    const recipe = await createRecipe(db, chef.id, "Patch Helper");
    const cookbook = await db.cookbook.create({
      data: { title: "Patch Helper Cookbook", authorId: chef.id },
    });
    await db.recipeInCookbook.create({
      data: { recipeId: recipe.id, cookbookId: cookbook.id, addedById: chef.id },
    });
    const oldCookbookUpdatedAt = new Date("2000-01-01T00:00:00.000Z");
    await db.cookbook.update({
      where: { id: cookbook.id },
      data: { updatedAt: oldCookbookUpdatedAt },
    });
    const deleted = await createRecipe(db, chef.id, "Patch Deleted Helper");
    await db.recipe.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await createRecipe(db, chef.id, "Patch Duplicate Helper");

    expectFailure(await updateNativeRecipe(db, chef.id, "missing", { clientMutationId: "missing", fields: {} }), "not_found");
    expectFailure(await updateNativeRecipe(db, chef.id, deleted.id, { clientMutationId: "deleted", fields: {} }), "not_found");
    expectFailure(await updateNativeRecipe(db, other.id, recipe.id, { clientMutationId: "owner", fields: {} }), "insufficient_scope");
    expectValidationFailure(await updateNativeRecipe(db, chef.id, recipe.id, {
      clientMutationId: "duplicate",
      fields: { title: "Patch Duplicate Helper" },
    }));

    const noop = expectOk(await updateNativeRecipe(db, chef.id, recipe.id, { clientMutationId: "noop", fields: {} }));
    expect(noop.data.updated).toBe(false);
    const updated = expectOk(await updateNativeRecipe(db, chef.id, recipe.id, {
      clientMutationId: "update",
      fields: { title: "Patch Changed", description: null, servings: "6" },
    }));
    expect(updated.data).toEqual({ recipeId: recipe.id, updated: true });
    const touchedCookbook = await db.cookbook.findUniqueOrThrow({
      where: { id: cookbook.id },
      select: { updatedAt: true },
    });
    expect(touchedCookbook.updatedAt.getTime()).toBeGreaterThan(oldCookbookUpdatedAt.getTime());
  });

  it("deletes recipes across ownership, tombstone, missing, and success paths", async () => {
    const chef = await createUser(db);
    const other = await createUser(db);
    const recipe = await createRecipe(db, chef.id, "Delete Helper");
    const deleted = await createRecipe(db, chef.id, "Delete Deleted Helper");
    await db.recipe.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    expectFailure(await deleteNativeRecipe(db, chef.id, "missing"), "not_found");
    expectFailure(await deleteNativeRecipe(db, chef.id, deleted.id), "not_found");
    expectFailure(await deleteNativeRecipe(db, other.id, recipe.id), "insufficient_scope");
    const result = expectOk(await deleteNativeRecipe(db, chef.id, recipe.id));
    expect(result.data.recipe).toMatchObject({ id: recipe.id, deletedAt: expect.any(Date), updatedAt: expect.any(Date) });
    await expect(db.nativeSyncTombstone.findUniqueOrThrow({
      where: {
        accountId_resourceType_resourceId: {
          accountId: chef.id,
          resourceType: "recipe",
          resourceId: recipe.id,
        },
      },
    })).resolves.toMatchObject({
      accountId: chef.id,
      resourceType: "recipe",
      resourceId: recipe.id,
      title: "Delete Helper",
      deletedAt: result.data.recipe.deletedAt,
      updatedAt: result.data.recipe.updatedAt,
    });
  });

  it("batches recipe delete tombstones with the delete write", async () => {
    const recipeUpdate = vi.fn(async () => ({
      id: "recipe_1",
      title: "Atomic Delete",
      deletedAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    }));
    const cookbookUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tombstoneUpsert = vi.fn(async () => ({}));
    const dbMock = {
      recipe: {
        findUnique: vi.fn(async () => ({ id: "recipe_1", chefId: "chef_1", title: "Atomic Delete", deletedAt: null })),
        update: recipeUpdate,
      },
      cookbook: {
        updateMany: cookbookUpdateMany,
      },
      nativeSyncTombstone: {
        upsert: tombstoneUpsert,
      },
      $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => await Promise.all(ops)),
    } as unknown as LocalDb;

    const result = expectOk(await deleteNativeRecipe(dbMock, "chef_1", "recipe_1"));

    expect(result.data.recipe).toMatchObject({ id: "recipe_1", title: "Atomic Delete" });
    expect(recipeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "recipe_1" },
      data: { deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
    }));
    expect(cookbookUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipes: { some: { recipeId: "recipe_1" } } },
    }));
    expect(tombstoneUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        accountId_resourceType_resourceId: {
          accountId: "chef_1",
          resourceType: "recipe",
          resourceId: "recipe_1",
        },
      },
      create: expect.objectContaining({
        accountId: "chef_1",
        resourceType: "recipe",
        resourceId: "recipe_1",
        title: "Atomic Delete",
      }),
      update: expect.objectContaining({
        title: "Atomic Delete",
      }),
    }));
    expect(dbMock.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
    ]);
  });

  it("forks recipes through helper success, source-missing, and title-exhaustion paths", async () => {
    const sourceChef = await createUser(db);
    const forker = await createUser(db);
    const source = await createRecipe(db, sourceChef.id, "Fork Helper");

    const forked = expectOk(await forkNativeRecipe(db, forker.id, source.id, {
      clientMutationId: "fork-helper",
      titleOverride: null,
    }));
    expect(forked.status).toBe(201);
    expect(forked.data.fork).toMatchObject({
      appliedTitle: "Fork Helper",
      sourceChef: { id: sourceChef.id, username: sourceChef.username },
      sourceRecipeId: source.id,
      titleWasSuffixed: false,
    });

    expectFailure(await forkNativeRecipe(db, forker.id, "missing", {
      clientMutationId: "fork-missing",
      titleOverride: null,
    }), "not_found");

    const exhaustedSource = await createRecipe(db, sourceChef.id, "X");
    await seedForkTitleCollisions(db, forker.id, "X");
    expectValidationFailure(await forkNativeRecipe(db, forker.id, exhaustedSource.id, {
      clientMutationId: "fork-exhausted",
      titleOverride: "X",
    }));

    await expect(forkNativeRecipe({
      recipe: {
        findUnique: async () => {
          throw new Error("unexpected fork storage failure");
        },
      },
    } as never, forker.id, source.id, {
      clientMutationId: "fork-unknown-error",
      titleOverride: null,
    })).rejects.toThrow("unexpected fork storage failure");
  });
});
