import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import * as recipeScale from "~/lib/recipe-scale";
import { cleanupDatabase } from "../helpers/cleanup";
import { createCookbookTitle, createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";
import { expectConsoleError } from "../warning-policy";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

const RECIPE_SUMMARY_KEYS = [
  "attribution",
  "canonicalUrl",
  "chef",
  "course",
  "coverImageUrl",
  "coverProvenanceLabel",
  "coverSourceType",
  "coverVariant",
  "createdAt",
  "description",
  "href",
  "id",
  "servings",
  "tags",
  "title",
  "updatedAt",
] as const;

const RECIPE_DETAIL_KEYS = [...RECIPE_SUMMARY_KEYS, "cookbooks", "steps"] as const;

function expectExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function listCursor(value: unknown) {
  return `v1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Request-Id");
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

async function activateRecipeCover(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  recipeId: string,
  coverId: string,
  variant: "image" | "stylized",
  coverMode: "auto" | "manual" | "none" = "manual",
) {
  await db.recipe.update({
    where: { id: recipeId },
    data: { activeCoverId: coverId, activeCoverVariant: variant, coverMode },
  });
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
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(response.headers.get("Vary")).toBe("Authorization, Cookie");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Cache-Control");
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
          coverImageUrl: null,
          href: expect.stringMatching(/^\/recipes\//),
          canonicalUrl: expect.stringMatching(/^https:\/\/spoonjoy\.app\/recipes\//),
          attribution: {
            creditText: expect.stringContaining(" on Spoonjoy"),
            canonicalUrl: expect.stringMatching(/^https:\/\/spoonjoy\.app\/recipes\//),
            sourceUrl: null,
            sourceHost: null,
            sourceRecipe: null,
          },
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

    const overLimit = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes?limit=51", {
      headers: { "X-Request-Id": "req_recipe_over_limit" },
    }) as unknown as Request, "recipes"));
    expect(overLimit.status).toBe(400);
    expectEnvelopeHeaders(overLimit, "req_recipe_over_limit");
    await expect(readJson(overLimit)).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_over_limit",
      error: { code: "validation_error", status: 400 },
    });
  });

  it("validates list cursors and normalizes cover/source URLs", async () => {
    const stylized = await createRecipeFixture(db, "Api V1 Stylized Cover");
    const stylizedCover = await db.recipeCover.create({
      data: {
        recipeId: stylized.recipe.id,
        imageUrl: "/photos/covers/original.png",
        stylizedImageUrl: "/photos/covers/stylized.png",
        sourceType: "spoon",
      },
    });
    await activateRecipeCover(db, stylized.recipe.id, stylizedCover.id, "stylized");
    const imageOnly = await createRecipeFixture(db, "Api V1 Image Cover");
    await db.recipe.update({
      where: { id: imageOnly.recipe.id },
      data: { sourceUrl: "mailto:chef@example.com" },
    });
    const imageOnlyCover = await db.recipeCover.create({
      data: {
        recipeId: imageOnly.recipe.id,
        imageUrl: "/photos/covers/original-only.png",
        sourceType: "import",
      },
    });
    await activateRecipeCover(db, imageOnly.recipe.id, imageOnlyCover.id, "image");
    const dataCover = await createRecipeFixture(db, "Api V1 Data Cover");
    const dataCoverRow = await db.recipeCover.create({
      data: {
        recipeId: dataCover.recipe.id,
        imageUrl: "data:image/png;base64,AAAA",
        sourceType: "ai-placeholder",
      },
    });
    await activateRecipeCover(db, dataCover.recipe.id, dataCoverRow.id, "image", "auto");
    const invalidUrl = await db.recipe.update({
      where: { id: stylized.recipe.id },
      data: { sourceUrl: "http://%" },
    });

    const stylizedDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${invalidUrl.id}`, {
      headers: { "X-Request-Id": "req_recipe_stylized_cover" },
    }) as unknown as Request, `recipes/${invalidUrl.id}`));
    const stylizedPayload = await readJson(stylizedDetail);

    expect(stylizedDetail.status).toBe(200);
    expect(stylizedPayload.data.recipe.coverImageUrl).toBe("https://spoonjoy.app/photos/covers/stylized.png");
    expect(stylizedPayload.data.recipe.attribution.sourceUrl).toBe("http://%");
    expect(stylizedPayload.data.recipe.attribution.sourceHost).toBeNull();

    const imageDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${imageOnly.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_image_cover" },
    }) as unknown as Request, `recipes/${imageOnly.recipe.id}`));
    const imagePayload = await readJson(imageDetail);

    expect(imageDetail.status).toBe(200);
    expect(imagePayload.data.recipe.coverImageUrl).toBe("https://spoonjoy.app/photos/covers/original-only.png");
    expect(imagePayload.data.recipe.attribution.sourceUrl).toBe("mailto:chef@example.com");
    expect(imagePayload.data.recipe.attribution.sourceHost).toBeNull();

    const dataDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${dataCover.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_data_cover" },
    }) as unknown as Request, `recipes/${dataCover.recipe.id}`));
    const dataPayload = await readJson(dataDetail);

    expect(dataDetail.status).toBe(200);
    expect(dataPayload.data.recipe).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
    });

    await db.recipeCover.create({
      data: {
        recipeId: dataCover.recipe.id,
        imageUrl: "",
        sourceType: "empty-import",
      },
    });
    const emptyCoverDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${dataCover.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_empty_cover" },
    }) as unknown as Request, `recipes/${dataCover.recipe.id}`));
    const emptyCoverPayload = await readJson(emptyCoverDetail);
    expect(emptyCoverDetail.status).toBe(200);
    expect(emptyCoverPayload.data.recipe.coverImageUrl).toBeNull();

    const clearedCover = await createRecipeFixture(db, "Api V1 Cleared Cover");
    await db.recipeCover.create({
      data: {
        recipeId: clearedCover.recipe.id,
        imageUrl: "/photos/covers/old-visible.png",
        sourceType: "chef-upload",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: clearedCover.recipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    const clearedCoverDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${clearedCover.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_cleared_cover" },
    }) as unknown as Request, `recipes/${clearedCover.recipe.id}`));
    const clearedCoverPayload = await readJson(clearedCoverDetail);
    expect(clearedCoverDetail.status).toBe(200);
    expect(clearedCoverPayload.data.recipe.coverImageUrl).toBeNull();

    const invalidAssetCover = await db.recipeCover.create({
      data: {
        recipeId: dataCover.recipe.id,
        imageUrl: "http://%",
        sourceType: "import",
      },
    });
    await activateRecipeCover(db, dataCover.recipe.id, invalidAssetCover.id, "image");
    const invalidAssetDetail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${dataCover.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_invalid_asset" },
    }) as unknown as Request, `recipes/${dataCover.recipe.id}`));
    const invalidAssetPayload = await readJson(invalidAssetDetail);
    expect(invalidAssetDetail.status).toBe(200);
    expect(invalidAssetPayload.data.recipe).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
    });

    const validCursor = listCursor({ createdAt: stylized.recipe.createdAt.toISOString(), id: stylized.recipe.id });
    const cursorResponse = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes?cursor=${encodeURIComponent(validCursor)}&limit=50`,
      { headers: { "X-Request-Id": "req_recipe_valid_cursor" } },
    ) as unknown as Request, "recipes"));
    const cursorPayload = await readJson(cursorResponse);
    expect(cursorResponse.status).toBe(200);
    expect(cursorPayload.data.cursor).toBe(validCursor);
    expect(cursorPayload.data.recipes.map((recipe: { id: string }) => recipe.id)).not.toContain(stylized.recipe.id);

    const invalidCursors = [
      "plain-cursor",
      "v1.%",
      listCursor({}),
      listCursor({ createdAt: "not-a-date", id: "recipe_1" }),
    ];
    for (const [index, cursor] of invalidCursors.entries()) {
      const requestId = `req_recipe_invalid_cursor_${index}`;
      const response = await loader(routeArgs(new UndiciRequest(
        `http://localhost/api/v1/recipes?cursor=${encodeURIComponent(cursor)}`,
        { headers: { "X-Request-Id": requestId } },
      ) as unknown as Request, "recipes"));

      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, requestId);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code: "invalid_cursor", status: 400 },
      });
    }
  });

  it("uses explicit active covers and exposes provenance for recipe list and detail", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Explicit Cover");
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/explicit-raw.jpg",
        stylizedImageUrl: "/photos/covers/explicit-editorial.jpg",
        sourceType: "spoon",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/archived-newer.jpg",
        stylizedImageUrl: "/photos/covers/archived-newer-editorial.jpg",
        sourceType: "chef-upload",
        status: "archived",
        archivedAt: new Date("2026-01-03T00:00:00.000Z"),
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    await activateRecipeCover(db, fixture.recipe.id, activeCover.id, "stylized");

    const list = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes?query=${encodeURIComponent(fixture.recipe.title)}&limit=10`,
      { headers: { "X-Request-Id": "req_recipe_explicit_cover_list" } },
    ) as unknown as Request, "recipes"));
    const listPayload = await readJson(list);
    const listedRecipe = listPayload.data.recipes.find((recipe: { id: string }) => recipe.id === fixture.recipe.id);

    expect(list.status).toBe(200);
    expect(listedRecipe).toMatchObject({
      coverImageUrl: "https://spoonjoy.app/photos/covers/explicit-editorial.jpg",
      coverProvenanceLabel: "Editorial photo",
      coverSourceType: "spoon",
      coverVariant: "stylized",
    });

    const detail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_explicit_cover_detail" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const detailPayload = await readJson(detail);

    expect(detail.status).toBe(200);
    expect(detailPayload.data.recipe).toMatchObject({
      coverImageUrl: "https://spoonjoy.app/photos/covers/explicit-editorial.jpg",
      coverProvenanceLabel: "Editorial photo",
      coverSourceType: "spoon",
      coverVariant: "stylized",
    });
  });

  it("exposes an intentional no-cover state even when historical cover rows exist", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 No Cover");
    await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/historical.jpg",
        sourceType: "chef-upload",
      },
    });
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });

    const detail = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}`, {
      headers: { "X-Request-Id": "req_recipe_no_cover_detail" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const payload = await readJson(detail);

    expect(detail.status).toBe(200);
    expect(payload.data.recipe).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
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
          coverImageUrl: null,
          coverProvenanceLabel: null,
          coverSourceType: null,
          coverVariant: null,
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
            canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
          }],
        },
      },
    });
  });

  it("scales recipe-detail ingredient quantities without changing servings, identity, or storage", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Scaled Detail");
    const ingredient = await db.ingredient.findFirstOrThrow({
      where: { recipeId: fixture.recipe.id },
    });
    await db.ingredient.update({
      where: { id: ingredient.id },
      data: { quantity: 1.23456789 },
    });
    const secondStep = await db.recipeStep.create({
      data: {
        recipeId: fixture.recipe.id,
        stepNum: 2,
        stepTitle: "Finish",
        description: "Finish the dish.",
        duration: 2,
      },
    });
    const secondIngredientRef = await getOrCreateIngredientRef(db, `zest ${faker.string.alphanumeric(6)}`);
    const secondUnit = await getOrCreateUnit(db, "tbsp");
    const secondIngredient = await db.ingredient.create({
      data: {
        recipeId: fixture.recipe.id,
        stepNum: secondStep.stepNum,
        quantity: 0.5,
        unitId: secondUnit.id,
        ingredientRefId: secondIngredientRef.id,
      },
    });

    const unscaledResponse = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}`,
      { headers: { "X-Request-Id": "req_recipe_unscaled_contract" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const unscaledPayload = await readJson(unscaledResponse);
    const scaledResponse = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=1e%2B1`,
      { headers: { "X-Request-Id": "req_recipe_scaled_contract" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const scaledPayload = await readJson(scaledResponse);

    expect(unscaledResponse.status).toBe(200);
    expectExactKeys(unscaledPayload.data.recipe, RECIPE_DETAIL_KEYS);
    expect(unscaledPayload.data.recipe).not.toHaveProperty("scale");
    expect(scaledResponse.status).toBe(200);
    expectExactKeys(scaledPayload.data.recipe, [...RECIPE_DETAIL_KEYS, "scale"]);
    expect(scaledPayload.data.recipe).toEqual({
      ...unscaledPayload.data.recipe,
      steps: unscaledPayload.data.recipe.steps.map((step: Record<string, any>) => ({
        ...step,
        ingredients: step.ingredients.map((item: Record<string, any>) => ({
          ...item,
          quantity: item.id === ingredient.id ? 12.345679 : 5,
        })),
      })),
      scale: {
        factor: 10,
        appliedTo: "ingredient_quantities",
        decimalPlaces: 6,
      },
    });
    expect(scaledPayload.data.recipe.servings).toBe("4");
    expect(JSON.stringify(scaledPayload.data.recipe)).toContain(secondIngredient.id);
    await expect(db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }))
      .resolves.toMatchObject({ quantity: 1.23456789 });
    await expect(db.ingredient.findUniqueOrThrow({ where: { id: secondIngredient.id } }))
      .resolves.toMatchObject({ quantity: 0.5 });
  });

  it.each([
    ["0.1", 0.1],
    ["1", 1],
    ["100", 100],
    ["1e2", 100],
    ["1E-1", 0.1],
    ["1e+1", 10],
  ])("accepts REST detail scale grammar %s", async (raw, factor) => {
    const fixture = await createRecipeFixture(db, `Api V1 Scale Grammar ${raw}`);
    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=${encodeURIComponent(raw)}`,
      { headers: { "X-Request-Id": `req_recipe_scale_valid_${factor}` } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.data.recipe.scale.factor).toBe(factor);
  });

  it.each([
    "",
    "+1",
    "0x1",
    " 1 ",
    "01",
    ".5",
    "1.",
    "NaN",
    "Infinity",
    "null",
    "-0.1",
    "0.099999",
    "100.000001",
  ])("rejects invalid REST detail scale %j with field metadata", async (raw) => {
    const fixture = await createRecipeFixture(db, "Api V1 Invalid Scale");
    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=${encodeURIComponent(raw)}`,
      { headers: { "X-Request-Id": "req_recipe_scale_invalid" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        status: 400,
        details: { field: "scale" },
      },
    });
  });

  it("rejects repeated REST detail scales", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Repeated Scale");
    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=1&scale=2`,
      { headers: { "X-Request-Id": "req_recipe_scale_repeated" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "scale" } },
    });

    const duplicateResponse = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=1&scale=1`,
      { headers: { "X-Request-Id": "req_recipe_scale_repeated_same" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    expect(duplicateResponse.status).toBe(400);
    await expect(readJson(duplicateResponse)).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "scale" } },
    });
  });

  it("rejects recipe-detail multiplication overflow as an all-or-nothing validation error", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Scale Overflow");
    const ingredient = await db.ingredient.findFirstOrThrow({ where: { recipeId: fixture.recipe.id } });
    await db.ingredient.update({ where: { id: ingredient.id }, data: { quantity: 1e308 } });

    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=100`,
      { headers: { "X-Request-Id": "req_recipe_scale_overflow" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "scale" } },
    });
    await expect(db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }))
      .resolves.toMatchObject({ quantity: 1e308 });
  });

  it.each([
    ["", "unscaled"],
    ["?scale=2", "scaled"],
  ])("keeps unrelated %s recipe serialization failures out of scale validation", async (query, requestLabel) => {
    const fixture = await createRecipeFixture(db, "Api V1 Serializer Failure");
    const originalToISOString = Date.prototype.toISOString;
    const recipeCreatedAt = fixture.recipe.createdAt.getTime();
    const serializationError = new Error("serializer internals must stay private");
    const toISOString = vi.spyOn(Date.prototype, "toISOString").mockImplementation(function () {
      if (this.getTime() === recipeCreatedAt) throw serializationError;
      return originalToISOString.call(this);
    });

    try {
      expectConsoleError("[api-v1] internal_error", {
        requestId: `req_recipe_serializer_${requestLabel}`,
        method: "GET",
        path: `/api/v1/recipes/${fixture.recipe.id}`,
        error: {
          name: serializationError.name,
          message: serializationError.message,
          stack: serializationError.stack,
        },
      });
      const response = await loader(routeArgs(new UndiciRequest(
        `http://localhost/api/v1/recipes/${fixture.recipe.id}${query}`,
        { headers: { "X-Request-Id": `req_recipe_serializer_${requestLabel}` } },
      ) as unknown as Request, `recipes/${fixture.recipe.id}`));

      expect(response.status).toBe(500);
      await expect(readJson(response)).resolves.toEqual({
        ok: false,
        requestId: `req_recipe_serializer_${requestLabel}`,
        error: {
          code: "internal_error",
          message: "Internal error",
          status: 500,
        },
      });
    } finally {
      toISOString.mockRestore();
    }
  });

  it("keeps unexpected scale-parser failures out of validation responses", async () => {
    const parserError = new Error("unexpected scale parser failure");
    vi.spyOn(recipeScale, "parseRestRecipeScale").mockImplementationOnce(() => {
      throw parserError;
    });
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_recipe_scale_parser_internal",
      method: "GET",
      path: "/api/v1/recipes/parser-fixture",
      error: {
        name: parserError.name,
        message: parserError.message,
        stack: parserError.stack,
      },
    });

    const response = await loader(routeArgs(new UndiciRequest(
      "http://localhost/api/v1/recipes/parser-fixture?scale=2",
      { headers: { "X-Request-Id": "req_recipe_scale_parser_internal" } },
    ) as unknown as Request, "recipes/parser-fixture"));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      requestId: "req_recipe_scale_parser_internal",
      error: { code: "internal_error", message: "Internal error", status: 500 },
    });
  });

  it("keeps unexpected scaling-adapter failures out of validation responses", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Scale Adapter Failure");
    const scalerError = new Error("unexpected scaling adapter failure");
    vi.spyOn(recipeScale, "applyRecipeScale").mockImplementationOnce(() => {
      throw scalerError;
    });
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_recipe_scaler_internal",
      method: "GET",
      path: `/api/v1/recipes/${fixture.recipe.id}`,
      error: {
        name: scalerError.name,
        message: scalerError.message,
        stack: scalerError.stack,
      },
    });

    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}?scale=2`,
      { headers: { "X-Request-Id": "req_recipe_scaler_internal" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      requestId: "req_recipe_scaler_internal",
      error: { code: "internal_error", message: "Internal error", status: 500 },
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

  it("redacts deleted source recipe attribution", async () => {
    const source = await createRecipeFixture(db, "Api V1 Source Recipe");
    const forker = await db.user.create({ data: createTestUser() });
    const fork = await db.recipe.create({
      data: {
        ...createTestRecipe(forker.id),
        title: `Api V1 Fork ${faker.string.alphanumeric(8)}`,
        sourceRecipeId: source.recipe.id,
      },
    });

    const beforeDelete = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fork.id}`, {
      headers: { "X-Request-Id": "req_recipe_source_before_delete" },
    }) as unknown as Request, `recipes/${fork.id}`));
    const beforePayload = await readJson(beforeDelete);
    expect(beforePayload.data.recipe.attribution.sourceRecipe).toMatchObject({
      id: source.recipe.id,
      title: source.recipe.title,
      chef: { id: source.chef.id, username: source.chef.username },
      href: `/recipes/${source.recipe.id}`,
      deleted: false,
    });

    await db.recipe.update({ where: { id: source.recipe.id }, data: { deletedAt: new Date() } });

    const afterDelete = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fork.id}`, {
      headers: { "X-Request-Id": "req_recipe_source_after_delete" },
    }) as unknown as Request, `recipes/${fork.id}`));
    const afterPayload = await readJson(afterDelete);
    expect(afterPayload.data.recipe.attribution.sourceRecipe).toEqual({
      id: source.recipe.id,
      title: null,
      chef: null,
      href: null,
      canonicalUrl: null,
      deleted: true,
    });
  });

  it("returns neutral course and UTF-16 ordered tags on recipe list reads without personalized save state", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Neutral Metadata");
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: { course: "dessert" },
    });
    await db.recipeTag.createMany({
      data: [
        {
          id: `tag-neutral-accent-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Accent Apple",
          normalizedLabel: "\u00e4pfel",
        },
        {
          id: `tag-neutral-zebra-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Zebra",
          normalizedLabel: "zebra",
        },
      ],
    });
    const reader = await db.user.create({ data: createTestUser() });
    await db.savedRecipe.create({
      data: {
        userId: reader.id,
        recipeId: fixture.recipe.id,
        savedAt: "2026-07-22T18:00:00.000Z",
      },
    });
    const credential = await createApiCredential(db, reader.id, "Neutral recipe reader", {
      scopes: ["recipes:read"],
    });
    const headers = {
      Authorization: `Bearer ${credential.token}`,
      "X-Request-Id": "req_recipe_neutral_metadata",
    };

    const list = await loader(routeArgs(new UndiciRequest(
      "http://localhost/api/v1/recipes?query=Neutral%20Metadata",
      { headers },
    ) as unknown as Request, "recipes"));
    const listPayload = await readJson(list);
    const summary = listPayload.data.recipes.find((recipe: { id: string }) => recipe.id === fixture.recipe.id);

    expect(list.status).toBe(200);
    expectExactKeys(summary, RECIPE_SUMMARY_KEYS);
    expect(summary).toMatchObject({ id: fixture.recipe.id, course: "dessert", tags: ["Zebra", "Accent Apple"] });
  });

  it("returns neutral course and ordered tags on recipe detail reads without personalized save state", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Neutral Detail Metadata");
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: { course: "appetizer" },
    });
    await db.recipeTag.createMany({
      data: [
        {
          id: `tag-neutral-detail-weeknight-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Weeknight",
          normalizedLabel: "weeknight",
        },
        {
          id: `tag-neutral-detail-comfort-${faker.string.alphanumeric(8)}`,
          recipeId: fixture.recipe.id,
          label: "Comfort Food",
          normalizedLabel: "comfort food",
        },
      ],
    });
    const reader = await db.user.create({ data: createTestUser() });
    await db.savedRecipe.create({
      data: {
        userId: reader.id,
        recipeId: fixture.recipe.id,
        savedAt: "2026-07-22T18:00:00.000Z",
      },
    });
    const credential = await createApiCredential(db, reader.id, "Neutral recipe detail reader", {
      scopes: ["recipes:read"],
    });

    const detail = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}`,
      {
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "X-Request-Id": "req_recipe_neutral_metadata_detail",
        },
      },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const detailPayload = await readJson(detail);

    expect(detail.status).toBe(200);
    expectExactKeys(detailPayload.data.recipe, RECIPE_DETAIL_KEYS);
    expect(detailPayload.data.recipe).toMatchObject({
      id: fixture.recipe.id,
      course: "appetizer",
      tags: ["Comfort Food", "Weeknight"],
    });
  });

  it("returns course null and empty tags on recipe list reads", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Empty List Metadata");
    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes?query=${encodeURIComponent(fixture.recipe.title)}`,
      { headers: { "X-Request-Id": "req_recipe_empty_metadata_list" } },
    ) as unknown as Request, "recipes"));
    const payload = await readJson(response);
    const summary = payload.data.recipes.find((recipe: { id: string }) => recipe.id === fixture.recipe.id);

    expect(response.status).toBe(200);
    expectExactKeys(summary, RECIPE_SUMMARY_KEYS);
    expect(summary).toMatchObject({ course: null, tags: [] });
  });

  it("returns course null and empty tags on recipe detail reads", async () => {
    const fixture = await createRecipeFixture(db, "Api V1 Empty Detail Metadata");
    const response = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/recipes/${fixture.recipe.id}`,
      { headers: { "X-Request-Id": "req_recipe_empty_metadata_detail" } },
    ) as unknown as Request, `recipes/${fixture.recipe.id}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectExactKeys(payload.data.recipe, RECIPE_DETAIL_KEYS);
    expect(payload.data.recipe).toMatchObject({ course: null, tags: [] });
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
