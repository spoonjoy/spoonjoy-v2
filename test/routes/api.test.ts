import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { action, loader } from "~/routes/api.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { captureEvent, captureException } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import * as recipeImport from "~/lib/recipe-import.server";
import { ImportRecipeError } from "~/lib/recipe-import.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { getOrCreateIngredientRef } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
  captureException: vi.fn(async () => undefined),
}));

function uniqueEmail(prefix = "rest") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env, ctx: { waitUntil } } },
    waitUntil,
  } as any;
}

function streamRequest(url: string, body: string, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const chunks = [body.slice(0, Math.ceil(body.length / 2)), body.slice(Math.ceil(body.length / 2))];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
  });
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function legacyTelemetryInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectLegacyEvent(input: {
  requestId: string;
  operation?: string;
  status: number;
  authMode: "anonymous" | "bearer" | "oauth_bearer" | "session";
  routeTemplate?: string;
  errorCode?: string;
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = legacyTelemetryInputs().find((candidate) => (
    candidate.event === "spoonjoy.legacy_api.request" &&
    candidate.properties?.request_id === input.requestId &&
    candidate.properties?.status === input.status &&
    (!input.routeTemplate || candidate.properties?.route_template === input.routeTemplate)
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.legacy_api.request",
    properties: {
      route_template: input.routeTemplate ?? "/api/{operation}",
      operation: input.operation,
      status: input.status,
      request_id: input.requestId,
      auth_mode: input.authMode,
      error_code: input.errorCode,
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
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
  return eventInput;
}

describe("Spoonjoy REST API route", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("serves discovery, health, tools, and CORS preflight", async () => {
    const root = await loader(routeArgs(new UndiciRequest("http://localhost/api"), ""));
    await expect(readJson(root)).resolves.toMatchObject({ ok: true, data: { app: "spoonjoy-v2" } });

    const rootWithoutSplatParam = await loader({
      request: new UndiciRequest("http://localhost/api"),
      params: {},
      context: { cloudflare: { env: null } },
    } as any);
    await expect(readJson(rootWithoutSplatParam)).resolves.toMatchObject({ ok: true, data: { app: "spoonjoy-v2" } });

    const health = await loader(routeArgs(new UndiciRequest("http://localhost/api/health"), "health"));
    await expect(readJson(health)).resolves.toMatchObject({ ok: true, data: { ok: true, authenticated: false, writable: false } });

    const tools = await loader(routeArgs(new UndiciRequest("http://localhost/api/tools"), "tools"));
    const toolsPayload = await readJson(tools);
    expect(toolsPayload.data.operations.map((operation: { name: string }) => operation.name)).toContain("search_spoonjoy");
    const toolsWithBadBearer = await loader(routeArgs(new UndiciRequest("http://localhost/api/tools", {
      headers: { Authorization: "Bearer literal-bootstrap-placeholder" },
    }), "tools"));
    await expect(readJson(toolsWithBadBearer)).resolves.toMatchObject({ ok: true });

    const options = await action(routeArgs(new UndiciRequest("http://localhost/api/search", { method: "OPTIONS" }), "search"));
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("keeps public search from leaking private shopping-list data", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    const ingredientRef = await getOrCreateIngredientRef(db, "rest private milk");
    await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id } });

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/search?query=milk&scope=all"), "search"));
    const payload = await readJson(response);
    expect(payload).toMatchObject({ ok: true, data: { query: "milk", scope: "all" } });
    expect(payload.data.results.some((result: { type: string }) => result.type === "shopping-list-item")).toBe(false);
  });

  it("rejects MCP audience-bound OAuth tokens on the legacy REST surface", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "MCP-bound OAuth token", {
      scopes: ["kitchen:read"],
      oauthClientId: "oauth_client_mcp",
      oauthResource: "https://spoonjoy.app/mcp",
    });

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/search?query=pasta", {
      headers: { Authorization: `Bearer ${token}` },
    }), "search"));

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      error: {
        status: 403,
        message: "OAuth access token is bound to a protected resource and cannot call legacy /api routes.",
      },
    });
  });

  it("rejects oversized legacy tool Content-Length before operation dispatch", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "Legacy upload token", { scopes: ["kitchen:write"] });
    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/tools/upload_recipe_image", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": String(8 * 1024 * 1024),
      },
      body: JSON.stringify({ imageBase64: "", mimeType: "image/png", filename: "big.png" }),
    }), "tools/upload_recipe_image"));

    expect(response.status).toBe(413);
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      error: { message: "Request body is too large.", status: 413 },
    });
  });

  it("rejects oversized legacy tool streaming bodies while reading before operation dispatch", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "Legacy upload token", { scopes: ["kitchen:write"] });
    const body = JSON.stringify({
      imageBase64: "a".repeat(8 * 1024 * 1024),
      mimeType: "image/png",
      filename: "big.png",
    });
    const response = await action(routeArgs(streamRequest(
      "http://localhost/api/tools/upload_recipe_image",
      body,
      { Authorization: `Bearer ${token}` },
    ), "tools/upload_recipe_image"));

    expect(response.status).toBe(413);
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      error: { message: "Request body is too large.", status: 413 },
    });
  });

  it("coerces legacy REST query and body edge cases before dispatch", async () => {
    await expect(readJson(await loader(routeArgs(
      new UndiciRequest("http://localhost/api/search?duration=2&limit=abc&quantity=3&checked=true"),
      "search",
    )))).resolves.toMatchObject({ ok: true });
    await expect(readJson(await loader(routeArgs(
      new UndiciRequest("http://localhost/api/search?checked=false"),
      "search",
    )))).resolves.toMatchObject({ ok: true });
    await expect(readJson(await loader(routeArgs(
      new UndiciRequest("http://localhost/api/search?checked=maybe"),
      "search",
    )))).resolves.toMatchObject({ ok: true });
    await expect(readJson(await loader(routeArgs(
      new UndiciRequest("http://localhost/api/shopping-list/search"),
      "shopping-list/search",
    )))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await loader(routeArgs(
      new UndiciRequest("http://localhost/api/tokens"),
      "tokens",
    )))).resolves.toMatchObject({ ok: false, error: { status: 401 } });

    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Length": "0" },
    }), "tokens")))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "ignored",
    }), "tokens")))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "   ",
    }), "tokens")))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    }), "tokens")))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    }), "tokens")))).resolves.toMatchObject({
      ok: false,
      error: { status: 400, message: "JSON body must be an object" },
    });
    await expect(readJson(await action(routeArgs(
      new UndiciRequest("http://localhost/api/tokens/credential-1", { method: "DELETE" }),
      "tokens/credential-1",
    )))).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    await expect(readJson(await action(routeArgs(new UndiciRequest("http://localhost/api/nope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), "nope")))).resolves.toMatchObject({ ok: false, error: { status: 404 } });
  });

  it("creates tokens from a session and then uses bearer auth for shopping-list REST calls", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const cookie = await sessionCookie(user.id);

    const createTokenResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "External REST client" }),
    }), "tokens"));
    const tokenPayload = await readJson(createTokenResponse);
    expect(tokenPayload).toMatchObject({ ok: true, data: { credential: { name: "External REST client" } } });
    const token = tokenPayload.data.token as string;

    const addItemResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/shopping-list/items", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Eggs", quantity: 12, unit: "Each" }),
    }), "shopping-list/items"));
    await expect(readJson(addItemResponse)).resolves.toMatchObject({
      ok: true,
      data: { created: 1, shoppingList: { items: [{ name: "eggs", quantity: 12, unit: "each" }] } },
    });

    const listResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/shopping-list", {
      headers: { Authorization: `Bearer ${token}` },
    }), "shopping-list"));
    const listPayload = await readJson(listResponse);
    expect(listPayload.data.shoppingList.items[0]).toMatchObject({ name: "eggs", checked: false });

    const itemId = listPayload.data.shoppingList.items[0].id as string;
    const checkedResponse = await action(routeArgs(new UndiciRequest(`http://localhost/api/shopping-list/items/${itemId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ checked: true }),
    }), `shopping-list/items/${itemId}`));
    await expect(readJson(checkedResponse)).resolves.toMatchObject({
      ok: true,
      data: { shoppingList: { items: [{ id: itemId, checked: true }] } },
    });

    const removeResponse = await action(routeArgs(new UndiciRequest(`http://localhost/api/shopping-list/items/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }), `shopping-list/items/${itemId}`));
    await expect(readJson(removeResponse)).resolves.toMatchObject({ ok: true, data: { shoppingList: { items: [] } } });
  });

  it("exposes generic tool calls without allowing unauthenticated ownerEmail writes", async () => {
    const connectionResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/tools/start_agent_connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "slugger", baseUrl: "https://spoonjoy.app" }),
    }), "tools/start_agent_connection"));
    const connectionPayload = await readJson(connectionResponse);
    expect(connectionPayload).toMatchObject({
      ok: true,
      data: {
        deviceCode: expect.stringMatching(/^sjdc_/),
        authorizationUrl: expect.stringContaining("https://spoonjoy.app/agent/connect/"),
      },
    });

    const staleVaultTokenResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/tools/start_agent_connection", {
      method: "POST",
      headers: { Authorization: "Bearer stale-vault-token", "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "slugger", baseUrl: "https://spoonjoy.app" }),
    }), "tools/start_agent_connection"));
    await expect(readJson(staleVaultTokenResponse)).resolves.toMatchObject({
      ok: true,
      data: {
        authorizationUrl: expect.stringContaining("https://spoonjoy.app/agent/connect/"),
      },
    });

    const blocked = await action(routeArgs(new UndiciRequest("http://localhost/api/tools/create_recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEmail: uniqueEmail("attacker"), title: "Remote takeover soup" }),
    }), "tools/create_recipe"));
    await expect(readJson(blocked)).resolves.toMatchObject({
      ok: false,
      error: { status: 401, message: expect.stringContaining("ownerEmail is required") },
    });
  });

  it("routes recipe and cookbook REST endpoints through the shared operation layer", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "REST recipe token", { scopes: ["kitchen:read", "kitchen:write"] });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const recipeResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/recipes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "REST Pasta",
        description: "API-born dinner",
        steps: [{ description: "Boil", ingredients: [{ name: "Pasta", quantity: 1, unit: "Lb" }] }],
      }),
    }), "recipes"));
    const recipePayload = await readJson(recipeResponse);
    const recipeId = recipePayload.data.recipe.id as string;
    expect(recipePayload.data.recipe.title).toBe("REST Pasta");

    await expect(readJson(await loader(routeArgs(new UndiciRequest(`http://localhost/api/recipes/${recipeId}`), `recipes/${recipeId}`))))
      .resolves.toMatchObject({ ok: true, data: { recipe: { id: recipeId, title: "REST Pasta" } } });
    await expect(readJson(await loader(routeArgs(new UndiciRequest("http://localhost/api/recipes?query=Pasta&limit=1"), "recipes"))))
      .resolves.toMatchObject({ ok: true, data: { recipes: [{ id: recipeId }] } });

    const cookbookResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/cookbooks", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "REST Menus" }),
    }), "cookbooks"));
    const cookbookPayload = await readJson(cookbookResponse);
    const cookbookId = cookbookPayload.data.cookbook.id as string;

    await expect(readJson(await action(routeArgs(new UndiciRequest(`http://localhost/api/cookbooks/${cookbookId}/recipes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipeId }),
    }), `cookbooks/${cookbookId}/recipes`))))
      .resolves.toMatchObject({ ok: true, data: { added: true, cookbook: { recipeCount: 1 } } });
    await expect(readJson(await loader(routeArgs(new UndiciRequest(`http://localhost/api/cookbooks/${cookbookId}`, { headers }), `cookbooks/${cookbookId}`))))
      .resolves.toMatchObject({ ok: true, data: { cookbook: { id: cookbookId, recipeCount: 1 } } });
    await expect(readJson(await loader(routeArgs(new UndiciRequest("http://localhost/api/cookbooks?query=REST", { headers }), "cookbooks"))))
      .resolves.toMatchObject({ ok: true, data: { cookbooks: [{ id: cookbookId }] } });
    await expect(readJson(await action(routeArgs(new UndiciRequest(`http://localhost/api/cookbooks/${cookbookId}/recipes/${recipeId}`, {
      method: "DELETE",
      headers,
    }), `cookbooks/${cookbookId}/recipes/${recipeId}`))))
      .resolves.toMatchObject({ ok: true, data: { removed: true, cookbook: { recipeCount: 0 } } });
    await expect(readJson(await action(routeArgs(new UndiciRequest(`http://localhost/api/recipes/${recipeId}/shopping-list`, {
      method: "POST",
      headers,
    }), `recipes/${recipeId}/shopping-list`))))
      .resolves.toMatchObject({ ok: true, data: { created: 1 } });
  });

  it("preserves the exact legacy envelopes for both shared shopping-list writers", async () => {
    const manualOwner = await db.user.create({
      data: { email: uniqueEmail("legacy-manual-shape"), username: faker.internet.username() },
    });
    const manualCredential = await createApiCredential(db, manualOwner.id, "Legacy manual shape", {
      scopes: ["shopping_list:write"],
    });
    const manualResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/shopping-list/items", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${manualCredential.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Legacy shape milk",
        quantity: 2,
        unit: "Gallon",
        categoryKey: "dairy",
        iconKey: "milk",
      }),
    }), "shopping-list/items"));
    expect(manualResponse.status).toBe(200);
    await expect(readJson(manualResponse)).resolves.toEqual({
      ok: true,
      data: {
        created: 1,
        updated: 0,
        shoppingList: {
          id: expect.any(String),
          ownerId: manualOwner.id,
          items: [{
            id: expect.any(String),
            quantity: 2,
            unit: "gallon",
            name: "legacy shape milk",
            checked: false,
            categoryKey: "dairy",
            iconKey: "milk",
            sortIndex: 0,
          }],
        },
      },
    });

    const recipeOwner = await db.user.create({
      data: { email: uniqueEmail("legacy-recipe-shape"), username: faker.internet.username() },
    });
    const recipeCredential = await createApiCredential(db, recipeOwner.id, "Legacy recipe shape", {
      scopes: ["shopping_list:write"],
    });
    const recipe = await db.recipe.create({
      data: { chefId: recipeOwner.id, title: "Legacy shopping shape recipe" },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Add beans" },
    });
    const recipeUnit = await db.unit.create({ data: { name: `shape-can-${faker.string.alphanumeric(6).toLowerCase()}` } });
    const recipeIngredient = await db.ingredientRef.create({
      data: { name: `shape-beans-${faker.string.alphanumeric(6).toLowerCase()}` },
    });
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 3,
        unitId: recipeUnit.id,
        ingredientRefId: recipeIngredient.id,
      },
    });

    const recipeResponse = await action(routeArgs(new UndiciRequest(
      `http://localhost/api/recipes/${recipe.id}/shopping-list`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${recipeCredential.token}` },
      },
    ), `recipes/${recipe.id}/shopping-list`));
    expect(recipeResponse.status).toBe(200);
    await expect(readJson(recipeResponse)).resolves.toEqual({
      ok: true,
      data: {
        created: 1,
        updated: 0,
        shoppingList: {
          id: expect.any(String),
          ownerId: recipeOwner.id,
          items: [{
            id: expect.any(String),
            quantity: 3,
            unit: recipeUnit.name,
            name: recipeIngredient.name,
            checked: false,
            categoryKey: null,
            iconKey: null,
            sortIndex: 0,
          }],
        },
      },
    });
  });

  it("maps a real membership-insert fence to the frozen legacy activation response and rolls back", async () => {
    vi.mocked(captureException).mockClear();
    const user = await db.user.create({
      data: { email: uniqueEmail("legacy-fenced-add"), username: faker.internet.username() },
    });
    const credential = await createApiCredential(db, user.id, "Legacy fenced add", {
      scopes: ["kitchen:write"],
    });
    const recipe = await db.recipe.create({ data: { chefId: user.id, title: "Fenced legacy add recipe" } });
    const cookbook = await db.cookbook.create({ data: { authorId: user.id, title: "Fenced legacy add cookbook" } });
    // Native Prisma erases RAISE text as P2003; the Workers D1 suite covers
    // the production trigger while this preserves the token for local mapping.
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "SavedRecipe_cutover_block_membership_insert"
      BEFORE INSERT ON "RecipeInCookbook"
      BEGIN
        SELECT * FROM saved_recipe_cutover_pending;
      END
    `);

    try {
      const response = await action(routeArgs(new UndiciRequest(
        `http://localhost/api/cookbooks/${cookbook.id}/recipes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "Content-Type": "application/json",
            "X-Request-Id": "req_legacy_product_pending_add",
          },
          body: JSON.stringify({ recipeId: recipe.id }),
        },
      ), `cookbooks/${cookbook.id}/recipes`, { POSTHOG_KEY: "ph_test" }));

      await expect(db.recipeInCookbook.count({ where: { cookbookId: cookbook.id, recipeId: recipe.id } }))
        .resolves.toBe(0);
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(readJson(response)).resolves.toEqual({
        ok: false,
        error: {
          message: "Spoonjoy product activation is still completing. Retry shortly.",
          status: 503,
        },
      });
      expectLegacyEvent({
        requestId: "req_legacy_product_pending_add",
        operation: "add_recipe_to_cookbook",
        status: 503,
        authMode: "bearer",
        errorCode: "product_activation_pending",
      });
      expect(captureException).not.toHaveBeenCalled();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SavedRecipe_cutover_block_membership_insert"');
    }
  });

  it("maps a real membership-delete fence to the frozen legacy activation response and preserves membership", async () => {
    vi.mocked(captureException).mockClear();
    const user = await db.user.create({
      data: { email: uniqueEmail("legacy-fenced-remove"), username: faker.internet.username() },
    });
    const credential = await createApiCredential(db, user.id, "Legacy fenced remove", {
      scopes: ["kitchen:write"],
    });
    const recipe = await db.recipe.create({ data: { chefId: user.id, title: "Fenced legacy remove recipe" } });
    const cookbook = await db.cookbook.create({ data: { authorId: user.id, title: "Fenced legacy remove cookbook" } });
    const membership = await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: user.id },
    });
    // Native Prisma erases RAISE text as P2003; the Workers D1 suite covers
    // the production trigger while this preserves the token for local mapping.
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "SavedRecipe_cutover_block_membership_delete"
      BEFORE DELETE ON "RecipeInCookbook"
      BEGIN
        SELECT * FROM saved_recipe_cutover_pending;
      END
    `);

    try {
      const response = await action(routeArgs(new UndiciRequest(
        `http://localhost/api/cookbooks/${cookbook.id}/recipes/${recipe.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "X-Request-Id": "req_legacy_product_pending_remove",
          },
        },
      ), `cookbooks/${cookbook.id}/recipes/${recipe.id}`, { POSTHOG_KEY: "ph_test" }));

      await expect(db.recipeInCookbook.findUnique({ where: { id: membership.id } })).resolves.toMatchObject({
        id: membership.id,
        cookbookId: cookbook.id,
        recipeId: recipe.id,
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(readJson(response)).resolves.toEqual({
        ok: false,
        error: {
          message: "Spoonjoy product activation is still completing. Retry shortly.",
          status: 503,
        },
      });
      expectLegacyEvent({
        requestId: "req_legacy_product_pending_remove",
        operation: "remove_recipe_from_cookbook",
        status: 503,
        authMode: "bearer",
        errorCode: "product_activation_pending",
      });
      expect(captureException).not.toHaveBeenCalled();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SavedRecipe_cutover_block_membership_delete"');
    }
  });

  it("returns structured REST errors", async () => {
    const badJson = await action(routeArgs(new UndiciRequest("http://localhost/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }), "tokens"));
    await expect(readJson(badJson)).resolves.toMatchObject({ ok: false, error: { status: 400, message: "Invalid JSON body" } });

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/shopping-list"), "shopping-list"));
    await expect(readJson(missingAuth)).resolves.toMatchObject({ ok: false, error: { status: 401 } });

    const missingEndpoint = await loader(routeArgs(new UndiciRequest("http://localhost/api/nope"), "nope"));
    await expect(readJson(missingEndpoint)).resolves.toMatchObject({ ok: false, error: { status: 404 } });

    const missingDeviceCode = await action(routeArgs(new UndiciRequest("http://localhost/api/tools/poll_agent_connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), "tools/poll_agent_connection"));
    expect(missingDeviceCode.status).toBe(400);
    await expect(readJson(missingDeviceCode)).resolves.toMatchObject({
      ok: false,
      error: { status: 400, message: "deviceCode is required" },
    });
  });

  it("returns 429 with Retry-After when the rate limiter denies the request", async () => {
    const env = {
      API_TOKEN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    };
    const request = new UndiciRequest("http://localhost/api/health", {
      headers: { Authorization: "Bearer sj_throttled_token" },
    });
    const response = await loader({
      request: request as any,
      params: { "*": "health" },
      context: { cloudflare: { env } },
    } as any);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    // CORS headers should still be present so browser clients can read the response
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await readJson(response);
    expect(body).toMatchObject({
      error: "rate_limited",
      retryAfterSeconds: 60,
    });
  });

  it("captures safe legacy REST telemetry for public success, bearer success, auth errors, not-found, and rate limits", async () => {
    const telemetryEnv = { POSTHOG_KEY: "ph_test" };
    const publicResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/health", {
      headers: {
        "X-Request-Id": "req_legacy_health",
        Origin: "https://client.example",
        Referer: "https://docs.example/start?token=secret",
        "User-Agent": "curl/8.7.1",
      },
    }), "health", telemetryEnv));

    expect(publicResponse.status).toBe(200);
    expectLegacyEvent({
      requestId: "req_legacy_health",
      operation: "health",
      status: 200,
      authMode: "anonymous",
      forbidden: ["token=secret", "curl/8.7.1"],
    });

    const unsafeRequestId = "Bearer sj_request_id_secret";
    const unsafeRequestIdResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/health", {
      headers: {
        "X-Request-Id": unsafeRequestId,
      },
    }), "health", telemetryEnv));
    expect(unsafeRequestIdResponse.status).toBe(200);
    expectLegacyEvent({
      requestId: "unknown",
      operation: "health",
      status: 200,
      authMode: "anonymous",
      forbidden: [unsafeRequestId, "sj_request_id_secret"],
    });

    const user = await db.user.create({ data: { email: uniqueEmail("telemetry"), username: faker.internet.username() } });
    const credential = await createApiCredential(db, user.id, "Legacy Telemetry Reader", { scopes: ["kitchen:read"] });
    const bearerResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/shopping-list", {
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "X-Request-Id": "req_legacy_bearer",
      },
    }), "shopping-list", telemetryEnv));

    expect(bearerResponse.status).toBe(200);
    expectLegacyEvent({
      requestId: "req_legacy_bearer",
      operation: "get_shopping_list",
      status: 200,
      authMode: "bearer",
      forbidden: [
        credential.token,
        credential.credential.tokenPrefix,
        "Legacy Telemetry Reader",
        user.email,
        user.username,
      ],
    });

    const oauthCredential = await createApiCredential(db, user.id, "Legacy OAuth Client Reader", {
      scopes: ["kitchen:read"],
      oauthClientId: "legacy-oauth-client",
    });
    const oauthBearerResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/shopping-list", {
      headers: {
        Authorization: `Bearer ${oauthCredential.token}`,
        "X-Request-Id": "req_legacy_oauth_bearer",
      },
    }), "shopping-list", telemetryEnv));

    expect(oauthBearerResponse.status).toBe(200);
    const oauthEvent = expectLegacyEvent({
      requestId: "req_legacy_oauth_bearer",
      operation: "get_shopping_list",
      status: 200,
      authMode: "oauth_bearer",
      forbidden: [oauthCredential.token, oauthCredential.credential.tokenPrefix, "Legacy OAuth Client Reader"],
    });
    expect(oauthEvent!.properties).toMatchObject({
      oauth_client_id: "legacy-oauth-client",
      oauth_resource: null,
    });

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/shopping-list", {
      headers: { "X-Request-Id": "req_legacy_missing_auth" },
    }), "shopping-list", telemetryEnv));
    expect(missingAuth.status).toBe(401);
    expectLegacyEvent({
      requestId: "req_legacy_missing_auth",
      operation: "get_shopping_list",
      status: 401,
      authMode: "anonymous",
      errorCode: "api_auth_error",
    });

    const unknown = await loader(routeArgs(new UndiciRequest("http://localhost/api/unknown-secret-path", {
      headers: { "X-Request-Id": "req_legacy_unknown" },
    }), "unknown-secret-path", telemetryEnv));
    expect(unknown.status).toBe(404);
    expectLegacyEvent({
      requestId: "req_legacy_unknown",
      status: 404,
      authMode: "anonymous",
      routeTemplate: "/api/{unknown}",
      errorCode: "api_auth_error",
      forbidden: ["unknown-secret-path"],
    });

    const rawToolName = "sj_tool_path_secret@example.com";
    const unknownTool = await action(routeArgs(new UndiciRequest(`http://localhost/api/tools/${encodeURIComponent(rawToolName)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "req_legacy_unknown_tool",
      },
      body: "{}",
    }), `tools/${rawToolName}`, telemetryEnv));
    expect(unknownTool.status).toBe(404);
    expectLegacyEvent({
      requestId: "req_legacy_unknown_tool",
      status: 404,
      authMode: "anonymous",
      routeTemplate: "/api/{unknown}",
      errorCode: "api_auth_error",
      forbidden: [rawToolName, "sj_tool_path_secret"],
    });

    const malformedSplat = "%E0%A4%A";
    const malformed = await loader(routeArgs(new UndiciRequest(`http://localhost/api/${malformedSplat}`, {
      headers: { "X-Request-Id": "req_legacy_malformed_path" },
    }), malformedSplat, telemetryEnv));
    expect(malformed.status).toBe(500);
    expectLegacyEvent({
      requestId: "req_legacy_malformed_path",
      status: 500,
      authMode: "anonymous",
      routeTemplate: "/api/{unknown}",
      errorCode: "internal_error",
      forbidden: [malformedSplat],
    });

    const token = "sj_legacy_rate_limited_secret";
    const throttled = await loader(routeArgs(new UndiciRequest("http://localhost/api/health", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": "req_legacy_rate_limited",
      },
    }), "health", {
      POSTHOG_KEY: "ph_test",
      API_TOKEN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    }));
    expect(throttled.status).toBe(429);
    expectLegacyEvent({
      requestId: "req_legacy_rate_limited",
      operation: "health",
      status: 429,
      authMode: "anonymous",
      errorCode: "rate_limited",
      rateLimitScope: "token",
      forbidden: [token],
    });

    const throttledTools = await loader(routeArgs(new UndiciRequest("http://localhost/api/tools", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": "req_legacy_rate_limited_tools",
      },
    }), "tools", {
      POSTHOG_KEY: "ph_test",
      API_TOKEN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    }));
    expect(throttledTools.status).toBe(429);
    expectLegacyEvent({
      requestId: "req_legacy_rate_limited_tools",
      operation: "tools",
      status: 429,
      authMode: "anonymous",
      errorCode: "rate_limited",
      rateLimitScope: "token",
      forbidden: [token],
    });

    const throttledMissingSplat = await loader({
      request: new UndiciRequest("http://localhost/api/health", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": "req_legacy_rate_limited_missing_splat",
        },
      }),
      params: {},
      context: {
        cloudflare: {
          env: {
            POSTHOG_KEY: "ph_test",
            API_TOKEN_RATE_LIMITER: {
              limit: async () => ({ success: false }),
            },
          },
          ctx: {
            waitUntil: vi.fn((promise: Promise<unknown>) => {
              void promise;
            }),
          },
        },
      },
    } as any);
    expect(throttledMissingSplat.status).toBe(429);
    expectLegacyEvent({
      requestId: "req_legacy_rate_limited_missing_splat",
      operation: "root",
      status: 429,
      authMode: "anonymous",
      errorCode: "rate_limited",
      rateLimitScope: "token",
      forbidden: [token],
    });

    const throttledPost = await action(routeArgs(new UndiciRequest("http://localhost/api/health", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": "req_legacy_rate_limited_post",
      },
    }), "health", {
      POSTHOG_KEY: "ph_test",
      API_TOKEN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    }));
    expect(throttledPost.status).toBe(429);
    expectLegacyEvent({
      requestId: "req_legacy_rate_limited_post",
      status: 429,
      authMode: "anonymous",
      routeTemplate: "/api/{unknown}",
      errorCode: "rate_limited",
      rateLimitScope: "token",
      forbidden: [token],
    });

    const throttledMalformed = await loader(routeArgs(new UndiciRequest(`http://localhost/api/${malformedSplat}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": "req_legacy_rate_limited_malformed",
      },
    }), malformedSplat, {
      POSTHOG_KEY: "ph_test",
      API_TOKEN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    }));
    expect(throttledMalformed.status).toBe(429);
    expectLegacyEvent({
      requestId: "req_legacy_rate_limited_malformed",
      status: 429,
      authMode: "anonymous",
      routeTemplate: "/api/{unknown}",
      errorCode: "rate_limited",
      rateLimitScope: "token",
      forbidden: [token, malformedSplat],
    });
  });

  describe("import_recipe_from_url failures", () => {
    async function importToolCall(
      requestId: string,
      token: string,
      env: Record<string, unknown> | null = { POSTHOG_KEY: "ph_test" },
    ) {
      return action(routeArgs(new UndiciRequest("http://localhost/api/tools/import_recipe_from_url", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ url: "https://recipes.example/pasta" }),
      }), "tools/import_recipe_from_url", env));
    }

    it("surfaces a server-side import failure at its real status and captures it with import_code", async () => {
      const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
      const { token } = await createApiCredential(db, user.id, "Import token", { scopes: ["kitchen:write"] });
      vi.mocked(captureEvent).mockClear();
      vi.mocked(captureException).mockClear();
      const importSpy = vi.spyOn(recipeImport, "importRecipeFromUrl")
        .mockRejectedValueOnce(new ImportRecipeError("llm-failed", 502, "LLM extraction failed"));

      try {
        const response = await importToolCall("req_import_llm_failed", token);
        expect(response.status).toBe(502);
        await expect(readJson(response)).resolves.toMatchObject({
          ok: false,
          error: { status: 502 },
        });
        // Lifecycle event records the machine code instead of internal_error.
        expectLegacyEvent({
          requestId: "req_import_llm_failed",
          operation: "import_recipe_from_url",
          status: 502,
          authMode: "bearer",
          errorCode: "llm-failed",
          forbidden: [token],
        });
        // The stack is preserved, tagged with the import_code.
        expect(captureException).toHaveBeenCalledTimes(1);
        const [, captureInput] = vi.mocked(captureException).mock.calls[0];
        expect(captureInput).toMatchObject({
          distinctId: "server",
          route: "/api/tools/import_recipe_from_url",
          method: "POST",
          extras: { import_code: "llm-failed" },
        });
      } finally {
        importSpy.mockRestore();
      }
    });

    it("surfaces an expected import failure at its status without capturing an exception", async () => {
      const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
      const { token } = await createApiCredential(db, user.id, "Import token", { scopes: ["kitchen:write"] });
      vi.mocked(captureEvent).mockClear();
      vi.mocked(captureException).mockClear();
      // `video-unavailable` carries a 502 status but is an expected upstream 4xx
      // (private/deleted video) — it must NOT be captured as an exception.
      const importSpy = vi.spyOn(recipeImport, "importRecipeFromUrl")
        .mockRejectedValueOnce(new ImportRecipeError("video-unavailable", 502, "video metadata unavailable"));

      try {
        const response = await importToolCall("req_import_video_unavailable", token);
        expect(response.status).toBe(502);
        expectLegacyEvent({
          requestId: "req_import_video_unavailable",
          operation: "import_recipe_from_url",
          status: 502,
          authMode: "bearer",
          errorCode: "video-unavailable",
          forbidden: [token],
        });
        expect(captureException).not.toHaveBeenCalled();
      } finally {
        importSpy.mockRestore();
      }
    });

    it("surfaces an expected client import failure (bad-url) at its 4xx status without capturing", async () => {
      const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
      const { token } = await createApiCredential(db, user.id, "Import token", { scopes: ["kitchen:write"] });
      vi.mocked(captureEvent).mockClear();
      vi.mocked(captureException).mockClear();
      const importSpy = vi.spyOn(recipeImport, "importRecipeFromUrl")
        .mockRejectedValueOnce(new ImportRecipeError("bad-url", 400, "Cannot parse URL"));

      try {
        const response = await importToolCall("req_import_bad_url", token);
        expect(response.status).toBe(400);
        expectLegacyEvent({
          requestId: "req_import_bad_url",
          operation: "import_recipe_from_url",
          status: 400,
          authMode: "bearer",
          errorCode: "bad-url",
          forbidden: [token],
        });
        expect(captureException).not.toHaveBeenCalled();
      } finally {
        importSpy.mockRestore();
      }
    });

    it("still surfaces the import status when PostHog is unconfigured, without capturing", async () => {
      const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
      const { token } = await createApiCredential(db, user.id, "Import token", { scopes: ["kitchen:write"] });
      vi.mocked(captureException).mockClear();
      const importSpy = vi.spyOn(recipeImport, "importRecipeFromUrl")
        .mockRejectedValueOnce(new ImportRecipeError("llm-failed", 502, "LLM extraction failed"));

      try {
        // A capturable code, but no POSTHOG_KEY → resolvePostHogServerConfig is
        // disabled, so capture is skipped while the status still passes through.
        const response = await importToolCall("req_import_no_posthog", token, {});
        expect(response.status).toBe(502);
        expect(captureException).not.toHaveBeenCalled();
      } finally {
        importSpy.mockRestore();
      }
    });
  });
});
