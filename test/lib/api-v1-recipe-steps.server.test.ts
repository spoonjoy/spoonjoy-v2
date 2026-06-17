import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  createNativeRecipeStep,
  createNativeRecipeStepIngredient,
  deleteNativeRecipeStep,
  deleteNativeRecipeStepIngredient,
  parseNativeRecipeStepCreateBody,
  parseNativeRecipeStepDeleteBody,
  parseNativeRecipeStepIngredientCreateBody,
  parseNativeRecipeStepIngredientDeleteBody,
  parseNativeRecipeStepOutputUsesBody,
  parseNativeRecipeStepPatchBody,
  parseNativeRecipeStepReorderBody,
  reorderNativeRecipeStep,
  replaceNativeRecipeStepOutputUses,
  updateNativeRecipeStep,
} from "~/lib/api-v1-recipe-steps.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function expectOk<T>(result: { ok: true; data: T } | { ok: false }) {
  expect(result.ok).toBe(true);
  return result as { ok: true; status: number; data: T };
}

function expectError(result: { ok: true } | { ok: false; code: string; details?: unknown }, code = "validation_error") {
  expect(result.ok).toBe(false);
  expect((result as { ok: false; code: string }).code).toBe(code);
  return result as { ok: false; code: string; details?: unknown };
}

async function createRecipeWithSteps(db: LocalDb, stepNums: number[] = [1, 2, 3]) {
  const chef = await db.user.create({ data: createTestUser() });
  const otherChef = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `Step helper recipe ${faker.string.alphanumeric(8)}`,
    },
  });
  const steps = [];
  for (const stepNum of stepNums) {
    steps.push(await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum,
        stepTitle: `Step ${stepNum}`,
        description: `Do step ${stepNum}.`,
      },
    }));
  }
  return { chef, otherChef, recipe, steps };
}

async function addIngredient(db: LocalDb, recipeId: string, stepNum: number, name = `salt-${faker.string.alphanumeric(6)}`) {
  const unit = await getOrCreateUnit(db, `cup-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredientRef = await getOrCreateIngredientRef(db, name.toLowerCase());
  return await db.ingredient.create({
    data: {
      recipeId,
      stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
}

describe("API v1 recipe step helper contracts", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("parses recipe step request bodies and rejects malformed edge cases", () => {
    expectOk(parseNativeRecipeStepCreateBody({
      clientMutationId: "create",
      stepNum: "2",
      stepTitle: "  Finish  ",
      description: "  Finish the dish.  ",
      duration: "5",
      ingredients: [{ quantity: "1.5", unit: "tbsp", name: "butter" }],
      outputStepNums: [1, "1"],
    })).data;
    expectOk(parseNativeRecipeStepCreateBody({
      clientMutationId: "create-minimal",
      stepTitle: "   ",
      description: "Minimal.",
    }));
    expectOk(parseNativeRecipeStepPatchBody({
      clientMutationId: "patch-minimal",
    })).data;
    expectOk(parseNativeRecipeStepPatchBody({
      clientMutationId: "patch",
      stepTitle: null,
      description: "Updated.",
      duration: null,
      outputStepNums: [1],
    }));
    expectOk(parseNativeRecipeStepDeleteBody({}, "delete-from-header"));
    expectOk(parseNativeRecipeStepIngredientCreateBody({
      clientMutationId: "ingredient-create",
      quantity: "2",
      unit: "cloves",
      name: "garlic",
    }));
    expectOk(parseNativeRecipeStepIngredientDeleteBody({}, "ingredient-delete-from-header"));
    expectOk(parseNativeRecipeStepReorderBody({
      clientMutationId: "reorder",
      stepId: "step_1",
      toStepNum: "2",
    }));
    expectOk(parseNativeRecipeStepOutputUsesBody({
      clientMutationId: "output-uses",
      inputStepId: "step_2",
      outputStepNums: ["1"],
    }));

    for (const body of [
      { clientMutationId: "create", description: "x", nope: true },
      { description: "x" },
      { clientMutationId: "   ", description: "x" },
      { clientMutationId: "create", stepNum: 0, description: "x" },
      { clientMutationId: "create", stepTitle: 1, description: "x" },
      { clientMutationId: "create", stepTitle: "x".repeat(201), description: "x" },
      { clientMutationId: "create", description: "" },
      { clientMutationId: "create", description: "x", duration: "later" },
      { clientMutationId: "create", description: "x", duration: {} },
      { clientMutationId: "create", description: "x", ingredients: {} },
      { clientMutationId: "create", description: "x", ingredients: [null] },
      { clientMutationId: "create", description: "x", ingredients: [{ quantity: 1, unit: "cup", name: "salt", extra: true }] },
      { clientMutationId: "create", description: "x", ingredients: [{ quantity: 0, unit: "cup", name: "salt" }] },
      { clientMutationId: "create", description: "x", ingredients: [{ quantity: {}, unit: "cup", name: "salt" }] },
      { clientMutationId: "create", description: "x", ingredients: [{ quantity: 1, unit: "", name: "salt" }] },
      { clientMutationId: "create", description: "x", ingredients: [{ quantity: 1, unit: "cup", name: "" }] },
      { clientMutationId: "create", description: "x", outputStepNums: {} },
      { clientMutationId: "create", description: "x", outputStepNums: [0] },
      { clientMutationId: "create", description: "x", outputStepNums: [{}] },
    ]) {
      expectError(parseNativeRecipeStepCreateBody(body));
    }

    for (const body of [
      { clientMutationId: "patch", nope: true },
      { description: "x" },
      { clientMutationId: "patch", stepTitle: 1 },
      { clientMutationId: "patch", description: "" },
      { clientMutationId: "patch", duration: 0 },
      { clientMutationId: "patch", outputStepNums: [0] },
    ]) {
      expectError(parseNativeRecipeStepPatchBody(body));
    }

    expectError(parseNativeRecipeStepDeleteBody({ nope: true }, "delete"));
    expectError(parseNativeRecipeStepDeleteBody({}, null));
    expectError(parseNativeRecipeStepIngredientCreateBody({ quantity: 1, unit: "cup", name: "salt" }));
    expectError(parseNativeRecipeStepIngredientCreateBody({ clientMutationId: "ingredient", quantity: 1, unit: "cup", name: "salt", nope: true }));
    expectError(parseNativeRecipeStepIngredientCreateBody({ clientMutationId: "ingredient", quantity: 0, unit: "cup", name: "salt" }));
    expectError(parseNativeRecipeStepIngredientDeleteBody({ nope: true }, "ingredient-delete"));
    expectError(parseNativeRecipeStepIngredientDeleteBody({}, null));
    expectError(parseNativeRecipeStepReorderBody({ clientMutationId: "reorder", stepId: "step_1", toStepNum: 1, nope: true }));
    expectError(parseNativeRecipeStepReorderBody({ stepId: "step_1", toStepNum: 1 }));
    expectError(parseNativeRecipeStepReorderBody({ clientMutationId: "reorder", stepId: " ", toStepNum: 1 }));
    expectError(parseNativeRecipeStepReorderBody({ clientMutationId: "reorder", stepId: "step_1", toStepNum: 0 }));
    expectError(parseNativeRecipeStepReorderBody({ clientMutationId: "reorder", stepId: "step_1", toStepNum: {} }));
    expectError(parseNativeRecipeStepOutputUsesBody({ clientMutationId: "uses", inputStepId: "step_1", outputStepNums: [1], nope: true }));
    expectError(parseNativeRecipeStepOutputUsesBody({ inputStepId: "step_1", outputStepNums: [1] }));
    expectError(parseNativeRecipeStepOutputUsesBody({ clientMutationId: "uses", inputStepId: " ", outputStepNums: [1] }));
    expectError(parseNativeRecipeStepOutputUsesBody({ clientMutationId: "uses", inputStepId: "step_1", outputStepNums: [0] }));
  });

  it("covers create and update validation branches for recipe steps", async () => {
    const empty = await createRecipeWithSteps(db, []);
    const first = expectOk(await createNativeRecipeStep(db, empty.chef.id, empty.recipe.id, {
      clientMutationId: "create-first",
      stepTitle: null,
      description: "First.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    }));
    expect(first.data.stepNum).toBe(1);

    const globalRef = await getOrCreateIngredientRef(db, `parsley-${faker.string.alphanumeric(6)}`.toLowerCase());
    const second = expectOk(await createNativeRecipeStep(db, empty.chef.id, empty.recipe.id, {
      clientMutationId: "create-second",
      stepNum: 2,
      stepTitle: "Second",
      description: "Second.",
      duration: 1,
      ingredients: [{ quantity: 1, unit: "pinch", ingredientName: globalRef.name }],
      outputStepNums: [1],
    }));
    expect(second.data.stepNum).toBe(2);

    expectError(await createNativeRecipeStep(db, empty.otherChef.id, empty.recipe.id, {
      clientMutationId: "not-owner",
      stepTitle: null,
      description: "Nope.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    }), "insufficient_scope");
    expectError(await createNativeRecipeStep(db, empty.chef.id, "missing", {
      clientMutationId: "missing-recipe",
      stepTitle: null,
      description: "Nope.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    }), "not_found");
    await db.recipe.update({ where: { id: empty.recipe.id }, data: { deletedAt: new Date() } });
    expectError(await createNativeRecipeStep(db, empty.chef.id, empty.recipe.id, {
      clientMutationId: "deleted-recipe",
      stepTitle: null,
      description: "Nope.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    }), "not_found");

    const fixture = await createRecipeWithSteps(db, [1]);
    await addIngredient(db, fixture.recipe.id, 1, "existing-carrot");
    expectError(await createNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, {
      clientMutationId: "duplicate-input",
      stepTitle: null,
      description: "Duplicate input.",
      duration: null,
      ingredients: [
        { quantity: 1, unit: "cup", ingredientName: "pepper" },
        { quantity: 2, unit: "cup", ingredientName: "pepper" },
      ],
      outputStepNums: [],
    }));
    expectError(await createNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, {
      clientMutationId: "existing-ingredient",
      stepTitle: null,
      description: "Existing ingredient.",
      duration: null,
      ingredients: [{ quantity: 1, unit: "cup", ingredientName: "existing-carrot" }],
      outputStepNums: [],
    }));
    expectError(await createNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, {
      clientMutationId: "gap",
      stepNum: 3,
      stepTitle: null,
      description: "Gap.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    }));

    const missingOutput = await createRecipeWithSteps(db, [2]);
    expectError(await createNativeRecipeStep(db, missingOutput.chef.id, missingOutput.recipe.id, {
      clientMutationId: "missing-output",
      stepTitle: null,
      description: "Missing output.",
      duration: null,
      ingredients: [],
      outputStepNums: [1],
    }));

    const noFields = expectOk(await updateNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, fixture.steps[0].id, {
      clientMutationId: "noop",
      fields: {},
    }));
    expect(noFields.data.updated).toBe(false);
    expectError(await updateNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, "missing", {
      clientMutationId: "missing-step",
      fields: { description: "Nope." },
    }), "not_found");
    expectError(await updateNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, fixture.steps[0].id, {
      clientMutationId: "bad-output",
      fields: { outputStepNums: [2] },
    }));

    const emptyStepFixture = await createRecipeWithSteps(db, [1]);
    expectError(await updateNativeRecipeStep(db, emptyStepFixture.chef.id, emptyStepFixture.recipe.id, emptyStepFixture.steps[0].id, {
      clientMutationId: "empty-step",
      fields: { outputStepNums: [] },
    }));
  });

  it("covers delete, ingredient, reorder, and output-use branch paths", async () => {
    const fixture = await createRecipeWithSteps(db, [1, 2, 3]);
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: fixture.recipe.id, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: fixture.recipe.id, outputStepNum: 1, inputStepNum: 3 },
      ],
    });
    const protectedDelete = expectError(await deleteNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, fixture.steps[0].id));
    expect(protectedDelete.details).toMatchObject({ dependentStepNums: [2, 3] });
    expectError(await deleteNativeRecipeStep(db, fixture.otherChef.id, fixture.recipe.id, fixture.steps[0].id), "insufficient_scope");
    expectError(await deleteNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, "missing"), "not_found");

    const ingredientFixture = await createRecipeWithSteps(db, [1]);
    const createdIngredient = expectOk(await createNativeRecipeStepIngredient(db, ingredientFixture.chef.id, ingredientFixture.recipe.id, ingredientFixture.steps[0].id, {
      clientMutationId: "ingredient",
      quantity: 1,
      unit: "cup",
      ingredientName: "thyme",
    }));
    expect(createdIngredient.data.ingredientId).toEqual(expect.any(String));
    expectError(await createNativeRecipeStepIngredient(db, ingredientFixture.otherChef.id, ingredientFixture.recipe.id, ingredientFixture.steps[0].id, {
      clientMutationId: "ingredient-owner",
      quantity: 1,
      unit: "cup",
      ingredientName: "oregano",
    }), "insufficient_scope");
    expectError(await createNativeRecipeStepIngredient(db, ingredientFixture.chef.id, ingredientFixture.recipe.id, ingredientFixture.steps[0].id, {
      clientMutationId: "ingredient-duplicate",
      quantity: 1,
      unit: "cup",
      ingredientName: "thyme",
    }));
    expectError(await createNativeRecipeStepIngredient(db, ingredientFixture.chef.id, ingredientFixture.recipe.id, "missing", {
      clientMutationId: "ingredient-missing-step",
      quantity: 1,
      unit: "cup",
      ingredientName: "mint",
    }), "not_found");
    expectError(await deleteNativeRecipeStepIngredient(db, ingredientFixture.otherChef.id, ingredientFixture.recipe.id, ingredientFixture.steps[0].id, createdIngredient.data.ingredientId), "insufficient_scope");
    expectOk(await deleteNativeRecipeStepIngredient(db, ingredientFixture.chef.id, ingredientFixture.recipe.id, ingredientFixture.steps[0].id, createdIngredient.data.ingredientId));

    const reorderFixture = await createRecipeWithSteps(db, [1, 2]);
    await db.stepOutputUse.create({
      data: { recipeId: reorderFixture.recipe.id, outputStepNum: 1, inputStepNum: 2 },
    });
    expectOk(await reorderNativeRecipeStep(db, reorderFixture.chef.id, reorderFixture.recipe.id, {
      clientMutationId: "same-position",
      stepId: reorderFixture.steps[0].id,
      toStepNum: 1,
    }));
    expectError(await reorderNativeRecipeStep(db, reorderFixture.chef.id, reorderFixture.recipe.id, {
      clientMutationId: "out-of-range",
      stepId: reorderFixture.steps[0].id,
      toStepNum: 99,
    }));
    const outgoing = expectError(await reorderNativeRecipeStep(db, reorderFixture.chef.id, reorderFixture.recipe.id, {
      clientMutationId: "outgoing",
      stepId: reorderFixture.steps[1].id,
      toStepNum: 1,
    }));
    expect(outgoing.details).toMatchObject({ blockingStepNums: [1] });

    const incomingSortFixture = await createRecipeWithSteps(db, [1, 2, 3]);
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: incomingSortFixture.recipe.id, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: incomingSortFixture.recipe.id, outputStepNum: 1, inputStepNum: 3 },
      ],
    });
    const incomingSort = expectError(await reorderNativeRecipeStep(db, incomingSortFixture.chef.id, incomingSortFixture.recipe.id, {
      clientMutationId: "incoming-sort",
      stepId: incomingSortFixture.steps[0].id,
      toStepNum: 3,
    }));
    expect(incomingSort.details).toMatchObject({ blockingStepNums: [2, 3] });

    const outgoingSortFixture = await createRecipeWithSteps(db, [1, 2, 3]);
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: outgoingSortFixture.recipe.id, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: outgoingSortFixture.recipe.id, outputStepNum: 2, inputStepNum: 3 },
      ],
    });
    const outgoingSort = expectError(await reorderNativeRecipeStep(db, outgoingSortFixture.chef.id, outgoingSortFixture.recipe.id, {
      clientMutationId: "outgoing-sort",
      stepId: outgoingSortFixture.steps[2].id,
      toStepNum: 1,
    }));
    expect(outgoingSort.details).toMatchObject({ blockingStepNums: [1, 2] });

    expectError(await reorderNativeRecipeStep(db, reorderFixture.otherChef.id, reorderFixture.recipe.id, {
      clientMutationId: "reorder-owner",
      stepId: reorderFixture.steps[0].id,
      toStepNum: 1,
    }), "insufficient_scope");
    expectError(await replaceNativeRecipeStepOutputUses(db, reorderFixture.chef.id, reorderFixture.recipe.id, {
      clientMutationId: "replace-empty-invalid",
      inputStepId: reorderFixture.steps[1].id,
      outputStepNums: [],
    }));
    await addIngredient(db, reorderFixture.recipe.id, 2, "replace-clear-celery");
    expectOk(await replaceNativeRecipeStepOutputUses(db, reorderFixture.chef.id, reorderFixture.recipe.id, {
      clientMutationId: "replace-empty-with-ingredient",
      inputStepId: reorderFixture.steps[1].id,
      outputStepNums: [],
    }));
    expectError(await replaceNativeRecipeStepOutputUses(db, reorderFixture.otherChef.id, reorderFixture.recipe.id, {
      clientMutationId: "replace-owner",
      inputStepId: reorderFixture.steps[1].id,
      outputStepNums: [],
    }), "insufficient_scope");
  });

  it("keeps delete recovery fallback defensive when dependency state changes between checks", async () => {
    const dbMock = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({ id: "step_1", recipeId: "recipe_1", stepNum: 1 }),
      },
      stepOutputUse: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ inputStepNum: 2, inputOfStep: { stepNum: 2, stepTitle: "Use it" } }])
          .mockResolvedValueOnce([]),
      },
    } as unknown as LocalDb;

    const result = expectError(await deleteNativeRecipeStep(dbMock, "chef_1", "recipe_1", "step_1"));
    expect(result.details).toMatchObject({ dependentStepNums: [2] });
  });

  it("supports successful step deletes with and without route idempotency tombstones", async () => {
    const fixture = await createRecipeWithSteps(db, [1]);
    expectOk(await deleteNativeRecipeStep(db, fixture.chef.id, fixture.recipe.id, fixture.steps[0].id));

    const tombstoneDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_1",
          recipeId: "recipe_1",
          stepNum: 1,
          stepTitle: "First",
          description: "First.",
          duration: null,
        }),
        delete: vi.fn().mockResolvedValue({ id: "step_1" }),
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      apiMutationTombstone: {
        upsert: vi.fn().mockResolvedValue({ id: "tombstone_1" }),
      },
    } as unknown as LocalDb;

    expectOk(await deleteNativeRecipeStep(tombstoneDb, "chef_1", "recipe_1", "step_1", {
      tombstone: {
        idempotencyKeyId: "idem_1",
        operation: "recipes.steps.delete",
      },
    }));
    expect(tombstoneDb.apiMutationTombstone.upsert).toHaveBeenCalledWith({
      where: {
        idempotencyKeyId_resourceType_resourceId: {
          idempotencyKeyId: "idem_1",
          resourceType: "recipe_step",
          resourceId: "step_1",
        },
      },
      update: {
        operation: "recipes.steps.delete",
        parentResourceId: "recipe_1",
        payload: JSON.stringify({ recipeId: "recipe_1", stepNum: 1 }),
      },
      create: {
        idempotencyKeyId: "idem_1",
        operation: "recipes.steps.delete",
        resourceType: "recipe_step",
        resourceId: "step_1",
        parentResourceId: "recipe_1",
        payload: JSON.stringify({ recipeId: "recipe_1", stepNum: 1 }),
      },
    });
  });

  it("rolls back partial step creates when dependent writes fail", async () => {
    const createFailure = new Error("recipe step insert failed");
    const createRejectDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findFirst: vi.fn().mockResolvedValue({ stepNum: 1 }),
        findMany: vi.fn().mockResolvedValue([{ stepNum: 1 }]),
        create: vi.fn().mockRejectedValue(createFailure),
        delete: vi.fn(),
      },
      ingredientRef: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stepOutputUse: {
        createMany: vi.fn(),
      },
    } as unknown as LocalDb;

    await expect(createNativeRecipeStep(createRejectDb, "chef_1", "recipe_1", {
      clientMutationId: "create-fails-before-step-id",
      stepTitle: null,
      description: "Create before id.",
      duration: null,
      ingredients: [],
      outputStepNums: [1],
    })).rejects.toThrow(createFailure);
    expect(createRejectDb.recipeStep.delete).not.toHaveBeenCalled();

    const outputFailure = new Error("output use insert failed");
    const cleanupDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findFirst: vi.fn().mockResolvedValue({ stepNum: 1 }),
        findMany: vi.fn().mockResolvedValue([{ stepNum: 1 }]),
        create: vi.fn().mockResolvedValue({ id: "created_step" }),
        delete: vi.fn().mockRejectedValue(new Error("cleanup failed")),
      },
      ingredientRef: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stepOutputUse: {
        createMany: vi.fn().mockRejectedValue(outputFailure),
      },
    } as unknown as LocalDb;

    await expect(createNativeRecipeStep(cleanupDb, "chef_1", "recipe_1", {
      clientMutationId: "create-cleans-created-step",
      stepTitle: null,
      description: "Create then output failure.",
      duration: null,
      ingredients: [],
      outputStepNums: [1],
    })).rejects.toThrow(outputFailure);
    expect(cleanupDb.recipeStep.delete).toHaveBeenCalledWith({ where: { id: "created_step" } });
  });

  it("restores step fields and output uses when patch replacement fails", async () => {
    const replaceFailure = new Error("output replacement failed");
    const update = vi.fn()
      .mockResolvedValueOnce({ id: "step_2" })
      .mockResolvedValueOnce({ id: "step_2" });
    const deleteMany = vi.fn()
      .mockRejectedValueOnce(replaceFailure)
      .mockResolvedValueOnce({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const dbMock = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_2",
          recipeId: "recipe_1",
          stepNum: 2,
          stepTitle: "Original title",
          description: "Original description.",
          duration: 5,
        }),
        findMany: vi.fn().mockResolvedValue([{ stepNum: 1 }]),
        update,
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([{ outputStepNum: 1 }]),
        deleteMany,
        createMany,
      },
      ingredient: {
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as LocalDb;

    await expect(updateNativeRecipeStep(dbMock, "chef_1", "recipe_1", "step_2", {
      clientMutationId: "patch-rolls-back",
      fields: {
        description: "Broken replacement.",
        outputStepNums: [1],
      },
    })).rejects.toThrow(replaceFailure);

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "step_2" },
      data: { description: "Broken replacement." },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "step_2" },
      data: {
        stepTitle: "Original title",
        description: "Original description.",
        duration: 5,
      },
    });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ recipeId: "recipe_1", inputStepNum: 2, outputStepNum: 1 }],
    });
  });

  it("restores recipe order on reorder failure and preserves the original error if restore also fails", async () => {
    const reorderFailure = new Error("renumber failed");
    const restoreSuccessUpdate = vi.fn()
      .mockRejectedValueOnce(reorderFailure)
      .mockResolvedValue({ id: "step" });
    const restoreSuccessDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_2",
          recipeId: "recipe_1",
          stepNum: 2,
          stepTitle: "Second",
          description: "Second.",
          duration: null,
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: "step_1", stepNum: 1 },
          { id: "step_2", stepNum: 2 },
        ]),
        update: restoreSuccessUpdate,
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as LocalDb;

    await expect(reorderNativeRecipeStep(restoreSuccessDb, "chef_1", "recipe_1", {
      clientMutationId: "reorder-restores",
      stepId: "step_2",
      toStepNum: 1,
    })).rejects.toThrow(reorderFailure);
    expect(restoreSuccessUpdate).toHaveBeenCalledTimes(5);
    expect(restoreSuccessUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "step_1" },
      data: { stepNum: -1 },
    });
    expect(restoreSuccessUpdate).toHaveBeenNthCalledWith(5, {
      where: { id: "step_2" },
      data: { stepNum: 2 },
    });

    const restoreFailure = new Error("restore failed");
    const restoreFailureUpdate = vi.fn()
      .mockRejectedValueOnce(reorderFailure)
      .mockRejectedValueOnce(restoreFailure);
    const restoreFailureDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_2",
          recipeId: "recipe_1",
          stepNum: 2,
          stepTitle: "Second",
          description: "Second.",
          duration: null,
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: "step_1", stepNum: 1 },
          { id: "step_2", stepNum: 2 },
        ]),
        update: restoreFailureUpdate,
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as LocalDb;

    await expect(reorderNativeRecipeStep(restoreFailureDb, "chef_1", "recipe_1", {
      clientMutationId: "reorder-restore-also-fails",
      stepId: "step_2",
      toStepNum: 1,
    })).rejects.toThrow(reorderFailure);
    expect(restoreFailureUpdate).toHaveBeenCalledTimes(2);
  });

  it("restores output uses on replacement failure and preserves the original error if restore also fails", async () => {
    const replaceFailure = new Error("replace failed");
    const restoreSuccessDeleteMany = vi.fn()
      .mockRejectedValueOnce(replaceFailure)
      .mockResolvedValueOnce({ count: 0 });
    const restoreSuccessDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_2",
          recipeId: "recipe_1",
          stepNum: 2,
          stepTitle: "Second",
          description: "Second.",
          duration: null,
        }),
        findMany: vi.fn().mockResolvedValue([{ stepNum: 1 }]),
      },
      ingredient: {
        count: vi.fn().mockResolvedValue(0),
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([{ outputStepNum: 1 }]),
        deleteMany: restoreSuccessDeleteMany,
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as LocalDb;

    await expect(replaceNativeRecipeStepOutputUses(restoreSuccessDb, "chef_1", "recipe_1", {
      clientMutationId: "replace-restores",
      inputStepId: "step_2",
      outputStepNums: [1],
    })).rejects.toThrow(replaceFailure);
    expect(restoreSuccessDeleteMany).toHaveBeenCalledTimes(2);
    expect(restoreSuccessDb.stepOutputUse.createMany).toHaveBeenCalledWith({
      data: [{ recipeId: "recipe_1", inputStepNum: 2, outputStepNum: 1 }],
    });

    const restoreFailure = new Error("restore failed");
    const restoreFailureDeleteMany = vi.fn()
      .mockRejectedValueOnce(replaceFailure)
      .mockRejectedValueOnce(restoreFailure);
    const restoreFailureDb = {
      recipe: {
        findUnique: vi.fn().mockResolvedValue({ id: "recipe_1", chefId: "chef_1", deletedAt: null }),
      },
      recipeStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "step_2",
          recipeId: "recipe_1",
          stepNum: 2,
          stepTitle: "Second",
          description: "Second.",
          duration: null,
        }),
        findMany: vi.fn().mockResolvedValue([{ stepNum: 1 }]),
      },
      ingredient: {
        count: vi.fn().mockResolvedValue(0),
      },
      stepOutputUse: {
        findMany: vi.fn().mockResolvedValue([{ outputStepNum: 1 }]),
        deleteMany: restoreFailureDeleteMany,
        createMany: vi.fn(),
      },
    } as unknown as LocalDb;

    await expect(replaceNativeRecipeStepOutputUses(restoreFailureDb, "chef_1", "recipe_1", {
      clientMutationId: "replace-restore-also-fails",
      inputStepId: "step_2",
      outputStepNums: [1],
    })).rejects.toThrow(replaceFailure);
    expect(restoreFailureDeleteMany).toHaveBeenCalledTimes(2);
  });
});
