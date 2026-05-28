import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { action, loader } from "~/routes/api.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { getOrCreateIngredientRef } from "../utils";

function uniqueEmail(prefix = "rest") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

describe("Spoonjoy REST API route", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("serves discovery, health, tools, and CORS preflight", async () => {
    const root = await loader(routeArgs(new UndiciRequest("http://localhost/api"), ""));
    await expect(readJson(root)).resolves.toMatchObject({ ok: true, data: { app: "spoonjoy-v2" } });

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
    const { token } = await createApiCredential(db, user.id, "REST recipe token");
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
});
