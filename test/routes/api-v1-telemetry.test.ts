import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
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
});
