import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import * as apiAuth from "~/lib/api-auth.server";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, idempotencyClientKey, IDEMPOTENCY_TTL_MS } from "~/lib/api-idempotency.server";
import { captureEvent, captureException } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createCookbookTitle, createTestRecipe, createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
  captureException: vi.fn(async () => undefined),
}));

function routeArgs(request: Request, splat: string, env: Record<string, unknown> = {}) {
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
          env: { POSTHOG_KEY: "ph_test", ...env },
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

function apiV1Event(routeTemplate: string, requestId: string) {
  return captureInputs().find((candidate) => (
    candidate.event === "spoonjoy.api_v1.request" &&
    candidate.properties?.route_template === routeTemplate &&
    candidate.properties?.request_id === requestId
  ));
}

function expectSafeApiV1Event(routeTemplate: string, requestId: string) {
  const input = apiV1Event(routeTemplate, requestId);

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
  rateLimitScope?: string;
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
  if (input.rateLimitScope) {
    expect(properties.rate_limit_scope).toBe(input.rateLimitScope);
  } else {
    expect(properties.rate_limit_scope).toBeUndefined();
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

function expectApiV1ErrorEvent(input: {
  routeTemplate: string;
  requestId: string;
  status: number;
  errorCode: string;
  authMode: "anonymous" | "session" | "bearer" | "oauth_bearer";
  operation?: string;
  privacyClass?: string;
  rateLimitScope?: string;
  forbidden?: readonly string[];
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
      status: input.status,
      request_id: input.requestId,
      error_code: input.errorCode,
      auth_mode: input.authMode,
      privacy_class: input.privacyClass ?? expect.any(String),
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
  if (input.operation) {
    expect(properties.operation).toBe(input.operation);
  } else {
    expect(properties.operation).toBeUndefined();
  }
  if (input.rateLimitScope) {
    expect(properties.rate_limit_scope).toBe(input.rateLimitScope);
  } else {
    expect(properties.rate_limit_scope).toBeUndefined();
  }

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden ?? []) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("__session=");
  expect(serialized).not.toContain("stack");
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
      ["http://localhost/api/v1/openapi.connector.json", "openapi.connector.json", "/api/v1/openapi.connector.json", "req_api_openapi_connector"],
      ["http://localhost/api/v1/openapi.sdk.json", "openapi.sdk.json", "/api/v1/openapi.sdk.json", "req_api_openapi_sdk"],
    ] as const) {
      const context = routeArgs(publicRequest(url, requestId), splat);
      const response = await loader(context.args);

      expect(response.status).toBe(200);
      expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
      expectSafeApiV1Event(routeTemplate, requestId);
    }

    expect(apiV1Event("/api/v1/openapi.connector.json", "req_api_openapi_connector")?.properties?.operation)
      .toBe("openapi.connector.read");
    expect(apiV1Event("/api/v1/openapi.sdk.json", "req_api_openapi_sdk")?.properties?.operation)
      .toBe("openapi.sdk.read");
  });

  it("classifies coarse user-agent families and omits unsafe origin hosts", async () => {
    for (const [userAgent, family, requestId] of [
      ["undici/7.20.0 node", "node", "req_api_ua_node"],
      ["Mozilla/5.0 Safari/605.1.15", "browser", "req_api_ua_browser"],
      ["KitchenSyncBot/1.0", "other", "req_api_ua_other"],
      ["", "unknown", "req_api_ua_unknown"],
    ] as const) {
      const request = new UndiciRequest("http://localhost/api/v1/health", {
        headers: {
          "X-Request-Id": requestId,
          Origin: "not a url",
          Referer: "also not a url",
          ...(userAgent ? { "User-Agent": userAgent } : {}),
        },
      }) as unknown as Request;
      const response = await loader(routeArgs(request, "health").args);

      expect(response.status).toBe(200);
      const input = apiV1Event("/api/v1/health", requestId);
      expect(input?.properties).toMatchObject({
        user_agent_family: family,
        origin_host: undefined,
        referrer_host: undefined,
      });
    }

    const ipLiteral = new UndiciRequest("http://localhost/api/v1/health", {
      headers: {
        "X-Request-Id": "req_api_ip_literal_hosts",
        Origin: "http://203.0.113.4:8443",
        Referer: "http://[2001:db8::1]/docs?token=secret",
        "User-Agent": "KitchenSyncBot/1.0",
      },
    }) as unknown as Request;
    const response = await loader(routeArgs(ipLiteral, "health").args);

    expect(response.status).toBe(200);
    const input = apiV1Event("/api/v1/health", "req_api_ip_literal_hosts");
    expect(input?.properties).toMatchObject({
      user_agent_family: "other",
      origin_host: undefined,
      referrer_host: undefined,
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("203.0.113.4");
    expect(serialized).not.toContain("2001:db8::1");
    expect(serialized).not.toContain("token=secret");
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

  it("captures recipe import operation metadata from the generic route mapper", async () => {
    const importBody = {
      clientMutationId: "raw-import-mutation-id",
      source: { type: "url", url: "https://example.com/private-recipe" },
    };
    const request = apiJsonRequest("POST", "recipes/import", "req_import_operation_no_auth", {}, importBody);

    const response = await action(routeArgs(request.request, "recipes/import").args);

    expect(response.status).toBe(401);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/recipes/import",
      requestId: "req_import_operation_no_auth",
      operation: "recipes.import",
      status: 401,
      errorCode: "authentication_required",
      authMode: "anonymous",
      forbidden: [
        "raw-import-mutation-id",
        "https://example.com/private-recipe",
        request.bodyText,
      ],
    });
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

  it("captures recipe cover operations without cover ids, mutation ids, or body values", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Kitchen Writer", {
      scopes: ["kitchen:write"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Telemetry Cover Recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/telemetry-active.jpg",
        stylizedImageUrl: "/photos/covers/telemetry-active-stylized.jpg",
        sourceType: "chef-upload",
        sourceImageUrl: "/photos/uploads/telemetry-active-source.jpg",
        status: "ready",
        generationStatus: "succeeded",
        createdById: user.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: activeCover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    const basePath = `recipes/${recipe.id}/covers`;

    const listRequest = apiRequest(`http://localhost/api/v1/${basePath}?limit=1&offset=0`, "req_cover_operation_list", {
      ...auth,
      "User-Agent": "PostmanRuntime/7.39.0",
    });
    const listResponse = await loader(routeArgs(listRequest, basePath).args);
    expect(listResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers",
      requestId: "req_cover_operation_list",
      operation: "recipes.covers.list",
      status: 200,
      authMode: "bearer",
      requestBytes: 0,
      forbidden: [recipe.id, activeCover.id, credential.token, credential.credential.tokenPrefix],
    });

    const setNoCover = apiJsonRequest("PATCH", basePath, "req_cover_operation_set_none", auth, {
      clientMutationId: "raw-cover-set-none-id",
      confirmNoCover: false,
    });
    const setNoCoverResponse = await action(routeArgs(setNoCover.request, basePath).args);
    expect(setNoCoverResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers",
      requestId: "req_cover_operation_set_none",
      operation: "recipes.covers.set-no-cover",
      status: 400,
      authMode: "bearer",
      requestBytes: setNoCover.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-cover-set-none-id", setNoCover.bodyText, recipe.id],
    });

    const activate = apiJsonRequest("PATCH", `${basePath}/${activeCover.id}`, "req_cover_operation_activate", auth, {
      clientMutationId: "raw-cover-activate-id",
      variant: "thumbnail",
    });
    const activateResponse = await action(routeArgs(activate.request, `${basePath}/${activeCover.id}`).args);
    expect(activateResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers/{coverId}",
      requestId: "req_cover_operation_activate",
      operation: "recipes.covers.activate",
      status: 400,
      authMode: "bearer",
      requestBytes: activate.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-cover-activate-id", "thumbnail", activate.bodyText, recipe.id, activeCover.id],
    });

    const archive = apiJsonRequest("DELETE", `${basePath}/${activeCover.id}`, "req_cover_operation_archive", auth, {
      clientMutationId: "raw-cover-archive-id",
      replacementVariant: "thumbnail",
    });
    const archiveResponse = await action(routeArgs(archive.request, `${basePath}/${activeCover.id}`).args);
    expect(archiveResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers/{coverId}",
      requestId: "req_cover_operation_archive",
      operation: "recipes.covers.archive",
      status: 400,
      authMode: "bearer",
      requestBytes: archive.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-cover-archive-id", "thumbnail", archive.bodyText, recipe.id, activeCover.id],
    });

    const regenerate = apiJsonRequest("POST", `${basePath}/regenerate`, "req_cover_operation_regenerate", auth, {
      clientMutationId: "raw-cover-regenerate-id",
      coverId: "missing_cover_for_telemetry",
    });
    const regenerateResponse = await action(routeArgs(regenerate.request, `${basePath}/regenerate`).args);
    expect(regenerateResponse.status).toBe(404);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers/regenerate",
      requestId: "req_cover_operation_regenerate",
      operation: "recipes.covers.regenerate",
      status: 404,
      authMode: "bearer",
      requestBytes: regenerate.bodyBytes,
      errorCode: "not_found",
      idempotencyOutcome: "aborted",
      forbidden: ["raw-cover-regenerate-id", "missing_cover_for_telemetry", regenerate.bodyText, recipe.id],
    });

    const fromSpoon = apiJsonRequest("POST", `${basePath}/from-spoon/missing_spoon_for_telemetry`, "req_cover_operation_from_spoon", auth, {
      clientMutationId: "raw-cover-from-spoon-id",
    });
    const fromSpoonResponse = await action(routeArgs(fromSpoon.request, `${basePath}/from-spoon/missing_spoon_for_telemetry`).args);
    expect(fromSpoonResponse.status).toBe(404);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers/from-spoon/{spoonId}",
      requestId: "req_cover_operation_from_spoon",
      operation: "recipes.covers.from-spoon",
      status: 404,
      authMode: "bearer",
      requestBytes: fromSpoon.bodyBytes,
      errorCode: "not_found",
      idempotencyOutcome: "aborted",
      forbidden: ["raw-cover-from-spoon-id", "missing_spoon_for_telemetry", fromSpoon.bodyText, recipe.id],
    });
  });

  it("captures recipe spoon operations without recipe ids, spoon ids, mutation ids, or body values", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Spoon Writer", {
      scopes: ["kitchen:write"],
    });
    const readCredential = await createApiCredential(db, user.id, "Telemetry Spoon Reader", {
      scopes: ["recipes:read"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Telemetry Spoon Recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const spoon = await db.recipeSpoon.create({
      data: {
        chefId: user.id,
        recipeId: recipe.id,
        note: "Telemetry spoon private note",
      },
    });
    const basePath = `recipes/${recipe.id}/spoons`;

    const listRequest = apiRequest(`http://localhost/api/v1/${basePath}`, "req_spoon_operation_list", {
      Authorization: `Bearer ${readCredential.token}`,
      "User-Agent": "PostmanRuntime/7.39.0",
    });
    const listResponse = await loader(routeArgs(listRequest, basePath).args);
    expect(listResponse.status).toBe(200);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons",
      requestId: "req_spoon_operation_list",
      operation: "recipes.spoons.list",
      status: 200,
      authMode: "bearer",
      requestBytes: 0,
      forbidden: [recipe.id, spoon.id, readCredential.token, readCredential.credential.tokenPrefix],
    });

    const create = apiJsonRequest("POST", basePath, "req_spoon_operation_create_invalid", auth, {
      clientMutationId: "raw-spoon-create-id",
      note: "Private create note",
      cookedAt: "not-a-date",
    });
    const createResponse = await action(routeArgs(create.request, basePath).args);
    expect(createResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons",
      requestId: "req_spoon_operation_create_invalid",
      operation: "recipes.spoons.create",
      status: 400,
      authMode: "bearer",
      requestBytes: create.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-spoon-create-id", "Private create note", create.bodyText, recipe.id],
    });

    const update = apiJsonRequest("PATCH", `${basePath}/${spoon.id}`, "req_spoon_operation_update_invalid", auth, {
      clientMutationId: "raw-spoon-update-id",
      cookedAt: "also-not-a-date",
    });
    const updateResponse = await action(routeArgs(update.request, `${basePath}/${spoon.id}`).args);
    expect(updateResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons/{spoonId}",
      requestId: "req_spoon_operation_update_invalid",
      operation: "recipes.spoons.update",
      status: 400,
      authMode: "bearer",
      requestBytes: update.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: ["raw-spoon-update-id", "also-not-a-date", update.bodyText, recipe.id, spoon.id],
    });

    const remove = apiJsonRequest("DELETE", `${basePath}/${spoon.id}`, "req_spoon_operation_delete_invalid", auth, {});
    const removeResponse = await action(routeArgs(remove.request, `${basePath}/${spoon.id}`).args);
    expect(removeResponse.status).toBe(400);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons/{spoonId}",
      requestId: "req_spoon_operation_delete_invalid",
      operation: "recipes.spoons.delete",
      status: 400,
      authMode: "bearer",
      requestBytes: remove.bodyBytes,
      errorCode: "validation_error",
      idempotencyOutcome: "not_attempted",
      forbidden: [remove.bodyText, recipe.id, spoon.id],
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

  it("captures native account settings operations without profile, token, or connection values", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const connectionToken = await createApiCredential(db, user.id, "Telemetry connection token", {
      scopes: ["tokens:read", "tokens:write"],
    });

    function expectAccountOperation(input: {
      routeTemplate: string;
      requestId: string;
      operation: string;
      status: number;
      forbidden: readonly string[];
    }) {
      const event = apiV1Event(input.routeTemplate, input.requestId);
      expect(event?.properties).toMatchObject({
        route_template: input.routeTemplate,
        request_id: input.requestId,
        operation: input.operation,
        status: input.status,
      });
      const serialized = JSON.stringify(event);
      for (const forbidden of input.forbidden) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toContain("Authorization");
      expect(serialized).not.toContain("Bearer ");
      expect(serialized).not.toContain("__session=");
    }

    const readProfile = await loader(routeArgs(apiRequest("http://localhost/api/v1/me", "req_account_operation_read", {
      Cookie: cookie,
    }), "me").args);
    expect(readProfile.status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me",
      requestId: "req_account_operation_read",
      operation: "account.read",
      status: 200,
      forbidden: [user.email, user.username, cookie],
    });

    const nextEmail = faker.internet.email();
    const nextUsername = `telemetry_${faker.string.alphanumeric(8)}`;
    const updateProfile = apiJsonRequest("PATCH", "me", "req_account_operation_update", { Cookie: cookie }, {
      email: nextEmail,
      username: nextUsername,
    });
    expect((await action(routeArgs(updateProfile.request, "me").args)).status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me",
      requestId: "req_account_operation_update",
      operation: "account.update",
      status: 200,
      forbidden: [nextEmail, nextUsername, updateProfile.bodyText, cookie],
    });

    const photoForm = new UndiciFormData();
    const uploadPhoto = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Request-Id": "req_account_operation_photo_upload",
        Origin: "https://client.example",
        Referer: "https://docs.example/start?token=secret",
        "User-Agent": "PostmanRuntime/7.39.0",
      },
      body: photoForm,
      duplex: "half",
    }) as unknown as Request, "me/photo").args);
    expect(uploadPhoto.status).toBe(400);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/photo",
      requestId: "req_account_operation_photo_upload",
      operation: "account.photo.upload",
      status: 400,
      forbidden: [cookie],
    });

    const removePhoto = apiJsonRequest("DELETE", "me/photo", "req_account_operation_photo_remove", { Cookie: cookie }, {});
    expect((await action(routeArgs(removePhoto.request, "me/photo").args)).status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/photo",
      requestId: "req_account_operation_photo_remove",
      operation: "account.photo.remove",
      status: 200,
      forbidden: [removePhoto.bodyText, cookie],
    });

    const readNotifications = await loader(routeArgs(apiRequest(
      "http://localhost/api/v1/me/notification-preferences",
      "req_account_operation_notifications_read",
      { Cookie: cookie },
    ), "me/notification-preferences").args);
    expect(readNotifications.status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/notification-preferences",
      requestId: "req_account_operation_notifications_read",
      operation: "account.notification-preferences.read",
      status: 200,
      forbidden: [cookie],
    });

    const updateNotifications = apiJsonRequest(
      "PATCH",
      "me/notification-preferences",
      "req_account_operation_notifications_update",
      { Cookie: cookie },
      {
        notifySpoonOnMyRecipe: true,
        notifyForkOfMyRecipe: false,
        notifyCookbookSaveOfMine: true,
        notifyFellowChefOriginCook: false,
      },
    );
    expect((await action(routeArgs(updateNotifications.request, "me/notification-preferences").args)).status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/notification-preferences",
      requestId: "req_account_operation_notifications_update",
      operation: "account.notification-preferences.update",
      status: 200,
      forbidden: [updateNotifications.bodyText, cookie],
    });

    const listConnections = await loader(routeArgs(apiRequest("http://localhost/api/v1/me/connections", "req_account_operation_connections_list", {
      Authorization: `Bearer ${connectionToken.token}`,
    }), "me/connections").args);
    expect(listConnections.status).toBe(200);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/connections",
      requestId: "req_account_operation_connections_list",
      operation: "account.connections.list",
      status: 200,
      forbidden: [connectionToken.token, connectionToken.credential.tokenPrefix],
    });

    const disconnect = apiJsonRequest(
      "DELETE",
      "me/connections/not-a-connection",
      "req_account_operation_connection_disconnect",
      { Authorization: `Bearer ${connectionToken.token}` },
      {},
    );
    expect((await action(routeArgs(disconnect.request, "me/connections/not-a-connection").args)).status).toBe(404);
    expectAccountOperation({
      routeTemplate: "/api/v1/me/connections/{connectionId}",
      requestId: "req_account_operation_connection_disconnect",
      operation: "account.connections.disconnect",
      status: 404,
      forbidden: [connectionToken.token, connectionToken.credential.tokenPrefix, disconnect.bodyText, "not-a-connection"],
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

    const bulkValidationCases = [
      {
        path: "shopping-list/add-from-recipe",
        routeTemplate: "/api/v1/shopping-list/add-from-recipe",
        requestId: "req_validation_add_recipe",
        operation: "shopping-list.add-from-recipe",
        body: { clientMutationId: "raw-add-recipe-id", recipeId: "" },
        forbidden: ["raw-add-recipe-id"],
      },
      {
        path: "shopping-list/clear-completed",
        routeTemplate: "/api/v1/shopping-list/clear-completed",
        requestId: "req_validation_clear_completed",
        operation: "shopping-list.clear-completed",
        body: { clientMutationId: "raw-clear-completed-id", unexpected: true },
        forbidden: ["raw-clear-completed-id"],
      },
      {
        path: "shopping-list/clear-all",
        routeTemplate: "/api/v1/shopping-list/clear-all",
        requestId: "req_validation_clear_all",
        operation: "shopping-list.clear-all",
        body: { clientMutationId: "raw-clear-all-id", unexpected: true },
        forbidden: ["raw-clear-all-id"],
      },
    ] as const;

    for (const testCase of bulkValidationCases) {
      const invalid = apiJsonRequest("POST", testCase.path, testCase.requestId, auth, testCase.body);
      const invalidResponse = await action(routeArgs(invalid.request, testCase.path).args);

      expect(invalidResponse.status).toBe(400);
      expectApiV1OperationEvent({
        routeTemplate: testCase.routeTemplate,
        requestId: testCase.requestId,
        operation: testCase.operation,
        status: 400,
        authMode: "bearer",
        requestBytes: invalid.bodyBytes,
        errorCode: "validation_error",
        idempotencyOutcome: "not_attempted",
        forbidden: [...testCase.forbidden, invalid.bodyText],
      });
    }

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

describe("API v1 rate-limit and error telemetry", () => {
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

  it("captures rate-limited requests with limiter scope without leaking the bearer token", async () => {
    const token = "sj_rate_limited_secret";
    const context = routeArgs(apiRequest("http://localhost/api/v1/health", "req_error_rate_limited", {
      Authorization: `Bearer ${token}`,
      "CF-Connecting-IP": "203.0.113.4",
    }), "health", {
      API_TOKEN_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toMatch(/^token:[a-f0-9]{64}$/);
          return { success: false };
        },
      },
    });
    const response = await loader(context.args);

    expect(response.status).toBe(429);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/health",
      requestId: "req_error_rate_limited",
      status: 429,
      errorCode: "rate_limited",
      authMode: "anonymous",
      operation: "health.read",
      privacyClass: "public",
      rateLimitScope: "token",
      forbidden: [token, "203.0.113.4"],
    });
  });

  it("captures auth, scope, method, and unknown-path errors with safe metadata", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const writeOnly = await createApiCredential(db, user.id, "Write only telemetry token", {
      scopes: ["shopping_list:write"],
    });

    const missingAuth = await loader(routeArgs(
      apiRequest("http://localhost/api/v1/shopping-list", "req_error_missing_auth"),
      "shopping-list",
    ).args);
    expect(missingAuth.status).toBe(401);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/shopping-list",
      requestId: "req_error_missing_auth",
      status: 401,
      errorCode: "authentication_required",
      authMode: "anonymous",
      operation: "shopping-list.read",
      privacyClass: "private",
    });

    const unauthenticatedTokenCreate = apiJsonRequest("POST", "tokens", "req_error_token_create_no_auth", {}, {
      name: "No auth token body",
      scopes: ["recipes:read"],
    });
    const unauthenticatedTokenCreateResponse = await action(routeArgs(
      unauthenticatedTokenCreate.request,
      "tokens",
    ).args);
    expect(unauthenticatedTokenCreateResponse.status).toBe(401);
    const tokenCreateEvent = expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/tokens",
      requestId: "req_error_token_create_no_auth",
      status: 401,
      errorCode: "authentication_required",
      authMode: "anonymous",
      operation: "tokens.create",
      privacyClass: "private",
      forbidden: ["No auth token body", unauthenticatedTokenCreate.bodyText],
    });
    expect(tokenCreateEvent?.properties?.idempotency_outcome).toBe("none");

    const invalidToken = "sj_invalid_token_secret";
    const badBearer = await loader(routeArgs(apiRequest("http://localhost/api/v1/health", "req_error_invalid_token", {
      Authorization: `Bearer ${invalidToken}`,
    }), "health").args);
    expect(badBearer.status).toBe(401);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/health",
      requestId: "req_error_invalid_token",
      status: 401,
      errorCode: "invalid_token",
      authMode: "anonymous",
      operation: "health.read",
      privacyClass: "public",
      forbidden: [invalidToken],
    });

    const missingScope = await loader(routeArgs(apiRequest("http://localhost/api/v1/shopping-list", "req_error_missing_scope", {
      Authorization: `Bearer ${writeOnly.token}`,
    }), "shopping-list").args);
    expect(missingScope.status).toBe(403);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/shopping-list",
      requestId: "req_error_missing_scope",
      status: 403,
      errorCode: "insufficient_scope",
      authMode: "bearer",
      operation: "shopping-list.read",
      privacyClass: "authenticated",
      forbidden: [writeOnly.token, writeOnly.credential.tokenPrefix, "Write only telemetry token"],
    });

    const methodNotAllowed = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/health", {
      method: "POST",
      headers: { "X-Request-Id": "req_error_method_not_allowed" },
    }) as unknown as Request, "health").args);
    expect(methodNotAllowed.status).toBe(405);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/health",
      requestId: "req_error_method_not_allowed",
      status: 405,
      errorCode: "method_not_allowed",
      authMode: "anonymous",
      privacyClass: "public",
    });

    const itemId = "actual-item-id-should-not-ship";
    const itemMethodNotAllowed = await action(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/items/${itemId}`,
      {
        method: "POST",
        headers: { "X-Request-Id": "req_error_item_method_not_allowed" },
      },
    ) as unknown as Request, `shopping-list/items/${itemId}`).args);
    expect(itemMethodNotAllowed.status).toBe(405);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/shopping-list/items/{itemId}",
      requestId: "req_error_item_method_not_allowed",
      status: 405,
      errorCode: "method_not_allowed",
      authMode: "anonymous",
      operation: undefined,
      privacyClass: "private",
      forbidden: [itemId],
    });

    const unauthenticatedDelete = apiJsonRequest("DELETE", `shopping-list/items/${itemId}`, "req_error_delete_missing_auth", {}, {
      clientMutationId: "delete-without-auth",
    });
    const unauthenticatedDeleteResponse = await action(routeArgs(
      unauthenticatedDelete.request,
      `shopping-list/items/${itemId}`,
    ).args);
    expect(unauthenticatedDeleteResponse.status).toBe(401);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/shopping-list/items/{itemId}",
      requestId: "req_error_delete_missing_auth",
      status: 401,
      errorCode: "authentication_required",
      authMode: "anonymous",
      operation: "shopping-list.items.delete",
      privacyClass: "private",
      forbidden: [itemId, unauthenticatedDelete.bodyText],
    });

    const missingPath = "missing-secret-path";
    vi.mocked(captureException).mockClear();
    const unknownPath = await loader(routeArgs(apiRequest(
      `http://localhost/api/v1/${missingPath}`,
      "req_error_unknown_path",
    ), missingPath).args);
    expect(unknownPath.status).toBe(404);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/{unknown}",
      requestId: "req_error_unknown_path",
      status: 404,
      errorCode: "not_found",
      authMode: "anonymous",
      privacyClass: "public",
      forbidden: [missingPath],
    });
    // Expected ApiV1Errors (e.g. 404 not_found) are not exceptions — no capture.
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures internal errors without stack traces or exception messages in lifecycle telemetry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(captureException).mockClear();
    const thrownError = new Error("auth storage unavailable");
    vi.spyOn(apiAuth, "authenticateApiRequest").mockRejectedValueOnce(thrownError);
    const token = "sj_storage_failure_secret";
    const response = await loader(routeArgs(apiRequest("http://localhost/api/v1/health", "req_error_internal", {
      Authorization: `Bearer ${token}`,
    }), "health").args);

    expect(response.status).toBe(500);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/health",
      requestId: "req_error_internal",
      status: 500,
      errorCode: "internal_error",
      authMode: "anonymous",
      operation: "health.read",
      privacyClass: "public",
      forbidden: [token, "auth storage unavailable", "Error"],
    });
    expect(errorSpy).toHaveBeenCalledWith("[api-v1] internal_error", expect.objectContaining({
      requestId: "req_error_internal",
      method: "GET",
      path: "/api/v1/health",
    }));
    // The lifecycle event omits the stack; captureException is what preserves it.
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
      expect.objectContaining({
        error: thrownError,
        distinctId: "server",
        route: "/api/v1/health",
        method: "GET",
      }),
    );

    vi.mocked(captureEvent).mockClear();
    vi.spyOn(apiAuth, "authenticateApiRequest").mockRejectedValueOnce("auth string unavailable" as never);
    const stringThrowResponse = await loader(routeArgs(apiRequest("http://localhost/api/v1/health", "req_error_internal_string", {
      Authorization: `Bearer ${token}`,
    }), "health").args);
    expect(stringThrowResponse.status).toBe(500);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/health",
      requestId: "req_error_internal_string",
      status: 500,
      errorCode: "internal_error",
      authMode: "anonymous",
      operation: "health.read",
      privacyClass: "public",
      forbidden: [token, "auth string unavailable"],
    });
    expect(errorSpy).toHaveBeenCalledWith("[api-v1] internal_error", expect.objectContaining({
      requestId: "req_error_internal_string",
      error: "auth string unavailable",
    }));
  });

  it("does not capture internal errors when PostHog is unconfigured", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(captureException).mockClear();
    vi.spyOn(apiAuth, "authenticateApiRequest").mockRejectedValueOnce(new Error("auth storage unavailable"));

    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const response = await loader({
      request: apiRequest("http://localhost/api/v1/health", "req_error_internal_no_ph", {
        Authorization: "Bearer sj_no_posthog_secret",
      }),
      params: { "*": "health" },
      // env present (so waitUntil is wired) but no POSTHOG_KEY → capture is skipped.
      context: { cloudflare: { env: {}, ctx: { waitUntil } } },
    } as never);

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith("[api-v1] internal_error", expect.objectContaining({
      requestId: "req_error_internal_no_ph",
    }));
    expect(captureException).not.toHaveBeenCalled();
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
