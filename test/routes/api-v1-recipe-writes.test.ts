import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "DELETE";

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
};

function routeArgs(request: Request, splat: string, context: Record<string, unknown> = {}) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env: null, ...context } },
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

async function expectInProgress(response: Response, requestId: string) {
  expect(response.status).toBe(409);
  expectErrorEnvelope(await readJson(response), requestId, "idempotency_in_progress", 409);
}

function expectChefShape(chef: Record<string, unknown>) {
  expectExactKeys(chef, ["id", "username"]);
  expect(typeof chef.id).toBe("string");
  expect(typeof chef.username).toBe("string");
}

function expectAttributionShape(attribution: Record<string, any>) {
  expectExactKeys(attribution, ["canonicalUrl", "creditText", "sourceHost", "sourceRecipe", "sourceUrl"]);
  expect(attribution.canonicalUrl).toMatch(/^https:\/\/spoonjoy\.app\/recipes\//);
  expect(typeof attribution.creditText).toBe("string");
  expect(attribution.sourceHost === null || typeof attribution.sourceHost === "string").toBe(true);
  expect(attribution.sourceUrl === null || typeof attribution.sourceUrl === "string").toBe(true);
  if (attribution.sourceRecipe) {
    expectExactKeys(attribution.sourceRecipe, ["canonicalUrl", "chef", "deleted", "href", "id", "title"]);
    expect(typeof attribution.sourceRecipe.id).toBe("string");
    expect(typeof attribution.sourceRecipe.deleted).toBe("boolean");
    if (attribution.sourceRecipe.chef) {
      expectChefShape(attribution.sourceRecipe.chef);
    }
  }
}

function expectRecipeDetailShape(recipe: Record<string, any>) {
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
    "recentSpoons",
    "servings",
    "steps",
    "title",
    "updatedAt",
  ]);
  expect(typeof recipe.id).toBe("string");
  expect(typeof recipe.title).toBe("string");
  expect(recipe.description === null || typeof recipe.description === "string").toBe(true);
  expect(recipe.servings === null || typeof recipe.servings === "string").toBe(true);
  expectChefShape(recipe.chef);
  expect(recipe.href).toBe(`/recipes/${recipe.id}`);
  expect(recipe.canonicalUrl).toBe(`https://spoonjoy.app/recipes/${recipe.id}`);
  expect(typeof recipe.createdAt).toBe("string");
  expect(typeof recipe.updatedAt).toBe("string");
  expectAttributionShape(recipe.attribution);
  expect(Array.isArray(recipe.steps)).toBe(true);
  expect(Array.isArray(recipe.cookbooks)).toBe(true);
  expect(Array.isArray(recipe.recentSpoons)).toBe(true);
  for (const step of recipe.steps) {
    expectExactKeys(step, ["description", "duration", "id", "ingredients", "stepNum", "stepTitle", "usingSteps"]);
    expect(typeof step.id).toBe("string");
    expect(typeof step.stepNum).toBe("number");
    expect(step.stepTitle === null || typeof step.stepTitle === "string").toBe(true);
    expect(typeof step.description).toBe("string");
    expect(step.duration === null || typeof step.duration === "number").toBe(true);
    expect(Array.isArray(step.ingredients)).toBe(true);
    expect(Array.isArray(step.usingSteps)).toBe(true);
    for (const ingredient of step.ingredients) {
      expectExactKeys(ingredient, ["id", "name", "quantity", "unit"]);
      expect(typeof ingredient.id).toBe("string");
      expect(typeof ingredient.name).toBe("string");
      expect(typeof ingredient.quantity).toBe("number");
      expect(typeof ingredient.unit).toBe("string");
    }
  }
}

async function createRecipeWriteFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const otherChef = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, chef.id, "Recipe writer", { scopes: ["kitchen:write"] });
  const reader = await createApiCredential(db, chef.id, "Recipe reader", { scopes: ["recipes:read"] });
  const otherWriter = await createApiCredential(db, otherChef.id, "Other recipe writer", { scopes: ["kitchen:write"] });
  return { chef, otherChef, writer, reader, otherWriter };
}

async function createRecipeGraph(
  db: LocalDb,
  chefId: string,
  options: {
    title?: string;
    description?: string | null;
    servings?: string | null;
    deletedAt?: Date | null;
    sourceUrl?: string | null;
  } = {},
) {
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chefId),
      title: options.title ?? `API Recipe ${faker.string.alphanumeric(8)}`,
      description: options.description ?? "Existing recipe for API mutation tests",
      servings: options.servings ?? "4",
      deletedAt: options.deletedAt ?? null,
      sourceUrl: options.sourceUrl ?? null,
    },
  });
  const firstStep = await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Prep",
      description: "Prep the ingredients.",
      duration: 5,
    },
  });
  await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 2,
      stepTitle: "Finish",
      description: "Finish the dish.",
      duration: 10,
    },
  });
  const unit = await getOrCreateUnit(db, `cup-${faker.string.alphanumeric(6)}`.toLowerCase());
  const ingredientRef = await getOrCreateIngredientRef(db, `flour-${faker.string.alphanumeric(6)}`.toLowerCase());
  await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: firstStep.stepNum,
      quantity: 2,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
  await db.stepOutputUse.create({
    data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 2 },
  });
  return recipe;
}

async function reserveMutation(
  db: LocalDb,
  input: {
    body: { clientMutationId: string };
    credentialId: string;
    method: MutationMethod;
    operation: string;
    path: string;
    userId: string;
  },
) {
  const reservation = await reserveIdempotencyKey(db, {
    userId: input.userId,
    credentialId: input.credentialId,
    clientKey: `chef:${input.userId}`,
    key: input.body.clientMutationId,
    operation: input.operation,
    requestHash: await hashIdempotencyRequest({
      method: input.method,
      path: `/api/v1/${input.path}`,
      body: input.body,
    }),
  });
  if (reservation.status !== "reserved") throw new Error("expected idempotency reservation");
  return reservation.record;
}

describe("API v1 recipe write mutations", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares native recipe write scope rows", () => {
    expect(resolveApiV1ScopeRequirement("POST", "recipes")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(resolveApiV1ScopeRequirement("PATCH", "recipes/recipe-1")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(resolveApiV1ScopeRequirement("DELETE", "recipes/recipe-1")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(resolveApiV1ScopeRequirement("POST", "recipes/recipe-1/fork")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
  });

  it("creates a recipe graph with exact mutation envelope and replay semantics", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const body = {
      clientMutationId: "recipe-create-graph",
      title: `  Native Pancakes ${faker.string.alphanumeric(8)}  `,
      description: "  Breakfast for the native app  ",
      servings: " 4 ",
      steps: [
        {
          stepTitle: " Mix ",
          description: " Mix dry ingredients ",
          duration: 5,
          ingredients: [{ quantity: 2, unit: " Cup ", name: " Flour " }],
        },
        {
          stepTitle: null,
          description: "Cook until golden",
          duration: null,
          ingredients: [],
        },
      ],
    };

    const first = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recipe_create", body),
      "recipes",
    ));
    const firstPayload = await readJson(first);

    expect(first.status).toBe(201);
    expectPrivateEnvelopeHeaders(first, "req_recipe_create");
    expectSuccessEnvelope(firstPayload, "req_recipe_create");
    expectExactKeys(firstPayload.data, ["created", "mutation", "recipe"]);
    expect(firstPayload.data.created).toBe(true);
    expectMutationShape(firstPayload.data.mutation, "recipe-create-graph", false);
    expectRecipeDetailShape(firstPayload.data.recipe);
    expect(firstPayload.data.recipe).toMatchObject({
      title: expect.stringMatching(/^Native Pancakes /),
      description: "Breakfast for the native app",
      servings: "4",
      chef: { id: fixture.chef.id, username: fixture.chef.username },
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
      steps: [
        {
          stepNum: 1,
          stepTitle: "Mix",
          description: "Mix dry ingredients",
          duration: 5,
          ingredients: [{ name: "flour", quantity: 2, unit: "cup" }],
        },
        {
          stepNum: 2,
          stepTitle: null,
          description: "Cook until golden",
          duration: null,
          ingredients: [],
        },
      ],
    });

    const persisted = await db.recipe.findUniqueOrThrow({
      where: { id: firstPayload.data.recipe.id },
      include: { steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } } },
    });
    expect(persisted.chefId).toBe(fixture.chef.id);
    expect(persisted.deletedAt).toBeNull();
    expect(persisted.steps).toHaveLength(2);

    const replay = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recipe_create_replay", body),
      "recipes",
    ));
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(firstPayload);
    expectedReplay.requestId = "req_recipe_create_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(201);
    expectPrivateEnvelopeHeaders(replay, "req_recipe_create_replay");
    expect(replayPayload).toEqual(expectedReplay);
  });

  it("updates owned recipe metadata and rejects duplicate or cross-owner updates", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const recipe = await createRecipeGraph(db, fixture.chef.id, { title: "Before API Update" });
    await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: "Already Taken",
      },
    });

    const duplicate = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${recipe.id}`, fixture.writer.token, "req_recipe_patch_duplicate", {
        clientMutationId: "recipe-update-duplicate",
        title: "  Already Taken  ",
      }),
      `recipes/${recipe.id}`,
    ));
    expect(duplicate.status).toBe(400);
    expectPrivateEnvelopeHeaders(duplicate, "req_recipe_patch_duplicate");
    await expect(readJson(duplicate)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_patch_duplicate",
      error: {
        code: "validation_error",
        status: 400,
        details: { fieldErrors: { title: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } },
      },
    });

    const updateBody = {
      clientMutationId: "recipe-update-metadata",
      title: "  After API Update  ",
      description: null,
      servings: " 6 ",
    };
    const update = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${recipe.id}`, fixture.writer.token, "req_recipe_patch", updateBody),
      `recipes/${recipe.id}`,
    ));
    const updatePayload = await readJson(update);

    expect(update.status).toBe(200);
    expectPrivateEnvelopeHeaders(update, "req_recipe_patch");
    expectSuccessEnvelope(updatePayload, "req_recipe_patch");
    expectExactKeys(updatePayload.data, ["mutation", "recipe", "updated"]);
    expect(updatePayload.data.updated).toBe(true);
    expectMutationShape(updatePayload.data.mutation, "recipe-update-metadata", false);
    expectRecipeDetailShape(updatePayload.data.recipe);
    expect(updatePayload.data.recipe).toMatchObject({
      id: recipe.id,
      title: "After API Update",
      description: null,
      servings: "6",
      steps: expect.any(Array),
    });

    const updateReplay = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${recipe.id}`, fixture.writer.token, "req_recipe_patch_replay", updateBody),
      `recipes/${recipe.id}`,
    ));
    const updateReplayPayload = await readJson(updateReplay);
    const expectedUpdateReplay = structuredClone(updatePayload);
    expectedUpdateReplay.requestId = "req_recipe_patch_replay";
    expectedUpdateReplay.data.mutation.replayed = true;

    expect(updateReplay.status).toBe(200);
    expectPrivateEnvelopeHeaders(updateReplay, "req_recipe_patch_replay");
    expect(updateReplayPayload).toEqual(expectedUpdateReplay);

    const crossOwner = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${recipe.id}`, fixture.otherWriter.token, "req_recipe_patch_cross_owner", {
        clientMutationId: "recipe-update-cross-owner",
        title: "Cross-owner update",
      }),
      `recipes/${recipe.id}`,
    ));
    expect(crossOwner.status).toBe(403);
    expectPrivateEnvelopeHeaders(crossOwner, "req_recipe_patch_cross_owner");
    expectErrorEnvelope(await readJson(crossOwner), "req_recipe_patch_cross_owner", "insufficient_scope", 403);

    const missing = await action(routeArgs(
      mutationRequest("PATCH", "recipes/missing-recipe", fixture.writer.token, "req_recipe_patch_missing", {
        clientMutationId: "recipe-update-missing",
        title: "Missing",
      }),
      "recipes/missing-recipe",
    ));
    expect(missing.status).toBe(404);
    expectPrivateEnvelopeHeaders(missing, "req_recipe_patch_missing");
    expectErrorEnvelope(await readJson(missing), "req_recipe_patch_missing", "not_found", 404);
  });

  it("soft deletes owned recipes with tombstone response, owner checks, and idempotent replay", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const recipe = await createRecipeGraph(db, fixture.chef.id, { title: "Delete Through API" });
    const otherRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Delete Cross Owner" });
    const body = { clientMutationId: "recipe-delete-owned" };

    const crossOwner = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${otherRecipe.id}`, fixture.otherWriter.token, "req_recipe_delete_cross_owner", {
        clientMutationId: "recipe-delete-cross-owner",
      }),
      `recipes/${otherRecipe.id}`,
    ));
    expect(crossOwner.status).toBe(403);
    expectPrivateEnvelopeHeaders(crossOwner, "req_recipe_delete_cross_owner");
    expectErrorEnvelope(await readJson(crossOwner), "req_recipe_delete_cross_owner", "insufficient_scope", 403);

    const first = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${recipe.id}`, fixture.writer.token, "req_recipe_delete", body),
      `recipes/${recipe.id}`,
    ));
    const firstPayload = await readJson(first);

    expect(first.status).toBe(200);
    expectPrivateEnvelopeHeaders(first, "req_recipe_delete");
    expectSuccessEnvelope(firstPayload, "req_recipe_delete");
    expectExactKeys(firstPayload.data, ["deleted", "mutation", "recipe"]);
    expect(firstPayload.data.deleted).toBe(true);
    expectMutationShape(firstPayload.data.mutation, "recipe-delete-owned", false);
    expectExactKeys(firstPayload.data.recipe, ["deletedAt", "id", "updatedAt"]);
    expect(firstPayload.data.recipe).toMatchObject({
      id: recipe.id,
      deletedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } }))
      .resolves.toMatchObject({ deletedAt: expect.any(Date) });

    const replay = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${recipe.id}`, fixture.writer.token, "req_recipe_delete_replay", body),
      `recipes/${recipe.id}`,
    ));
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(firstPayload);
    expectedReplay.requestId = "req_recipe_delete_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(200);
    expectPrivateEnvelopeHeaders(replay, "req_recipe_delete_replay");
    expect(replayPayload).toEqual(expectedReplay);
  });

  it("does not recover deletes for recipes deleted before the idempotency attempt", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const deletedRecipe = await createRecipeGraph(db, fixture.chef.id, {
      title: "Already Deleted Through API",
      deletedAt: new Date(Date.now() - 60_000),
    });

    const response = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${deletedRecipe.id}`, fixture.writer.token, "req_recipe_delete_already_deleted", {
        clientMutationId: "recipe-delete-already-deleted",
      }),
      `recipes/${deletedRecipe.id}`,
    ));

    expect(response.status).toBe(404);
    expectPrivateEnvelopeHeaders(response, "req_recipe_delete_already_deleted");
    expectErrorEnvelope(await readJson(response), "req_recipe_delete_already_deleted", "not_found", 404);
  });

  it("forks recipes with source graph, title suffixing, cover copy, and notification side effects", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const forker = await db.user.create({ data: createTestUser() });
    const source = await createRecipeGraph(db, owner.id, {
      title: "Forkable Pasta",
      description: "Copy me",
      servings: "3",
      sourceUrl: "https://example.com/pasta",
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: source.id,
        imageUrl: "/photos/covers/fork-source.jpg",
        stylizedImageUrl: "/photos/covers/fork-source-stylized.jpg",
        sourceType: "import",
        status: "ready",
        sourceImageUrl: "https://example.com/source.jpg",
        generationStatus: "succeeded",
      },
    });
    await db.recipe.update({
      where: { id: source.id },
      data: { activeCoverId: activeCover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    await db.recipe.create({
      data: {
        ...createTestRecipe(forker.id),
        title: "My Pasta",
      },
    });
    const token = await createApiCredential(db, forker.id, "Fork writer", { scopes: ["kitchen:write"] });
    const captured: Promise<unknown>[] = [];
    const body = { clientMutationId: "recipe-fork-pasta", title: " My Pasta " };

    const response = await action(routeArgs(
      mutationRequest("POST", `recipes/${source.id}/fork`, token.token, "req_recipe_fork", body),
      `recipes/${source.id}/fork`,
      {
        env: VAPID_ENV,
        ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
      },
    ));
    const payload = await readJson(response);
    await Promise.all(captured);

    expect(response.status).toBe(201);
    expectPrivateEnvelopeHeaders(response, "req_recipe_fork");
    expectSuccessEnvelope(payload, "req_recipe_fork");
    expectExactKeys(payload.data, ["fork", "mutation", "recipe"]);
    expectMutationShape(payload.data.mutation, "recipe-fork-pasta", false);
    expectExactKeys(payload.data.fork, ["appliedTitle", "sourceChef", "sourceRecipeId", "titleWasSuffixed"]);
    expect(payload.data.fork).toMatchObject({
      sourceRecipeId: source.id,
      sourceChef: { id: owner.id, username: owner.username },
      appliedTitle: "My Pasta (variation 2)",
      titleWasSuffixed: true,
    });
    expectRecipeDetailShape(payload.data.recipe);
    expect(payload.data.recipe).toMatchObject({
      title: "My Pasta (variation 2)",
      description: "Copy me",
      servings: "3",
      chef: { id: forker.id, username: forker.username },
      coverImageUrl: "https://spoonjoy.app/photos/covers/fork-source-stylized.jpg",
      coverSourceType: "import",
      coverVariant: "stylized",
      attribution: {
        sourceUrl: null,
        sourceRecipe: {
          id: source.id,
          title: "Forkable Pasta",
          deleted: false,
          chef: { id: owner.id, username: owner.username },
        },
      },
    });
    expect(payload.data.recipe.steps).toHaveLength(2);
    await expect(db.stepOutputUse.count({ where: { recipeId: payload.data.recipe.id } })).resolves.toBe(1);
    await expect(db.recipeCover.count({ where: { recipeId: payload.data.recipe.id } })).resolves.toBe(1);
    const events = await db.notificationEvent.findMany({
      where: { recipientId: owner.id, kind: "fork_of_my_recipe" },
    });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toMatchObject({
      sourceRecipeId: source.id,
      forkedRecipeId: payload.data.recipe.id,
      recipeTitle: "My Pasta (variation 2)",
      forkerUsername: forker.username,
    });

    const replayCaptured: Promise<unknown>[] = [];
    const replay = await action(routeArgs(
      mutationRequest("POST", `recipes/${source.id}/fork`, token.token, "req_recipe_fork_replay", body),
      `recipes/${source.id}/fork`,
      {
        env: VAPID_ENV,
        ctx: { waitUntil: (promise: Promise<unknown>) => replayCaptured.push(promise) },
      },
    ));
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(payload);
    expectedReplay.requestId = "req_recipe_fork_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(201);
    expectPrivateEnvelopeHeaders(replay, "req_recipe_fork_replay");
    expect(replayPayload).toEqual(expectedReplay);
    expect(replayCaptured).toHaveLength(0);
    await expect(db.recipe.count({ where: { chefId: forker.id, sourceRecipeId: source.id } })).resolves.toBe(1);
    await expect(db.notificationEvent.count({
      where: { recipientId: owner.id, kind: "fork_of_my_recipe" },
    })).resolves.toBe(1);

    const syncNotificationBody = { clientMutationId: "recipe-fork-sync-notify", title: "My Pasta Sync" };
    const syncNotification = await action(routeArgs(
      mutationRequest("POST", `recipes/${source.id}/fork`, token.token, "req_recipe_fork_sync_notify", syncNotificationBody),
      `recipes/${source.id}/fork`,
      { env: VAPID_ENV },
    ));

    expect(syncNotification.status).toBe(201);
    expectPrivateEnvelopeHeaders(syncNotification, "req_recipe_fork_sync_notify");
    await expect(db.notificationEvent.count({
      where: { recipientId: owner.id, kind: "fork_of_my_recipe" },
    })).resolves.toBe(2);
  });

  it("recovers committed in-flight recipe mutations through the real route callbacks", async () => {
    const fixture = await createRecipeWriteFixture(db);

    const createBody = { clientMutationId: "recover-route-create", title: "Recovered Route Create" };
    const createReservation = await reserveMutation(db, {
      body: createBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "recipes.create",
      path: "recipes",
      userId: fixture.chef.id,
    });
    await db.recipe.create({
      data: { id: createReservation.id, chefId: fixture.chef.id, title: createBody.title },
    });
    const recoveredCreate = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recover_route_create", createBody),
      "recipes",
    ));
    const createPayload = await readJson(recoveredCreate);
    expect(recoveredCreate.status).toBe(201);
    expect(createPayload.data).toMatchObject({
      created: true,
      recipe: { id: createReservation.id, title: createBody.title },
      mutation: { clientMutationId: createBody.clientMutationId, replayed: true },
    });

    const updateRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Recover Route Update Source" });
    const updateBody = {
      clientMutationId: "recover-route-update",
      title: "Recover Route Updated",
      description: null,
      servings: "8",
    };
    await reserveMutation(db, {
      body: updateBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "recipes.update",
      path: `recipes/${updateRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({
      where: { id: updateRecipe.id },
      data: { title: updateBody.title, description: updateBody.description, servings: updateBody.servings },
    });
    const recoveredUpdate = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${updateRecipe.id}`, fixture.writer.token, "req_recover_route_update", updateBody),
      `recipes/${updateRecipe.id}`,
    ));
    const updatePayload = await readJson(recoveredUpdate);
    expect(recoveredUpdate.status).toBe(200);
    expect(updatePayload.data).toMatchObject({
      updated: true,
      recipe: { id: updateRecipe.id, title: updateBody.title, description: null, servings: "8" },
      mutation: { clientMutationId: updateBody.clientMutationId, replayed: true },
    });

    const descriptionMismatchBody = {
      clientMutationId: "recover-route-update-description-mismatch",
      title: "Description Match Title",
      description: "Expected description",
      servings: "3",
    };
    const descriptionMismatchRecipe = await createRecipeGraph(db, fixture.chef.id, {
      title: "Description Mismatch Source",
    });
    await reserveMutation(db, {
      body: descriptionMismatchBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "recipes.update",
      path: `recipes/${descriptionMismatchRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({
      where: { id: descriptionMismatchRecipe.id },
      data: {
        title: descriptionMismatchBody.title,
        description: "Different description",
        servings: descriptionMismatchBody.servings,
      },
    });
    const descriptionMismatch = await action(routeArgs(
      mutationRequest(
        "PATCH",
        `recipes/${descriptionMismatchRecipe.id}`,
        fixture.writer.token,
        "req_recover_route_update_description_mismatch",
        descriptionMismatchBody,
      ),
      `recipes/${descriptionMismatchRecipe.id}`,
    ));
    expect(descriptionMismatch.status).toBe(409);
    expectErrorEnvelope(
      await readJson(descriptionMismatch),
      "req_recover_route_update_description_mismatch",
      "idempotency_in_progress",
      409,
    );

    const servingsMismatchBody = {
      clientMutationId: "recover-route-update-servings-mismatch",
      title: "Servings Match Title",
      description: "Matching description",
      servings: "12",
    };
    const servingsMismatchRecipe = await createRecipeGraph(db, fixture.chef.id, {
      title: "Servings Mismatch Source",
    });
    await reserveMutation(db, {
      body: servingsMismatchBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "recipes.update",
      path: `recipes/${servingsMismatchRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({
      where: { id: servingsMismatchRecipe.id },
      data: {
        title: servingsMismatchBody.title,
        description: servingsMismatchBody.description,
        servings: "Different servings",
      },
    });
    const servingsMismatch = await action(routeArgs(
      mutationRequest(
        "PATCH",
        `recipes/${servingsMismatchRecipe.id}`,
        fixture.writer.token,
        "req_recover_route_update_servings_mismatch",
        servingsMismatchBody,
      ),
      `recipes/${servingsMismatchRecipe.id}`,
    ));
    expect(servingsMismatch.status).toBe(409);
    expectErrorEnvelope(
      await readJson(servingsMismatch),
      "req_recover_route_update_servings_mismatch",
      "idempotency_in_progress",
      409,
    );

    const deleteRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Recover Route Delete Source" });
    const deleteBody = { clientMutationId: "recover-route-delete" };
    await reserveMutation(db, {
      body: deleteBody,
      credentialId: fixture.writer.credential.id,
      method: "DELETE",
      operation: "recipes.delete",
      path: `recipes/${deleteRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({ where: { id: deleteRecipe.id }, data: { deletedAt: new Date() } });
    const recoveredDelete = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${deleteRecipe.id}`, fixture.writer.token, "req_recover_route_delete", deleteBody),
      `recipes/${deleteRecipe.id}`,
    ));
    const deletePayload = await readJson(recoveredDelete);
    expect(recoveredDelete.status).toBe(200);
    expect(deletePayload.data).toMatchObject({
      deleted: true,
      recipe: { id: deleteRecipe.id, deletedAt: expect.any(String), updatedAt: expect.any(String) },
      mutation: { clientMutationId: deleteBody.clientMutationId, replayed: true },
    });

    const source = await createRecipeGraph(db, fixture.otherChef.id, { title: "Recover Fork Source" });
    const forkBody = { clientMutationId: "recover-route-fork", title: "Recover Forked" };
    const forkReservation = await reserveMutation(db, {
      body: forkBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "recipes.fork",
      path: `recipes/${source.id}/fork`,
      userId: fixture.chef.id,
    });
    await db.recipe.create({
      data: {
        id: forkReservation.id,
        chefId: fixture.chef.id,
        sourceRecipeId: source.id,
        title: forkBody.title,
      },
    });
    const recoveredFork = await action(routeArgs(
      mutationRequest("POST", `recipes/${source.id}/fork`, fixture.writer.token, "req_recover_route_fork", forkBody),
      `recipes/${source.id}/fork`,
    ));
    const forkPayload = await readJson(recoveredFork);
    expect(recoveredFork.status).toBe(201);
    expect(forkPayload.data).toMatchObject({
      fork: {
        appliedTitle: forkBody.title,
        sourceChef: { id: fixture.otherChef.id, username: fixture.otherChef.username },
        sourceRecipeId: source.id,
        titleWasSuffixed: false,
      },
      recipe: { id: forkReservation.id, title: forkBody.title },
      mutation: { clientMutationId: forkBody.clientMutationId, replayed: true },
    });

    const sourceTitleForkBody = { clientMutationId: "recover-route-fork-source-title" };
    const sourceTitleForkReservation = await reserveMutation(db, {
      body: sourceTitleForkBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "recipes.fork",
      path: `recipes/${source.id}/fork`,
      userId: fixture.chef.id,
    });
    await db.recipe.create({
      data: {
        id: sourceTitleForkReservation.id,
        chefId: fixture.chef.id,
        sourceRecipeId: source.id,
        title: source.title,
      },
    });
    const recoveredSourceTitleFork = await action(routeArgs(
      mutationRequest(
        "POST",
        `recipes/${source.id}/fork`,
        fixture.writer.token,
        "req_recover_route_fork_source_title",
        sourceTitleForkBody,
      ),
      `recipes/${source.id}/fork`,
    ));
    const sourceTitleForkPayload = await readJson(recoveredSourceTitleFork);
    expect(recoveredSourceTitleFork.status).toBe(201);
    expect(sourceTitleForkPayload.data).toMatchObject({
      fork: { appliedTitle: source.title, titleWasSuffixed: false },
      recipe: { id: sourceTitleForkReservation.id, title: source.title },
      mutation: { clientMutationId: sourceTitleForkBody.clientMutationId, replayed: true },
    });

    const noCloudflareForkBody = { clientMutationId: "recover-route-fork-no-cloudflare", title: "No Cloudflare Fork" };
    const noCloudflareFork = await action({
      request: mutationRequest(
        "POST",
        `recipes/${source.id}/fork`,
        fixture.writer.token,
        "req_recover_route_fork_no_cloudflare",
        noCloudflareForkBody,
      ),
      params: { "*": `recipes/${source.id}/fork` },
      context: {},
    } as never);
    expect(noCloudflareFork.status).toBe(201);
  });

  it("rejects incomplete recipe recovery when committed state is missing or mismatched", async () => {
    const fixture = await createRecipeWriteFixture(db);

    const createWrongOwnerBody = { clientMutationId: "recover-create-wrong-owner", title: "Wrong Owner Create" };
    const createWrongOwnerReservation = await reserveMutation(db, {
      body: createWrongOwnerBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "recipes.create",
      path: "recipes",
      userId: fixture.chef.id,
    });
    await db.recipe.create({
      data: { id: createWrongOwnerReservation.id, chefId: fixture.otherChef.id, title: createWrongOwnerBody.title },
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recover_create_wrong_owner", createWrongOwnerBody),
      "recipes",
    )), "req_recover_create_wrong_owner");

    const updateWrongOwnerRecipe = await createRecipeGraph(db, fixture.otherChef.id, { title: "Wrong Owner Update Source" });
    const updateWrongOwnerBody = { clientMutationId: "recover-update-wrong-owner", title: "Wrong Owner Update" };
    await reserveMutation(db, {
      body: updateWrongOwnerBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "recipes.update",
      path: `recipes/${updateWrongOwnerRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({
      where: { id: updateWrongOwnerRecipe.id },
      data: { title: updateWrongOwnerBody.title },
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PATCH", `recipes/${updateWrongOwnerRecipe.id}`, fixture.writer.token, "req_recover_update_wrong_owner", updateWrongOwnerBody),
      `recipes/${updateWrongOwnerRecipe.id}`,
    )), "req_recover_update_wrong_owner");

    const titleMismatchRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Title Mismatch Source" });
    const titleMismatchBody = { clientMutationId: "recover-update-title-mismatch", title: "Expected Recovered Title" };
    await reserveMutation(db, {
      body: titleMismatchBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "recipes.update",
      path: `recipes/${titleMismatchRecipe.id}`,
      userId: fixture.chef.id,
    });
    await db.recipe.update({
      where: { id: titleMismatchRecipe.id },
      data: { title: "Different recovered title" },
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("PATCH", `recipes/${titleMismatchRecipe.id}`, fixture.writer.token, "req_recover_update_title_mismatch", titleMismatchBody),
      `recipes/${titleMismatchRecipe.id}`,
    )), "req_recover_update_title_mismatch");

    const notDeletedRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Not Deleted Recovery Source" });
    const notDeletedBody = { clientMutationId: "recover-delete-not-deleted" };
    await reserveMutation(db, {
      body: notDeletedBody,
      credentialId: fixture.writer.credential.id,
      method: "DELETE",
      operation: "recipes.delete",
      path: `recipes/${notDeletedRecipe.id}`,
      userId: fixture.chef.id,
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", `recipes/${notDeletedRecipe.id}`, fixture.writer.token, "req_recover_delete_not_deleted", notDeletedBody),
      `recipes/${notDeletedRecipe.id}`,
    )), "req_recover_delete_not_deleted");

    const staleDeletedRecipe = await createRecipeGraph(db, fixture.chef.id, {
      title: "Stale Deleted Recovery Source",
      deletedAt: new Date(Date.now() - 60_000),
    });
    const staleDeletedBody = { clientMutationId: "recover-delete-stale" };
    await reserveMutation(db, {
      body: staleDeletedBody,
      credentialId: fixture.writer.credential.id,
      method: "DELETE",
      operation: "recipes.delete",
      path: `recipes/${staleDeletedRecipe.id}`,
      userId: fixture.chef.id,
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("DELETE", `recipes/${staleDeletedRecipe.id}`, fixture.writer.token, "req_recover_delete_stale", staleDeletedBody),
      `recipes/${staleDeletedRecipe.id}`,
    )), "req_recover_delete_stale");

    const source = await createRecipeGraph(db, fixture.otherChef.id, { title: "Missing Fork Recovery Source" });
    const forkMissingBody = { clientMutationId: "recover-fork-missing", title: "Missing Fork" };
    await reserveMutation(db, {
      body: forkMissingBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "recipes.fork",
      path: `recipes/${source.id}/fork`,
      userId: fixture.chef.id,
    });
    await expectInProgress(await action(routeArgs(
      mutationRequest("POST", `recipes/${source.id}/fork`, fixture.writer.token, "req_recover_fork_missing", forkMissingBody),
      `recipes/${source.id}/fork`,
    )), "req_recover_fork_missing");
  });

  it("validates mutation bodies, duplicate titles, deleted fork sources, auth, and scope before writes", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const recipe = await createRecipeGraph(db, fixture.chef.id, { title: "Validation Target" });

    const missingAuth = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_recipe_missing_auth" },
      body: JSON.stringify({ clientMutationId: "missing-auth", unexpected: true }),
    }) as unknown as Request, "recipes"));
    expect(missingAuth.status).toBe(401);
    expectPrivateEnvelopeHeaders(missingAuth, "req_recipe_missing_auth");
    expectErrorEnvelope(await readJson(missingAuth), "req_recipe_missing_auth", "authentication_required", 401);

    const insufficient = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.reader.token, "req_recipe_missing_write_scope", {
        clientMutationId: "missing-scope",
        unexpected: true,
      }),
      "recipes",
    ));
    expect(insufficient.status).toBe(403);
    expectPrivateEnvelopeHeaders(insufficient, "req_recipe_missing_write_scope");
    expectErrorEnvelope(await readJson(insufficient), "req_recipe_missing_write_scope", "insufficient_scope", 403);

    const validationCases = [
      {
        method: "POST" as const,
        path: "recipes",
        requestId: "req_recipe_create_unknown_field",
        body: { clientMutationId: "bad-create-extra", title: "Soup", extra: true },
      },
      {
        method: "POST" as const,
        path: "recipes",
        requestId: "req_recipe_create_missing_client_mutation",
        body: { title: "Soup" },
      },
      {
        method: "POST" as const,
        path: "recipes",
        requestId: "req_recipe_create_blank_title",
        body: { clientMutationId: "blank-title", title: " " },
      },
      {
        method: "POST" as const,
        path: "recipes",
        requestId: "req_recipe_create_bad_step",
        body: {
          clientMutationId: "bad-step",
          title: "Soup",
          steps: [{ description: "Mix", duration: 0 }],
        },
      },
      {
        method: "PATCH" as const,
        path: `recipes/${recipe.id}`,
        requestId: "req_recipe_patch_unknown_field",
        body: { clientMutationId: "bad-patch-extra", title: "Soup", extra: true },
      },
      {
        method: "DELETE" as const,
        path: `recipes/${recipe.id}`,
        requestId: "req_recipe_delete_unknown_field",
        body: { clientMutationId: "bad-delete-extra", extra: true },
      },
      {
        method: "POST" as const,
        path: `recipes/${recipe.id}/fork`,
        requestId: "req_recipe_fork_blank_client_mutation",
        body: { clientMutationId: " ", title: "Fork" },
      },
    ];

    for (const testCase of validationCases) {
      const response = await action(routeArgs(
        mutationRequest(testCase.method, testCase.path, fixture.writer.token, testCase.requestId, testCase.body),
        testCase.path,
      ));
      expect(response.status).toBe(400);
      expectPrivateEnvelopeHeaders(response, testCase.requestId);
      expectErrorEnvelope(await readJson(response), testCase.requestId, "validation_error", 400);
    }

    await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: "Duplicate API Dinner",
      },
    });
    const duplicate = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recipe_create_duplicate_title", {
        clientMutationId: "duplicate-title",
        title: " Duplicate API Dinner ",
      }),
      "recipes",
    ));
    expect(duplicate.status).toBe(400);
    expectPrivateEnvelopeHeaders(duplicate, "req_recipe_create_duplicate_title");
    await expect(readJson(duplicate)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_create_duplicate_title",
      error: {
        code: "validation_error",
        status: 400,
        details: { fieldErrors: { title: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } },
      },
    });

    const deletedSource = await createRecipeGraph(db, fixture.otherChef.id, {
      title: "Deleted Fork Source",
      deletedAt: new Date(),
    });
    const deletedFork = await action(routeArgs(
      mutationRequest("POST", `recipes/${deletedSource.id}/fork`, fixture.writer.token, "req_recipe_fork_deleted_source", {
        clientMutationId: "fork-deleted-source",
      }),
      `recipes/${deletedSource.id}/fork`,
    ));
    expect(deletedFork.status).toBe(404);
    expectPrivateEnvelopeHeaders(deletedFork, "req_recipe_fork_deleted_source");
    expectErrorEnvelope(await readJson(deletedFork), "req_recipe_fork_deleted_source", "not_found", 404);
  });

  it("rejects recipe idempotency conflicts across bodies, paths, and operations", async () => {
    const fixture = await createRecipeWriteFixture(db);
    const firstRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Idempotency One" });
    const secondRecipe = await createRecipeGraph(db, fixture.chef.id, { title: "Idempotency Two" });
    const createBody = {
      clientMutationId: "recipe-idem-create",
      title: `Idempotent Create ${faker.string.alphanumeric(8)}`,
    };

    const create = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recipe_idem_create", createBody),
      "recipes",
    ));
    expect(create.status).toBe(201);

    const differentCreateBody = await action(routeArgs(
      mutationRequest("POST", "recipes", fixture.writer.token, "req_recipe_idem_create_body_conflict", {
        ...createBody,
        title: `Different ${faker.string.alphanumeric(8)}`,
      }),
      "recipes",
    ));
    expect(differentCreateBody.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentCreateBody, "req_recipe_idem_create_body_conflict");
    expectErrorEnvelope(await readJson(differentCreateBody), "req_recipe_idem_create_body_conflict", "idempotency_conflict", 409);

    const patchBody = { clientMutationId: "recipe-idem-patch", title: "Patched Once" };
    const patch = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${firstRecipe.id}`, fixture.writer.token, "req_recipe_idem_patch", patchBody),
      `recipes/${firstRecipe.id}`,
    ));
    expect(patch.status).toBe(200);

    const differentPath = await action(routeArgs(
      mutationRequest("PATCH", `recipes/${secondRecipe.id}`, fixture.writer.token, "req_recipe_idem_patch_path_conflict", patchBody),
      `recipes/${secondRecipe.id}`,
    ));
    expect(differentPath.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentPath, "req_recipe_idem_patch_path_conflict");
    expectErrorEnvelope(await readJson(differentPath), "req_recipe_idem_patch_path_conflict", "idempotency_conflict", 409);

    const differentOperation = await action(routeArgs(
      mutationRequest("DELETE", `recipes/${firstRecipe.id}`, fixture.writer.token, "req_recipe_idem_operation_conflict", {
        clientMutationId: "recipe-idem-patch",
      }),
      `recipes/${firstRecipe.id}`,
    ));
    expect(differentOperation.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentOperation, "req_recipe_idem_operation_conflict");
    expectErrorEnvelope(await readJson(differentOperation), "req_recipe_idem_operation_conflict", "idempotency_conflict", 409);
  });
});
