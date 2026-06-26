import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    outputStepNums: [],
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
        outputStepNums: [],
      }],
    });
    const noIngredientStep = expectOk(parseNativeRecipeCreateBody({
      clientMutationId: "create-no-ingredients",
      title: "Toast",
      steps: [
        { description: "Toast bread.", duration: null },
        { description: "Serve toast.", outputStepNums: [1, "1"] },
      ],
    }));
    expect(noIngredientStep.data.steps[0].ingredients).toEqual([]);
    expect(noIngredientStep.data.steps[0].outputStepNums).toEqual([]);
    expect(noIngredientStep.data.steps[1].outputStepNums).toEqual([1]);

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
      { clientMutationId: "bad-output-container", title: "Soup", steps: [{ ...validStep(), outputStepNums: {} }] },
      { clientMutationId: "bad-output-value", title: "Soup", steps: [{ ...validStep(), outputStepNums: [0] }] },
      { clientMutationId: "bad-output-type", title: "Soup", steps: [{ ...validStep(), outputStepNums: [{}] }] },
      { clientMutationId: "bad-output-current", title: "Soup", steps: [{ ...validStep(), outputStepNums: [1] }] },
      { clientMutationId: "bad-output-future", title: "Soup", steps: [validStep(), { ...validStep(), outputStepNums: [3] }] },
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
      steps: [
        { stepTitle: "Cook", description: "Cook.", duration: null, ingredients: [] },
        { stepTitle: "Serve", description: "Use the cooked base.", duration: null, ingredients: [], outputStepNums: [1] },
      ],
    }, { recipeId: "recipe_helper_fixed" }));
    expect(create.status).toBe(201);
    expect(create.data.recipeId).toBe("recipe_helper_fixed");
    const createdUses = await db.stepOutputUse.findMany({
      where: { recipeId: "recipe_helper_fixed" },
      select: { inputStepNum: true, outputStepNum: true },
    });
    expect(createdUses).toEqual([{ inputStepNum: 2, outputStepNum: 1 }]);

    expectValidationFailure(await createNativeRecipe(db, chef.id, {
      clientMutationId: "create-helper-invalid-output",
      title: "Invalid Output Dinner",
      description: null,
      servings: null,
      steps: [{ stepTitle: "Cook", description: "Cook.", duration: null, ingredients: [], outputStepNums: [1] }],
    }));

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
