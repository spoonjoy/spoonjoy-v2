import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, idempotencyClientKey, reserveIdempotencyKey } from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createCookbookTitle, createTestRecipe, createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "DELETE";

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
};

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = VAPID_ENV) {
  const scheduled: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => {
    scheduled.push(promise);
  };

  return {
    args: {
      request,
      params: { "*": splat },
      context: { cloudflare: { env, ctx: { waitUntil } } },
    },
    scheduled,
  } as const;
}

function bearerHeaders(token: string, requestId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Request-Id": requestId,
    ...extra,
  };
}

function mutationRequest(
  method: MutationMethod,
  pathSuffix: string,
  token: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method,
    headers: bearerHeaders(token, requestId, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function unauthenticatedMutationRequest(
  method: MutationMethod,
  pathSuffix: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method,
    headers: { "X-Request-Id": requestId, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function deleteRequest(pathSuffix: string, token: string, requestId: string, clientMutationId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method: "DELETE",
    headers: bearerHeaders(token, requestId, { "X-Client-Mutation-Id": clientMutationId }),
  }) as unknown as Request;
}

function deleteQueryRequest(pathSuffix: string, token: string, requestId: string, clientMutationId: string) {
  const url = new URL(`http://localhost/api/v1/${pathSuffix}`);
  url.searchParams.set("clientMutationId", clientMutationId);
  return new UndiciRequest(url, {
    method: "DELETE",
    headers: bearerHeaders(token, requestId),
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectBaseEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expectBaseEnvelopeHeaders(response, requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: Record<string, any>, requestId: string) {
  expectExactKeys(payload, ["data", "ok", "requestId"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(payload: Record<string, any>, requestId: string, code: string, status: number) {
  expectExactKeys(payload, ["error", "ok", "requestId"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

function expectMutationShape(mutation: Record<string, unknown>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

function expectCookbookSummaryShape(cookbook: Record<string, any>) {
  expectExactKeys(cookbook, [
    "attribution",
    "canonicalUrl",
    "chef",
    "coverImageUrls",
    "createdAt",
    "href",
    "id",
    "recipeCount",
    "title",
    "updatedAt",
  ]);
  expectExactKeys(cookbook.chef, ["id", "username"]);
  expectExactKeys(cookbook.attribution, ["canonicalUrl", "creditText"]);
  expect(cookbook.href).toBe(`/cookbooks/${cookbook.id}`);
  expect(cookbook.canonicalUrl).toBe(`https://spoonjoy.app/cookbooks/${cookbook.id}`);
  expect(cookbook.attribution.canonicalUrl).toBe(cookbook.canonicalUrl);
  expect(Array.isArray(cookbook.coverImageUrls)).toBe(true);
}

function expectCookbookDetailShape(cookbook: Record<string, any>) {
  expectExactKeys(cookbook, [
    "attribution",
    "canonicalUrl",
    "chef",
    "coverImageUrls",
    "createdAt",
    "href",
    "id",
    "recipeCount",
    "recipes",
    "title",
    "updatedAt",
  ]);
  expectCookbookSummaryShape(Object.fromEntries(Object.entries(cookbook).filter(([key]) => key !== "recipes")));
  expect(Array.isArray(cookbook.recipes)).toBe(true);
}

function expectCreateCookbookData(data: Record<string, any>, clientMutationId: string, created: boolean, replayed = false) {
  expectExactKeys(data, ["cookbook", "created", "mutation"]);
  expect(data.created).toBe(created);
  expectCookbookDetailShape(data.cookbook);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function expectUpdateCookbookData(data: Record<string, any>, clientMutationId: string, replayed = false) {
  expectExactKeys(data, ["cookbook", "mutation", "updated"]);
  expect(data.updated).toBe(true);
  expectCookbookDetailShape(data.cookbook);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function expectDeleteCookbookData(data: Record<string, any>, clientMutationId: string, replayed = false) {
  expectExactKeys(data, ["cookbook", "deleted", "mutation"]);
  expect(data.deleted).toBe(true);
  expectExactKeys(data.cookbook, ["deletedAt", "id", "title"]);
  expect(typeof data.cookbook.deletedAt).toBe("string");
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function expectCookbookRecipeMutationData(
  data: Record<string, any>,
  clientMutationId: string,
  key: "added" | "removed",
  value: boolean,
  replayed = false,
) {
  const expectedKeys = key === "added"
    ? ["added", "cookbook", "mutation"]
    : ["cookbook", "mutation", "removed"];
  expectExactKeys(data, expectedKeys);
  expect(data[key]).toBe(value);
  expectCookbookDetailShape(data.cookbook);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

async function expectInProgress(response: Response, requestId: string) {
  expect(response.status).toBe(409);
  expectPrivateEnvelopeHeaders(response, requestId);
  expect(response.headers.get("Retry-After")).toBe("2");
  expectErrorEnvelope(await readJson(response), requestId, "idempotency_in_progress", 409);
}

async function createFixture(db: LocalDb) {
  const owner = await db.user.create({ data: createTestUser() });
  const other = await db.user.create({ data: createTestUser() });
  const recipeOwner = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, owner.id, "Cookbook Writer", { scopes: ["kitchen:write", "cookbooks:read"] });
  const reader = await createApiCredential(db, owner.id, "Cookbook Reader", { scopes: ["cookbooks:read"] });
  const otherWriter = await createApiCredential(db, other.id, "Other Cookbook Writer", { scopes: ["kitchen:write"] });
  const ownRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `Owner Cookbook Recipe ${faker.string.alphanumeric(8)}`,
    },
  });
  const otherRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(recipeOwner.id),
      title: `Other Chef Recipe ${faker.string.alphanumeric(8)}`,
    },
  });
  const deletedRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(recipeOwner.id),
      title: `Deleted Cookbook Recipe ${faker.string.alphanumeric(8)}`,
      deletedAt: new Date(),
    },
  });
  const cookbook = await db.cookbook.create({
    data: { title: createCookbookTitle(), authorId: owner.id },
  });

  return { owner, other, recipeOwner, writer, reader, otherWriter, ownRecipe, otherRecipe, deletedRecipe, cookbook };
}

async function reserveCookbookMutation(
  db: LocalDb,
  input: {
    body: Record<string, unknown> & { clientMutationId: string };
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
    clientKey: idempotencyClientKey({ id: input.userId, source: "bearer", credentialId: input.credentialId }),
    key: input.body.clientMutationId,
    operation: input.operation,
    requestHash: await hashIdempotencyRequest({
      method: input.method,
      path: `/api/v1/${input.path}`,
      body: input.body,
    }),
  });
  if (reservation.status !== "reserved") throw new Error(`expected reserved idempotency key, got ${reservation.status}`);
  return reservation.record;
}

describe("API v1 cookbook write mutations", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares cookbook write routes as authenticated kitchen mutations", () => {
    expect(resolveApiV1ScopeRequirement("POST", "cookbooks")).toEqual({ auth: "bearer", scopes: ["kitchen:write"] });
    expect(resolveApiV1ScopeRequirement("PATCH", "cookbooks/cookbook_1")).toEqual({ auth: "bearer", scopes: ["kitchen:write"] });
    expect(resolveApiV1ScopeRequirement("DELETE", "cookbooks/cookbook_1")).toEqual({ auth: "bearer", scopes: ["kitchen:write"] });
    expect(resolveApiV1ScopeRequirement("POST", "cookbooks/cookbook_1/recipes/recipe_1")).toEqual({ auth: "bearer", scopes: ["kitchen:write"] });
    expect(resolveApiV1ScopeRequirement("DELETE", "cookbooks/cookbook_1/recipes/recipe_1")).toEqual({ auth: "bearer", scopes: ["kitchen:write"] });
  });

  it("creates cookbooks with trimmed titles, exact mutation envelopes, and replay semantics", async () => {
    const fixture = await createFixture(db);
    const body = { clientMutationId: "cookbook-create-family", title: "  Family Table  " };

    const first = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_create", body),
      "cookbooks",
    ).args);
    const firstPayload = await readJson(first);

    expect(first.status).toBe(201);
    expectPrivateEnvelopeHeaders(first, "req_cookbook_create");
    expectSuccessEnvelope(firstPayload, "req_cookbook_create");
    expectCreateCookbookData(firstPayload.data, body.clientMutationId, true);
    expect(firstPayload.data.cookbook).toMatchObject({
      title: "Family Table",
      chef: { id: fixture.owner.id, username: fixture.owner.username },
      recipeCount: 0,
      recipes: [],
      coverImageUrls: [],
    });

    const replay = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_create_replay", body),
      "cookbooks",
    ).args);
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(firstPayload);
    expectedReplay.requestId = "req_cookbook_create_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(201);
    expectPrivateEnvelopeHeaders(replay, "req_cookbook_create_replay");
    expect(replayPayload).toEqual(expectedReplay);
    await expect(db.cookbook.count({ where: { authorId: fixture.owner.id, title: "Family Table" } })).resolves.toBe(1);
  });

  it("updates owned cookbook titles and rejects duplicate or cross-owner updates", async () => {
    const fixture = await createFixture(db);
    const duplicate = await db.cookbook.create({
      data: { title: "Already Mine", authorId: fixture.owner.id },
    });
    const body = { clientMutationId: "cookbook-update-title", title: "  Picnic Binder  " };

    const updated = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_update", body),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    const payload = await readJson(updated);

    expect(updated.status).toBe(200);
    expectPrivateEnvelopeHeaders(updated, "req_cookbook_update");
    expectUpdateCookbookData(payload.data, body.clientMutationId);
    expect(payload.data.cookbook.title).toBe("Picnic Binder");

    const replay = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_update_replay", body),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(payload);
    expectedReplay.requestId = "req_cookbook_update_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(200);
    expect(replayPayload).toEqual(expectedReplay);

    const duplicateResponse = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_update_duplicate", {
        clientMutationId: "cookbook-update-duplicate",
        title: duplicate.title,
      }),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    expect(duplicateResponse.status).toBe(400);
    expectPrivateEnvelopeHeaders(duplicateResponse, "req_cookbook_update_duplicate");
    expectErrorEnvelope(await readJson(duplicateResponse), "req_cookbook_update_duplicate", "validation_error", 400);

    const crossOwner = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.otherWriter.token, "req_cookbook_update_cross_owner", {
        clientMutationId: "cookbook-update-cross-owner",
        title: "Nope",
      }),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    expect(crossOwner.status).toBe(403);
    expectPrivateEnvelopeHeaders(crossOwner, "req_cookbook_update_cross_owner");
    expectErrorEnvelope(await readJson(crossOwner), "req_cookbook_update_cross_owner", "insufficient_scope", 403);
  });

  it("deletes owned cookbooks idempotently, cascading links without deleting recipes", async () => {
    const fixture = await createFixture(db);
    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: fixture.ownRecipe.id, addedById: fixture.owner.id },
    });
    const body = { clientMutationId: "cookbook-delete-owned" };

    const first = await action(routeArgs(
      mutationRequest("DELETE", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_delete", body),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    const payload = await readJson(first);

    expect(first.status).toBe(200);
    expectPrivateEnvelopeHeaders(first, "req_cookbook_delete");
    expectDeleteCookbookData(payload.data, body.clientMutationId);
    expect(payload.data.cookbook).toMatchObject({ id: fixture.cookbook.id, title: fixture.cookbook.title });
    await expect(db.cookbook.findUnique({ where: { id: fixture.cookbook.id } })).resolves.toBeNull();
    await expect(db.recipeInCookbook.count({ where: { cookbookId: fixture.cookbook.id } })).resolves.toBe(0);
    await expect(db.recipe.findUnique({ where: { id: fixture.ownRecipe.id } })).resolves.not.toBeNull();

    const replay = await action(routeArgs(
      mutationRequest("DELETE", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_delete_replay", body),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(payload);
    expectedReplay.requestId = "req_cookbook_delete_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(200);
    expect(replayPayload).toEqual(expectedReplay);

    const missing = await action(routeArgs(
      mutationRequest("DELETE", "cookbooks/missing-cookbook", fixture.writer.token, "req_cookbook_delete_missing", {
        clientMutationId: "cookbook-delete-missing",
      }),
      "cookbooks/missing-cookbook",
    ).args);
    expect(missing.status).toBe(404);
    expectPrivateEnvelopeHeaders(missing, "req_cookbook_delete_missing");
    expectErrorEnvelope(await readJson(missing), "req_cookbook_delete_missing", "not_found", 404);

    const queryFallbackCookbook = await db.cookbook.create({
      data: { title: createCookbookTitle(), authorId: fixture.owner.id },
    });
    const queryFallback = await action(routeArgs(
      deleteQueryRequest(
        `cookbooks/${queryFallbackCookbook.id}`,
        fixture.writer.token,
        "req_cookbook_delete_query_fallback",
        "cookbook-delete-query-fallback",
      ),
      `cookbooks/${queryFallbackCookbook.id}`,
    ).args);
    const queryFallbackPayload = await readJson(queryFallback);
    expect(queryFallback.status).toBe(200);
    expectPrivateEnvelopeHeaders(queryFallback, "req_cookbook_delete_query_fallback");
    expectDeleteCookbookData(queryFallbackPayload.data, "cookbook-delete-query-fallback");
    expect(queryFallbackPayload.data.cookbook).toMatchObject({ id: queryFallbackCookbook.id });
  });

  it("adds and removes active recipes with idempotency, detail refresh, and cookbook-save notifications", async () => {
    const fixture = await createFixture(db);
    const addBody = { clientMutationId: "cookbook-add-recipe" };

    const firstAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_add_recipe",
        addBody,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const addPayload = await readJson(firstAdd);

    expect(firstAdd.status).toBe(201);
    expectPrivateEnvelopeHeaders(firstAdd, "req_cookbook_add_recipe");
    expectCookbookRecipeMutationData(addPayload.data, addBody.clientMutationId, "added", true);
    expect(addPayload.data.cookbook.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([fixture.otherRecipe.id]);
    await expect(db.notificationEvent.findMany({
      where: { recipientId: fixture.recipeOwner.id, kind: "cookbook_save_of_mine" },
    })).resolves.toHaveLength(1);

    const replayAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_add_recipe_replay",
        addBody,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const replayAddPayload = await readJson(replayAdd);
    const expectedAddReplay = structuredClone(addPayload);
    expectedAddReplay.requestId = "req_cookbook_add_recipe_replay";
    expectedAddReplay.data.mutation.replayed = true;

    expect(replayAdd.status).toBe(201);
    expect(replayAddPayload).toEqual(expectedAddReplay);
    await expect(db.notificationEvent.count({
      where: { recipientId: fixture.recipeOwner.id, kind: "cookbook_save_of_mine" },
    })).resolves.toBe(1);

    const idempotentReAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_add_recipe_existing",
        { clientMutationId: "cookbook-add-existing" },
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const idempotentReAddPayload = await readJson(idempotentReAdd);
    expect(idempotentReAdd.status).toBe(200);
    expectCookbookRecipeMutationData(idempotentReAddPayload.data, "cookbook-add-existing", "added", false);
    await expect(db.notificationEvent.count({
      where: { recipientId: fixture.recipeOwner.id, kind: "cookbook_save_of_mine" },
    })).resolves.toBe(1);

    const removeBody = { clientMutationId: "cookbook-remove-recipe" };
    const firstRemove = await action(routeArgs(
      mutationRequest(
        "DELETE",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_remove_recipe",
        removeBody,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const removePayload = await readJson(firstRemove);

    expect(firstRemove.status).toBe(200);
    expectPrivateEnvelopeHeaders(firstRemove, "req_cookbook_remove_recipe");
    expectCookbookRecipeMutationData(removePayload.data, removeBody.clientMutationId, "removed", true);
    expect(removePayload.data.cookbook.recipes).toEqual([]);
    await expect(db.recipe.findUnique({ where: { id: fixture.otherRecipe.id } })).resolves.not.toBeNull();

    const replayRemove = await action(routeArgs(
      mutationRequest(
        "DELETE",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_remove_recipe_replay",
        removeBody,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const replayRemovePayload = await readJson(replayRemove);
    const expectedRemoveReplay = structuredClone(removePayload);
    expectedRemoveReplay.requestId = "req_cookbook_remove_recipe_replay";
    expectedRemoveReplay.data.mutation.replayed = true;

    expect(replayRemove.status).toBe(200);
    expect(replayRemovePayload).toEqual(expectedRemoveReplay);

    const idempotentRemove = await action(routeArgs(
      deleteRequest(
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_remove_recipe_existing_header",
        "cookbook-remove-existing",
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const idempotentRemovePayload = await readJson(idempotentRemove);
    expect(idempotentRemove.status).toBe(200);
    expectCookbookRecipeMutationData(idempotentRemovePayload.data, "cookbook-remove-existing", "removed", false);

    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: fixture.ownRecipe.id, addedById: fixture.owner.id },
    });
    const queryFallbackRemove = await action(routeArgs(
      deleteQueryRequest(
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_remove_recipe_query_fallback",
        "cookbook-remove-query-fallback",
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`,
    ).args);
    const queryFallbackRemovePayload = await readJson(queryFallbackRemove);
    expect(queryFallbackRemove.status).toBe(200);
    expectPrivateEnvelopeHeaders(queryFallbackRemove, "req_cookbook_remove_recipe_query_fallback");
    expectCookbookRecipeMutationData(queryFallbackRemovePayload.data, "cookbook-remove-query-fallback", "removed", true);
    expect(queryFallbackRemovePayload.data.cookbook.recipes).toEqual([]);
  });

  it("validates auth, scope, title, recipe state, and owner checks before writes", async () => {
    const fixture = await createFixture(db);

    const unauthenticated = await action(routeArgs(
      unauthenticatedMutationRequest("POST", "cookbooks", "req_cookbook_create_unauth", {
        clientMutationId: "cookbook-create-unauth",
        title: "Unauth",
      }),
      "cookbooks",
    ).args);
    expect(unauthenticated.status).toBe(401);
    expectPrivateEnvelopeHeaders(unauthenticated, "req_cookbook_create_unauth");
    expectErrorEnvelope(await readJson(unauthenticated), "req_cookbook_create_unauth", "authentication_required", 401);

    const insufficient = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.reader.token, "req_cookbook_create_scope", {
        clientMutationId: "cookbook-create-scope",
        title: "Nope",
      }),
      "cookbooks",
    ).args);
    expect(insufficient.status).toBe(403);
    expectPrivateEnvelopeHeaders(insufficient, "req_cookbook_create_scope");
    expectErrorEnvelope(await readJson(insufficient), "req_cookbook_create_scope", "insufficient_scope", 403);

    for (const [requestId, method, path, body] of [
      ["req_cookbook_create_blank", "POST", "cookbooks", { clientMutationId: "cookbook-create-blank", title: "  " }],
      ["req_cookbook_create_title_type", "POST", "cookbooks", { clientMutationId: "cookbook-create-title-type", title: 12 }],
      ["req_cookbook_create_mutation_id_long", "POST", "cookbooks", { clientMutationId: "x".repeat(161), title: "Too Long Mutation" }],
      ["req_cookbook_update_blank", "PATCH", `cookbooks/${fixture.cookbook.id}`, { clientMutationId: "cookbook-update-blank", title: "" }],
      ["req_cookbook_update_unknown", "PATCH", `cookbooks/${fixture.cookbook.id}`, { clientMutationId: "cookbook-update-unknown", unknown: true }],
      ["req_cookbook_delete_missing_mutation", "DELETE", `cookbooks/${fixture.cookbook.id}`, {}],
      ["req_cookbook_add_unknown_body", "POST", `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`, { clientMutationId: "cookbook-add-unknown", unknown: true }],
      ["req_cookbook_remove_missing_mutation", "DELETE", `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`, {}],
    ] as const) {
      const response = await action(routeArgs(
        mutationRequest(method, path, fixture.writer.token, requestId, body),
        path,
      ).args);
      expect(response.status).toBe(400);
      expectPrivateEnvelopeHeaders(response, requestId);
      expectErrorEnvelope(await readJson(response), requestId, "validation_error", 400);
    }

    const duplicateCreate = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_create_duplicate", {
        clientMutationId: "cookbook-create-duplicate",
        title: fixture.cookbook.title,
      }),
      "cookbooks",
    ).args);
    expect(duplicateCreate.status).toBe(400);
    expectPrivateEnvelopeHeaders(duplicateCreate, "req_cookbook_create_duplicate");
    expectErrorEnvelope(await readJson(duplicateCreate), "req_cookbook_create_duplicate", "validation_error", 400);

    const addDeletedRecipe = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.deletedRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_add_deleted_recipe",
        { clientMutationId: "cookbook-add-deleted-recipe" },
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.deletedRecipe.id}`,
    ).args);
    expect(addDeletedRecipe.status).toBe(404);
    expectPrivateEnvelopeHeaders(addDeletedRecipe, "req_cookbook_add_deleted_recipe");
    expectErrorEnvelope(await readJson(addDeletedRecipe), "req_cookbook_add_deleted_recipe", "not_found", 404);

    const addMissingRecipe = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/missing-recipe`,
        fixture.writer.token,
        "req_cookbook_add_missing_recipe",
        { clientMutationId: "cookbook-add-missing-recipe" },
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/missing-recipe`,
    ).args);
    expect(addMissingRecipe.status).toBe(404);
    expectPrivateEnvelopeHeaders(addMissingRecipe, "req_cookbook_add_missing_recipe");
    expectErrorEnvelope(await readJson(addMissingRecipe), "req_cookbook_add_missing_recipe", "not_found", 404);

    const crossOwnerAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`,
        fixture.otherWriter.token,
        "req_cookbook_add_cross_owner",
        { clientMutationId: "cookbook-add-cross-owner" },
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.ownRecipe.id}`,
    ).args);
    expect(crossOwnerAdd.status).toBe(403);
    expectPrivateEnvelopeHeaders(crossOwnerAdd, "req_cookbook_add_cross_owner");
    expectErrorEnvelope(await readJson(crossOwnerAdd), "req_cookbook_add_cross_owner", "insufficient_scope", 403);
  });

  it("recovers committed in-flight cookbook mutations through the real route callbacks", async () => {
    const fixture = await createFixture(db);

    const createBody = { clientMutationId: "cookbook-recover-create", title: "Recovered Cookbook" };
    const createReservation = await reserveCookbookMutation(db, {
      body: createBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "cookbooks.create",
      path: "cookbooks",
      userId: fixture.owner.id,
    });
    await db.cookbook.create({
      data: { id: createReservation.id, title: createBody.title, authorId: fixture.owner.id },
    });
    const recoveredCreate = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_recover_create", createBody),
      "cookbooks",
    ).args);
    const createPayload = await readJson(recoveredCreate);
    expect(recoveredCreate.status).toBe(201);
    expectCreateCookbookData(createPayload.data, createBody.clientMutationId, true, true);
    expect(createPayload.data).toMatchObject({
      cookbook: { id: createReservation.id, title: createBody.title },
      mutation: { replayed: true },
    });

    const updateBody = { clientMutationId: "cookbook-recover-update", title: "Recovered Rename" };
    await reserveCookbookMutation(db, {
      body: updateBody,
      credentialId: fixture.writer.credential.id,
      method: "PATCH",
      operation: "cookbooks.update",
      path: `cookbooks/${fixture.cookbook.id}`,
      userId: fixture.owner.id,
    });
    await db.cookbook.update({
      where: { id: fixture.cookbook.id },
      data: { title: updateBody.title },
    });
    const recoveredUpdate = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_recover_update", updateBody),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    const updatePayload = await readJson(recoveredUpdate);
    expect(recoveredUpdate.status).toBe(200);
    expectUpdateCookbookData(updatePayload.data, updateBody.clientMutationId, true);
    expect(updatePayload.data).toMatchObject({
      cookbook: { id: fixture.cookbook.id, title: updateBody.title },
      mutation: { replayed: true },
    });

    const deleteCookbook = await db.cookbook.create({
      data: { title: createCookbookTitle(), authorId: fixture.owner.id },
    });
    const deleteBody = { clientMutationId: "cookbook-recover-delete" };
    const deleteReservation = await reserveCookbookMutation(db, {
      body: deleteBody,
      credentialId: fixture.writer.credential.id,
      method: "DELETE",
      operation: "cookbooks.delete",
      path: `cookbooks/${deleteCookbook.id}`,
      userId: fixture.owner.id,
    });
    const deletedAt = new Date(deleteReservation.createdAt.getTime() + 1000);
    await db.$transaction([
      db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: deleteReservation.id,
          operation: "cookbooks.delete",
          resourceType: "cookbook",
          resourceId: deleteCookbook.id,
          payload: JSON.stringify({ title: deleteCookbook.title, deletedAt: deletedAt.toISOString() }),
        },
      }),
      db.cookbook.delete({ where: { id: deleteCookbook.id } }),
    ]);
    const recoveredDelete = await action(routeArgs(
      deleteRequest(`cookbooks/${deleteCookbook.id}`, fixture.writer.token, "req_cookbook_recover_delete", deleteBody.clientMutationId),
      `cookbooks/${deleteCookbook.id}`,
    ).args);
    const deletePayload = await readJson(recoveredDelete);
    expect(recoveredDelete.status).toBe(200);
    expectDeleteCookbookData(deletePayload.data, deleteBody.clientMutationId, true);
    expect(deletePayload.data).toMatchObject({
      cookbook: { id: deleteCookbook.id, title: deleteCookbook.title, deletedAt: deletedAt.toISOString() },
      mutation: { replayed: true },
    });

    const addBody = { clientMutationId: "cookbook-recover-add" };
    const addReservation = await reserveCookbookMutation(db, {
      body: addBody,
      credentialId: fixture.writer.credential.id,
      method: "POST",
      operation: "cookbooks.recipes.add",
      path: `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
      userId: fixture.owner.id,
    });
    await db.recipeInCookbook.create({
      data: {
        id: addReservation.id,
        cookbookId: fixture.cookbook.id,
        recipeId: fixture.otherRecipe.id,
        addedById: fixture.owner.id,
      },
    });
    const recoveredAdd = await action(routeArgs(
      mutationRequest(
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_recover_add",
        addBody,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const addPayload = await readJson(recoveredAdd);
    expect(recoveredAdd.status).toBe(201);
    expectCookbookRecipeMutationData(addPayload.data, addBody.clientMutationId, "added", true, true);
    expect(addPayload.data).toMatchObject({
      cookbook: { id: fixture.cookbook.id, recipes: [expect.objectContaining({ id: fixture.otherRecipe.id })] },
      mutation: { replayed: true },
    });

    const removeBody = { clientMutationId: "cookbook-recover-remove" };
    const removeReservation = await reserveCookbookMutation(db, {
      body: removeBody,
      credentialId: fixture.writer.credential.id,
      method: "DELETE",
      operation: "cookbooks.recipes.remove",
      path: `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
      userId: fixture.owner.id,
    });
    await db.$transaction([
      db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: removeReservation.id,
          operation: "cookbooks.recipes.remove",
          resourceType: "recipe_in_cookbook",
          resourceId: fixture.otherRecipe.id,
          parentResourceId: fixture.cookbook.id,
        },
      }),
      db.recipeInCookbook.delete({ where: { id: addReservation.id } }),
    ]);
    const recoveredRemove = await action(routeArgs(
      deleteRequest(
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
        fixture.writer.token,
        "req_cookbook_recover_remove",
        removeBody.clientMutationId,
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.otherRecipe.id}`,
    ).args);
    const removePayload = await readJson(recoveredRemove);
    expect(recoveredRemove.status).toBe(200);
    expectCookbookRecipeMutationData(removePayload.data, removeBody.clientMutationId, "removed", true, true);
    expect(removePayload.data).toMatchObject({
      cookbook: { id: fixture.cookbook.id, recipes: [] },
      mutation: { replayed: true },
    });
  });

  it("rejects cookbook idempotency conflicts across bodies, paths, operations, and in-progress reservations", async () => {
    const fixture = await createFixture(db);
    const createBody = { clientMutationId: "cookbook-conflict-create", title: "Conflict Cookbook" };
    const first = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_conflict_create", createBody),
      "cookbooks",
    ).args);
    expect(first.status).toBe(201);

    const differentCreateBody = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_conflict_body", {
        ...createBody,
        title: "Different Cookbook",
      }),
      "cookbooks",
    ).args);
    expect(differentCreateBody.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentCreateBody, "req_cookbook_conflict_body");
    expectErrorEnvelope(await readJson(differentCreateBody), "req_cookbook_conflict_body", "idempotency_conflict", 409);

    const firstPatchBody = { clientMutationId: "cookbook-conflict-patch", title: "First Patch" };
    const patch = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_conflict_patch", firstPatchBody),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    expect(patch.status).toBe(200);
    const otherCookbook = await db.cookbook.create({
      data: { title: "Other Patch Cookbook", authorId: fixture.owner.id },
    });
    const differentPath = await action(routeArgs(
      mutationRequest("PATCH", `cookbooks/${otherCookbook.id}`, fixture.writer.token, "req_cookbook_conflict_path", firstPatchBody),
      `cookbooks/${otherCookbook.id}`,
    ).args);
    expect(differentPath.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentPath, "req_cookbook_conflict_path");
    expectErrorEnvelope(await readJson(differentPath), "req_cookbook_conflict_path", "idempotency_conflict", 409);

    const differentOperation = await action(routeArgs(
      mutationRequest("DELETE", `cookbooks/${fixture.cookbook.id}`, fixture.writer.token, "req_cookbook_conflict_operation", {
        clientMutationId: firstPatchBody.clientMutationId,
      }),
      `cookbooks/${fixture.cookbook.id}`,
    ).args);
    expect(differentOperation.status).toBe(409);
    expectPrivateEnvelopeHeaders(differentOperation, "req_cookbook_conflict_operation");
    expectErrorEnvelope(await readJson(differentOperation), "req_cookbook_conflict_operation", "idempotency_conflict", 409);

    const inProgressBody = { clientMutationId: "cookbook-in-progress", title: "In Progress" };
    const inProgressPath = "/api/v1/cookbooks";
    const inProgressRequestHash = await hashIdempotencyRequest({
      method: "POST",
      path: inProgressPath,
      body: inProgressBody,
    });
    const reserve = await db.apiIdempotencyKey.create({
      data: {
        userId: fixture.owner.id,
        credentialId: fixture.writer.credential.id,
        clientKey: idempotencyClientKey({ id: fixture.owner.id, source: "bearer", credentialId: fixture.writer.credential.id }),
        key: inProgressBody.clientMutationId,
        operation: "cookbooks.create",
        requestHash: inProgressRequestHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(reserve.responseStatus).toBeNull();
    const inProgress = await action(routeArgs(
      mutationRequest("POST", "cookbooks", fixture.writer.token, "req_cookbook_in_progress", inProgressBody),
      "cookbooks",
    ).args);
    await expectInProgress(inProgress, "req_cookbook_in_progress");
  });
});
