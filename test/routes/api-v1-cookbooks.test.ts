import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Request-Id");
}

async function createCookbookFixture(db: Awaited<ReturnType<typeof getLocalDb>>, titlePrefix = "Api V1 Weeknight") {
  const chef = await db.user.create({ data: createTestUser() });
  const cookbook = await db.cookbook.create({
    data: {
      title: `${titlePrefix} ${faker.string.alphanumeric(8)}`,
      authorId: chef.id,
    },
  });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `${titlePrefix} Recipe ${faker.string.alphanumeric(8)}`,
      description: "A public cookbook recipe for API tests",
      servings: "2",
    },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chef.id },
  });

  return { chef, cookbook, recipe };
}

async function addDeletedRecipeToCookbook(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  fixture: Awaited<ReturnType<typeof createCookbookFixture>>
) {
  const deletedRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(fixture.chef.id),
      title: `Api V1 Deleted Cookbook Recipe ${faker.string.alphanumeric(8)}`,
      description: "Deleted recipes stay out of public cookbook details",
      deletedAt: new Date(),
    },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: fixture.cookbook.id, recipeId: deletedRecipe.id, addedById: fixture.chef.id },
  });
  return deletedRecipe;
}

describe("API v1 public cookbook reads", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("searches public cookbooks anonymously with query alias and limit behavior", async () => {
    const first = await createCookbookFixture(db, "Api V1 Weeknight");
    await addDeletedRecipeToCookbook(db, first);
    const second = await createCookbookFixture(db, "Api V1 Weeknight");
    await createCookbookFixture(db, "Api V1 Brunch");
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Cookbook list reader", { scopes: ["cookbooks:read"] });

    const queryResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?query=Api%20V1%20Weeknight&limit=20", {
      headers: { "X-Request-Id": "req_cookbook_query" },
    }) as unknown as Request, "cookbooks"));
    const queryPayload = await readJson(queryResponse);

    expect(queryResponse.status).toBe(200);
    expectEnvelopeHeaders(queryResponse, "req_cookbook_query");
    expect(queryResponse.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(queryResponse.headers.get("Vary")).toBe("Authorization, Cookie");
    expect(queryResponse.headers.get("Access-Control-Expose-Headers")).toContain("Cache-Control");
    expect(queryPayload.data.query).toBe("Api V1 Weeknight");
    expect(queryPayload.data.cookbooks.map((cookbook: { id: string }) => cookbook.id)).toEqual(
      expect.arrayContaining([first.cookbook.id, second.cookbook.id])
    );
    expect(queryPayload.data.cookbooks.find((cookbook: { id: string }) => cookbook.id === first.cookbook.id)).toMatchObject({
      recipeCount: 1,
    });

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?q=Api%20V1%20Weeknight&limit=1", {
      headers: { "X-Request-Id": "req_cookbook_search" },
    }) as unknown as Request, "cookbooks"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_cookbook_search");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cookbook_search",
      data: {
        query: "Api V1 Weeknight",
        limit: 1,
        cookbooks: [expect.objectContaining({
          id: expect.any(String),
          title: expect.stringContaining("Api V1 Weeknight"),
          chef: { id: expect.any(String), username: expect.any(String) },
          recipeCount: 1,
          coverImageUrls: [],
          href: expect.stringMatching(/^\/cookbooks\//),
          canonicalUrl: expect.stringMatching(/^https:\/\/spoonjoy\.app\/cookbooks\//),
          attribution: {
            creditText: expect.stringContaining(" on Spoonjoy"),
            canonicalUrl: expect.stringMatching(/^https:\/\/spoonjoy\.app\/cookbooks\//),
          },
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })],
      },
    });
    expect(payload.data.cookbooks).toHaveLength(1);
    expect([first.cookbook.id, second.cookbook.id]).toContain(payload.data.cookbooks[0].id);
    expect(queryPayload.data.cookbooks.find((cookbook: { id: string }) => cookbook.id === first.cookbook.id).recipeCount).toBe(1);

    const scoped = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?query=Api%20V1%20Weeknight", {
      headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_cookbook_list_scope_success" },
    }) as unknown as Request, "cookbooks"));
    const scopedPayload = await readJson(scoped);

    expect(scoped.status).toBe(200);
    expectEnvelopeHeaders(scoped, "req_cookbook_list_scope_success");
    expect(scopedPayload.data.cookbooks.map((cookbook: { id: string }) => cookbook.id)).toEqual(
      expect.arrayContaining([first.cookbook.id, second.cookbook.id])
    );
  });

  it("defaults blank cookbook queries, allows boundary limits, and handles zero active recipes", async () => {
    const emptyChef = await db.user.create({ data: createTestUser() });
    const emptyCookbook = await db.cookbook.create({
      data: { title: `Api V1 Empty Cookbook ${faker.string.alphanumeric(8)}`, authorId: emptyChef.id },
    });
    const ordered = await createCookbookFixture(db, "Api V1 Ordered Cookbook");
    const laterRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(ordered.chef.id),
        title: `Api V1 Ordered Later ${faker.string.alphanumeric(8)}`,
        description: "Another active recipe for ordering",
        servings: "6",
      },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: ordered.cookbook.id, recipeId: laterRecipe.id, addedById: ordered.chef.id },
    });

    const blank = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?query=&limit=", {
      headers: { "X-Request-Id": "req_cookbook_blank_query" },
    }) as unknown as Request, "cookbooks"));
    const blankPayload = await readJson(blank);

    expect(blank.status).toBe(200);
    expectEnvelopeHeaders(blank, "req_cookbook_blank_query");
    expect(blankPayload.data.query).toBeNull();
    expect(blankPayload.data.limit).toBe(20);
    expect(blankPayload.data.cookbooks.find((cookbook: { id: string }) => cookbook.id === emptyCookbook.id)).toMatchObject({
      recipeCount: 0,
    });

    const boundary = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?limit=50", {
      headers: { "X-Request-Id": "req_cookbook_limit_boundary" },
    }) as unknown as Request, "cookbooks"));
    const boundaryPayload = await readJson(boundary);

    expect(boundary.status).toBe(200);
    expectEnvelopeHeaders(boundary, "req_cookbook_limit_boundary");
    expect(boundaryPayload.data.query).toBeNull();
    expect(boundaryPayload.data.limit).toBe(50);

    const emptyDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${emptyCookbook.id}`, {
      headers: { "X-Request-Id": "req_cookbook_empty_detail" },
    }) as unknown as Request, `cookbooks/${emptyCookbook.id}`));
    const emptyDetailPayload = await readJson(emptyDetail);

    expect(emptyDetail.status).toBe(200);
    expectEnvelopeHeaders(emptyDetail, "req_cookbook_empty_detail");
    expect(emptyDetailPayload.data.cookbook).toMatchObject({
      id: emptyCookbook.id,
      recipeCount: 0,
      recipes: [],
    });

    const orderedDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${ordered.cookbook.id}`, {
      headers: { "X-Request-Id": "req_cookbook_ordered_detail" },
    }) as unknown as Request, `cookbooks/${ordered.cookbook.id}`));
    const orderedPayload = await readJson(orderedDetail);

    expect(orderedDetail.status).toBe(200);
    expectEnvelopeHeaders(orderedDetail, "req_cookbook_ordered_detail");
    expect(orderedPayload.data.cookbook.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([
      ordered.recipe.id,
      laterRecipe.id,
    ]);
  });

  it("returns cookbook detail with active recipe summaries and scoped bearer success", async () => {
    const fixture = await createCookbookFixture(db, "Api V1 Detail Cookbook");
    const deletedRecipe = await addDeletedRecipeToCookbook(db, fixture);
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Cookbook reader", { scopes: ["cookbooks:read"] });
    const insufficientToken = await createApiCredential(db, tokenOwner.id, "Recipe-only reader", { scopes: ["recipes:read"] });

    const anonymous = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, {
      headers: { "X-Request-Id": "req_cookbook_detail_anon" },
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}`));
    const anonymousPayload = await readJson(anonymous);

    expect(anonymous.status).toBe(200);
    expectEnvelopeHeaders(anonymous, "req_cookbook_detail_anon");
    expect(anonymous.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(anonymous.headers.get("Vary")).toBe("Authorization, Cookie");
    expect(anonymousPayload.data.cookbook.id).toBe(fixture.cookbook.id);
    expect(anonymousPayload.data.cookbook.recipeCount).toBe(1);

    const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, {
      headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_cookbook_detail" },
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_cookbook_detail");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cookbook_detail",
      data: {
        cookbook: {
          id: fixture.cookbook.id,
          title: fixture.cookbook.title,
          chef: { id: fixture.chef.id, username: fixture.chef.username },
          recipeCount: 1,
          coverImageUrls: [],
          href: `/cookbooks/${fixture.cookbook.id}`,
          canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
          attribution: {
            creditText: `${fixture.cookbook.title} by ${fixture.chef.username} on Spoonjoy`,
            canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
          },
          createdAt: fixture.cookbook.createdAt.toISOString(),
          updatedAt: expect.any(String),
          recipes: [{
            id: fixture.recipe.id,
            title: fixture.recipe.title,
            description: "A public cookbook recipe for API tests",
            servings: "2",
            chef: { id: fixture.chef.id, username: fixture.chef.username },
            coverImageUrl: null,
            href: `/recipes/${fixture.recipe.id}`,
            canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
            attribution: {
              creditText: `${fixture.recipe.title} by ${fixture.chef.username} on Spoonjoy`,
              canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
              sourceUrl: null,
              sourceHost: null,
              sourceRecipe: null,
            },
            createdAt: fixture.recipe.createdAt.toISOString(),
            updatedAt: expect.any(String),
          }],
        },
      },
    });
    expect(payload.data.cookbook.recipes.map((recipe: { id: string }) => recipe.id)).not.toContain(deletedRecipe.id);

    const insufficient = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, {
      headers: { Authorization: `Bearer ${insufficientToken.token}`, "X-Request-Id": "req_cookbook_detail_scope" },
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}`));

    expect(insufficient.status).toBe(403);
    expectEnvelopeHeaders(insufficient, "req_cookbook_detail_scope");
    await expect(readJson(insufficient)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_detail_scope",
      error: { code: "insufficient_scope", status: 403 },
    });
  });

  it("returns missing cookbooks as not_found", async () => {
    const missing = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks/missing-cookbook", {
      headers: { "X-Request-Id": "req_cookbook_missing" },
    }) as unknown as Request, "cookbooks/missing-cookbook"));

    expect(missing.status).toBe(404);
    expectEnvelopeHeaders(missing, "req_cookbook_missing");
    await expect(readJson(missing)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_missing",
      error: { code: "not_found", status: 404 },
    });
  });

  it("validates limit and rejects bearer tokens without cookbooks:read", async () => {
    await createCookbookFixture(db, "Api V1 Limit Cookbook");
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Recipe-only reader", { scopes: ["recipes:read"] });

    const invalidLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?limit=0", {
      headers: { "X-Request-Id": "req_cookbook_limit" },
    }) as unknown as Request, "cookbooks"));
    expect(invalidLimit.status).toBe(400);
    expectEnvelopeHeaders(invalidLimit, "req_cookbook_limit");
    await expect(readJson(invalidLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_limit",
      error: { code: "validation_error", status: 400 },
    });

    const malformedLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?limit=abc", {
      headers: { "X-Request-Id": "req_cookbook_malformed_limit" },
    }) as unknown as Request, "cookbooks"));
    expect(malformedLimit.status).toBe(400);
    expectEnvelopeHeaders(malformedLimit, "req_cookbook_malformed_limit");
    await expect(readJson(malformedLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_malformed_limit",
      error: { code: "validation_error", status: 400 },
    });

    const overLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?limit=51", {
      headers: { "X-Request-Id": "req_cookbook_over_limit" },
    }) as unknown as Request, "cookbooks"));
    expect(overLimit.status).toBe(400);
    expectEnvelopeHeaders(overLimit, "req_cookbook_over_limit");
    await expect(readJson(overLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_over_limit",
      error: { code: "validation_error", status: 400 },
    });

    const insufficient = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks", {
      headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_cookbook_scope" },
    }) as unknown as Request, "cookbooks"));
    expect(insufficient.status).toBe(403);
    expectEnvelopeHeaders(insufficient, "req_cookbook_scope");
    await expect(readJson(insufficient)).resolves.toMatchObject({
      ok: false,
      requestId: "req_cookbook_scope",
      error: { code: "insufficient_scope", status: 403 },
    });
  });
});
