import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import * as apiAuth from "~/lib/api-auth.server";
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
  method: "POST" | "PATCH" | "PUT" | "DELETE",
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

function expectApiV1OperationName(input: {
  routeTemplate: string;
  requestId: string;
  operation: string;
  status?: number;
  forbidden?: readonly string[];
}) {
  const eventInput = apiV1Event(input.routeTemplate, input.requestId);

  expect(eventInput).toMatchObject({
    event: "spoonjoy.api_v1.request",
    properties: {
      route_template: input.routeTemplate,
      request_id: input.requestId,
      operation: input.operation,
      status: input.status ?? 200,
      privacy_class: "authenticated",
      latency_ms: expect.any(Number),
    },
  });

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden ?? []) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("__session=");
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

  it("captures public profile graph and search operation names without leaking identifiers", async () => {
    const user = await db.user.create({ data: createTestUser() });

    for (const [url, splat, routeTemplate, requestId, operation] of [
      [
        `http://localhost/api/v1/users/${user.username}`,
        `users/${user.username}`,
        "/api/v1/users/{identifier}",
        "req_api_user_profile_operation",
        "profiles.read",
      ],
      [
        `http://localhost/api/v1/users/${user.username}/fellow-chefs`,
        `users/${user.username}/fellow-chefs`,
        "/api/v1/users/{identifier}/fellow-chefs",
        "req_api_user_fellow_chefs_operation",
        "profiles.fellow-chefs.list",
      ],
      [
        `http://localhost/api/v1/users/${user.username}/kitchen-visitors`,
        `users/${user.username}/kitchen-visitors`,
        "/api/v1/users/{identifier}/kitchen-visitors",
        "req_api_user_kitchen_visitors_operation",
        "profiles.kitchen-visitors.list",
      ],
      [
        "http://localhost/api/v1/search?q=telemetry",
        "search",
        "/api/v1/search",
        "req_api_search_operation",
        "search.read",
      ],
    ] as const) {
      const context = routeArgs(publicRequest(url, requestId), splat);
      const response = await loader(context.args);

      expect(response.status).toBe(200);
      const event = expectSafeApiV1Event(routeTemplate, requestId);
      expect(event?.properties?.operation).toBe(operation);
      expect(JSON.stringify(event)).not.toContain(user.username);
      expect(JSON.stringify(event)).not.toContain(user.email);
    }
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

  it("captures recipe write operation names on authentication failures", async () => {
    const fixture = await createRecipeFixture(db);

    for (const [method, path, routeTemplate, requestId, operation, body] of [
      ["POST", "recipes", "/api/v1/recipes", "req_recipe_create_auth_operation", "recipes.create", {
        clientMutationId: "telemetry-create",
        title: "Telemetry Create",
      }],
      ["PATCH", `recipes/${fixture.recipe.id}`, "/api/v1/recipes/{id}", "req_recipe_update_auth_operation", "recipes.update", {
        clientMutationId: "telemetry-update",
        title: "Telemetry Update",
      }],
      ["DELETE", `recipes/${fixture.recipe.id}`, "/api/v1/recipes/{id}", "req_recipe_delete_auth_operation", "recipes.delete", {
        clientMutationId: "telemetry-delete",
      }],
      ["POST", `recipes/${fixture.recipe.id}/fork`, "/api/v1/recipes/{id}/fork", "req_recipe_fork_auth_operation", "recipes.fork", {
        clientMutationId: "telemetry-fork",
      }],
      ["POST", "recipes/import", "/api/v1/recipes/import", "req_recipe_import_auth_operation", "recipes.import", {
        clientMutationId: "telemetry-import",
        source: {
          type: "text",
          text: "Telemetry import should not leak this text.",
        },
      }],
    ] as const) {
      const request = apiJsonRequest(method, path, requestId, {}, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(401);
      expectApiV1ErrorEvent({
        routeTemplate,
        requestId,
        status: 401,
        errorCode: "authentication_required",
        authMode: "anonymous",
        operation,
        privacyClass: "private",
        forbidden: [request.bodyText, fixture.recipe.title],
      });
    }
  });

  it("captures cookbook write operation names on authentication failures", async () => {
    const fixture = await createCookbookFixture(db);

    for (const [method, path, routeTemplate, requestId, operation, body] of [
      ["POST", "cookbooks", "/api/v1/cookbooks", "req_cookbook_create_auth_operation", "cookbooks.create", {
        clientMutationId: "telemetry-cookbook-create",
        title: "Telemetry Cookbook Create",
      }],
      ["PATCH", `cookbooks/${fixture.cookbook.id}`, "/api/v1/cookbooks/{id}", "req_cookbook_update_auth_operation", "cookbooks.update", {
        clientMutationId: "telemetry-cookbook-update",
        title: "Telemetry Cookbook Update",
      }],
      ["DELETE", `cookbooks/${fixture.cookbook.id}`, "/api/v1/cookbooks/{id}", "req_cookbook_delete_auth_operation", "cookbooks.delete", {
        clientMutationId: "telemetry-cookbook-delete",
      }],
      [
        "POST",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.recipe.id}`,
        "/api/v1/cookbooks/{id}/recipes/{recipeId}",
        "req_cookbook_recipe_add_auth_operation",
        "cookbooks.recipes.add",
        { clientMutationId: "telemetry-cookbook-recipe-add" },
      ],
      [
        "DELETE",
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.recipe.id}`,
        "/api/v1/cookbooks/{id}/recipes/{recipeId}",
        "req_cookbook_recipe_remove_auth_operation",
        "cookbooks.recipes.remove",
        { clientMutationId: "telemetry-cookbook-recipe-remove" },
      ],
    ] as const) {
      const request = apiJsonRequest(method, path, requestId, {}, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(401);
      expectApiV1ErrorEvent({
        routeTemplate,
        requestId,
        status: 401,
        errorCode: "authentication_required",
        authMode: "anonymous",
        operation,
        privacyClass: "private",
        forbidden: [request.bodyText, fixture.cookbook.id, fixture.recipe.id, fixture.cookbook.title],
      });
    }
  });

  it("captures recipe cover operation names on validation failures without leaking native payloads", async () => {
    const fixture = await createRecipeFixture(db);
    const credential = await createApiCredential(db, fixture.chef.id, "Telemetry Cover Writer", {
      scopes: ["kitchen:write"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };

    const coverList = routeArgs(
      apiRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/covers?includeArchived=maybe`, "req_cover_operation_list", auth),
      `recipes/${fixture.recipe.id}/covers`,
    );
    const coverListResponse = await loader(coverList.args);
    await Promise.all(coverList.scheduled);
    expect(coverListResponse.status).toBe(400);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/recipes/{id}/covers",
      requestId: "req_cover_operation_list",
      status: 400,
      errorCode: "validation_error",
      authMode: "bearer",
      operation: "recipes.covers.list",
      privacyClass: "authenticated",
      forbidden: [credential.token, credential.credential.tokenPrefix, fixture.recipe.id, "includeArchived=maybe"],
    });

    const upload = apiJsonRequest("POST", `recipes/${fixture.recipe.id}/image`, "req_cover_operation_upload", auth, {
      clientMutationId: "raw-upload-cover-mutation",
    });
    const uploadContext = routeArgs(upload.request, `recipes/${fixture.recipe.id}/image`);
    const uploadResponse = await action(uploadContext.args);
    await Promise.all(uploadContext.scheduled);
    expect(uploadResponse.status).toBe(400);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/recipes/{id}/image",
      requestId: "req_cover_operation_upload",
      status: 400,
      errorCode: "validation_error",
      authMode: "bearer",
      operation: "recipes.image.upload",
      privacyClass: "authenticated",
      forbidden: [upload.bodyText, "raw-upload-cover-mutation", credential.token, credential.credential.tokenPrefix],
    });

    for (const [method, path, routeTemplate, requestId, operation, body] of [
      ["POST", `recipes/${fixture.recipe.id}/covers`, "/api/v1/recipes/{id}/covers", "req_cover_operation_create", "recipes.covers.create", {
        clientMutationId: "raw-create-cover-mutation",
      }],
      ["PATCH", `recipes/${fixture.recipe.id}/covers/cover_telemetry`, "/api/v1/recipes/{id}/covers/{coverId}", "req_cover_operation_activate", "recipes.covers.activate", {
        clientMutationId: "raw-activate-cover-mutation",
        variant: "thumbnail",
      }],
      ["DELETE", `recipes/${fixture.recipe.id}/covers/cover_telemetry`, "/api/v1/recipes/{id}/covers/{coverId}", "req_cover_operation_archive", "recipes.covers.archive", {
        confirmNoCover: true,
      }],
      ["POST", `recipes/${fixture.recipe.id}/covers/regenerate`, "/api/v1/recipes/{id}/covers/regenerate", "req_cover_operation_regenerate", "recipes.covers.regenerate", {
        clientMutationId: "raw-regenerate-cover-mutation",
      }],
      ["POST", `recipes/${fixture.recipe.id}/covers/from-spoon/spoon_telemetry`, "/api/v1/recipes/{id}/covers/from-spoon/{spoonId}", "req_cover_operation_from_spoon", "recipes.covers.from-spoon", {
        activate: true,
      }],
    ] as const) {
      const request = apiJsonRequest(method, path, requestId, auth, body);
      const context = routeArgs(request.request, path);
      const response = await action(context.args);
      await Promise.all(context.scheduled);

      expect(response.status).toBe(400);
      expectApiV1ErrorEvent({
        routeTemplate,
        requestId,
        status: 400,
        errorCode: "validation_error",
        authMode: "bearer",
        operation,
        privacyClass: "authenticated",
        forbidden: [
          request.bodyText,
          fixture.recipe.id,
          "cover_telemetry",
          "spoon_telemetry",
          "raw-create-cover-mutation",
          "raw-activate-cover-mutation",
          "raw-regenerate-cover-mutation",
          credential.token,
          credential.credential.tokenPrefix,
        ],
      });
    }
  });

  it("captures recipe spoon operation names and validation outcomes without leaking native payloads", async () => {
    const fixture = await createRecipeFixture(db);
    const credential = await createApiCredential(db, fixture.chef.id, "Telemetry Spoon Writer", {
      scopes: ["kitchen:write", "recipes:read"],
    });
    const auth = { Authorization: `Bearer ${credential.token}` };
    const spoon = await db.recipeSpoon.create({
      data: {
        chefId: fixture.chef.id,
        recipeId: fixture.recipe.id,
        note: "Telemetry spoon text must stay out of analytics",
      },
    });

    const listContext = routeArgs(
      apiRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "req_spoon_operation_list", auth),
      `recipes/${fixture.recipe.id}/spoons`,
    );
    expect((await loader(listContext.args)).status).toBe(200);
    await Promise.all(listContext.scheduled);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/recipes/{id}/spoons",
      requestId: "req_spoon_operation_list",
      operation: "recipes.spoons.list",
      forbidden: [fixture.recipe.id, spoon.note!, credential.token, credential.credential.tokenPrefix],
    });

    for (const [method, path, routeTemplate, requestId, operation, body] of [
      ["POST", `recipes/${fixture.recipe.id}/spoons`, "/api/v1/recipes/{id}/spoons", "req_spoon_create_auth_operation", "recipes.spoons.create", {
        clientMutationId: "raw-spoon-create-mutation",
        note: "raw spoon create",
      }],
      ["PATCH", `recipes/${fixture.recipe.id}/spoons/${spoon.id}`, "/api/v1/recipes/{id}/spoons/{spoonId}", "req_spoon_update_auth_operation", "recipes.spoons.update", {
        clientMutationId: "raw-spoon-update-mutation",
        note: "raw spoon update",
      }],
      ["DELETE", `recipes/${fixture.recipe.id}/spoons/${spoon.id}`, "/api/v1/recipes/{id}/spoons/{spoonId}", "req_spoon_delete_auth_operation", "recipes.spoons.delete", {
        clientMutationId: "raw-spoon-delete-mutation",
      }],
    ] as const) {
      const request = apiJsonRequest(method, path, requestId, {}, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(401);
      expectApiV1ErrorEvent({
        routeTemplate,
        requestId,
        status: 401,
        errorCode: "authentication_required",
        authMode: "anonymous",
        operation,
        privacyClass: "private",
        forbidden: [request.bodyText, fixture.recipe.id, spoon.id, spoon.note!],
      });
    }

    const createNoContentType = routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
      method: "POST",
      headers: {
        ...auth,
        "X-Request-Id": "req_spoon_create_no_content_type",
        "User-Agent": "PostmanRuntime/7.39.0",
      },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`);
    expect((await action(createNoContentType.args)).status).toBe(400);
    await Promise.all(createNoContentType.scheduled);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons",
      requestId: "req_spoon_create_no_content_type",
      status: 400,
      errorCode: "validation_error",
      authMode: "bearer",
      operation: "recipes.spoons.create",
      privacyClass: "authenticated",
      forbidden: [fixture.recipe.id, credential.token, credential.credential.tokenPrefix],
    });

    const deleteWithQuery = routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${spoon.id}?clientMutationId=delete-query-mutation`,
      {
        method: "DELETE",
        headers: {
          ...auth,
          "X-Request-Id": "req_spoon_delete_query_mutation",
          "User-Agent": "PostmanRuntime/7.39.0",
        },
      },
    ) as unknown as Request, `recipes/${fixture.recipe.id}/spoons/${spoon.id}`);
    expect((await action(deleteWithQuery.args)).status).toBe(200);
    await Promise.all(deleteWithQuery.scheduled);
    expectApiV1OperationEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons/{spoonId}",
      requestId: "req_spoon_delete_query_mutation",
      operation: "recipes.spoons.delete",
      status: 200,
      authMode: "bearer",
      requestBytes: 0,
      idempotencyOutcome: "committed",
      forbidden: [fixture.recipe.id, spoon.id, "delete-query-mutation", credential.token, credential.credential.tokenPrefix],
    });

    const deleteMissingMutation = routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${spoon.id}`, {
      method: "DELETE",
      headers: {
        ...auth,
        "X-Request-Id": "req_spoon_delete_missing_mutation",
        "User-Agent": "PostmanRuntime/7.39.0",
      },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons/${spoon.id}`);
    expect((await action(deleteMissingMutation.args)).status).toBe(400);
    await Promise.all(deleteMissingMutation.scheduled);
    expectApiV1ErrorEvent({
      routeTemplate: "/api/v1/recipes/{id}/spoons/{spoonId}",
      requestId: "req_spoon_delete_missing_mutation",
      status: 400,
      errorCode: "validation_error",
      authMode: "bearer",
      operation: "recipes.spoons.delete",
      privacyClass: "authenticated",
      forbidden: [fixture.recipe.id, spoon.id, credential.token, credential.credential.tokenPrefix],
    });
  });

  it("captures recipe step operation names on authentication failures", async () => {
    const fixture = await createRecipeFixture(db);
    const stepId = "telemetry-step";
    const ingredientId = "telemetry-ingredient";

    for (const [method, path, routeTemplate, requestId, operation, body] of [
      ["POST", `recipes/${fixture.recipe.id}/steps`, "/api/v1/recipes/{id}/steps", "req_step_create_auth_operation", "recipes.steps.create", {
        clientMutationId: "telemetry-step-create",
        description: "Telemetry step create",
      }],
      ["PATCH", `recipes/${fixture.recipe.id}/steps/${stepId}`, "/api/v1/recipes/{id}/steps/{stepId}", "req_step_update_auth_operation", "recipes.steps.update", {
        clientMutationId: "telemetry-step-update",
        description: "Telemetry step update",
      }],
      ["DELETE", `recipes/${fixture.recipe.id}/steps/${stepId}`, "/api/v1/recipes/{id}/steps/{stepId}", "req_step_delete_auth_operation", "recipes.steps.delete", {
        clientMutationId: "telemetry-step-delete",
      }],
      ["POST", `recipes/${fixture.recipe.id}/steps/reorder`, "/api/v1/recipes/{id}/steps/reorder", "req_step_reorder_auth_operation", "recipes.steps.reorder", {
        clientMutationId: "telemetry-step-reorder",
        stepId,
        toStepNum: 2,
      }],
      ["POST", `recipes/${fixture.recipe.id}/steps/${stepId}/ingredients`, "/api/v1/recipes/{id}/steps/{stepId}/ingredients", "req_step_ingredient_create_auth_operation", "recipes.steps.ingredients.create", {
        clientMutationId: "telemetry-step-ingredient-create",
        quantity: 1,
        unit: "cup",
        name: "salt",
      }],
      ["DELETE", `recipes/${fixture.recipe.id}/steps/${stepId}/ingredients/${ingredientId}`, "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", "req_step_ingredient_delete_auth_operation", "recipes.steps.ingredients.delete", {
        clientMutationId: "telemetry-step-ingredient-delete",
      }],
      ["PUT", `recipes/${fixture.recipe.id}/step-output-uses`, "/api/v1/recipes/{id}/step-output-uses", "req_step_output_uses_auth_operation", "recipes.steps.output-uses.replace", {
        clientMutationId: "telemetry-step-output-uses",
        inputStepId: stepId,
        outputStepNums: [1],
      }],
    ] as const) {
      const request = apiJsonRequest(method, path, requestId, {}, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(401);
      expectApiV1ErrorEvent({
        routeTemplate,
        requestId,
        status: 401,
        errorCode: "authentication_required",
        authMode: "anonymous",
        operation,
        privacyClass: "private",
        forbidden: [request.bodyText, fixture.recipe.title, stepId, ingredientId],
      });
    }
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

  it("captures shopping-list recipe add and clear operations without body values", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Telemetry Shopping Parity Writer", {
      scopes: ["shopping_list:write"],
    });
    const recipe = await db.recipe.create({
      data: { title: `Telemetry Empty Recipe ${faker.string.alphanumeric(8)}`, chefId: user.id },
    });
    const auth = { Authorization: `Bearer ${credential.token}` };

    for (const [path, requestId, operation, body] of [
      ["shopping-list/add-from-recipe", "req_shopping_add_recipe_operation", "shopping-list.add-from-recipe", {
        clientMutationId: "raw-shopping-add-recipe-id",
        recipeId: recipe.id,
      }],
      ["shopping-list/clear-completed", "req_shopping_clear_completed_operation", "shopping-list.clear-completed", {
        clientMutationId: "raw-shopping-clear-completed-id",
      }],
      ["shopping-list/clear-all", "req_shopping_clear_all_operation", "shopping-list.clear-all", {
        clientMutationId: "raw-shopping-clear-all-id",
      }],
    ] as const) {
      const request = apiJsonRequest("POST", path, requestId, auth, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(200);
      expectApiV1OperationEvent({
        routeTemplate: `/api/v1/${path}`,
        requestId,
        operation,
        status: 200,
        authMode: "bearer",
        requestBytes: request.bodyBytes,
        idempotencyOutcome: "committed",
        forbidden: [request.bodyText, body.clientMutationId, recipe.id, recipe.title, credential.token],
      });
    }
  });

  it("captures shopping-list parity operation names on authentication failures", async () => {
    for (const [path, requestId, operation, body] of [
      ["shopping-list/add-from-recipe", "req_shopping_add_recipe_auth_operation", "shopping-list.add-from-recipe", {
        clientMutationId: "telemetry-shopping-add-auth",
        recipeId: "recipe_secret",
      }],
      ["shopping-list/clear-completed", "req_shopping_clear_completed_auth_operation", "shopping-list.clear-completed", {
        clientMutationId: "telemetry-shopping-clear-completed-auth",
      }],
      ["shopping-list/clear-all", "req_shopping_clear_all_auth_operation", "shopping-list.clear-all", {
        clientMutationId: "telemetry-shopping-clear-all-auth",
      }],
    ] as const) {
      const request = apiJsonRequest("POST", path, requestId, {}, body);
      const response = await action(routeArgs(request.request, path).args);

      expect(response.status).toBe(401);
      expectApiV1ErrorEvent({
        routeTemplate: `/api/v1/${path}`,
        requestId,
        status: 401,
        errorCode: "authentication_required",
        authMode: "anonymous",
        operation,
        privacyClass: "private",
        forbidden: [request.bodyText, body.clientMutationId],
      });
    }
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

  it("captures native account operation names without account secrets", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const client = await db.oAuthClient.create({
      data: {
        clientName: "Telemetry account client",
        redirectUris: "https://telemetry.example/callback",
      },
    });
    const resource = "https://spoonjoy.app/mcp";
    await db.oAuthRefreshToken.create({
      data: {
        tokenHash: `refresh-${faker.string.alphanumeric(16)}`,
        userId: user.id,
        clientId: client.id,
        resource,
        scope: "recipes:read",
      },
    });

    const read = await loader(routeArgs(apiRequest("http://localhost/api/v1/me", "req_account_operation_read", {
      Cookie: cookie,
    }), "me").args);
    expect(read.status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me",
      requestId: "req_account_operation_read",
      operation: "account.read",
      forbidden: [user.email],
    });

    const update = apiJsonRequest("PATCH", "me", "req_account_operation_update", { Cookie: cookie }, {
      username: `telemetry_${faker.string.alphanumeric(8)}`,
    });
    expect((await action(routeArgs(update.request, "me").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me",
      requestId: "req_account_operation_update",
      operation: "account.update",
      forbidden: [update.bodyText],
    });

    const formData = new UndiciFormData();
    formData.append("photo", new File([new TextEncoder().encode("GIF89a")], "profile.gif", { type: "image/gif" }));
    const upload = new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Request-Id": "req_account_operation_photo_upload",
        Origin: "https://client.example",
        Referer: "https://docs.example/start?token=secret",
        "User-Agent": "PostmanRuntime/7.39.0",
      },
      body: formData,
    }) as unknown as Request;
    expect((await action(routeArgs(upload, "me/photo").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/photo",
      requestId: "req_account_operation_photo_upload",
      operation: "account.photo.upload",
      forbidden: ["GIF89a"],
    });

    expect((await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Request-Id": "req_account_operation_photo_remove" },
    }) as unknown as Request, "me/photo").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/photo",
      requestId: "req_account_operation_photo_remove",
      operation: "account.photo.remove",
    });

    expect((await loader(routeArgs(apiRequest("http://localhost/api/v1/me/kitchen", "req_account_operation_kitchen", {
      Cookie: cookie,
    }), "me/kitchen").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/kitchen",
      requestId: "req_account_operation_kitchen",
      operation: "account.kitchen.bootstrap",
    });

    const syncReader = await createApiCredential(db, user.id, "Telemetry sync reader", { scopes: ["kitchen:read"] });
    expect((await loader(routeArgs(apiRequest("http://localhost/api/v1/me/sync", "req_account_operation_sync", {
      Authorization: `Bearer ${syncReader.token}`,
    }), "me/sync").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/sync",
      requestId: "req_account_operation_sync",
      operation: "account.sync",
      forbidden: [user.email, syncReader.token],
    });

    expect((await loader(routeArgs(apiRequest(
      "http://localhost/api/v1/me/notification-preferences",
      "req_account_operation_notifications_read",
      { Cookie: cookie },
    ), "me/notification-preferences").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/notification-preferences",
      requestId: "req_account_operation_notifications_read",
      operation: "account.notifications.read",
    });

    const prefs = apiJsonRequest(
      "PATCH",
      "me/notification-preferences",
      "req_account_operation_notifications_update",
      { Cookie: cookie },
      { notifySpoonOnMyRecipe: false },
    );
    expect((await action(routeArgs(prefs.request, "me/notification-preferences").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/notification-preferences",
      requestId: "req_account_operation_notifications_update",
      operation: "account.notifications.update",
      forbidden: [prefs.bodyText],
    });

    const apnsToken = `apns-token-${faker.string.alphanumeric(32)}`;
    const apns = apiJsonRequest("POST", "me/apns-devices", "req_account_operation_apns_register", { Cookie: cookie }, {
      deviceId: "telemetry-device",
      platform: "ios",
      environment: "development",
      token: apnsToken,
    });
    expect((await action(routeArgs(apns.request, "me/apns-devices").args)).status).toBe(201);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/apns-devices",
      requestId: "req_account_operation_apns_register",
      operation: "account.apns.register",
      status: 201,
      forbidden: [apnsToken, apns.bodyText],
    });

    expect((await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/apns-devices/telemetry-device", {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Request-Id": "req_account_operation_apns_revoke" },
    }) as unknown as Request, "me/apns-devices/telemetry-device").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/apns-devices/{deviceId}",
      requestId: "req_account_operation_apns_revoke",
      operation: "account.apns.revoke",
      forbidden: ["telemetry-device"],
    });

    expect((await loader(routeArgs(apiRequest(
      "http://localhost/api/v1/me/connections",
      "req_account_operation_connections_list",
      { Cookie: cookie },
    ), "me/connections").args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/connections",
      requestId: "req_account_operation_connections_list",
      operation: "account.connections.list",
      forbidden: [client.clientName ?? "", client.id],
    });

    const connectionId = `oauth_${Buffer.from(JSON.stringify({ clientId: client.id, resource })).toString("base64url")}`;
    expect((await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/me/connections/${connectionId}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Request-Id": "req_account_operation_connection_disconnect" },
    }) as unknown as Request, `me/connections/${connectionId}`).args)).status).toBe(200);
    expectApiV1OperationName({
      routeTemplate: "/api/v1/me/connections/{connectionId}",
      requestId: "req_account_operation_connection_disconnect",
      operation: "account.connections.disconnect",
      forbidden: [connectionId, client.id],
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
  });

  it("captures internal errors without stack traces or exception messages in lifecycle telemetry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(apiAuth, "authenticateApiRequest").mockRejectedValueOnce(new Error("auth storage unavailable"));
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
