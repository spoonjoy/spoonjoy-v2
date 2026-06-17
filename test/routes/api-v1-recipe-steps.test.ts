import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
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

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
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
