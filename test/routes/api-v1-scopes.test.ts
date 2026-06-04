import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function bearer(token: string, requestId: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, "X-Request-Id": requestId, ...extra };
}

function expectError(payload: any, requestId: string, code: string, status: number) {
  expect(payload).toMatchObject({
    ok: false,
    requestId,
    error: { code, status },
  });
}

async function createFixtures(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const chef = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: { ...createTestRecipe(chef.id), title: `Matrix Recipe ${faker.string.alphanumeric(8)}` },
  });
  const cookbook = await db.cookbook.create({
    data: { title: `Matrix Cookbook ${faker.string.alphanumeric(8)}`, authorId: chef.id },
  });
  await db.recipeInCookbook.create({ data: { recipeId: recipe.id, cookbookId: cookbook.id, addedById: chef.id } });

  const user = await db.user.create({ data: createTestUser() });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  const ingredientRef = await getOrCreateIngredientRef(db, `matrix item ${faker.string.alphanumeric(8)}`.toLowerCase());
  const item = await db.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id, quantity: 1, sortIndex: 0 },
  });

  const noScopes = await createApiCredential(db, user.id, "Matrix no scopes", { scopes: [] });
  const publicOnly = await createApiCredential(db, user.id, "Matrix public", { scopes: ["public:read"] });
  const recipesRead = await createApiCredential(db, user.id, "Matrix recipes", { scopes: ["recipes:read"] });
  const cookbooksRead = await createApiCredential(db, user.id, "Matrix cookbooks", { scopes: ["cookbooks:read"] });
  const shoppingRead = await createApiCredential(db, user.id, "Matrix shopping read", { scopes: ["shopping_list:read"] });
  const shoppingWrite = await createApiCredential(db, user.id, "Matrix shopping write", { scopes: ["shopping_list:write"] });
  const tokensRead = await createApiCredential(db, user.id, "Matrix tokens read", { scopes: ["tokens:read"] });
  const tokensWrite = await createApiCredential(db, user.id, "Matrix tokens write", { scopes: ["tokens:write"] });
  const legacyRead = await createApiCredential(db, user.id, "Matrix legacy read", { scopes: ["kitchen:read"] });
  const legacyWrite = await createApiCredential(db, user.id, "Matrix legacy write", { scopes: ["kitchen:write"] });

  return {
    chef,
    recipe,
    cookbook,
    user,
    item,
    noScopes,
    publicOnly,
    recipesRead,
    cookbooksRead,
    shoppingRead,
    shoppingWrite,
    tokensRead,
    tokensWrite,
    legacyRead,
    legacyWrite,
  };
}

describe("API v1 complete scope matrix", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("resolves exact scope rows for every first-slice v1 endpoint", () => {
    expect(resolveApiV1ScopeRequirement("GET", "")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "health")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "openapi.json")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "openapi.sdk.json")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "recipes")).toEqual({ auth: "optional", scopes: ["recipes:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "recipes/recipe_1")).toEqual({ auth: "optional", scopes: ["recipes:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "cookbooks")).toEqual({ auth: "optional", scopes: ["cookbooks:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "cookbooks/cookbook_1")).toEqual({ auth: "optional", scopes: ["cookbooks:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "shopping-list")).toEqual({ auth: "bearer", scopes: ["shopping_list:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "shopping-list/sync")).toEqual({ auth: "bearer", scopes: ["shopping_list:read"] });
    expect(resolveApiV1ScopeRequirement("POST", "shopping-list/items")).toEqual({ auth: "bearer", scopes: ["shopping_list:write"] });
    expect(resolveApiV1ScopeRequirement("PATCH", "shopping-list/items/item_1")).toEqual({ auth: "bearer", scopes: ["shopping_list:write"] });
    expect(resolveApiV1ScopeRequirement("DELETE", "shopping-list/items/item_1")).toEqual({ auth: "bearer", scopes: ["shopping_list:write"] });
    expect(resolveApiV1ScopeRequirement("GET", "tokens")).toEqual({ auth: "bearer", scopes: ["tokens:read"] });
    expect(resolveApiV1ScopeRequirement("POST", "tokens")).toEqual({ auth: "bearer", scopes: ["tokens:write"] });
    expect(resolveApiV1ScopeRequirement("DELETE", "tokens/token_1")).toEqual({ auth: "bearer", scopes: ["tokens:write"] });
  });

  it("allows anonymous public routes and enforces bearer public read scopes when credentials are present", async () => {
    const fixture = await createFixtures(db);
    const publicRoutes = [
      ["root", "http://localhost/api/v1", "", fixture.noScopes.token],
      ["health", "http://localhost/api/v1/health", "health", fixture.noScopes.token],
      ["openapi", "http://localhost/api/v1/openapi.json", "openapi.json", fixture.noScopes.token],
      ["openapi-sdk", "http://localhost/api/v1/openapi.sdk.json", "openapi.sdk.json", fixture.noScopes.token],
      ["recipes", "http://localhost/api/v1/recipes", "recipes", fixture.recipesRead.token],
      ["recipe", `http://localhost/api/v1/recipes/${fixture.recipe.id}`, `recipes/${fixture.recipe.id}`, fixture.recipesRead.token],
      ["cookbooks", "http://localhost/api/v1/cookbooks", "cookbooks", fixture.cookbooksRead.token],
      ["cookbook", `http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, `cookbooks/${fixture.cookbook.id}`, fixture.cookbooksRead.token],
    ] as const;

    for (const [name, url, splat, allowedToken] of publicRoutes) {
      const anonymous = await loader(routeArgs(new UndiciRequest(url, {
        headers: { "X-Request-Id": `req_matrix_${name}_anon` },
      }) as unknown as Request, splat));
      expect(anonymous.status).toBe(200);

      const allowed = await loader(routeArgs(new UndiciRequest(url, {
        headers: bearer(allowedToken, `req_matrix_${name}_allowed`),
      }) as unknown as Request, splat));
      expect(allowed.status).toBe(200);

      if (["recipes", "recipe", "cookbooks", "cookbook"].includes(name)) {
        const publicOnly = await loader(routeArgs(new UndiciRequest(url, {
          headers: bearer(fixture.publicOnly.token, `req_matrix_${name}_public_only`),
        }) as unknown as Request, splat));
        expect(publicOnly.status).toBe(200);

        const legacy = await loader(routeArgs(new UndiciRequest(url, {
          headers: bearer(fixture.legacyRead.token, `req_matrix_${name}_legacy`),
        }) as unknown as Request, splat));
        expect(legacy.status).toBe(200);
      }
    }
  });

  it("enforces authenticated shopping-list read and write scopes with legacy compatibility", async () => {
    const fixture = await createFixtures(db);
    const readRoutes = [
      ["shopping-list", "http://localhost/api/v1/shopping-list", "shopping-list"],
      ["shopping-sync", "http://localhost/api/v1/shopping-list/sync", "shopping-list/sync"],
    ] as const;

    for (const [name, url, splat] of readRoutes) {
      const missing = await loader(routeArgs(new UndiciRequest(url, {
        headers: { "X-Request-Id": `req_matrix_${name}_missing` },
      }) as unknown as Request, splat));
      expect(missing.status).toBe(401);
      expectError(await readJson(missing), `req_matrix_${name}_missing`, "authentication_required", 401);

      const writerOnly = await loader(routeArgs(new UndiciRequest(url, {
        headers: bearer(fixture.shoppingWrite.token, `req_matrix_${name}_writer_only`),
      }) as unknown as Request, splat));
      expect(writerOnly.status).toBe(403);

      const allowed = await loader(routeArgs(new UndiciRequest(url, {
        headers: bearer(fixture.shoppingRead.token, `req_matrix_${name}_read`),
      }) as unknown as Request, splat));
      expect(allowed.status).toBe(200);

      const legacy = await loader(routeArgs(new UndiciRequest(url, {
        headers: bearer(fixture.legacyRead.token, `req_matrix_${name}_legacy`),
      }) as unknown as Request, splat));
      expect(legacy.status).toBe(200);
    }

    const writeCases = [
      {
        method: "POST" as const,
        url: "http://localhost/api/v1/shopping-list/items",
        splat: "shopping-list/items",
        body: { clientMutationId: "matrix-add", name: `Matrix Add ${faker.string.alphanumeric(6)}` },
      },
      {
        method: "PATCH" as const,
        url: `http://localhost/api/v1/shopping-list/items/${fixture.item.id}`,
        splat: `shopping-list/items/${fixture.item.id}`,
        body: { clientMutationId: "matrix-check", checked: true },
      },
      {
        method: "DELETE" as const,
        url: `http://localhost/api/v1/shopping-list/items/${fixture.item.id}`,
        splat: `shopping-list/items/${fixture.item.id}`,
        body: { clientMutationId: "matrix-delete" },
      },
    ];

    for (const testCase of writeCases) {
      const missing = await action(routeArgs(new UndiciRequest(testCase.url, {
        method: testCase.method,
        headers: { "Content-Type": "application/json", "X-Request-Id": `req_matrix_${testCase.method}_missing` },
        body: JSON.stringify(testCase.body),
      }) as unknown as Request, testCase.splat));
      expect(missing.status).toBe(401);

      const readerOnly = await action(routeArgs(new UndiciRequest(testCase.url, {
        method: testCase.method,
        headers: bearer(fixture.shoppingRead.token, `req_matrix_${testCase.method}_reader_only`, { "Content-Type": "application/json" }),
        body: JSON.stringify({ ...testCase.body, extra: "auth before validation" }),
      }) as unknown as Request, testCase.splat));
      expect(readerOnly.status).toBe(403);
      expectError(await readJson(readerOnly), `req_matrix_${testCase.method}_reader_only`, "insufficient_scope", 403);
    }

    const allowedAdd = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
      method: "POST",
      headers: bearer(fixture.shoppingWrite.token, "req_matrix_write_add", { "Content-Type": "application/json" }),
      body: JSON.stringify({ clientMutationId: "matrix-write-add", name: `Matrix Write ${faker.string.alphanumeric(6)}` }),
    }) as unknown as Request, "shopping-list/items"));
    expect(allowedAdd.status).toBe(201);

    const legacyAdd = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
      method: "POST",
      headers: bearer(fixture.legacyWrite.token, "req_matrix_legacy_write_add", { "Content-Type": "application/json" }),
      body: JSON.stringify({ clientMutationId: "matrix-legacy-write-add", name: `Matrix Legacy ${faker.string.alphanumeric(6)}` }),
    }) as unknown as Request, "shopping-list/items"));
    expect(legacyAdd.status).toBe(201);
  });

  it("enforces authenticated token read/write scopes without kitchen-scope escalation", async () => {
    const fixture = await createFixtures(db);
    const missingList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { "X-Request-Id": "req_matrix_tokens_missing" },
    }) as unknown as Request, "tokens"));
    expect(missingList.status).toBe(401);

    const readAllowed = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: bearer(fixture.tokensRead.token, "req_matrix_tokens_read"),
    }) as unknown as Request, "tokens"));
    expect(readAllowed.status).toBe(200);

    const legacyReadBlocked = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: bearer(fixture.legacyRead.token, "req_matrix_tokens_legacy_read"),
    }) as unknown as Request, "tokens"));
    expect(legacyReadBlocked.status).toBe(403);

    const writeOnlyList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: bearer(fixture.tokensWrite.token, "req_matrix_tokens_write_only"),
    }) as unknown as Request, "tokens"));
    expect(writeOnlyList.status).toBe(403);

    const createAllowed = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: bearer(fixture.tokensWrite.token, "req_matrix_tokens_create", { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Matrix child token" }),
    }) as unknown as Request, "tokens"));
    expect(createAllowed.status).toBe(201);

    const createInsufficient = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: bearer(fixture.tokensRead.token, "req_matrix_tokens_create_insufficient", { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Matrix blocked token", unknown: true }),
    }) as unknown as Request, "tokens"));
    expect(createInsufficient.status).toBe(403);
    expectError(await readJson(createInsufficient), "req_matrix_tokens_create_insufficient", "insufficient_scope", 403);

    const legacyDeleteBlocked = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${fixture.publicOnly.credential.id}`, {
      method: "DELETE",
      headers: bearer(fixture.legacyWrite.token, "req_matrix_tokens_delete_legacy"),
    }) as unknown as Request, `tokens/${fixture.publicOnly.credential.id}`));
    expect(legacyDeleteBlocked.status).toBe(403);

    const deleteAllowed = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${fixture.publicOnly.credential.id}`, {
      method: "DELETE",
      headers: bearer(fixture.tokensWrite.token, "req_matrix_tokens_delete"),
    }) as unknown as Request, `tokens/${fixture.publicOnly.credential.id}`));
    expect(deleteAllowed.status).toBe(200);
  });
});
