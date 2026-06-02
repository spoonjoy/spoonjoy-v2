import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createCookbookTitle, createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
}

async function createRecipeFixture(db: Awaited<ReturnType<typeof getLocalDb>>, titlePrefix = "Api V1 Pasta") {
  const chef = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `${titlePrefix} ${faker.string.alphanumeric(8)}`,
      description: "Weeknight pasta for public API tests",
      servings: "4",
    },
  });
  const step = await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Boil",
      description: "Boil pasta.",
      duration: 12,
    },
  });
  const unit = await getOrCreateUnit(db, "lb");
  const ingredientRef = await getOrCreateIngredientRef(db, `pasta ${faker.string.alphanumeric(6)}`);
  await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: step.stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
  const cookbook = await db.cookbook.create({
    data: { title: createCookbookTitle(), authorId: chef.id },
  });
  await db.recipeInCookbook.create({
    data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chef.id },
  });

  return { chef, recipe, step, ingredientRef, cookbook };
}

describe("API v1 public recipe reads", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("searches public recipes anonymously with query alias and limit behavior", async () => {
    const first = await createRecipeFixture(db, "Api V1 Noodle");
    const second = await createRecipeFixture(db, "Api V1 Noodle");
    await createRecipeFixture(db, "Api V1 Soup");

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?q=noodle&limit=1", {
      headers: { "X-Request-Id": "req_recipe_search" },
    }) as unknown as Request, "recipes"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_recipe_search");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_recipe_search",
      data: {
        query: "noodle",
        limit: 1,
        recipes: [expect.objectContaining({
          id: expect.any(String),
          title: expect.stringContaining("Api V1 Noodle"),
          description: "Weeknight pasta for public API tests",
          servings: "4",
          chef: { id: expect.any(String), username: expect.any(String) },
          href: expect.stringMatching(/^\/recipes\//),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })],
      },
    });
    expect(payload.data.recipes).toHaveLength(1);
    expect(payload.data.recipes.map((recipe: { id: string }) => recipe.id)).toContain(first.recipe.id);
    expect(payload.data.recipes.map((recipe: { id: string }) => recipe.id)).not.toContain(second.recipe.id);
  });

  it("defaults blank recipe queries and validates list limit boundaries", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Blank Query");

    const blank = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?query=&limit=", {
      headers: { "X-Request-Id": "req_recipe_blank_query" },
    }) as unknown as Request, "recipes"));
    const blankPayload = await readJson(blank);

    expect(blank.status).toBe(200);
    expectEnvelopeHeaders(blank, "req_recipe_blank_query");
    expect(blankPayload.data.query).toBeNull();
    expect(blankPayload.data.limit).toBe(20);
    expect(blankPayload.data.recipes.map((recipe: { id: string }) => recipe.id)).toContain(fixture.recipe.id);

    const boundary = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?limit=50", {
      headers: { "X-Request-Id": "req_recipe_limit_boundary" },
    }) as unknown as Request, "recipes"));
    const boundaryPayload = await readJson(boundary);

    expect(boundary.status).toBe(200);
    expectEnvelopeHeaders(boundary, "req_recipe_limit_boundary");
    expect(boundaryPayload.data.query).toBeNull();
    expect(boundaryPayload.data.limit).toBe(50);

    const malformedLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?limit=abc", {
      headers: { "X-Request-Id": "req_recipe_malformed_limit" },
    }) as unknown as Request, "recipes"));
    expect(malformedLimit.status).toBe(400);
    expectEnvelopeHeaders(malformedLimit, "req_recipe_malformed_limit");
    await expect(readJson(malformedLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_malformed_limit",
      error: { code: "validation_error", status: 400 },
    });
  });

  it("returns recipe detail with steps, ingredients, cookbook links, and scoped bearer success", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Detail");
    const earlierStep = await db.recipeStep.create({
      data: {
        recipeId: fixture.recipe.id,
        stepNum: 0,
        stepTitle: "Prep",
        description: "Gather ingredients.",
        duration: 3,
      },
    });
    const saltRef = await getOrCreateIngredientRef(db, `a salt ${faker.string.alphanumeric(6)}`);
    const saltUnit = await getOrCreateUnit(db, "tsp");
    await db.ingredient.create({
      data: {
        recipeId: fixture.recipe.id,
        stepNum: fixture.step.stepNum,
        quantity: 2,
        unitId: saltUnit.id,
        ingredientRefId: saltRef.id,
      },
    });
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Recipe reader", { scopes: ["recipes:read"] });

    const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}`, {
      headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_recipe_detail" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_recipe_detail");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_recipe_detail",
      data: {
        recipe: {
          id: fixture.recipe.id,
          title: fixture.recipe.title,
          description: "Weeknight pasta for public API tests",
          servings: "4",
          chef: { id: fixture.chef.id, username: fixture.chef.username },
          href: `/recipes/${fixture.recipe.id}`,
          createdAt: fixture.recipe.createdAt.toISOString(),
          updatedAt: expect.any(String),
          steps: [{
            id: earlierStep.id,
            stepNum: 0,
            stepTitle: "Prep",
            description: "Gather ingredients.",
            duration: 3,
            ingredients: [],
          }, {
            id: fixture.step.id,
            stepNum: 1,
            stepTitle: "Boil",
            description: "Boil pasta.",
            duration: 12,
            ingredients: [{
              id: expect.any(String),
              name: saltRef.name,
              quantity: 2,
              unit: "tsp",
            }, {
              id: expect.any(String),
              name: fixture.ingredientRef.name,
              quantity: 1,
              unit: "lb",
            }],
          }],
          cookbooks: [{
            id: fixture.cookbook.id,
            title: fixture.cookbook.title,
            href: `/cookbooks/${fixture.cookbook.id}`,
          }],
        },
      },
    });
  });

  it("excludes deleted recipes and returns missing/deleted recipes as not_found", async () => {
    const active = await createRecipeFixture(db, "Api V1 Active");
    const deleted = await createRecipeFixture(db, "Api V1 Deleted");
    await db.recipe.update({ where: { id: deleted.recipe.id }, data: { deletedAt: new Date() } });

    const list = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?query=Api%20V1&limit=20", {
      headers: { "X-Request-Id": "req_recipe_deleted_list" },
    }) as unknown as Request, "recipes"));
    const listPayload = await readJson(list);

    expect(list.status).toBe(200);
    expect(listPayload.data.recipes.map((recipe: { id: string }) => recipe.id)).toContain(active.recipe.id);
    expect(listPayload.data.recipes.map((recipe: { id: string }) => recipe.id)).not.toContain(deleted.recipe.id);

    const deletedDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${deleted.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_deleted" },
    }) as unknown as Request, `recipes/${deleted.recipe.id}`));
    expect(deletedDetail.status).toBe(404);
    expectEnvelopeHeaders(deletedDetail, "req_recipe_deleted");
    await expect(readJson(deletedDetail)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_deleted",
      error: { code: "not_found", status: 404 },
    });

    const missing = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/missing-recipe", {
      headers: { "X-Request-Id": "req_recipe_missing" },
    }) as unknown as Request, "recipes/missing-recipe"));
    expect(missing.status).toBe(404);
    expectEnvelopeHeaders(missing, "req_recipe_missing");
    await expect(readJson(missing)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_missing",
      error: { code: "not_found", status: 404 },
    });
  });

  it("validates limit and rejects bearer tokens without recipes:read", async () => {
    await createRecipeFixture(db, "Api V1 Limit");
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, tokenOwner.id, "Cookbook-only reader", { scopes: ["cookbooks:read"] });

    const invalidLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?limit=0", {
      headers: { "X-Request-Id": "req_recipe_limit" },
    }) as unknown as Request, "recipes"));
    expect(invalidLimit.status).toBe(400);
    expectEnvelopeHeaders(invalidLimit, "req_recipe_limit");
    await expect(readJson(invalidLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_limit",
      error: { code: "validation_error", status: 400 },
    });

    const insufficient = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes", {
      headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_recipe_scope" },
    }) as unknown as Request, "recipes"));
    expect(insufficient.status).toBe(403);
    expectEnvelopeHeaders(insufficient, "req_recipe_scope");
    await expect(readJson(insufficient)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_scope",
      error: { code: "insufficient_scope", status: 403 },
    });
  });
});
