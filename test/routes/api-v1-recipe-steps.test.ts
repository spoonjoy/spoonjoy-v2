import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "PUT" | "DELETE";

function routeArgs(request: Request, splat: string) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env: null } },
  } as never;
}

function mutationRequest(
  method: MutationMethod,
  path: string,
  token: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function anonymousMutationRequest(
  method: MutationMethod,
  path: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function headerOnlyMutationRequest(
  method: MutationMethod,
  path: string,
  token: string,
  requestId: string,
  headers: Record<string, string>,
) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Request-Id": requestId,
      ...headers,
    },
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
}

async function reserveRouteMutation(
  db: LocalDb,
  fixture: Awaited<ReturnType<typeof createRecipeStepFixture>>,
  input: { method: MutationMethod; path: string; body: Record<string, unknown>; operation: string },
) {
  const reserved = await reserveIdempotencyKey(db, {
    userId: fixture.chef.id,
    credentialId: fixture.writer.credential.id,
    clientKey: idempotencyClientKey({
      id: fixture.chef.id,
      source: "bearer",
      credentialId: fixture.writer.credential.id,
    }),
    key: input.body.clientMutationId as string,
    operation: input.operation,
    requestHash: await hashIdempotencyRequest({
      method: input.method,
      path: `/api/v1/${input.path}`,
      body: input.body,
    }),
  });
  if (reserved.status !== "reserved") throw new Error("expected idempotency reservation");
  return reserved.record;
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: Record<string, any>, requestId: string) {
  expectExactKeys(payload, ["ok", "requestId", "data"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(payload: Record<string, any>, requestId: string, code: string, status: number) {
  expectExactKeys(payload, ["ok", "requestId", "error"]);
  expect(payload).toMatchObject({
    ok: false,
    requestId,
    error: { code, status, message: expect.any(String) },
  });
}

function expectMutationShape(mutation: Record<string, unknown>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

async function expectInProgress(response: Response, requestId: string) {
  expect(response.status).toBe(409);
  expectErrorEnvelope(await readJson(response), requestId, "idempotency_in_progress", 409);
}

function expectIngredientShape(ingredient: Record<string, unknown>) {
  expectExactKeys(ingredient, ["id", "name", "quantity", "unit"]);
  expect(typeof ingredient.id).toBe("string");
  expect(typeof ingredient.name).toBe("string");
  expect(typeof ingredient.quantity).toBe("number");
  expect(typeof ingredient.unit).toBe("string");
}

function expectStepOutputUseShape(use: Record<string, any>) {
  expectExactKeys(use, ["id", "inputStepNum", "outputOfStep", "outputStepNum"]);
  expect(typeof use.id).toBe("string");
  expect(typeof use.inputStepNum).toBe("number");
  expect(typeof use.outputStepNum).toBe("number");
  expectExactKeys(use.outputOfStep, ["stepNum", "stepTitle"]);
  expect(typeof use.outputOfStep.stepNum).toBe("number");
  expect(use.outputOfStep.stepTitle === null || typeof use.outputOfStep.stepTitle === "string").toBe(true);
}

function expectStepShape(step: Record<string, any>) {
  expectExactKeys(step, ["description", "duration", "id", "ingredients", "stepNum", "stepTitle", "usingSteps"]);
  expect(typeof step.id).toBe("string");
  expect(typeof step.stepNum).toBe("number");
  expect(step.stepTitle === null || typeof step.stepTitle === "string").toBe(true);
  expect(typeof step.description).toBe("string");
  expect(step.duration === null || typeof step.duration === "number").toBe(true);
  expect(Array.isArray(step.ingredients)).toBe(true);
  expect(Array.isArray(step.usingSteps)).toBe(true);
  for (const ingredient of step.ingredients) {
    expectIngredientShape(ingredient);
  }
  for (const use of step.usingSteps) {
    expectStepOutputUseShape(use);
  }
}

function expectRecipeGraphShape(recipe: Record<string, any>) {
  expectExactKeys(recipe, [
    "attribution",
    "canonicalUrl",
    "chef",
    "cookbooks",
    "coverImageUrl",
    "coverProvenanceLabel",
    "coverSourceType",
    "coverVariant",
    "createdAt",
    "description",
    "href",
    "id",
    "servings",
    "steps",
    "title",
    "updatedAt",
  ]);
  expect(Array.isArray(recipe.steps)).toBe(true);
  for (const step of recipe.steps) {
    expectStepShape(step);
  }
}

async function createRecipeStepFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const otherChef = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, chef.id, "Recipe step writer", { scopes: ["kitchen:write"] });
  const reader = await createApiCredential(db, chef.id, "Recipe step reader", { scopes: ["recipes:read"] });
  const otherWriter = await createApiCredential(db, otherChef.id, "Other recipe step writer", { scopes: ["kitchen:write"] });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `API Step Recipe ${faker.string.alphanumeric(8)}`,
      description: "Recipe for native step API tests",
      servings: "4",
    },
  });
  const steps = await Promise.all([
    db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        stepTitle: "Prep",
        description: "Prep ingredients.",
        duration: 5,
      },
    }),
    db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 2,
        stepTitle: "Cook",
        description: "Cook the base.",
        duration: 15,
      },
    }),
    db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 3,
        stepTitle: "Plate",
        description: "Plate the finished recipe.",
        duration: null,
      },
    }),
  ]);
  const unit = await getOrCreateUnit(db, `cup-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredientRef = await getOrCreateIngredientRef(db, `rice-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredient = await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
  await db.stepOutputUse.create({
    data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 2 },
  });
  return { chef, otherChef, writer, reader, otherWriter, recipe, steps, ingredient };
}

async function createForeignRecipeGraph(db: LocalDb, chefId: string) {
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chefId),
      title: `Foreign Step Recipe ${faker.string.alphanumeric(8)}`,
    },
  });
  const step = await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Foreign prep",
      description: "This step must not be reachable from another recipe route.",
    },
  });
  const unit = await getOrCreateUnit(db, `oz-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredientRef = await getOrCreateIngredientRef(db, `foreign-garlic-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredient = await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: step.stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
  return { recipe, step, ingredient };
}

async function createIngredientForStep(
  db: LocalDb,
  input: {
    recipeId: string;
    stepNum: number;
    quantity: number;
    unit: string;
    name: string;
    id?: string;
  },
) {
  const unit = await getOrCreateUnit(db, input.unit.toLowerCase());
  const ingredientRef = await getOrCreateIngredientRef(db, input.name.toLowerCase());
  return await db.ingredient.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      recipeId: input.recipeId,
      stepNum: input.stepNum,
      quantity: input.quantity,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
}

describe("API v1 recipe step and dependency mutations", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares the recipe step mutation scope rows", () => {
    for (const [method, path] of [
      ["POST", "/api/v1/recipes/{id}/steps"],
      ["PATCH", "/api/v1/recipes/{id}/steps/{stepId}"],
      ["DELETE", "/api/v1/recipes/{id}/steps/{stepId}"],
      ["POST", "/api/v1/recipes/{id}/steps/reorder"],
      ["POST", "/api/v1/recipes/{id}/steps/{stepId}/ingredients"],
      ["DELETE", "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}"],
      ["PUT", "/api/v1/recipes/{id}/step-output-uses"],
    ] as const) {
      expect(resolveApiV1ScopeRequirement(method, path)).toEqual({
        auth: "bearer",
        scopes: ["kitchen:write"],
      });
    }
  });

  it("creates, updates, replays, and deletes steps while returning dependency-aware recipe graphs", async () => {
    const fixture = await createRecipeStepFixture(db);
    const createBody = {
      clientMutationId: "step-create",
      stepTitle: "Finish sauce",
      description: "Reduce the sauce until glossy.",
      duration: 7,
      ingredients: [{ quantity: 2.5, unit: "tbsp", name: "soy sauce" }],
      outputStepNums: [1, 2],
    };
    const created = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps`, fixture.writer.token, "req_step_create", createBody),
      `recipes/${fixture.recipe.id}/steps`,
    ));
    const createPayload = await readJson(created);

    expect(created.status).toBe(201);
    expectPrivateEnvelopeHeaders(created, "req_step_create");
    expectSuccessEnvelope(createPayload, "req_step_create");
    expect(createPayload.data).toMatchObject({
      created: true,
      step: {
        stepNum: 4,
        stepTitle: "Finish sauce",
        description: "Reduce the sauce until glossy.",
        duration: 7,
        ingredients: [{ quantity: 2.5, unit: "tbsp", name: "soy sauce" }],
        usingSteps: [
          { inputStepNum: 4, outputStepNum: 1, outputOfStep: { stepNum: 1, stepTitle: "Prep" } },
          { inputStepNum: 4, outputStepNum: 2, outputOfStep: { stepNum: 2, stepTitle: "Cook" } },
        ],
      },
    });
    expectStepShape(createPayload.data.step);
    expectRecipeGraphShape(createPayload.data.recipe);
    expectMutationShape(createPayload.data.mutation, "step-create", false);

    const replayedCreate = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps`, fixture.writer.token, "req_step_create_replay", createBody),
      `recipes/${fixture.recipe.id}/steps`,
    ));
    const replayPayload = await readJson(replayedCreate);
    expect(replayedCreate.status).toBe(201);
    expectSuccessEnvelope(replayPayload, "req_step_create_replay");
    expect(replayPayload.data).toMatchObject({
      created: true,
      step: { id: createPayload.data.step.id, stepNum: 4 },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayPayload.data.mutation, "step-create", true);
    await expect(db.recipeStep.count({ where: { recipeId: fixture.recipe.id, stepTitle: "Finish sauce" } })).resolves.toBe(1);

    const createdStepId = createPayload.data.step.id as string;
    const patchBody = {
      clientMutationId: "step-update",
      stepTitle: null,
      description: "Finish with herbs.",
      duration: null,
      outputStepNums: [1],
    };
    const updated = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${fixture.recipe.id}/steps/${createdStepId}`, fixture.writer.token, "req_step_update", patchBody),
      `recipes/${fixture.recipe.id}/steps/${createdStepId}`,
    ));
    const updatePayload = await readJson(updated);
    expect(updated.status).toBe(200);
    expectSuccessEnvelope(updatePayload, "req_step_update");
    expect(updatePayload.data).toMatchObject({
      updated: true,
      step: {
        id: createdStepId,
        stepTitle: null,
        description: "Finish with herbs.",
        duration: null,
        usingSteps: [{ outputStepNum: 1 }],
      },
    });
    expectMutationShape(updatePayload.data.mutation, "step-update", false);

    const replayedUpdate = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${fixture.recipe.id}/steps/${createdStepId}`, fixture.writer.token, "req_step_update_replay", patchBody),
      `recipes/${fixture.recipe.id}/steps/${createdStepId}`,
    ));
    const replayUpdatePayload = await readJson(replayedUpdate);
    expect(replayedUpdate.status).toBe(200);
    expectSuccessEnvelope(replayUpdatePayload, "req_step_update_replay");
    expect(replayUpdatePayload.data).toMatchObject({
      updated: true,
      step: { id: createdStepId, description: "Finish with herbs.", usingSteps: [{ outputStepNum: 1 }] },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayUpdatePayload.data.mutation, "step-update", true);
    await expect(db.stepOutputUse.count({ where: { recipeId: fixture.recipe.id, inputStepNum: 4 } })).resolves.toBe(1);

    const deleted = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${fixture.recipe.id}/steps/${createdStepId}`, fixture.writer.token, "req_step_delete", {
        clientMutationId: "step-delete",
      }),
      `recipes/${fixture.recipe.id}/steps/${createdStepId}`,
    ));
    const deletePayload = await readJson(deleted);
    expect(deleted.status).toBe(200);
    expectSuccessEnvelope(deletePayload, "req_step_delete");
    expect(deletePayload.data).toMatchObject({
      deleted: true,
      step: { id: createdStepId },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(deletePayload.data.mutation, "step-delete", false);
    await expect(db.recipeStep.findUnique({ where: { id: createdStepId } })).resolves.toBeNull();

    const replayedDelete = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${fixture.recipe.id}/steps/${createdStepId}`, fixture.writer.token, "req_step_delete_replay", {
        clientMutationId: "step-delete",
      }),
      `recipes/${fixture.recipe.id}/steps/${createdStepId}`,
    ));
    const replayDeletePayload = await readJson(replayedDelete);
    expect(replayedDelete.status).toBe(200);
    expectSuccessEnvelope(replayDeletePayload, "req_step_delete_replay");
    expect(replayDeletePayload.data).toMatchObject({
      deleted: true,
      step: { id: createdStepId },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayDeletePayload.data.mutation, "step-delete", true);
    await expect(db.recipeStep.findUnique({ where: { id: createdStepId } })).resolves.toBeNull();
  });

  it("adds and deletes step ingredients with exact idempotent mutation envelopes", async () => {
    const fixture = await createRecipeStepFixture(db);
    const body = {
      clientMutationId: "ingredient-add",
      quantity: 3,
      unit: "cloves",
      name: "garlic",
    };
    const added = await action(routeArgs(
      mutationRequest(
        "POST",
        `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients`,
        fixture.writer.token,
        "req_step_ingredient_add",
        body,
      ),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients`,
    ));
    const addPayload = await readJson(added);

    expect(added.status).toBe(201);
    expectSuccessEnvelope(addPayload, "req_step_ingredient_add");
    expect(addPayload.data).toMatchObject({
      created: true,
      ingredient: { quantity: 3, unit: "cloves", name: "garlic" },
      step: { id: fixture.steps[1].id, stepNum: 2 },
      recipe: { id: fixture.recipe.id },
    });
    expectIngredientShape(addPayload.data.ingredient);
    expectMutationShape(addPayload.data.mutation, "ingredient-add", false);

    const ingredientId = addPayload.data.ingredient.id as string;
    const replayedAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients`,
        fixture.writer.token,
        "req_step_ingredient_add_replay",
        body,
      ),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients`,
    ));
    const replayAddPayload = await readJson(replayedAdd);
    expect(replayedAdd.status).toBe(201);
    expectSuccessEnvelope(replayAddPayload, "req_step_ingredient_add_replay");
    expect(replayAddPayload.data).toMatchObject({
      created: true,
      ingredient: { id: ingredientId, quantity: 3, unit: "cloves", name: "garlic" },
      step: { id: fixture.steps[1].id },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayAddPayload.data.mutation, "ingredient-add", true);
    await expect(db.ingredient.count({ where: { recipeId: fixture.recipe.id, stepNum: 2 } })).resolves.toBe(1);

    const removed = await action(routeArgs(
      mutationRequest(
        "DELETE",
        `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients/${ingredientId}`,
        fixture.writer.token,
        "req_step_ingredient_delete",
        { clientMutationId: "ingredient-delete" },
      ),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients/${ingredientId}`,
    ));
    const removePayload = await readJson(removed);
    expect(removed.status).toBe(200);
    expectSuccessEnvelope(removePayload, "req_step_ingredient_delete");
    expect(removePayload.data).toMatchObject({
      deleted: true,
      ingredient: { id: ingredientId },
      step: { id: fixture.steps[1].id },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(removePayload.data.mutation, "ingredient-delete", false);
    await expect(db.ingredient.findUnique({ where: { id: ingredientId } })).resolves.toBeNull();

    const replayedRemove = await action(routeArgs(
      mutationRequest(
        "DELETE",
        `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients/${ingredientId}`,
        fixture.writer.token,
        "req_step_ingredient_delete_replay",
        { clientMutationId: "ingredient-delete" },
      ),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients/${ingredientId}`,
    ));
    const replayRemovePayload = await readJson(replayedRemove);
    expect(replayedRemove.status).toBe(200);
    expectSuccessEnvelope(replayRemovePayload, "req_step_ingredient_delete_replay");
    expect(replayRemovePayload.data).toMatchObject({
      deleted: true,
      ingredient: { id: ingredientId },
      step: { id: fixture.steps[1].id },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayRemovePayload.data.mutation, "ingredient-delete", true);
    await expect(db.ingredient.findUnique({ where: { id: ingredientId } })).resolves.toBeNull();
  });

  it("reorders steps and replaces step-output dependencies without losing graph parity", async () => {
    const fixture = await createRecipeStepFixture(db);
    const reorderBody = {
      clientMutationId: "step-reorder",
      stepId: fixture.steps[2].id,
      toStepNum: 2,
    };
    const reordered = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps/reorder`, fixture.writer.token, "req_step_reorder", reorderBody),
      `recipes/${fixture.recipe.id}/steps/reorder`,
    ));
    const reorderPayload = await readJson(reordered);

    expect(reordered.status).toBe(200);
    expectSuccessEnvelope(reorderPayload, "req_step_reorder");
    expect(reorderPayload.data).toMatchObject({
      reordered: true,
      step: { id: fixture.steps[2].id, stepNum: 2 },
      recipe: { id: fixture.recipe.id },
    });
    expectRecipeGraphShape(reorderPayload.data.recipe);
    expectMutationShape(reorderPayload.data.mutation, "step-reorder", false);
    expect(reorderPayload.data.recipe.steps.map((step: Record<string, unknown>) => step.id)).toEqual([
      fixture.steps[0].id,
      fixture.steps[2].id,
      fixture.steps[1].id,
    ]);

    const replayedReorder = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps/reorder`, fixture.writer.token, "req_step_reorder_replay", reorderBody),
      `recipes/${fixture.recipe.id}/steps/reorder`,
    ));
    const replayReorderPayload = await readJson(replayedReorder);
    expect(replayedReorder.status).toBe(200);
    expectSuccessEnvelope(replayReorderPayload, "req_step_reorder_replay");
    expect(replayReorderPayload.data.recipe.steps.map((step: Record<string, unknown>) => step.id)).toEqual([
      fixture.steps[0].id,
      fixture.steps[2].id,
      fixture.steps[1].id,
    ]);
    expectMutationShape(replayReorderPayload.data.mutation, "step-reorder", true);

    const stepTwoAfterReorder = reorderPayload.data.recipe.steps[1];
    const dependencyBody = {
      clientMutationId: "step-output-uses",
      inputStepId: stepTwoAfterReorder.id,
      outputStepNums: [1],
    };
    const replaced = await action(routeArgs(
      mutationRequest("PUT", `recipes/${fixture.recipe.id}/step-output-uses`, fixture.writer.token, "req_step_output_uses", dependencyBody),
      `recipes/${fixture.recipe.id}/step-output-uses`,
    ));
    const replacePayload = await readJson(replaced);

    expect(replaced.status).toBe(200);
    expectSuccessEnvelope(replacePayload, "req_step_output_uses");
    expect(replacePayload.data).toMatchObject({
      replaced: true,
      step: {
        id: stepTwoAfterReorder.id,
        usingSteps: [{ inputStepNum: 2, outputStepNum: 1, outputOfStep: { stepNum: 1, stepTitle: "Prep" } }],
      },
      recipe: { id: fixture.recipe.id },
    });
    expectStepShape(replacePayload.data.step);
    expectRecipeGraphShape(replacePayload.data.recipe);
    expectMutationShape(replacePayload.data.mutation, "step-output-uses", false);

    const replayedReplace = await action(routeArgs(
      mutationRequest("PUT", `recipes/${fixture.recipe.id}/step-output-uses`, fixture.writer.token, "req_step_output_uses_replay", dependencyBody),
      `recipes/${fixture.recipe.id}/step-output-uses`,
    ));
    const replayReplacePayload = await readJson(replayedReplace);
    expect(replayedReplace.status).toBe(200);
    expectSuccessEnvelope(replayReplacePayload, "req_step_output_uses_replay");
    expect(replayReplacePayload.data).toMatchObject({
      replaced: true,
      step: {
        id: stepTwoAfterReorder.id,
        usingSteps: [{ inputStepNum: 2, outputStepNum: 1, outputOfStep: { stepNum: 1, stepTitle: "Prep" } }],
      },
      recipe: { id: fixture.recipe.id },
    });
    expectMutationShape(replayReplacePayload.data.mutation, "step-output-uses", true);
    await expect(db.stepOutputUse.count({ where: { recipeId: fixture.recipe.id, inputStepNum: 2 } })).resolves.toBe(1);

    const publicDetail = await action(routeArgs(
      new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}`, {
        method: "GET",
        headers: { "X-Request-Id": "req_step_detail_graph" },
      }) as unknown as Request,
      `recipes/${fixture.recipe.id}`,
    ));
    const detailPayload = await readJson(publicDetail);
    expect(publicDetail.status).toBe(200);
    expectRecipeGraphShape(detailPayload.data.recipe);
    expect(detailPayload.data.recipe.steps[1].usingSteps).toEqual([
      expect.objectContaining({ outputStepNum: 1, outputOfStep: { stepNum: 1, stepTitle: "Prep" } }),
    ]);
  });

  it("enforces authentication, kitchen write scope, and recipe ownership before step writes", async () => {
    const fixture = await createRecipeStepFixture(db);
    const body = {
      clientMutationId: "step-auth",
      stepTitle: "Auth",
      description: "Auth checks.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    };

    const anonymous = await action(routeArgs(
      anonymousMutationRequest("POST", `recipes/${fixture.recipe.id}/steps`, "req_step_auth_anonymous", body),
      `recipes/${fixture.recipe.id}/steps`,
    ));
    expect(anonymous.status).toBe(401);
    expectErrorEnvelope(await readJson(anonymous), "req_step_auth_anonymous", "authentication_required", 401);

    const insufficientScope = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps`, fixture.reader.token, "req_step_auth_scope", body),
      `recipes/${fixture.recipe.id}/steps`,
    ));
    expect(insufficientScope.status).toBe(403);
    expectErrorEnvelope(await readJson(insufficientScope), "req_step_auth_scope", "insufficient_scope", 403);

    const nonOwner = await action(routeArgs(
      mutationRequest(
        "PATCH",
        `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}`,
        fixture.otherWriter.token,
        "req_step_auth_owner",
        { clientMutationId: "step-non-owner", description: "Nope" },
      ),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}`,
    ));
    expect(nonOwner.status).toBe(403);
    expectErrorEnvelope(await readJson(nonOwner), "req_step_auth_owner", "insufficient_scope", 403);
  });

  it("rejects duplicate step numbers, malformed ingredients, missing ids, invalid dependency refs, and dependency cycles", async () => {
    const fixture = await createRecipeStepFixture(db);

    for (const [requestId, method, path, body] of [
      ["req_step_duplicate_num", "POST", `recipes/${fixture.recipe.id}/steps`, {
        clientMutationId: "step-duplicate-num",
        stepNum: 1,
        description: "Duplicate position.",
        ingredients: [],
        outputStepNums: [],
      }],
      ["req_step_bad_quantity", "POST", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients`, {
        clientMutationId: "step-bad-quantity",
        quantity: 0,
        unit: "cup",
        name: "salt",
      }],
      ["req_step_missing_id", "PATCH", `recipes/${fixture.recipe.id}/steps/missing`, {
        clientMutationId: "step-missing-id",
        description: "No step.",
      }],
      ["req_step_dependency_future", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "step-dependency-future",
        inputStepId: fixture.steps[0].id,
        outputStepNums: [2],
      }],
      ["req_step_dependency_self", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "step-dependency-self",
        inputStepId: fixture.steps[1].id,
        outputStepNums: [2],
      }],
      ["req_step_dependency_empty", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "step-dependency-empty",
        inputStepId: fixture.steps[1].id,
        outputStepNums: [],
      }],
      ["req_step_patch_empty_without_dependencies", "PATCH", `recipes/${fixture.recipe.id}/steps/${fixture.steps[2].id}`, {
        clientMutationId: "step-patch-empty-without-dependencies",
        description: "Still empty.",
      }],
    ] as const) {
      const response = await action(routeArgs(
        mutationRequest(method, path, fixture.writer.token, requestId, body),
        path,
      ));
      expect(response.status).toBe(requestId === "req_step_missing_id" ? 404 : 400);
      expectErrorEnvelope(
        await readJson(response),
        requestId,
        requestId === "req_step_missing_id" ? "not_found" : "validation_error",
        requestId === "req_step_missing_id" ? 404 : 400,
      );
    }
  });

  it("rejects nested step and ingredient ids that do not belong to the routed recipe graph", async () => {
    const fixture = await createRecipeStepFixture(db);
    const foreign = await createForeignRecipeGraph(db, fixture.chef.id);

    for (const [requestId, method, path, body] of [
      ["req_step_ingredient_missing_step", "POST", `recipes/${fixture.recipe.id}/steps/missing/ingredients`, {
        clientMutationId: "ingredient-missing-step",
        quantity: 1,
        unit: "cup",
        name: "salt",
      }],
      ["req_step_ingredient_foreign_step", "POST", `recipes/${fixture.recipe.id}/steps/${foreign.step.id}/ingredients`, {
        clientMutationId: "ingredient-foreign-step",
        quantity: 1,
        unit: "cup",
        name: "salt",
      }],
      ["req_step_ingredient_delete_foreign_step", "DELETE", `recipes/${fixture.recipe.id}/steps/${foreign.step.id}/ingredients/${fixture.ingredient.id}`, {
        clientMutationId: "ingredient-delete-foreign-step",
      }],
      ["req_step_ingredient_delete_foreign_ingredient", "DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients/${foreign.ingredient.id}`, {
        clientMutationId: "ingredient-delete-foreign-ingredient",
      }],
      ["req_step_ingredient_delete_wrong_step", "DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients/${fixture.ingredient.id}`, {
        clientMutationId: "ingredient-delete-wrong-step",
      }],
      ["req_step_ingredient_delete_missing_ingredient", "DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients/missing`, {
        clientMutationId: "ingredient-delete-missing-ingredient",
      }],
      ["req_step_reorder_missing_step", "POST", `recipes/${fixture.recipe.id}/steps/reorder`, {
        clientMutationId: "reorder-missing-step",
        stepId: "missing",
        toStepNum: 2,
      }],
      ["req_step_reorder_foreign_step", "POST", `recipes/${fixture.recipe.id}/steps/reorder`, {
        clientMutationId: "reorder-foreign-step",
        stepId: foreign.step.id,
        toStepNum: 2,
      }],
      ["req_step_output_uses_missing_input", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "output-uses-missing-input",
        inputStepId: "missing",
        outputStepNums: [1],
      }],
      ["req_step_output_uses_foreign_input", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "output-uses-foreign-input",
        inputStepId: foreign.step.id,
        outputStepNums: [1],
      }],
    ] as const) {
      const response = await action(routeArgs(
        mutationRequest(method, path, fixture.writer.token, requestId, body),
        path,
      ));
      expect(response.status).toBe(404);
      expectErrorEnvelope(await readJson(response), requestId, "not_found", 404);
    }
  });

  it("only recovers incomplete step create idempotency when the full requested graph committed", async () => {
    const fixture = await createRecipeStepFixture(db);
    const path = `recipes/${fixture.recipe.id}/steps`;
    const body = {
      clientMutationId: "step-create-partial-recovery",
      stepTitle: "Recoverable sauce",
      description: "Recover only when full graph exists.",
      duration: 6,
      ingredients: [{ quantity: 2, unit: "tbsp", name: "miso" }],
      outputStepNums: [1, 2],
    };
    const reservation = await reserveRouteMutation(db, fixture, {
      method: "POST",
      path,
      body,
      operation: "recipes.steps.create",
    });

    await db.recipeStep.create({
      data: {
        id: reservation.id,
        recipeId: fixture.recipe.id,
        stepNum: 4,
        stepTitle: body.stepTitle,
        description: body.description,
        duration: body.duration,
      },
    });

    const partial = await action(routeArgs(
      mutationRequest("POST", path, fixture.writer.token, "req_step_create_partial_recovery", body),
      path,
    ));
    expect(partial.status).toBe(409);
    expectErrorEnvelope(await readJson(partial), "req_step_create_partial_recovery", "idempotency_in_progress", 409);

    await db.stepOutputUse.createMany({
      data: body.outputStepNums.map((outputStepNum) => ({
        recipeId: fixture.recipe.id,
        inputStepNum: 4,
        outputStepNum,
      })),
    });
    const unit = await getOrCreateUnit(db, body.ingredients[0].unit);
    const ingredientRef = await getOrCreateIngredientRef(db, body.ingredients[0].name);
    await db.ingredient.create({
      data: {
        recipeId: fixture.recipe.id,
        stepNum: 4,
        quantity: body.ingredients[0].quantity,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });

    const recovered = await action(routeArgs(
      mutationRequest("POST", path, fixture.writer.token, "req_step_create_full_recovery", body),
      path,
    ));
    const payload = await readJson(recovered);
    expect(recovered.status).toBe(201);
    expectSuccessEnvelope(payload, "req_step_create_full_recovery");
    expect(payload.data).toMatchObject({
      created: true,
      step: {
        id: reservation.id,
        ingredients: [{ quantity: 2, unit: "tbsp", name: "miso" }],
        usingSteps: [{ outputStepNum: 1 }, { outputStepNum: 2 }],
      },
    });
    expectMutationShape(payload.data.mutation, body.clientMutationId, true);
  });

  it("rejects incomplete step create recovery when committed fields or ingredients differ", async () => {
    const fixture = await createRecipeStepFixture(db);
    const path = `recipes/${fixture.recipe.id}/steps`;
    let nextStepNum = 20;

    async function expectCreateRecoveryConflict(input: {
      clientMutationId: string;
      body?: Partial<{
        stepNum: number;
        stepTitle: string | null;
        description: string;
        duration: number | null;
        ingredients: { quantity: number; unit: string; name: string }[];
        outputStepNums: number[];
      }>;
      committed?: Partial<{
        stepNum: number;
        stepTitle: string | null;
        description: string;
        duration: number | null;
        ingredients: { quantity: number; unit: string; name: string }[];
      }>;
    }) {
      const committedStepNum = input.committed?.stepNum ?? nextStepNum++;
      if (input.committed?.stepNum !== undefined) {
        nextStepNum = Math.max(nextStepNum, input.committed.stepNum + 1);
      }
      const body = {
        clientMutationId: input.clientMutationId,
        stepTitle: `Expected ${input.clientMutationId}`,
        description: `Expected description ${input.clientMutationId}`,
        duration: 5,
        ingredients: [],
        outputStepNums: [],
        ...input.body,
      };
      const reservation = await reserveRouteMutation(db, fixture, {
        method: "POST",
        path,
        body,
        operation: "recipes.steps.create",
      });
      await db.recipeStep.create({
        data: {
          id: reservation.id,
          recipeId: fixture.recipe.id,
          stepNum: committedStepNum,
          stepTitle: input.committed?.stepTitle ?? body.stepTitle,
          description: input.committed?.description ?? body.description,
          duration: input.committed?.duration ?? body.duration,
        },
      });
      for (const ingredient of input.committed?.ingredients ?? []) {
        await createIngredientForStep(db, {
          recipeId: fixture.recipe.id,
          stepNum: committedStepNum,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          name: ingredient.name,
        });
      }

      const response = await action(routeArgs(
        mutationRequest("POST", path, fixture.writer.token, `req_${input.clientMutationId}`, body),
        path,
      ));
      await expectInProgress(response, `req_${input.clientMutationId}`);
    }

    const matchingStepNum = nextStepNum++;
    const matchingBody = {
      clientMutationId: "step-create-step-num-recovery",
      stepNum: matchingStepNum,
      stepTitle: "Recovered numbered step",
      description: "Recovered numbered description.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    };
    const matchingReservation = await reserveRouteMutation(db, fixture, {
      method: "POST",
      path,
      body: matchingBody,
      operation: "recipes.steps.create",
    });
    await db.recipeStep.create({
      data: {
        id: matchingReservation.id,
        recipeId: fixture.recipe.id,
        stepNum: matchingStepNum,
        stepTitle: matchingBody.stepTitle,
        description: matchingBody.description,
        duration: matchingBody.duration,
      },
    });
    const matching = await action(routeArgs(
      mutationRequest("POST", path, fixture.writer.token, "req_step_create_step_num_recovery", matchingBody),
      path,
    ));
    const matchingPayload = await readJson(matching);
    expect(matching.status).toBe(201);
    expectSuccessEnvelope(matchingPayload, "req_step_create_step_num_recovery");
    expect(matchingPayload.data.step).toMatchObject({ id: matchingReservation.id, stepNum: matchingStepNum });
    expectMutationShape(matchingPayload.data.mutation, matchingBody.clientMutationId, true);

    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-step-num-mismatch",
      body: { stepNum: nextStepNum + 1 },
      committed: { stepNum: nextStepNum },
    });
    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-title-mismatch",
      committed: { stepTitle: "Different title" },
    });
    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-description-mismatch",
      committed: { description: "Different description." },
    });
    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-duration-mismatch",
      committed: { duration: 6 },
    });
    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-ingredient-length-mismatch",
      body: { ingredients: [{ quantity: 1, unit: "tsp", name: "paprika length" }] },
    });
    await expectCreateRecoveryConflict({
      clientMutationId: "step-create-ingredient-value-mismatch",
      body: { ingredients: [{ quantity: 1, unit: "tsp", name: "paprika expected" }] },
      committed: { ingredients: [{ quantity: 1, unit: "tsp", name: "paprika actual" }] },
    });

    const wrongOwner = await createRecipeStepFixture(db);
    const wrongOwnerPath = `recipes/${wrongOwner.recipe.id}/steps`;
    const wrongOwnerBody = {
      clientMutationId: "step-create-owner-mismatch",
      stepTitle: "Wrong owner recovery",
      description: "The committed step moved owners.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    };
    const wrongOwnerReservation = await reserveRouteMutation(db, wrongOwner, {
      method: "POST",
      path: wrongOwnerPath,
      body: wrongOwnerBody,
      operation: "recipes.steps.create",
    });
    await db.recipeStep.create({
      data: {
        id: wrongOwnerReservation.id,
        recipeId: wrongOwner.recipe.id,
        stepNum: 4,
        stepTitle: wrongOwnerBody.stepTitle,
        description: wrongOwnerBody.description,
        duration: wrongOwnerBody.duration,
      },
    });
    await db.recipe.update({ where: { id: wrongOwner.recipe.id }, data: { chefId: wrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", wrongOwnerPath, wrongOwner.writer.token, "req_step_create_owner_mismatch", wrongOwnerBody),
      wrongOwnerPath,
    )), "req_step_create_owner_mismatch");
  });

  it("accepts delete clientMutationId headers without JSON bodies", async () => {
    const stepFixture = await createRecipeStepFixture(db);
    const stepPath = `recipes/${stepFixture.recipe.id}/steps/${stepFixture.steps[2].id}`;
    const stepDeleted = await action(routeArgs(
      headerOnlyMutationRequest("DELETE", stepPath, stepFixture.writer.token, "req_step_delete_header_id", {
        "X-Client-Mutation-Id": "step-delete-header-id",
      }),
      stepPath,
    ));
    const stepPayload = await readJson(stepDeleted);
    expect(stepDeleted.status).toBe(200);
    expectSuccessEnvelope(stepPayload, "req_step_delete_header_id");
    expect(stepPayload.data).toMatchObject({ deleted: true, step: { id: stepFixture.steps[2].id } });
    expectMutationShape(stepPayload.data.mutation, "step-delete-header-id", false);

    const ingredientFixture = await createRecipeStepFixture(db);
    const ingredientPath = `recipes/${ingredientFixture.recipe.id}/steps/${ingredientFixture.steps[0].id}/ingredients/${ingredientFixture.ingredient.id}`;
    const ingredientDeleted = await action(routeArgs(
      headerOnlyMutationRequest("DELETE", ingredientPath, ingredientFixture.writer.token, "req_step_ingredient_delete_header_id", {
        "X-Client-Mutation-Id": "ingredient-delete-header-id",
      }),
      ingredientPath,
    ));
    const ingredientPayload = await readJson(ingredientDeleted);
    expect(ingredientDeleted.status).toBe(200);
    expectSuccessEnvelope(ingredientPayload, "req_step_ingredient_delete_header_id");
    expect(ingredientPayload.data).toMatchObject({ deleted: true, ingredient: { id: ingredientFixture.ingredient.id } });
    expectMutationShape(ingredientPayload.data.mutation, "ingredient-delete-header-id", false);
  });

  it("requires reservation tombstones before recovering incomplete hard deletes", async () => {
    const fixture = await createRecipeStepFixture(db);
    const stepPath = `recipes/${fixture.recipe.id}/steps/${fixture.steps[2].id}`;
    const stepBody = { clientMutationId: "step-delete-without-tombstone" };
    await reserveRouteMutation(db, fixture, {
      method: "DELETE",
      path: stepPath,
      body: stepBody,
      operation: "recipes.steps.delete",
    });
    await db.recipeStep.delete({ where: { id: fixture.steps[2].id } });

    const noTombstone = await action(routeArgs(
      mutationRequest("DELETE", stepPath, fixture.writer.token, "req_step_delete_no_tombstone", stepBody),
      stepPath,
    ));
    expect(noTombstone.status).toBe(409);
    expectErrorEnvelope(await readJson(noTombstone), "req_step_delete_no_tombstone", "idempotency_in_progress", 409);

    const ingredientFixture = await createRecipeStepFixture(db);
    const ingredientPath = `recipes/${ingredientFixture.recipe.id}/steps/${ingredientFixture.steps[0].id}/ingredients/${ingredientFixture.ingredient.id}`;
    const ingredientBody = { clientMutationId: "ingredient-delete-with-tombstone" };
    const reservation = await reserveRouteMutation(db, ingredientFixture, {
      method: "DELETE",
      path: ingredientPath,
      body: ingredientBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: reservation.id,
        operation: "recipes.steps.ingredients.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: ingredientFixture.ingredient.id,
        parentResourceId: ingredientFixture.steps[0].id,
        payload: JSON.stringify({ recipeId: ingredientFixture.recipe.id, stepId: ingredientFixture.steps[0].id }),
      },
    });
    await db.ingredient.delete({ where: { id: ingredientFixture.ingredient.id } });

    const recovered = await action(routeArgs(
      mutationRequest("DELETE", ingredientPath, ingredientFixture.writer.token, "req_ingredient_delete_tombstone", ingredientBody),
      ingredientPath,
    ));
    const payload = await readJson(recovered);
    expect(recovered.status).toBe(200);
    expectSuccessEnvelope(payload, "req_ingredient_delete_tombstone");
    expect(payload.data).toMatchObject({
      deleted: true,
      ingredient: { id: ingredientFixture.ingredient.id },
      step: { id: ingredientFixture.steps[0].id },
      recipe: { id: ingredientFixture.recipe.id },
    });
    expectMutationShape(payload.data.mutation, ingredientBody.clientMutationId, true);
  });

  it("recovers committed in-flight step update, delete, ingredient, reorder, and output mutations", async () => {
    const updateFixture = await createRecipeStepFixture(db);
    const updatePath = `recipes/${updateFixture.recipe.id}/steps/${updateFixture.steps[1].id}`;
    const updateBody = {
      clientMutationId: "step-update-recovery",
      stepTitle: null,
      description: "Recovered in-flight update.",
      duration: null,
      outputStepNums: [1],
    };
    await reserveRouteMutation(db, updateFixture, {
      method: "PATCH",
      path: updatePath,
      body: updateBody,
      operation: "recipes.steps.update",
    });
    await db.recipeStep.update({
      where: { id: updateFixture.steps[1].id },
      data: { stepTitle: null, description: updateBody.description, duration: null },
    });
    const recoveredUpdate = await action(routeArgs(
      mutationRequest("PATCH", updatePath, updateFixture.writer.token, "req_step_update_recovery", updateBody),
      updatePath,
    ));
    const updatePayload = await readJson(recoveredUpdate);
    expect(recoveredUpdate.status).toBe(200);
    expect(updatePayload.data).toMatchObject({
      updated: true,
      step: { id: updateFixture.steps[1].id, stepTitle: null, description: updateBody.description, duration: null },
    });
    expectMutationShape(updatePayload.data.mutation, updateBody.clientMutationId, true);

    const deleteFixture = await createRecipeStepFixture(db);
    const deletePath = `recipes/${deleteFixture.recipe.id}/steps/${deleteFixture.steps[2].id}`;
    const deleteBody = { clientMutationId: "step-delete-recovery" };
    const deleteReservation = await reserveRouteMutation(db, deleteFixture, {
      method: "DELETE",
      path: deletePath,
      body: deleteBody,
      operation: "recipes.steps.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: deleteReservation.id,
        operation: "recipes.steps.delete",
        resourceType: "recipe_step",
        resourceId: deleteFixture.steps[2].id,
        parentResourceId: deleteFixture.recipe.id,
        payload: JSON.stringify({ recipeId: deleteFixture.recipe.id }),
      },
    });
    await db.recipeStep.delete({ where: { id: deleteFixture.steps[2].id } });
    const recoveredDelete = await action(routeArgs(
      mutationRequest("DELETE", deletePath, deleteFixture.writer.token, "req_step_delete_recovery", deleteBody),
      deletePath,
    ));
    const deletePayload = await readJson(recoveredDelete);
    expect(recoveredDelete.status).toBe(200);
    expect(deletePayload.data).toMatchObject({
      deleted: true,
      step: { id: deleteFixture.steps[2].id },
      recipe: { id: deleteFixture.recipe.id },
    });
    expectMutationShape(deletePayload.data.mutation, deleteBody.clientMutationId, true);

    const ingredientFixture = await createRecipeStepFixture(db);
    const ingredientPath = `recipes/${ingredientFixture.recipe.id}/steps/${ingredientFixture.steps[1].id}/ingredients`;
    const ingredientBody = {
      clientMutationId: "ingredient-create-recovery",
      quantity: 4,
      unit: "pinch",
      name: "sumac recovery",
    };
    const ingredientReservation = await reserveRouteMutation(db, ingredientFixture, {
      method: "POST",
      path: ingredientPath,
      body: ingredientBody,
      operation: "recipes.steps.ingredients.create",
    });
    await createIngredientForStep(db, {
      id: ingredientReservation.id,
      recipeId: ingredientFixture.recipe.id,
      stepNum: ingredientFixture.steps[1].stepNum,
      quantity: ingredientBody.quantity,
      unit: ingredientBody.unit,
      name: ingredientBody.name,
    });
    const recoveredIngredient = await action(routeArgs(
      mutationRequest("POST", ingredientPath, ingredientFixture.writer.token, "req_ingredient_create_recovery", ingredientBody),
      ingredientPath,
    ));
    const ingredientPayload = await readJson(recoveredIngredient);
    expect(recoveredIngredient.status).toBe(201);
    expect(ingredientPayload.data).toMatchObject({
      created: true,
      ingredient: { id: ingredientReservation.id, quantity: 4, unit: "pinch", name: "sumac recovery" },
      step: { id: ingredientFixture.steps[1].id },
    });
    expectMutationShape(ingredientPayload.data.mutation, ingredientBody.clientMutationId, true);

    const reorderFixture = await createRecipeStepFixture(db);
    const reorderPath = `recipes/${reorderFixture.recipe.id}/steps/reorder`;
    const reorderBody = {
      clientMutationId: "step-reorder-recovery",
      stepId: reorderFixture.steps[2].id,
      toStepNum: 2,
    };
    const reorderReservation = await reserveRouteMutation(db, reorderFixture, {
      method: "POST",
      path: reorderPath,
      body: reorderBody,
      operation: "recipes.steps.reorder",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: reorderReservation.id,
        operation: "recipes.steps.reorder",
        resourceType: "recipe_step_reorder",
        resourceId: reorderFixture.steps[2].id,
        parentResourceId: reorderFixture.recipe.id,
        payload: JSON.stringify({
          recipeId: reorderFixture.recipe.id,
          stepId: reorderFixture.steps[2].id,
          toStepNum: 2,
          reordered: true,
        }),
      },
    });
    await db.recipeStep.update({ where: { id: reorderFixture.steps[1].id }, data: { stepNum: 99 } });
    await db.recipeStep.update({ where: { id: reorderFixture.steps[2].id }, data: { stepNum: 2 } });
    await db.recipeStep.update({ where: { id: reorderFixture.steps[1].id }, data: { stepNum: 3 } });
    const recoveredReorder = await action(routeArgs(
      mutationRequest("POST", reorderPath, reorderFixture.writer.token, "req_step_reorder_recovery", reorderBody),
      reorderPath,
    ));
    const reorderPayload = await readJson(recoveredReorder);
    expect(recoveredReorder.status).toBe(200);
    expect(reorderPayload.data).toMatchObject({
      reordered: true,
      step: { id: reorderFixture.steps[2].id, stepNum: 2 },
    });
    expectMutationShape(reorderPayload.data.mutation, reorderBody.clientMutationId, true);

    const noOpReorderFixture = await createRecipeStepFixture(db);
    const noOpReorderPath = `recipes/${noOpReorderFixture.recipe.id}/steps/reorder`;
    const noOpReorderBody = {
      clientMutationId: "step-reorder-no-op-recovery",
      stepId: noOpReorderFixture.steps[1].id,
      toStepNum: 2,
    };
    const noOpReorderReservation = await reserveRouteMutation(db, noOpReorderFixture, {
      method: "POST",
      path: noOpReorderPath,
      body: noOpReorderBody,
      operation: "recipes.steps.reorder",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: noOpReorderReservation.id,
        operation: "recipes.steps.reorder",
        resourceType: "recipe_step_reorder",
        resourceId: noOpReorderFixture.steps[1].id,
        parentResourceId: noOpReorderFixture.recipe.id,
        payload: JSON.stringify({
          recipeId: noOpReorderFixture.recipe.id,
          stepId: noOpReorderFixture.steps[1].id,
          toStepNum: 2,
          reordered: false,
        }),
      },
    });
    const recoveredNoOpReorder = await action(routeArgs(
      mutationRequest("POST", noOpReorderPath, noOpReorderFixture.writer.token, "req_step_reorder_no_op_recovery", noOpReorderBody),
      noOpReorderPath,
    ));
    const noOpReorderPayload = await readJson(recoveredNoOpReorder);
    expect(recoveredNoOpReorder.status).toBe(200);
    expect(noOpReorderPayload.data).toMatchObject({
      reordered: false,
      step: { id: noOpReorderFixture.steps[1].id, stepNum: 2 },
    });
    expectMutationShape(noOpReorderPayload.data.mutation, noOpReorderBody.clientMutationId, true);

    const outputFixture = await createRecipeStepFixture(db);
    const outputPath = `recipes/${outputFixture.recipe.id}/step-output-uses`;
    const outputBody = {
      clientMutationId: "output-uses-recovery",
      inputStepId: outputFixture.steps[1].id,
      outputStepNums: [1],
    };
    await reserveRouteMutation(db, outputFixture, {
      method: "PUT",
      path: outputPath,
      body: outputBody,
      operation: "recipes.steps.output-uses.replace",
    });
    const recoveredOutput = await action(routeArgs(
      mutationRequest("PUT", outputPath, outputFixture.writer.token, "req_output_uses_recovery", outputBody),
      outputPath,
    ));
    const outputPayload = await readJson(recoveredOutput);
    expect(recoveredOutput.status).toBe(200);
    expect(outputPayload.data).toMatchObject({
      replaced: true,
      step: { id: outputFixture.steps[1].id, usingSteps: [{ outputStepNum: 1 }] },
    });
    expectMutationShape(outputPayload.data.mutation, outputBody.clientMutationId, true);
  });

  it("rejects in-flight recovery when committed step mutation state is unsafe or incomplete", async () => {
    const ownerMismatch = await createRecipeStepFixture(db);
    const ownerPath = `recipes/${ownerMismatch.recipe.id}/steps/${ownerMismatch.steps[1].id}`;
    const ownerBody = { clientMutationId: "step-update-owner-mismatch", description: "Owner moved." };
    await reserveRouteMutation(db, ownerMismatch, {
      method: "PATCH",
      path: ownerPath,
      body: ownerBody,
      operation: "recipes.steps.update",
    });
    await db.recipe.update({ where: { id: ownerMismatch.recipe.id }, data: { chefId: ownerMismatch.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PATCH", ownerPath, ownerMismatch.writer.token, "req_step_update_owner_mismatch", ownerBody),
      ownerPath,
    )), "req_step_update_owner_mismatch");

    const missingStep = await createRecipeStepFixture(db);
    const missingPath = `recipes/${missingStep.recipe.id}/steps/${missingStep.steps[2].id}`;
    const missingBody = { clientMutationId: "step-update-missing-recovery", description: "Missing step." };
    await reserveRouteMutation(db, missingStep, {
      method: "PATCH",
      path: missingPath,
      body: missingBody,
      operation: "recipes.steps.update",
    });
    await db.recipeStep.delete({ where: { id: missingStep.steps[2].id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PATCH", missingPath, missingStep.writer.token, "req_step_update_missing_recovery", missingBody),
      missingPath,
    )), "req_step_update_missing_recovery");

    for (const [requestId, body, data] of [
      ["step-update-title-mismatch", { stepTitle: "Expected title" }, { stepTitle: "Different title" }],
      ["step-update-description-mismatch", { description: "Expected description" }, { description: "Different description" }],
      ["step-update-duration-mismatch", { duration: 12 }, { duration: 13 }],
    ] as const) {
      const fixture = await createRecipeStepFixture(db);
      const path = `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}`;
      const updateBody = { clientMutationId: requestId, ...body };
      await reserveRouteMutation(db, fixture, {
        method: "PATCH",
        path,
        body: updateBody,
        operation: "recipes.steps.update",
      });
      await db.recipeStep.update({ where: { id: fixture.steps[1].id }, data });
      await expectInProgress(await action(routeArgs(
        mutationRequest("PATCH", path, fixture.writer.token, `req_${requestId}`, updateBody),
        path,
      )), `req_${requestId}`);
    }

    const outputMismatch = await createRecipeStepFixture(db);
    const outputMismatchPath = `recipes/${outputMismatch.recipe.id}/steps/${outputMismatch.steps[1].id}`;
    const outputMismatchBody = { clientMutationId: "step-update-output-mismatch", outputStepNums: [1] };
    await reserveRouteMutation(db, outputMismatch, {
      method: "PATCH",
      path: outputMismatchPath,
      body: outputMismatchBody,
      operation: "recipes.steps.update",
    });
    await db.stepOutputUse.deleteMany({ where: { recipeId: outputMismatch.recipe.id, inputStepNum: 2 } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PATCH", outputMismatchPath, outputMismatch.writer.token, "req_step_update_output_mismatch", outputMismatchBody),
      outputMismatchPath,
    )), "req_step_update_output_mismatch");

    const outputMissingStep = await createRecipeStepFixture(db);
    const outputPath = `recipes/${outputMissingStep.recipe.id}/step-output-uses`;
    const outputBody = {
      clientMutationId: "output-uses-missing-step-recovery",
      inputStepId: outputMissingStep.steps[2].id,
      outputStepNums: [1],
    };
    await reserveRouteMutation(db, outputMissingStep, {
      method: "PUT",
      path: outputPath,
      body: outputBody,
      operation: "recipes.steps.output-uses.replace",
    });
    await db.recipeStep.delete({ where: { id: outputMissingStep.steps[2].id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PUT", outputPath, outputMissingStep.writer.token, "req_output_uses_missing_step_recovery", outputBody),
      outputPath,
    )), "req_output_uses_missing_step_recovery");

    const outputWrongUses = await createRecipeStepFixture(db);
    const outputWrongPath = `recipes/${outputWrongUses.recipe.id}/step-output-uses`;
    const outputWrongBody = {
      clientMutationId: "output-uses-value-mismatch",
      inputStepId: outputWrongUses.steps[1].id,
      outputStepNums: [1],
    };
    await reserveRouteMutation(db, outputWrongUses, {
      method: "PUT",
      path: outputWrongPath,
      body: outputWrongBody,
      operation: "recipes.steps.output-uses.replace",
    });
    await db.stepOutputUse.deleteMany({ where: { recipeId: outputWrongUses.recipe.id, inputStepNum: 2 } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PUT", outputWrongPath, outputWrongUses.writer.token, "req_output_uses_value_mismatch", outputWrongBody),
      outputWrongPath,
    )), "req_output_uses_value_mismatch");

    const deleteStillPresent = await createRecipeStepFixture(db);
    const deleteStillPresentPath = `recipes/${deleteStillPresent.recipe.id}/steps/${deleteStillPresent.steps[2].id}`;
    const deleteStillPresentBody = { clientMutationId: "step-delete-still-present" };
    const deleteStillPresentReservation = await reserveRouteMutation(db, deleteStillPresent, {
      method: "DELETE",
      path: deleteStillPresentPath,
      body: deleteStillPresentBody,
      operation: "recipes.steps.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: deleteStillPresentReservation.id,
        operation: "recipes.steps.delete",
        resourceType: "recipe_step",
        resourceId: deleteStillPresent.steps[2].id,
        parentResourceId: deleteStillPresent.recipe.id,
        payload: JSON.stringify({ recipeId: deleteStillPresent.recipe.id }),
      },
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", deleteStillPresentPath, deleteStillPresent.writer.token, "req_step_delete_still_present", deleteStillPresentBody),
      deleteStillPresentPath,
    )), "req_step_delete_still_present");

    const deleteWrongOwner = await createRecipeStepFixture(db);
    const deleteWrongOwnerPath = `recipes/${deleteWrongOwner.recipe.id}/steps/${deleteWrongOwner.steps[2].id}`;
    const deleteWrongOwnerBody = { clientMutationId: "step-delete-owner-mismatch" };
    const deleteWrongOwnerReservation = await reserveRouteMutation(db, deleteWrongOwner, {
      method: "DELETE",
      path: deleteWrongOwnerPath,
      body: deleteWrongOwnerBody,
      operation: "recipes.steps.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: deleteWrongOwnerReservation.id,
        operation: "recipes.steps.delete",
        resourceType: "recipe_step",
        resourceId: deleteWrongOwner.steps[2].id,
        parentResourceId: deleteWrongOwner.recipe.id,
        payload: JSON.stringify({ recipeId: deleteWrongOwner.recipe.id }),
      },
    });
    await db.recipeStep.delete({ where: { id: deleteWrongOwner.steps[2].id } });
    await db.recipe.update({ where: { id: deleteWrongOwner.recipe.id }, data: { chefId: deleteWrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", deleteWrongOwnerPath, deleteWrongOwner.writer.token, "req_step_delete_owner_mismatch", deleteWrongOwnerBody),
      deleteWrongOwnerPath,
    )), "req_step_delete_owner_mismatch");

    const reorderWrongOwner = await createRecipeStepFixture(db);
    const reorderWrongOwnerPath = `recipes/${reorderWrongOwner.recipe.id}/steps/reorder`;
    const reorderWrongOwnerBody = {
      clientMutationId: "step-reorder-owner-mismatch",
      stepId: reorderWrongOwner.steps[2].id,
      toStepNum: 2,
    };
    await reserveRouteMutation(db, reorderWrongOwner, {
      method: "POST",
      path: reorderWrongOwnerPath,
      body: reorderWrongOwnerBody,
      operation: "recipes.steps.reorder",
    });
    await db.recipeStep.update({ where: { id: reorderWrongOwner.steps[1].id }, data: { stepNum: 99 } });
    await db.recipeStep.update({ where: { id: reorderWrongOwner.steps[2].id }, data: { stepNum: 2 } });
    await db.recipeStep.update({ where: { id: reorderWrongOwner.steps[1].id }, data: { stepNum: 3 } });
    await db.recipe.update({ where: { id: reorderWrongOwner.recipe.id }, data: { chefId: reorderWrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", reorderWrongOwnerPath, reorderWrongOwner.writer.token, "req_step_reorder_owner_mismatch", reorderWrongOwnerBody),
      reorderWrongOwnerPath,
    )), "req_step_reorder_owner_mismatch");

    const outputWrongOwner = await createRecipeStepFixture(db);
    const outputWrongOwnerPath = `recipes/${outputWrongOwner.recipe.id}/step-output-uses`;
    const outputWrongOwnerBody = {
      clientMutationId: "output-uses-owner-mismatch",
      inputStepId: outputWrongOwner.steps[1].id,
      outputStepNums: [1],
    };
    await reserveRouteMutation(db, outputWrongOwner, {
      method: "PUT",
      path: outputWrongOwnerPath,
      body: outputWrongOwnerBody,
      operation: "recipes.steps.output-uses.replace",
    });
    await db.recipe.update({ where: { id: outputWrongOwner.recipe.id }, data: { chefId: outputWrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PUT", outputWrongOwnerPath, outputWrongOwner.writer.token, "req_output_uses_owner_mismatch", outputWrongOwnerBody),
      outputWrongOwnerPath,
    )), "req_output_uses_owner_mismatch");
  });

  it("rejects in-flight ingredient recovery when tombstones or committed ingredient state are unsafe", async () => {
    const missingIngredient = await createRecipeStepFixture(db);
    const missingIngredientPath = `recipes/${missingIngredient.recipe.id}/steps/${missingIngredient.steps[1].id}/ingredients`;
    const missingIngredientBody = {
      clientMutationId: "ingredient-create-missing-recovery",
      quantity: 1,
      unit: "pinch",
      name: "missing recovered ingredient",
    };
    await reserveRouteMutation(db, missingIngredient, {
      method: "POST",
      path: missingIngredientPath,
      body: missingIngredientBody,
      operation: "recipes.steps.ingredients.create",
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", missingIngredientPath, missingIngredient.writer.token, "req_ingredient_create_missing_recovery", missingIngredientBody),
      missingIngredientPath,
    )), "req_ingredient_create_missing_recovery");

    const createWrongOwner = await createRecipeStepFixture(db);
    const createWrongOwnerPath = `recipes/${createWrongOwner.recipe.id}/steps/${createWrongOwner.steps[1].id}/ingredients`;
    const createWrongOwnerBody = {
      clientMutationId: "ingredient-create-owner-mismatch",
      quantity: 1,
      unit: "pinch",
      name: "owner mismatch ingredient",
    };
    const createWrongOwnerReservation = await reserveRouteMutation(db, createWrongOwner, {
      method: "POST",
      path: createWrongOwnerPath,
      body: createWrongOwnerBody,
      operation: "recipes.steps.ingredients.create",
    });
    await createIngredientForStep(db, {
      id: createWrongOwnerReservation.id,
      recipeId: createWrongOwner.recipe.id,
      stepNum: createWrongOwner.steps[1].stepNum,
      quantity: createWrongOwnerBody.quantity,
      unit: createWrongOwnerBody.unit,
      name: createWrongOwnerBody.name,
    });
    await db.recipe.update({ where: { id: createWrongOwner.recipe.id }, data: { chefId: createWrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", createWrongOwnerPath, createWrongOwner.writer.token, "req_ingredient_create_owner_mismatch", createWrongOwnerBody),
      createWrongOwnerPath,
    )), "req_ingredient_create_owner_mismatch");

    for (const [requestId, committed] of [
      ["ingredient-create-quantity-mismatch", { quantity: 2, unit: "pinch", name: "mismatch quantity" }],
      ["ingredient-create-unit-mismatch", { quantity: 1, unit: "dash", name: "mismatch unit" }],
      ["ingredient-create-name-mismatch", { quantity: 1, unit: "pinch", name: "different name" }],
    ] as const) {
      const fixture = await createRecipeStepFixture(db);
      const path = `recipes/${fixture.recipe.id}/steps/${fixture.steps[1].id}/ingredients`;
      const body = {
        clientMutationId: requestId,
        quantity: 1,
        unit: "pinch",
        name: "expected ingredient",
      };
      const reservation = await reserveRouteMutation(db, fixture, {
        method: "POST",
        path,
        body,
        operation: "recipes.steps.ingredients.create",
      });
      await createIngredientForStep(db, {
        id: reservation.id,
        recipeId: fixture.recipe.id,
        stepNum: fixture.steps[1].stepNum,
        ...committed,
      });
      await expectInProgress(await action(routeArgs(
        mutationRequest("POST", path, fixture.writer.token, `req_${requestId}`, body),
        path,
      )), `req_${requestId}`);
    }

    const noTombstone = await createRecipeStepFixture(db);
    const noTombstonePath = `recipes/${noTombstone.recipe.id}/steps/${noTombstone.steps[0].id}/ingredients/${noTombstone.ingredient.id}`;
    const noTombstoneBody = { clientMutationId: "ingredient-delete-no-tombstone" };
    await reserveRouteMutation(db, noTombstone, {
      method: "DELETE",
      path: noTombstonePath,
      body: noTombstoneBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.ingredient.delete({ where: { id: noTombstone.ingredient.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", noTombstonePath, noTombstone.writer.token, "req_ingredient_delete_no_tombstone", noTombstoneBody),
      noTombstonePath,
    )), "req_ingredient_delete_no_tombstone");

    const wrongTombstone = await createRecipeStepFixture(db);
    const wrongTombstonePath = `recipes/${wrongTombstone.recipe.id}/steps/${wrongTombstone.steps[0].id}/ingredients/${wrongTombstone.ingredient.id}`;
    const wrongTombstoneBody = { clientMutationId: "ingredient-delete-wrong-tombstone" };
    const wrongReservation = await reserveRouteMutation(db, wrongTombstone, {
      method: "DELETE",
      path: wrongTombstonePath,
      body: wrongTombstoneBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: wrongReservation.id,
        operation: "recipes.steps.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: wrongTombstone.ingredient.id,
        parentResourceId: wrongTombstone.steps[0].id,
        payload: JSON.stringify({ recipeId: wrongTombstone.recipe.id }),
      },
    });
    await db.ingredient.delete({ where: { id: wrongTombstone.ingredient.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", wrongTombstonePath, wrongTombstone.writer.token, "req_ingredient_delete_wrong_tombstone", wrongTombstoneBody),
      wrongTombstonePath,
    )), "req_ingredient_delete_wrong_tombstone");

    const wrongParent = await createRecipeStepFixture(db);
    const wrongParentPath = `recipes/${wrongParent.recipe.id}/steps/${wrongParent.steps[0].id}/ingredients/${wrongParent.ingredient.id}`;
    const wrongParentBody = { clientMutationId: "ingredient-delete-wrong-parent" };
    const wrongParentReservation = await reserveRouteMutation(db, wrongParent, {
      method: "DELETE",
      path: wrongParentPath,
      body: wrongParentBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: wrongParentReservation.id,
        operation: "recipes.steps.ingredients.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: wrongParent.ingredient.id,
        parentResourceId: wrongParent.steps[1].id,
        payload: JSON.stringify({ recipeId: wrongParent.recipe.id }),
      },
    });
    await db.ingredient.delete({ where: { id: wrongParent.ingredient.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", wrongParentPath, wrongParent.writer.token, "req_ingredient_delete_wrong_parent", wrongParentBody),
      wrongParentPath,
    )), "req_ingredient_delete_wrong_parent");

    const presentIngredient = await createRecipeStepFixture(db);
    const presentPath = `recipes/${presentIngredient.recipe.id}/steps/${presentIngredient.steps[0].id}/ingredients/${presentIngredient.ingredient.id}`;
    const presentBody = { clientMutationId: "ingredient-delete-still-present" };
    const presentReservation = await reserveRouteMutation(db, presentIngredient, {
      method: "DELETE",
      path: presentPath,
      body: presentBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: presentReservation.id,
        operation: "recipes.steps.ingredients.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: presentIngredient.ingredient.id,
        parentResourceId: presentIngredient.steps[0].id,
        payload: JSON.stringify({ recipeId: presentIngredient.recipe.id }),
      },
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", presentPath, presentIngredient.writer.token, "req_ingredient_delete_still_present", presentBody),
      presentPath,
    )), "req_ingredient_delete_still_present");

    const missingStep = await createRecipeStepFixture(db);
    const missingStepPath = `recipes/${missingStep.recipe.id}/steps/${missingStep.steps[2].id}/ingredients/${missingStep.ingredient.id}`;
    const missingStepBody = { clientMutationId: "ingredient-delete-missing-step-recovery" };
    const missingStepReservation = await reserveRouteMutation(db, missingStep, {
      method: "DELETE",
      path: missingStepPath,
      body: missingStepBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: missingStepReservation.id,
        operation: "recipes.steps.ingredients.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: missingStep.ingredient.id,
        parentResourceId: missingStep.steps[2].id,
        payload: JSON.stringify({ recipeId: missingStep.recipe.id }),
      },
    });
    await db.recipeStep.delete({ where: { id: missingStep.steps[2].id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", missingStepPath, missingStep.writer.token, "req_ingredient_delete_missing_step_recovery", missingStepBody),
      missingStepPath,
    )), "req_ingredient_delete_missing_step_recovery");

    const deleteWrongOwner = await createRecipeStepFixture(db);
    const deleteWrongOwnerPath = `recipes/${deleteWrongOwner.recipe.id}/steps/${deleteWrongOwner.steps[0].id}/ingredients/${deleteWrongOwner.ingredient.id}`;
    const deleteWrongOwnerBody = { clientMutationId: "ingredient-delete-owner-mismatch" };
    const deleteWrongOwnerReservation = await reserveRouteMutation(db, deleteWrongOwner, {
      method: "DELETE",
      path: deleteWrongOwnerPath,
      body: deleteWrongOwnerBody,
      operation: "recipes.steps.ingredients.delete",
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: deleteWrongOwnerReservation.id,
        operation: "recipes.steps.ingredients.delete",
        resourceType: "recipe_step_ingredient",
        resourceId: deleteWrongOwner.ingredient.id,
        parentResourceId: deleteWrongOwner.steps[0].id,
        payload: JSON.stringify({ recipeId: deleteWrongOwner.recipe.id }),
      },
    });
    await db.ingredient.delete({ where: { id: deleteWrongOwner.ingredient.id } });
    await db.recipe.update({ where: { id: deleteWrongOwner.recipe.id }, data: { chefId: deleteWrongOwner.otherChef.id } });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", deleteWrongOwnerPath, deleteWrongOwner.writer.token, "req_ingredient_delete_owner_mismatch", deleteWrongOwnerBody),
      deleteWrongOwnerPath,
    )), "req_ingredient_delete_owner_mismatch");
  });

  it("rejects malformed route bodies before reserving step mutations", async () => {
    const fixture = await createRecipeStepFixture(db);

    for (const [requestId, method, path, body] of [
      ["req_step_create_unknown_field", "POST", `recipes/${fixture.recipe.id}/steps`, {
        clientMutationId: "step-create-unknown-field",
        description: "Unknown field.",
        extra: true,
      }],
      ["req_step_patch_unknown_field", "PATCH", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}`, {
        clientMutationId: "step-patch-unknown-field",
        extra: true,
      }],
      ["req_step_delete_missing_mutation", "DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[2].id}`, {}],
      ["req_step_ingredient_create_missing_name", "POST", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients`, {
        clientMutationId: "ingredient-create-missing-name",
        quantity: 1,
        unit: "cup",
      }],
      ["req_step_ingredient_delete_missing_mutation", "DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients/${fixture.ingredient.id}`, {}],
      ["req_step_reorder_blank_step", "POST", `recipes/${fixture.recipe.id}/steps/reorder`, {
        clientMutationId: "step-reorder-blank-step",
        stepId: " ",
        toStepNum: 2,
      }],
      ["req_step_output_uses_blank_input", "PUT", `recipes/${fixture.recipe.id}/step-output-uses`, {
        clientMutationId: "output-uses-blank-input",
        inputStepId: " ",
        outputStepNums: [1],
      }],
    ] as const) {
      const response = await action(routeArgs(
        mutationRequest(method, path, fixture.writer.token, requestId, body),
        path,
      ));
      expect(response.status).toBe(400);
      expectErrorEnvelope(await readJson(response), requestId, "validation_error", 400);
    }
  });

  it("returns an internal error envelope if an ingredient delete reports an unreadable step", async () => {
    const fixture = await createRecipeStepFixture(db);
    const path = `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}/ingredients/${fixture.ingredient.id}`;
    const body = { clientMutationId: "ingredient-delete-unreadable-step" };

    vi.resetModules();
    vi.doMock("~/lib/api-v1-recipe-steps.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/api-v1-recipe-steps.server")>();
      return {
        ...actual,
        deleteNativeRecipeStepIngredient: vi.fn(async (
          _db: unknown,
          _chefId: string,
          recipeId: string,
          _stepId: string,
          ingredientId: string,
        ) => ({
          ok: true,
          status: 200,
          data: {
            recipeId,
            stepId: "missing-after-delete",
            ingredient: { id: ingredientId },
          },
        })),
      };
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { action: mockedAction } = await import("~/routes/api.v1.$");
      const response = await mockedAction(routeArgs(
        mutationRequest("DELETE", path, fixture.writer.token, "req_ingredient_delete_unreadable_step", body),
        path,
      ));
      expect(response.status).toBe(500);
      expectErrorEnvelope(await readJson(response), "req_ingredient_delete_unreadable_step", "internal_error", 500);
      expect(errorSpy).toHaveBeenCalledWith("[api-v1] internal_error", expect.objectContaining({
        requestId: "req_ingredient_delete_unreadable_step",
        method: "DELETE",
        error: expect.objectContaining({
          message: "Recipe step missing-after-delete was not readable after ingredient delete",
        }),
      }));
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock("~/lib/api-v1-recipe-steps.server");
      vi.resetModules();
    }
  });

  it("does not recover reorder idempotency when the recipe step order is corrupted", async () => {
    const fixture = await createRecipeStepFixture(db);
    const path = `recipes/${fixture.recipe.id}/steps/reorder`;
    const body = {
      clientMutationId: "step-reorder-corrupt-recovery",
      stepId: fixture.steps[2].id,
      toStepNum: 2,
    };
    await reserveRouteMutation(db, fixture, {
      method: "POST",
      path,
      body,
      operation: "recipes.steps.reorder",
    });
    await db.stepOutputUse.deleteMany({ where: { recipeId: fixture.recipe.id } });
    await db.recipeStep.update({
      where: { id: fixture.steps[1].id },
      data: { stepNum: 4 },
    });
    await db.recipeStep.update({
      where: { id: fixture.steps[2].id },
      data: { stepNum: 2 },
    });

    const response = await action(routeArgs(
      mutationRequest("POST", path, fixture.writer.token, "req_step_reorder_corrupt_recovery", body),
      path,
    ));
    expect(response.status).toBe(409);
    expectErrorEnvelope(await readJson(response), "req_step_reorder_corrupt_recovery", "idempotency_in_progress", 409);

    const expectUnrecoveredReorderRecovery = async (
      suffix: string,
      payload: string | Record<string, unknown>,
      mutate?: (fixture: Awaited<ReturnType<typeof createRecipeStepFixture>>) => Promise<void>,
    ) => {
      const recoveryFixture = await createRecipeStepFixture(db);
      const recoveryPath = `recipes/${recoveryFixture.recipe.id}/steps/reorder`;
      const recoveryBody = {
        clientMutationId: `step-reorder-${suffix}`,
        stepId: recoveryFixture.steps[1].id,
        toStepNum: 2,
      };
      const reservation = await reserveRouteMutation(db, recoveryFixture, {
        method: "POST",
        path: recoveryPath,
        body: recoveryBody,
        operation: "recipes.steps.reorder",
      });
      await db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: reservation.id,
          operation: "recipes.steps.reorder",
          resourceType: "recipe_step_reorder",
          resourceId: recoveryFixture.steps[1].id,
          parentResourceId: recoveryFixture.recipe.id,
          payload: typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      });
      await mutate?.(recoveryFixture);
      const recoveryResponse = await action(routeArgs(
        mutationRequest("POST", recoveryPath, recoveryFixture.writer.token, `req_step_reorder_${suffix}`, recoveryBody),
        recoveryPath,
      ));
      expect(recoveryResponse.status).toBe(409);
      expectErrorEnvelope(await readJson(recoveryResponse), `req_step_reorder_${suffix}`, "idempotency_in_progress", 409);
    };

    await expectUnrecoveredReorderRecovery("malformed_tombstone", "{");
    await expectUnrecoveredReorderRecovery("target_mismatch", {
      recipeId: "ignored",
      stepId: "ignored",
      toStepNum: 3,
      reordered: false,
    });
    await expectUnrecoveredReorderRecovery("result_mismatch", {
      recipeId: "ignored",
      stepId: "ignored",
      toStepNum: 2,
      reordered: "false",
    });
    await expectUnrecoveredReorderRecovery("missing_recipe", {
      toStepNum: 2,
      reordered: false,
    }, async (recoveryFixture) => {
      await db.recipe.delete({ where: { id: recoveryFixture.recipe.id } });
    });
    await expectUnrecoveredReorderRecovery("wrong_owner", {
      toStepNum: 2,
      reordered: false,
    }, async (recoveryFixture) => {
      await db.recipe.update({ where: { id: recoveryFixture.recipe.id }, data: { chefId: recoveryFixture.otherChef.id } });
    });
    await expectUnrecoveredReorderRecovery("missing_step", {
      toStepNum: 2,
      reordered: false,
    }, async (recoveryFixture) => {
      await db.recipeStep.delete({ where: { id: recoveryFixture.steps[1].id } });
    });
    await expectUnrecoveredReorderRecovery("step_moved_away", {
      toStepNum: 2,
      reordered: false,
    }, async (recoveryFixture) => {
      await db.stepOutputUse.deleteMany({ where: { recipeId: recoveryFixture.recipe.id } });
      await db.recipeStep.update({ where: { id: recoveryFixture.steps[1].id }, data: { stepNum: 99 } });
    });
    await expectUnrecoveredReorderRecovery("noncontiguous_order", {
      toStepNum: 2,
      reordered: false,
    }, async (recoveryFixture) => {
      await db.stepOutputUse.deleteMany({ where: { recipeId: recoveryFixture.recipe.id } });
      await db.recipeStep.update({ where: { id: recoveryFixture.steps[2].id }, data: { stepNum: 4 } });
    });
  });

  it("protects step deletion and reorder operations that would break step-output dependencies", async () => {
    const fixture = await createRecipeStepFixture(db);

    const protectedDelete = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}`, fixture.writer.token, "req_step_delete_protected", {
        clientMutationId: "step-delete-protected",
      }),
      `recipes/${fixture.recipe.id}/steps/${fixture.steps[0].id}`,
    ));
    expect(protectedDelete.status).toBe(400);
    const deletePayload = await readJson(protectedDelete);
    expectErrorEnvelope(deletePayload, "req_step_delete_protected", "validation_error", 400);
    expect(deletePayload.error.details).toMatchObject({
      reason: "step_output_dependency",
      dependentStepNums: [2],
    });

    const protectedReorder = await action(routeArgs(
      mutationRequest("POST", `recipes/${fixture.recipe.id}/steps/reorder`, fixture.writer.token, "req_step_reorder_protected", {
        clientMutationId: "step-reorder-protected",
        stepId: fixture.steps[0].id,
        toStepNum: 3,
      }),
      `recipes/${fixture.recipe.id}/steps/reorder`,
    ));
    expect(protectedReorder.status).toBe(400);
    const reorderPayload = await readJson(protectedReorder);
    expectErrorEnvelope(reorderPayload, "req_step_reorder_protected", "validation_error", 400);
    expect(reorderPayload.error.details).toMatchObject({
      reason: "step_output_dependency",
      blockingStepNums: [2],
    });
  });
});
