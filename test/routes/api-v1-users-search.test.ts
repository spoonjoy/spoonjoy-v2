import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectPublicEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  expect(response.headers.get("Vary")).toBe("Authorization, Cookie");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Cache-Control");
  expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Request-Id");
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: any, requestId: string) {
  expect(Object.keys(payload).sort()).toEqual(["data", "ok", "requestId"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
  expect(payload.data).toBeDefined();
}

function expectErrorEnvelope(payload: any, requestId: string, code: string, status: number) {
  expect(Object.keys(payload).sort()).toEqual(["error", "ok", "requestId"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

async function createChef(db: LocalDb, usernamePrefix: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${usernamePrefix}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

async function createRecipe(db: LocalDb, chefId: string, titlePrefix: string) {
  return db.recipe.create({
    data: {
      ...createTestRecipe(chefId),
      title: `${titlePrefix} ${faker.string.alphanumeric(8)}`,
      description: `${titlePrefix} description for profile/search API tests`,
      servings: "4",
    },
  });
}

async function createCookbookWithRecipe(db: LocalDb, authorId: string, recipeId: string, titlePrefix: string) {
  const cookbook = await db.cookbook.create({
    data: {
      title: `${titlePrefix} ${faker.string.alphanumeric(8)}`,
      authorId,
    },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: cookbook.id, recipeId, addedById: authorId },
  });
  return cookbook;
}

function bearerHeaders(token: string, requestId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Request-Id": requestId,
  };
}

describe("API v1 profile, chef graph, and search reads", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("returns a public chef profile by username with recipes, cookbooks, recent spoons, and graph counts", async () => {
    const chef = await createChef(db, "profilechef");
    await db.user.update({
      where: { id: chef.id },
      data: { photoUrl: "/photos/profiles/profile-chef.jpg" },
    });
    const recipe = await createRecipe(db, chef.id, "Api V1 Profile Tomato Tart");
    const deletedRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(chef.id),
        title: `Api V1 Deleted Profile Ghost ${faker.string.alphanumeric(8)}`,
        deletedAt: new Date("2026-06-02T10:00:00.000Z"),
      },
    });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/profile-tart-raw.jpg",
        stylizedImageUrl: "/photos/profile-tart-editorial.jpg",
        sourceType: "spoon",
        createdAt: new Date("2026-06-03T10:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    const cookbook = await createCookbookWithRecipe(db, chef.id, recipe.id, "Api V1 Profile Cookbook");
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: deletedRecipe.id, addedById: chef.id },
    });
    const fellow = await createChef(db, "fellowchef");
    const fellowRecipe = await createRecipe(db, fellow.id, "Api V1 Fellow Soup");
    await db.recipeSpoon.create({
      data: {
        chefId: chef.id,
        recipeId: fellowRecipe.id,
        note: "profile chef spoon",
        cookedAt: new Date("2026-06-04T10:00:00.000Z"),
      },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: fellow.id,
        recipeId: recipe.id,
        note: "visitor spoon",
        cookedAt: new Date("2026-06-05T10:00:00.000Z"),
      },
    });

    const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/users/${chef.username}`, {
      headers: { "X-Request-Id": "req_user_profile" },
    }) as unknown as Request, `users/${chef.username}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPublicEnvelopeHeaders(response, "req_user_profile");
    expectSuccessEnvelope(payload, "req_user_profile");
    expect(payload.data.profile).toMatchObject({
      id: chef.id,
      username: chef.username,
      photoUrl: "/photos/profiles/profile-chef.jpg",
      joinedLabel: expect.stringMatching(/^Joined \w{3} \d{4}$/),
      href: `/users/${chef.username}`,
      canonicalUrl: `https://spoonjoy.app/users/${chef.username}`,
    });
    expect(payload.data.profile.email).toBeUndefined();
    expect(payload.data.isOwner).toBe(false);
    expect(payload.data.recipes).toEqual([
      expect.objectContaining({
        id: recipe.id,
        title: recipe.title,
        coverImageUrl: "/photos/profile-tart-editorial.jpg",
        coverProvenanceLabel: "Editorialized chef photo",
        href: `/recipes/${recipe.id}`,
        canonicalUrl: `https://spoonjoy.app/recipes/${recipe.id}`,
      }),
    ]);
    expect(payload.data.recipes.map((item: { id: string }) => item.id)).not.toContain(deletedRecipe.id);
    expect(payload.data.cookbooks).toEqual([
      expect.objectContaining({
        id: cookbook.id,
        title: cookbook.title,
        recipeCount: 1,
        href: `/cookbooks/${cookbook.id}`,
        canonicalUrl: `https://spoonjoy.app/cookbooks/${cookbook.id}`,
      }),
    ]);
    expect(payload.data.recentSpoons).toEqual([
      expect.objectContaining({
        chef: { id: chef.id, username: chef.username, photoUrl: "/photos/profiles/profile-chef.jpg" },
        recipe: { id: fellowRecipe.id, title: fellowRecipe.title, chefId: fellow.id },
        note: "profile chef spoon",
        cookedAt: "2026-06-04T10:00:00.000Z",
        coverImageUrl: null,
      }),
    ]);
    expect(payload.data.fellowChefsCount).toBe(1);
    expect(payload.data.kitchenVisitorsCount).toBe(1);
  });

  it("returns fellow-chef and kitchen-visitor graph pages with stable pagination metadata", async () => {
    const owner = await createChef(db, "graphowner");
    const fellow = await createChef(db, "graphfellow");
    const visitor = await createChef(db, "graphvisitor");
    const fellowRecipe = await createRecipe(db, fellow.id, "Api V1 Graph Fellow Recipe");
    const ownerRecipe = await createRecipe(db, owner.id, "Api V1 Graph Owner Recipe");
    await db.recipeSpoon.create({
      data: { chefId: owner.id, recipeId: fellowRecipe.id, cookedAt: new Date("2026-06-04T10:00:00.000Z") },
    });
    await db.recipeSpoon.create({
      data: { chefId: visitor.id, recipeId: ownerRecipe.id, cookedAt: new Date("2026-06-05T10:00:00.000Z") },
    });

    const fellowResponse = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/users/${owner.username}/fellow-chefs?page=1`, {
      headers: { "X-Request-Id": "req_user_fellow_chefs" },
    }) as unknown as Request, `users/${owner.username}/fellow-chefs`));
    const fellowPayload = await readJson(fellowResponse);

    expect(fellowResponse.status).toBe(200);
    expectPublicEnvelopeHeaders(fellowResponse, "req_user_fellow_chefs");
    expectSuccessEnvelope(fellowPayload, "req_user_fellow_chefs");
    expect(fellowPayload.data).toMatchObject({
      profile: { id: owner.id, username: owner.username, href: `/users/${owner.username}` },
      page: 1,
      pageSize: 50,
      total: 1,
      nextCursor: null,
      rows: [
        {
          chefId: fellow.id,
          username: fellow.username,
          photoUrl: null,
          href: `/users/${fellow.username}`,
          canonicalUrl: `https://spoonjoy.app/users/${fellow.username}`,
          interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: "2026-06-04T10:00:00.000Z",
        },
      ],
    });

    const visitorsResponse = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/users/${owner.username}/kitchen-visitors?page=1`, {
      headers: { "X-Request-Id": "req_user_kitchen_visitors" },
    }) as unknown as Request, `users/${owner.username}/kitchen-visitors`));
    const visitorsPayload = await readJson(visitorsResponse);

    expect(visitorsResponse.status).toBe(200);
    expectPublicEnvelopeHeaders(visitorsResponse, "req_user_kitchen_visitors");
    expectSuccessEnvelope(visitorsPayload, "req_user_kitchen_visitors");
    expect(visitorsPayload.data).toMatchObject({
      profile: { id: owner.id, username: owner.username, href: `/users/${owner.username}` },
      page: 1,
      pageSize: 50,
      total: 1,
      nextCursor: null,
      rows: [
        {
          chefId: visitor.id,
          username: visitor.username,
          photoUrl: null,
          href: `/users/${visitor.username}`,
          canonicalUrl: `https://spoonjoy.app/users/${visitor.username}`,
          interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: "2026-06-05T10:00:00.000Z",
        },
      ],
    });
  });

  it("returns search results for public scopes and keeps shopping-list matches private to the authenticated owner", async () => {
    const chef = await createChef(db, "tomatosearchchef");
    const other = await createChef(db, "othersearchchef");
    const recipe = await createRecipe(db, chef.id, "Api V1 Tomato Search Tart");
    const cookbook = await createCookbookWithRecipe(db, chef.id, recipe.id, "Api V1 Tomato Search Cookbook");
    const list = await db.shoppingList.create({ data: { authorId: chef.id } });
    const ingredientRef = await getOrCreateIngredientRef(db, "tomato paste");
    const shoppingItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: ingredientRef.id,
        categoryKey: "pantry",
      },
    });
    const token = await createApiCredential(db, chef.id, "Search owner", { scopes: ["public:read"] });

    const publicSearch = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=all&limit=20", {
      headers: { "X-Request-Id": "req_search_public" },
    }) as unknown as Request, "search"));
    const publicPayload = await readJson(publicSearch);

    expect(publicSearch.status).toBe(200);
    expectPublicEnvelopeHeaders(publicSearch, "req_search_public");
    expectSuccessEnvelope(publicPayload, "req_search_public");
    expect(publicPayload.data).toMatchObject({
      query: "tomato",
      scope: "all",
      limit: 20,
      isAuthenticated: false,
    });
    expect(publicPayload.data.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "recipe", id: recipe.id, href: `/recipes/${recipe.id}` }),
      expect.objectContaining({ type: "cookbook", id: cookbook.id, href: `/cookbooks/${cookbook.id}` }),
      expect.objectContaining({ type: "chef", id: chef.id, href: `/users/${chef.username}` }),
    ]));
    expect(publicPayload.data.results.map((result: { id: string }) => result.id)).not.toContain(shoppingItem.id);

    for (const [scope, expectedType] of [
      ["recipes", "recipe"],
      ["cookbooks", "cookbook"],
      ["chefs", "chef"],
    ] as const) {
      const scoped = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/search?query=tomato&scope=${scope}`, {
        headers: { "X-Request-Id": `req_search_${scope}` },
      }) as unknown as Request, "search"));
      const scopedPayload = await readJson(scoped);

      expect(scoped.status).toBe(200);
      expectPublicEnvelopeHeaders(scoped, `req_search_${scope}`);
      expectSuccessEnvelope(scopedPayload, `req_search_${scope}`);
      expect(scopedPayload.data.scope).toBe(scope);
      expect(scopedPayload.data.results.every((result: { type: string }) => result.type === expectedType)).toBe(true);
    }

    const privateSearch = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=shopping", {
      headers: bearerHeaders(token.token, "req_search_private"),
    }) as unknown as Request, "search"));
    const privatePayload = await readJson(privateSearch);

    expect(privateSearch.status).toBe(200);
    expectPrivateEnvelopeHeaders(privateSearch, "req_search_private");
    expectSuccessEnvelope(privatePayload, "req_search_private");
    expect(privatePayload.data).toMatchObject({
      query: "tomato",
      scope: "shopping-list",
      isAuthenticated: true,
      results: [
        expect.objectContaining({
          type: "shopping-list-item",
          id: shoppingItem.id,
          ownerId: chef.id,
          href: "/shopping-list",
          metadata: expect.objectContaining({ checked: false, categoryKey: "pantry" }),
        }),
      ],
    });

    const otherToken = await createApiCredential(db, other.id, "Other searcher", { scopes: ["public:read"] });
    const otherPrivateSearch = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?q=tomato&scope=shopping-list", {
      headers: bearerHeaders(otherToken.token, "req_search_private_other"),
    }) as unknown as Request, "search"));
    const otherPrivatePayload = await readJson(otherPrivateSearch);

    expect(otherPrivateSearch.status).toBe(200);
    expectPrivateEnvelopeHeaders(otherPrivateSearch, "req_search_private_other");
    expectSuccessEnvelope(otherPrivatePayload, "req_search_private_other");
    expect(otherPrivatePayload.data.results).toEqual([]);
  });

  it("returns v1 envelopes for missing profile identifiers and invalid search limits", async () => {
    const missing = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/users/missing-chef", {
      headers: { "X-Request-Id": "req_user_missing" },
    }) as unknown as Request, "users/missing-chef"));
    const missingPayload = await readJson(missing);

    expect(missing.status).toBe(404);
    expect(missing.headers.get("X-Request-Id")).toBe("req_user_missing");
    expectErrorEnvelope(missingPayload, "req_user_missing", "not_found", 404);

    const invalidLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/search?limit=51", {
      headers: { "X-Request-Id": "req_search_invalid_limit" },
    }) as unknown as Request, "search"));
    const invalidLimitPayload = await readJson(invalidLimit);

    expect(invalidLimit.status).toBe(400);
    expect(invalidLimit.headers.get("X-Request-Id")).toBe("req_search_invalid_limit");
    expectErrorEnvelope(invalidLimitPayload, "req_search_invalid_limit", "validation_error", 400);
  });
});
