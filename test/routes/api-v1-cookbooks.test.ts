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
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
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

    const queryResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks?query=Api%20V1%20Weeknight&limit=20", {
      headers: { "X-Request-Id": "req_cookbook_query" },
    }) as unknown as Request, "cookbooks"));
    const queryPayload = await readJson(queryResponse);

    expect(queryResponse.status).toBe(200);
    expectEnvelopeHeaders(queryResponse, "req_cookbook_query");
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
          href: expect.stringMatching(/^\/cookbooks\//),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })],
      },
    });
    expect(payload.data.cookbooks).toHaveLength(1);
    expect([first.cookbook.id, second.cookbook.id]).toContain(payload.data.cookbooks[0].id);
    expect(queryPayload.data.cookbooks.find((cookbook: { id: string }) => cookbook.id === first.cookbook.id).recipeCount).toBe(1);
  });

  it("returns cookbook detail with active recipe summaries and scoped bearer success", async () => {
    const fixture = await createCookbookFixture(db, "Api V1 Detail Cookbook");
    const deletedRecipe = await addDeletedRecipeToCookbook(db, fixture);
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Cookbook reader", { scopes: ["cookbooks:read"] });

    const anonymous = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, {
      headers: { "X-Request-Id": "req_cookbook_detail_anon" },
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}`));
    const anonymousPayload = await readJson(anonymous);

    expect(anonymous.status).toBe(200);
    expectEnvelopeHeaders(anonymous, "req_cookbook_detail_anon");
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
          href: `/cookbooks/${fixture.cookbook.id}`,
          createdAt: fixture.cookbook.createdAt.toISOString(),
          updatedAt: expect.any(String),
          recipes: [{
            id: fixture.recipe.id,
            title: fixture.recipe.title,
            description: "A public cookbook recipe for API tests",
            servings: "2",
            chef: { id: fixture.chef.id, username: fixture.chef.username },
            href: `/recipes/${fixture.recipe.id}`,
            createdAt: fixture.recipe.createdAt.toISOString(),
            updatedAt: expect.any(String),
          }],
        },
      },
    });
    expect(payload.data.cookbook.recipes.map((recipe: { id: string }) => recipe.id)).not.toContain(deletedRecipe.id);
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
