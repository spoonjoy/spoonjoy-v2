import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader, action } from "~/routes/api.v1.$";
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

function bearer(token: string, requestId: string) {
  return { Authorization: `Bearer ${token}`, "X-Request-Id": requestId };
}

function expectSearchResultShape(result: any) {
  expect(Object.keys(result).sort()).toEqual([
    "canonicalUrl",
    "href",
    "id",
    "imageUrl",
    "metadata",
    "ownerId",
    "ownerUsername",
    "score",
    "snippet",
    "subtitle",
    "title",
    "type",
  ].sort());
  expect(typeof result.id).toBe("string");
  expect(typeof result.ownerId).toBe("string");
  expect(typeof result.ownerUsername).toBe("string");
  expect(typeof result.title).toBe("string");
  expect(typeof result.subtitle).toBe("string");
  expect(typeof result.snippet).toBe("string");
  expect(typeof result.href).toBe("string");
  expect(result.canonicalUrl).toMatch(/^https:\/\/spoonjoy\.app\//);
  expect(result.imageUrl === null || typeof result.imageUrl === "string").toBe(true);
  expect(typeof result.score).toBe("number");
  expect(result.metadata).toEqual(expect.any(Object));
}

async function createSearchFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const suffix = faker.string.alphanumeric(8).toLowerCase();
  const owner = await db.user.create({
    data: {
      ...createTestUser(),
      username: `tomato_api_owner_${suffix}`,
    },
  });
  const other = await db.user.create({
    data: {
      ...createTestUser(),
      username: `tomato_api_other_${suffix}`,
    },
  });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `Tomato API Sauce ${suffix}`,
      description: "A native API searchable recipe.",
    },
  });
  const cookbook = await db.cookbook.create({
    data: {
      title: `Tomato API Nights ${suffix}`,
      authorId: owner.id,
    },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: owner.id },
  });

  const ownerList = await db.shoppingList.create({ data: { authorId: owner.id } });
  const otherList = await db.shoppingList.create({ data: { authorId: other.id } });
  const tomatoRef = await getOrCreateIngredientRef(db, `tomato api paste ${suffix}`);
  const ownerItem = await db.shoppingListItem.create({
    data: {
      shoppingListId: ownerList.id,
      ingredientRefId: tomatoRef.id,
      categoryKey: "pantry",
    },
  });
  const otherItem = await db.shoppingListItem.create({
    data: {
      shoppingListId: otherList.id,
      ingredientRefId: tomatoRef.id,
      categoryKey: "pantry",
    },
  });

  const shoppingRead = await createApiCredential(db, owner.id, "Native search reader", {
    scopes: ["shopping_list:read"],
  });
  const legacyRead = await createApiCredential(db, owner.id, "Native search legacy reader", {
    scopes: ["kitchen:read"],
  });
  const writeOnly = await createApiCredential(db, owner.id, "Native search writer", {
    scopes: ["shopping_list:write"],
  });

  return { owner, other, recipe, cookbook, ownerItem, otherItem, shoppingRead, legacyRead, writeOnly };
}

describe("API v1 search", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("resolves as an auth-optional v1 resource", () => {
    expect(resolveApiV1ScopeRequirement("GET", "search")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("POST", "search")).toBeNull();
  });

  it("returns native-friendly public search rows without leaking shopping-list items anonymously", async () => {
    const fixture = await createSearchFixture(db);
    await db.recipe.update({ where: { id: fixture.recipe.id }, data: { course: "main" } });
    await db.recipeTag.createMany({
      data: [
        { id: "tag-rest-search-zesty", recipeId: fixture.recipe.id, label: "Zesty", normalizedLabel: "zesty" },
        { id: "tag-rest-search-dinner", recipeId: fixture.recipe.id, label: "Dinner", normalizedLabel: "dinner" },
      ],
    });
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=all", {
      headers: { "X-Request-Id": "req_api_search_public" },
    }) as unknown as Request, "search"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_api_search_public",
      data: {
        query: "tomato",
        scope: "all",
        limit: 20,
        isAuthenticated: false,
      },
    });
    expect(payload.data.results.map((result: any) => result.id)).toEqual(expect.arrayContaining([
      fixture.recipe.id,
      fixture.cookbook.id,
      fixture.owner.id,
    ]));
    expect(payload.data.results.map((result: any) => result.id)).not.toContain(fixture.ownerItem.id);
    for (const result of payload.data.results) {
      expectSearchResultShape(result);
      if (result.type !== "recipe") {
        expect(result.metadata).not.toHaveProperty("course");
        expect(result.metadata).not.toHaveProperty("tags");
      }
    }

    const queryAlias = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&query=native&scope=all", {
      headers: { "X-Request-Id": "req_api_search_query_alias" },
    }) as unknown as Request, "search"));
    const queryAliasPayload = await readJson(queryAlias);
    expect(queryAlias.status).toBe(200);
    expect(queryAliasPayload.data.query).toBe("native");
    expect(queryAliasPayload.data.results.map((result: any) => result.id)).toContain(fixture.recipe.id);

    const emptyQuery = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?scope=chefs&limit=1", {
      headers: { "X-Request-Id": "req_api_search_empty_query" },
    }) as unknown as Request, "search"));
    const emptyQueryPayload = await readJson(emptyQuery);
    expect(emptyQuery.status).toBe(200);
    expect(emptyQueryPayload.data).toMatchObject({
      query: "",
      scope: "chefs",
      limit: 1,
    });
    expect(emptyQueryPayload.data.results).toHaveLength(1);
    expect(emptyQueryPayload.data.results[0].type).toBe("chef");
  });

  it("adds neutral metadata to anonymous recipe search rows", async () => {
    const fixture = await createSearchFixture(db);
    await db.recipe.update({ where: { id: fixture.recipe.id }, data: { course: "main" } });
    await db.recipeTag.createMany({
      data: [
        { id: `tag-rest-public-dinner-${faker.string.alphanumeric(8)}`, recipeId: fixture.recipe.id, label: "Dinner", normalizedLabel: "dinner" },
        { id: `tag-rest-public-zesty-${faker.string.alphanumeric(8)}`, recipeId: fixture.recipe.id, label: "Zesty", normalizedLabel: "zesty" },
      ],
    });

    const response = await loader(routeArgs(new UndiciRequest(
      "http://localhost/api/v1/search?q=tomato&scope=recipes&limit=20",
      { headers: { "X-Request-Id": "req_api_search_public_recipe_metadata" } },
    ) as unknown as Request, "search"));
    const payload = await readJson(response);
    const recipe = payload.data.results.find((result: { type: string }) => result.type === "recipe");

    expect(response.status).toBe(200);
    expect(Object.keys(recipe.metadata).sort()).toEqual([
      "chefUsername", "cookbookTitles", "course", "coverProvenanceLabel", "coverSourceType",
      "coverVariant", "ingredientNames", "servings", "stepCount", "tags",
    ].sort());
    expect(recipe.metadata).toMatchObject({ course: "main", tags: ["Dinner", "Zesty"] });
    expect(recipe.metadata).not.toHaveProperty("isSaved");
  });

  it("keeps authenticated saved-user non-recipe search rows byte-compatible", async () => {
    const fixture = await createSearchFixture(db);
    await db.recipe.update({ where: { id: fixture.recipe.id }, data: { course: "main" } });
    await db.recipeTag.createMany({
      data: [
        {
          id: `tag-rest-auth-dinner-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Dinner",
          normalizedLabel: "dinner",
        },
        {
          id: `tag-rest-auth-zesty-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Zesty",
          normalizedLabel: "zesty",
        },
      ],
    });
    await db.savedRecipe.create({
      data: {
        userId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        savedAt: "2026-07-22T18:00:00.000Z",
      },
    });

    const response = await loader(routeArgs(new UndiciRequest(
      "http://localhost/api/v1/search?q=tomato&scope=all&limit=20",
      { headers: bearer(fixture.shoppingRead.token, "req_api_search_saved_private") },
    ) as unknown as Request, "search"));
    const payload = await readJson(response);
    const byType = new Map(payload.data.results.map((result: { type: string }) => [result.type, result]));

    expect(response.status).toBe(200);
    expect(payload.data.isAuthenticated).toBe(true);
    expect([...byType.keys()].sort()).toEqual(["chef", "cookbook", "recipe", "shopping-list-item"]);
    for (const result of payload.data.results) {
      expectSearchResultShape(result);
    }
    expect(Object.keys(byType.get("cookbook").metadata).sort()).toEqual([
      "authorUsername", "recipeCount", "recipeTitles",
    ].sort());
    expect(Object.keys(byType.get("chef").metadata).sort()).toEqual([
      "cookbookCount", "recipeCount", "username",
    ].sort());
    expect(Object.keys(byType.get("shopping-list-item").metadata).sort()).toEqual([
      "categoryKey", "checked", "iconKey", "quantity", "sortIndex", "unit",
    ].sort());
    expect(JSON.stringify(payload.data.results)).not.toContain("isSaved");
  });

  it("adds neutral metadata without save state to authenticated recipe search rows", async () => {
    const fixture = await createSearchFixture(db);
    await db.recipe.update({ where: { id: fixture.recipe.id }, data: { course: "main" } });
    await db.recipeTag.createMany({
      data: [
        { id: `tag-rest-saved-dinner-${faker.string.alphanumeric(8)}`, recipeId: fixture.recipe.id, label: "Dinner", normalizedLabel: "dinner" },
        { id: `tag-rest-saved-zesty-${faker.string.alphanumeric(8)}`, recipeId: fixture.recipe.id, label: "Zesty", normalizedLabel: "zesty" },
      ],
    });
    await db.savedRecipe.create({
      data: {
        userId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        savedAt: "2026-07-22T18:00:00.000Z",
      },
    });

    const response = await loader(routeArgs(new UndiciRequest(
      "http://localhost/api/v1/search?q=tomato&scope=recipes&limit=20",
      { headers: bearer(fixture.shoppingRead.token, "req_api_search_saved_recipe_metadata") },
    ) as unknown as Request, "search"));
    const payload = await readJson(response);
    const recipe = payload.data.results.find((result: { type: string }) => result.type === "recipe");

    expect(response.status).toBe(200);
    expect(Object.keys(recipe.metadata).sort()).toEqual([
      "chefUsername", "cookbookTitles", "course", "coverProvenanceLabel", "coverSourceType",
      "coverVariant", "ingredientNames", "servings", "stepCount", "tags",
    ].sort());
    expect(recipe.metadata).toMatchObject({ course: "main", tags: ["Dinner", "Zesty"] });
    expect(recipe.metadata).not.toHaveProperty("isSaved");
  });

  it("includes only the authenticated owner's shopping-list rows when the principal can read them", async () => {
    const fixture = await createSearchFixture(db);
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=all&limit=10", {
      headers: bearer(fixture.shoppingRead.token, "req_api_search_private"),
    }) as unknown as Request, "search"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_api_search_private",
      data: {
        query: "tomato",
        scope: "all",
        limit: 10,
        isAuthenticated: true,
      },
    });
    expect(payload.data.results.map((result: any) => result.id)).toContain(fixture.ownerItem.id);
    expect(payload.data.results.map((result: any) => result.id)).not.toContain(fixture.otherItem.id);
    expect(payload.data.results.find((result: any) => result.id === fixture.ownerItem.id)).toMatchObject({
      type: "shopping-list-item",
      ownerId: fixture.owner.id,
      ownerUsername: fixture.owner.username,
      href: "/shopping-list",
      canonicalUrl: "https://spoonjoy.app/shopping-list",
      metadata: expect.objectContaining({
        categoryKey: "pantry",
        checked: false,
      }),
    });
  });

  it("enforces explicit shopping-list scope without blocking public search scopes", async () => {
    const fixture = await createSearchFixture(db);

    const publicWithWriteOnly = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=recipes", {
      headers: bearer(fixture.writeOnly.token, "req_api_search_recipes_write_only"),
    }) as unknown as Request, "search"));
    expect(publicWithWriteOnly.status).toBe(200);
    expect((await readJson(publicWithWriteOnly)).data.results.every((result: any) => result.type === "recipe")).toBe(true);

    const missing = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=shopping-list", {
      headers: { "X-Request-Id": "req_api_search_shopping_missing" },
    }) as unknown as Request, "search"));
    expect(missing.status).toBe(401);
    expect(await readJson(missing)).toMatchObject({
      ok: false,
      requestId: "req_api_search_shopping_missing",
      error: { code: "authentication_required", status: 401 },
    });

    const insufficient = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=shopping-list", {
      headers: bearer(fixture.writeOnly.token, "req_api_search_shopping_insufficient"),
    }) as unknown as Request, "search"));
    expect(insufficient.status).toBe(403);
    expect(await readJson(insufficient)).toMatchObject({
      ok: false,
      requestId: "req_api_search_shopping_insufficient",
      error: { code: "insufficient_scope", status: 403 },
    });

    const legacy = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=shopping", {
      headers: bearer(fixture.legacyRead.token, "req_api_search_shopping_legacy"),
    }) as unknown as Request, "search"));
    const legacyPayload = await readJson(legacy);
    expect(legacy.status).toBe(200);
    expect(legacyPayload.data.scope).toBe("shopping-list");
    expect(legacyPayload.data.results.map((result: any) => result.id)).toEqual([fixture.ownerItem.id]);
  });

  it("validates limit and reports unsupported methods through the contract surface", async () => {
    await createSearchFixture(db);

    const invalidLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&limit=0", {
      headers: { "X-Request-Id": "req_api_search_bad_limit" },
    }) as unknown as Request, "search"));
    expect(invalidLimit.status).toBe(400);
    expect(await readJson(invalidLimit)).toMatchObject({
      ok: false,
      requestId: "req_api_search_bad_limit",
      error: { code: "validation_error", status: 400 },
    });

    const method = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/search", {
      method: "POST",
      headers: { "X-Request-Id": "req_api_search_method" },
    }) as unknown as Request, "search"));
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("GET");
    expect(await readJson(method)).toMatchObject({
      ok: false,
      requestId: "req_api_search_method",
      error: { code: "method_not_allowed", status: 405 },
    });
  });
});
