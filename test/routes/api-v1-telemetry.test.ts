import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, idempotencyClientKey, IDEMPOTENCY_TTL_MS } from "~/lib/api-idempotency.server";
import { captureEvent } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createCookbookTitle, createTestRecipe, createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

function routeArgs(request: Request, splat: string) {
  const scheduled: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    scheduled.push(promise);
  });

  return {
    args: {
      request,
      params: { "*": splat },
      context: {
        cloudflare: {
          env: { POSTHOG_KEY: "ph_test" },
          ctx: { waitUntil, passThroughOnException: vi.fn() },
        },
      },
    },
    waitUntil,
    scheduled,
  } as const;
}

function publicRequest(url: string, requestId: string) {
  return new UndiciRequest(url, {
    headers: {
      "X-Request-Id": requestId,
      Origin: "https://client.example",
      Referer: "https://docs.example/start?token=secret",
      Cookie: "session=secret",
      "User-Agent": "PebbleKit/4.4 (tiny-device)",
    },
  }) as unknown as Request;
}

function apiRequest(url: string, requestId: string, headers: Record<string, string> = {}) {
  return new UndiciRequest(url, {
    headers: {
      "X-Request-Id": requestId,
      Origin: "https://client.example",
      Referer: "https://docs.example/start?token=secret",
      "User-Agent": "curl/8.7.1 SpoonjoyTelemetryTest",
      ...headers,
    },
  }) as unknown as Request;
}

function apiJsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  requestId: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyText).byteLength;
  return {
    bodyText,
    bodyBytes,
    request: new UndiciRequest(`http://localhost/api/v1/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodyBytes),
        "X-Request-Id": requestId,
        Origin: "https://client.example",
        Referer: "https://docs.example/start?token=secret",
        "User-Agent": "PostmanRuntime/7.39.0",
        ...headers,
      },
      body: bodyText,
    }) as unknown as Request,
  };
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0]!;
}

function captureInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectSafeApiV1Event(routeTemplate: string, requestId: string) {
  const input = captureInputs().find((candidate) => (
    candidate.event === "spoonjoy.api_v1.request" &&
    candidate.properties?.route_template === routeTemplate &&
    candidate.properties?.request_id === requestId
  ));

  expect(input).toMatchObject({
    event: "spoonjoy.api_v1.request",
    distinctId: "anon",
    properties: {
      route_template: routeTemplate,
      method: "GET",
      status: 200,
      request_id: requestId,
      auth_mode: "anonymous",
      request_bytes: 0,
      privacy_class: "public",
      origin_host: "client.example",
      referrer_host: "docs.example",
      user_agent_family: "pebble",
      latency_ms: expect.any(Number),
    },
  });

  const serialized = JSON.stringify(input);
  expect(serialized).not.toContain("token=secret");
  expect(serialized).not.toContain("session=secret");
  expect(serialized).not.toContain("PebbleKit/4.4");
  return input;
}

function expectAuthenticatedApiV1Event(input: {
  routeTemplate: string;
  requestId: string;
  authMode: "session" | "bearer" | "oauth_bearer";
  principalId: string;
  credentialId?: string;
  oauthClientId?: string;
  oauthResource?: string | null;
  scopes: readonly string[];
  forbidden: readonly string[];
}) {
  const eventInput = captureInputs().find((candidate) => (
    candidate.event === "spoonjoy.api_v1.request" &&
    candidate.properties?.route_template === input.routeTemplate &&
    candidate.properties?.request_id === input.requestId
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.api_v1.request",
    distinctId: input.principalId,
    properties: {
      route_template: input.routeTemplate,
      method: "GET",
      status: 200,
      request_id: input.requestId,
      auth_mode: input.authMode,
      principal_id: input.principalId,
      request_bytes: 0,
      privacy_class: "authenticated",
      origin_host: "client.example",
      referrer_host: "docs.example",
      user_agent_family: "curl",
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
  expect(properties.scopes).toEqual(expect.arrayContaining([...input.scopes]));
  if (input.credentialId) {
    expect(properties.credential_id).toBe(input.credentialId);
  } else {
    expect(properties.credential_id).toBeUndefined();
  }
  if (input.oauthClientId) {
    expect(properties.oauth_client_id).toBe(input.oauthClientId);
    expect(properties.oauth_resource).toBe(input.oauthResource ?? null);
  } else {
    expect(properties.oauth_client_id).toBeUndefined();
    expect(properties.oauth_resource).toBeUndefined();
  }

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("token=secret");
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("__session=");
  return eventInput;
}

function expectApiV1OperationEvent(input: {
  routeTemplate: string;
  requestId: string;
  operation: string;
  status: number;
  authMode: "session" | "bearer" | "oauth_bearer";
  requestBytes: number;
  errorCode?: string;
  idempotencyOutcome?: string;
  forbidden: readonly string[];
}) {
  const eventInput = captureInputs().find((candidate) => (
    candidate.event === "spoonjoy.api_v1.request" &&
    candidate.properties?.route_template === input.routeTemplate &&
    candidate.properties?.request_id === input.requestId
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.api_v1.request",
    properties: {
      route_template: input.routeTemplate,
      operation: input.operation,
      status: input.status,
      request_id: input.requestId,
      auth_mode: input.authMode,
      request_bytes: input.requestBytes,
      user_agent_family: "postman",
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
  if (input.errorCode) {
    expect(properties.error_code).toBe(input.errorCode);
  } else {
    expect(properties.error_code).toBeUndefined();
  }
  if (input.idempotencyOutcome) {
    expect(properties.idempotency_outcome).toBe(input.idempotencyOutcome);
  } else {
    expect(properties.idempotency_outcome).toBeUndefined();
  }

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("token=secret");
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("clientMutationId");
  return eventInput;
}

async function createRecipeFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const chef = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `Telemetry Pasta ${faker.string.alphanumeric(8)}`,
      description: "Private wording must not reach analytics.",
    },
  });
  return { chef, recipe };
}

async function createCookbookFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const fixture = await createRecipeFixture(db);
  const cookbook = await db.cookbook.create({
    data: { title: createCookbookTitle(), authorId: fixture.chef.id },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: cookbook.id, recipeId: fixture.recipe.id, addedById: fixture.chef.id },
  });
  return { ...fixture, cookbook };
}

describe("API v1 public telemetry", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("captures root, health, and OpenAPI discovery requests with safe anonymous metadata", async () => {
    for (const [url, splat, routeTemplate, requestId] of [
      ["http://localhost/api/v1", "", "/api/v1", "req_api_root"],
      ["http://localhost/api/v1/health", "health", "/api/v1/health", "req_api_health"],
      ["http://localhost/api/v1/openapi.json", "openapi.json", "/api/v1/openapi.json", "req_api_openapi"],
    ] as const) {
      const context = routeArgs(publicRequest(url, requestId), splat);
      const response = await loader(context.args);

      expect(response.status).toBe(200);
      expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
      expectSafeApiV1Event(routeTemplate, requestId);
    }
  });

  it("captures public recipe list/detail requests without query strings or recipe text", async () => {
    const fixture = await createRecipeFixture(db);
    const list = routeArgs(
      publicRequest("http://localhost/api/v1/recipes?query=Telemetry%20Pasta&limit=1", "req_recipe_public_list"),
      "recipes",
    );
    const detail = routeArgs(
      publicRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}`, "req_recipe_public_detail"),
      `recipes/${fixture.recipe.id}`,
    );

    expect((await loader(list.args)).status).toBe(200);
    expect((await loader(detail.args)).status).toBe(200);

    expectSafeApiV1Event("/api/v1/recipes", "req_recipe_public_list");
    expectSafeApiV1Event("/api/v1/recipes/{id}", "req_recipe_public_detail");
    const serialized = JSON.stringify(captureInputs());
    expect(serialized).not.toContain("Telemetry Pasta");
    expect(serialized).not.toContain(fixture.recipe.title);
    expect(serialized).not.toContain(fixture.recipe.description);
  });

  it("captures public cookbook list/detail requests without query strings or cookbook text", async () => {
    const fixture = await createCookbookFixture(db);
    const list = routeArgs(
      publicRequest("http://localhost/api/v1/cookbooks?query=Telemetry%20Cookbook&limit=1", "req_cookbook_public_list"),
      "cookbooks",
    );
    const detail = routeArgs(
      publicRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, "req_cookbook_public_detail"),
      `cookbooks/${fixture.cookbook.id}`,
    );

    expect((await loader(list.args)).status).toBe(200);
    expect((await loader(detail.args)).status).toBe(200);

    expectSafeApiV1Event("/api/v1/cookbooks", "req_cookbook_public_list");
    expectSafeApiV1Event("/api/v1/cookbooks/{id}", "req_cookbook_public_detail");
    const serialized = JSON.stringify(captureInputs());
    expect(serialized).not.toContain("Telemetry Cookbook");
    expect(serialized).not.toContain(fixture.cookbook.title);
  });
});

describe("API v1 mutation and validation telemetry", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("captures shopping-list item create, check, and delete operations without body values", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Shopping Writer", {
      scopes: ["shopping_list:write"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const name = `Telemetry Kale ${faker.string.alphanumeric(8)}`;
    const unit = `bundle ${faker.string.alphanumeric(8)}`;
    const createBody = {
      clientMutationId: "raw-create-mutation-id",
      name,
      quantity: 2,
      unit,
      categoryKey: "produce",
      iconKey: "greens",
    };
    const create = apiJsonRequest("POST", "shopping-list/items", "req_mutation_create", auth, createBody);
    const createResponse = await action(routeArgs(create.request, "shopping-list/items").args);
    const createPayload = await createResponse.json() as { data: { item: { id: string } } };

    expect(createResponse.status).toBe(201);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items",
      requestId: "req_mutation_create",
      operation: "shopping-list.items.create",
      status: 201,
      authMode: "bearer",
      requestBytes: create.bodyBytes,
      idempotencyOutcome: "committed",
      forbidden: [
        name,
        unit,
        "raw-create-mutation-id",
        create.bodyText,
        credential.token,
        credential.credential.tokenPrefix,
      ],
    });

    const checkBody = { clientMutationId: "raw-check-mutation-id", checked: true };
    const check = apiJsonRequest(
      "PATCH",
      `shopping-list/items/${createPayload.data.item.id}`,
      "req_mutation_check",
      auth,
      checkBody,
    );
    const checkResponse = await action(routeArgs(check.request, `shopping-list/items/${createPayload.data.item.id}`).args);

    expect(checkResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items/{itemId}",
      requestId: "req_mutation_check",
      operation: "shopping-list.items.check",
      status: 200,
      authMode: "bearer",
      requestBytes: check.bodyBytes,
      idempotencyOutcome: "committed",
      forbidden: ["raw-check-mutation-id", createPayload.data.item.id, check.bodyText],
    });

    const deleteBody = { clientMutationId: "raw-delete-mutation-id" };
    const remove = apiJsonRequest(
      "DELETE",
      `shopping-list/items/${createPayload.data.item.id}`,
      "req_mutation_delete",
      auth,
      deleteBody,
    );
    const removeResponse = await action(routeArgs(remove.request, `shopping-list/items/${createPayload.data.item.id}`).args);

    expect(removeResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items/{itemId}",
      requestId: "req_mutation_delete",
      operation: "shopping-list.items.delete",
      status: 200,
      authMode: "bearer",
      requestBytes: remove.bodyBytes,
      idempotencyOutcome: "committed",
      forbidden: ["raw-delete-mutation-id", createPayload.data.item.id, remove.bodyText],
    });
  });

  it("captures token list, create, and revoke operations without credential names or secrets", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const target = await createApiCredential(db, user.id, "Telemetry Target Token", { scopes: ["recipes:read"] });
    const listResponse = await loader(routeArgs(apiRequest("http://localhost/api/v1/tokens", "req_tokens_operation_list", {
      Cookie: cookie,
      "User-Agent": "PostmanRuntime/7.39.0",
    }), "tokens").args);

    expect(listResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/tokens",
      requestId: "req_tokens_operation_list",
      operation: "tokens.list",
      status: 200,
      authMode: "session",
      requestBytes: 0,
      idempotencyOutcome: "none",
      forbidden: [
        "Telemetry Target Token",
        target.token,
        target.credential.tokenPrefix,
        cookie,
      ],
    });

    const createdName = `Telemetry Created Token ${faker.string.alphanumeric(8)}`;
    const create = apiJsonRequest("POST", "tokens", "req_tokens_operation_create", { Cookie: cookie }, {
      name: createdName,
      scopes: ["recipes:read"],
    });
    const createResponse = await action(routeArgs(create.request, "tokens").args);
    const createPayload = await createResponse.json() as {
      data: { token: string; credential: { id: string; tokenPrefix: string } };
    };

    expect(createResponse.status).toBe(201);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/tokens",
      requestId: "req_tokens_operation_create",
      operation: "tokens.create",
      status: 201,
      authMode: "session",
      requestBytes: create.bodyBytes,
      idempotencyOutcome: "none",
      forbidden: [
        createdName,
        createPayload.data.token,
        createPayload.data.credential.tokenPrefix,
        create.bodyText,
      ],
    });

    const revoke = apiJsonRequest(
      "DELETE",
      `tokens/${createPayload.data.credential.id}`,
      "req_tokens_operation_revoke",
      { Cookie: cookie },
      {},
    );
    const revokeResponse = await action(routeArgs(revoke.request, `tokens/${createPayload.data.credential.id}`).args);

    expect(revokeResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/tokens/{credentialId}",
      requestId: "req_tokens_operation_revoke",
      operation: "tokens.revoke",
      status: 200,
      authMode: "session",
      requestBytes: revoke.bodyBytes,
      idempotencyOutcome: "none",
      forbidden: [
        createdName,
        createPayload.data.credential.id,
        createPayload.data.credential.tokenPrefix,
        revoke.bodyText,
      ],
    });
  });

  it("captures idempotency replay, in-progress, and conflict outcomes without mutation ids", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Idempotency Writer", {
      scopes: ["shopping_list:write"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const replayBody = {
      clientMutationId: "raw-replay-mutation-id",
      name: `Replay Rice ${faker.string.alphanumeric(8)}`,
    };
    const first = apiJsonRequest("POST", "shopping-list/items", "req_idempotency_first", auth, replayBody);
    expect((await action(routeArgs(first.request, "shopping-list/items").args)).status).toBe(201);

    const replay = apiJsonRequest("POST", "shopping-list/items", "req_idempotency_replay", auth, replayBody);
    const replayResponse = await action(routeArgs(replay.request, "shopping-list/items").args);
    expect(replayResponse.status).toBe(201);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items",
      requestId: "req_idempotency_replay",
      operation: "shopping-list.items.create",
      status: 201,
      authMode: "bearer",
      requestBytes: replay.bodyBytes,
      idempotencyOutcome: "replayed",
      forbidden: ["raw-replay-mutation-id", replayBody.name, replay.bodyText],
    });

    const conflict = apiJsonRequest("POST", "shopping-list/items", "req_idempotency_conflict", auth, {
      ...replayBody,
      name: `Conflict Rice ${faker.string.alphanumeric(8)}`,
    });
    const conflictResponse = await action(routeArgs(conflict.request, "shopping-list/items").args);
    expect(conflictResponse.status).toBe(409);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items",
      requestId: "req_idempotency_conflict",
      operation: "shopping-list.items.create",
      status: 409,
      authMode: "bearer",
      requestBytes: conflict.bodyBytes,
      errorCode: "idempotency_conflict",
      idempotencyOutcome: "conflict",
      forbidden: ["raw-replay-mutation-id", conflict.bodyText],
    });

    const inProgressBody = {
      clientMutationId: "raw-in-progress-mutation-id",
      name: `Pending Rice ${faker.string.alphanumeric(8)}`,
    };
    await db.apiIdempotencyKey.create({
      data: {
        userId: user.id,
        credentialId: credential.credential.id,
        clientKey: idempotencyClientKey({ id: user.id, source: "bearer", credentialId: credential.credential.id }),
        key: inProgressBody.clientMutationId,
        operation: "shopping-list.items.create",
        requestHash: await hashIdempotencyRequest({
          method: "POST",
          path: "/api/v1/shopping-list/items",
          body: inProgressBody,
        }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });

    const inProgress = apiJsonRequest("POST", "shopping-list/items", "req_idempotency_in_progress", auth, inProgressBody);
    const inProgressResponse = await action(routeArgs(inProgress.request, "shopping-list/items").args);
    expect(inProgressResponse.status).toBe(409);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items",
      requestId: "req_idempotency_in_progress",
      operation: "shopping-list.items.create",
      status: 409,
      authMode: "bearer",
      requestBytes: inProgress.bodyBytes,
      errorCode: "idempotency_in_progress",
      idempotencyOutcome: "in_progress",
      forbidden: ["raw-in-progress-mutation-id", inProgressBody.name, inProgress.bodyText],
    });
  });

  it("captures JSON validation and not-found errors without raw request or response details", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Error Writer", {
      scopes: ["shopping_list:write"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const malformed = apiJsonRequest(
      "POST",
      "shopping-list/items",
      "req_validation_invalid_json",
      auth,
      "{\"clientMutationId\":\"raw-invalid-json-id\",\"name\":\"Raw Bad JSON\"",
    );
    const malformedResponse = await action(routeArgs(malformed.request, "shopping-list/items").args);

    expect(malformedResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items",
      requestId: "req_validation_invalid_json",
      operation: "shopping-list.items.create",
      status: 400,
      authMode: "bearer",
      requestBytes: malformed.bodyBytes,
      errorCode: "invalid_json",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-invalid-json-id", "Raw Bad JSON", malformed.bodyText],
    });

    const missingId = `missing-${faker.string.alphanumeric(8)}`;
    const missingBody = { clientMutationId: "raw-missing-mutation-id", checked: true };
    const missing = apiJsonRequest(
      "PATCH",
      `shopping-list/items/${missingId}`,
      "req_validation_not_found",
      auth,
      missingBody,
    );
    const missingResponse = await action(routeArgs(missing.request, `shopping-list/items/${missingId}`).args);

    expect(missingResponse.status).toBe(404);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/shopping-list/items/{itemId}",
      requestId: "req_validation_not_found",
      operation: "shopping-list.items.check",
      status: 404,
      authMode: "bearer",
      requestBytes: missing.bodyBytes,
      errorCode: "not_found",
      idempotencyOutcome: "aborted",
      forbidden: ["raw-missing-mutation-id", missingId, missing.bodyText],
    });
  });
});

describe("API v1 authenticated telemetry", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("captures session token-list reads with principal metadata and no profile or token text", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const existing = await createApiCredential(db, user.id, "Telemetry Session Token", { scopes: ["recipes:read"] });
    const cookie = await sessionCookie(user.id);
    const request = apiRequest("http://localhost/api/v1/tokens", "req_tokens_session", {
      Cookie: `${cookie}; preview=should_not_ship`,
    });
    const response = await loader(routeArgs(request, "tokens").args);

    expect(response.status).toBe(200);
    expectAuthenticatedApiV1Event({
      routeTemplate: "/api/v1/tokens",
      requestId: "req_tokens_session",
      authMode: "session",
      principalId: user.id,
      scopes: ["tokens:read", "tokens:write", "offline_access"],
      forbidden: [
        user.email,
        user.username,
        cookie,
        "preview=should_not_ship",
        "Telemetry Session Token",
        existing.token,
        existing.credential.tokenPrefix,
      ],
    });
  });

  it("captures personal bearer shopping-list reads with credential id and scopes but no token text", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Shopping Reader", {
      scopes: ["shopping_list:read"],
    });
    const request = apiRequest("http://localhost/api/v1/shopping-list", "req_shopping_bearer_telemetry", {
      Authorization: `Bearer ${credential.token}`,
      Cookie: "ignored_session=should_not_ship",
    });
    const response = await loader(routeArgs(request, "shopping-list").args);

    expect(response.status).toBe(200);
    expectAuthenticatedApiV1Event({
      routeTemplate: "/api/v1/shopping-list",
      requestId: "req_shopping_bearer_telemetry",
      authMode: "bearer",
      principalId: user.id,
      credentialId: credential.credential.id,
      scopes: ["shopping_list:read"],
      forbidden: [
        user.email,
        user.username,
        credential.token,
        credential.credential.tokenPrefix,
        "Telemetry Shopping Reader",
        "ignored_session=should_not_ship",
      ],
    });
  });

  it("captures OAuth bearer sync reads with delegated client metadata and safe resource class", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Delegated Sync Reader", {
      scopes: ["shopping_list:read"],
      oauthClientId: "oauth_client_telemetry_sync",
      oauthResource: null,
    });
    const cursor = "2026-06-02T00:00:00.000Z";
    const request = apiRequest(
      `http://localhost/api/v1/shopping-list/sync?cursor=${encodeURIComponent(cursor)}`,
      "req_shopping_oauth_sync_telemetry",
      { Authorization: `Bearer ${credential.token}` },
    );
    const response = await loader(routeArgs(request, "shopping-list/sync").args);

    expect(response.status).toBe(200);
    expectAuthenticatedApiV1Event({
      routeTemplate: "/api/v1/shopping-list/sync",
      requestId: "req_shopping_oauth_sync_telemetry",
      authMode: "oauth_bearer",
      principalId: user.id,
      credentialId: credential.credential.id,
      oauthClientId: "oauth_client_telemetry_sync",
      oauthResource: null,
      scopes: ["shopping_list:read"],
      forbidden: [
        user.email,
        user.username,
        credential.token,
        credential.credential.tokenPrefix,
        "Delegated Sync Reader",
        cursor,
      ],
    });
  });

  it("captures authenticated optional public reads with principal metadata instead of downgrading to anonymous", async () => {
    const sessionUser = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(sessionUser.id);
    const health = await loader(routeArgs(apiRequest("http://localhost/api/v1/health", "req_health_session_optional", {
      Cookie: cookie,
    }), "health").args);

    expect(health.status).toBe(200);
    expectAuthenticatedApiV1Event({
      routeTemplate: "/api/v1/health",
      requestId: "req_health_session_optional",
      authMode: "session",
      principalId: sessionUser.id,
      scopes: ["tokens:read", "tokens:write", "offline_access"],
      forbidden: [sessionUser.email, sessionUser.username, cookie],
    });

    const recipeFixture = await createRecipeFixture(db);
    const bearerUser = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, bearerUser.id, "Optional Public Reader", {
      scopes: ["recipes:read"],
    });
    const recipes = await loader(routeArgs(apiRequest(
      "http://localhost/api/v1/recipes?query=optional_public_secret&limit=1",
      "req_recipes_bearer_optional",
      { Authorization: `Bearer ${credential.token}` },
    ), "recipes").args);

    expect(recipes.status).toBe(200);
    expectAuthenticatedApiV1Event({
      routeTemplate: "/api/v1/recipes",
      requestId: "req_recipes_bearer_optional",
      authMode: "bearer",
      principalId: bearerUser.id,
      credentialId: credential.credential.id,
      scopes: ["recipes:read"],
      forbidden: [
        bearerUser.email,
        bearerUser.username,
        credential.token,
        credential.credential.tokenPrefix,
        "Optional Public Reader",
        "optional_public_secret",
        recipeFixture.recipe.title,
        recipeFixture.recipe.description,
      ],
    });
  });
});
