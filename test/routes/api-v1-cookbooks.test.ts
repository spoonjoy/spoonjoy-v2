import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
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

function bearer(token: string, requestId: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, "X-Request-Id": requestId, ...extra };
}

function jsonRequest(url: string, method: string, token: string, requestId: string, body: Record<string, unknown>) {
  return new UndiciRequest(url, {
    method,
    headers: bearer(token, requestId, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
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
    vi.useRealTimers();
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

  it("uses active recipe covers for cookbook art while recipe entries expose provenance", async () => {
    const fixture = await createCookbookFixture(db, "Api V1 Active Cover Cookbook");
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/cookbooks/active-cover-raw.jpg",
        stylizedImageUrl: "/photos/cookbooks/active-cover-editorial.jpg",
        sourceType: "chef-upload",
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
        imageUrl: "/photos/cookbooks/archived-cover.jpg",
        sourceType: "import",
        status: "archived",
        archivedAt: new Date("2026-01-03T00:00:00.000Z"),
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    await activateRecipeCover(db, fixture.recipe.id, activeCover.id, "stylized");

    const noCoverRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: `Api V1 Cookbook No Cover ${faker.string.alphanumeric(8)}`,
        description: "A recipe with historical imagery but no active cover",
        servings: "6",
        coverMode: "none",
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: noCoverRecipe.id,
        imageUrl: "/photos/cookbooks/historical-cover.jpg",
        sourceType: "spoon",
      },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: noCoverRecipe.id, addedById: fixture.chef.id },
    });

    const placeholderRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: `Api V1 Cookbook Placeholder Cover ${faker.string.alphanumeric(8)}`,
        description: "A recipe whose active cover is only a generated placeholder",
        servings: "4",
      },
    });
    const placeholderCover = await db.recipeCover.create({
      data: {
        recipeId: placeholderRecipe.id,
        imageUrl: "/photos/cookbooks/placeholder-cover.jpg",
        sourceType: "ai-placeholder",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    });
    await activateRecipeCover(db, placeholderRecipe.id, placeholderCover.id, "image");
    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: placeholderRecipe.id, addedById: fixture.chef.id },
    });

    const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, {
      headers: { "X-Request-Id": "req_cookbook_active_cover_detail" },
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.data.cookbook.coverImageUrls).toEqual([
      "https://spoonjoy.app/photos/cookbooks/active-cover-editorial.jpg",
    ]);
    expect(payload.data.cookbook.recipes.find((recipe: { id: string }) => recipe.id === fixture.recipe.id)).toMatchObject({
      coverImageUrl: "https://spoonjoy.app/photos/cookbooks/active-cover-editorial.jpg",
      coverProvenanceLabel: "Editorialized chef photo",
      coverSourceType: "chef-upload",
      coverVariant: "stylized",
    });
    expect(payload.data.cookbook.recipes.find((recipe: { id: string }) => recipe.id === noCoverRecipe.id)).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
    });
    expect(payload.data.cookbook.recipes.find((recipe: { id: string }) => recipe.id === placeholderRecipe.id)).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
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

  it("creates owner cookbooks with kitchen write scope and idempotent replay", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const token = await createApiCredential(db, owner.id, "Cookbook writer", { scopes: ["kitchen:write"] });
    const readOnly = await createApiCredential(db, owner.id, "Cookbook reader", { scopes: ["cookbooks:read"] });
    const title = `API v1 Created Cookbook ${faker.string.alphanumeric(8)}`;

    const unauthenticated = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/cookbooks", {
      method: "POST",
      headers: { "X-Request-Id": "req_cookbook_create_auth" },
    }) as unknown as Request, "cookbooks"));
    expect(unauthenticated.status).toBe(401);
    expectEnvelopeHeaders(unauthenticated, "req_cookbook_create_auth");

    const insufficient = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", readOnly.token, "req_cookbook_create_scope", {
      clientMutationId: "cm_cookbook_create_scope",
      title,
    }), "cookbooks"));
    expect(insufficient.status).toBe(403);
    expectEnvelopeHeaders(insufficient, "req_cookbook_create_scope");

    const invalid = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", token.token, "req_cookbook_create_invalid", {
      clientMutationId: "cm_cookbook_create_invalid",
      title: "   ",
    }), "cookbooks"));
    expect(invalid.status).toBe(400);
    await expect(readJson(invalid)).resolves.toMatchObject({
      error: { code: "validation_error", status: 400 },
    });

    const created = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", token.token, "req_cookbook_create", {
      clientMutationId: "cm_cookbook_create",
      title: `  ${title}  `,
    }), "cookbooks"));
    const createdPayload = await readJson(created);

    expect(created.status).toBe(201);
    expectEnvelopeHeaders(created, "req_cookbook_create");
    expect(created.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createdPayload).toMatchObject({
      ok: true,
      requestId: "req_cookbook_create",
      data: {
        created: true,
        cookbook: {
          id: expect.any(String),
          title,
          chef: { id: owner.id, username: owner.username },
          recipeCount: 0,
          recipes: [],
        },
        mutation: { clientMutationId: "cm_cookbook_create", replayed: false },
      },
    });

    const replay = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", token.token, "req_cookbook_create_replay", {
      clientMutationId: "cm_cookbook_create",
      title: `  ${title}  `,
    }), "cookbooks"));
    const replayPayload = await readJson(replay);

    expect(replay.status).toBe(201);
    expect(replayPayload.requestId).toBe("req_cookbook_create_replay");
    expect(replayPayload.data.mutation).toEqual({ clientMutationId: "cm_cookbook_create", replayed: true });
    expect(replayPayload.data.cookbook.id).toBe(createdPayload.data.cookbook.id);

    const conflict = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", token.token, "req_cookbook_create_conflict", {
      clientMutationId: "cm_cookbook_create",
      title: `${title} changed`,
    }), "cookbooks"));
    expect(conflict.status).toBe(409);
    await expect(readJson(conflict)).resolves.toMatchObject({
      error: { code: "idempotency_conflict", status: 409 },
    });

    const duplicate = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", token.token, "req_cookbook_create_duplicate", {
      clientMutationId: "cm_cookbook_create_duplicate",
      title,
    }), "cookbooks"));
    expect(duplicate.status).toBe(400);
    await expect(readJson(duplicate)).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "title" } },
    });
  });

  it("updates and deletes only owner cookbooks with duplicate-title validation", async () => {
    const first = await createCookbookFixture(db, "Api V1 Mutable Cookbook");
    const sameOwnerOtherCookbook = await db.cookbook.create({
      data: {
        title: `Api V1 Mutable Sibling ${faker.string.alphanumeric(8)}`,
        authorId: first.chef.id,
      },
    });
    const outsider = await db.user.create({ data: createTestUser() });
    const ownerToken = await createApiCredential(db, first.chef.id, "Cookbook owner writer", { scopes: ["kitchen:write"] });
    const outsiderToken = await createApiCredential(db, outsider.id, "Cookbook outsider writer", { scopes: ["kitchen:write"] });
    const renamed = `Api V1 Renamed Cookbook ${faker.string.alphanumeric(8)}`;

    const missing = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks/missing-cookbook", "PATCH", ownerToken.token, "req_cookbook_update_missing", {
      clientMutationId: "cm_cookbook_update_missing",
      title: renamed,
    }), "cookbooks/missing-cookbook"));
    expect(missing.status).toBe(404);

    const outsiderUpdate = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${first.cookbook.id}`, "PATCH", outsiderToken.token, "req_cookbook_update_outsider", {
      clientMutationId: "cm_cookbook_update_outsider",
      title: renamed,
    }), `cookbooks/${first.cookbook.id}`));
    expect(outsiderUpdate.status).toBe(403);
    await expect(readJson(outsiderUpdate)).resolves.toMatchObject({
      error: { code: "insufficient_scope", details: { resource: "cookbook", cookbookId: first.cookbook.id } },
    });

    const updated = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${first.cookbook.id}`, "PATCH", ownerToken.token, "req_cookbook_update", {
      clientMutationId: "cm_cookbook_update",
      title: ` ${renamed} `,
    }), `cookbooks/${first.cookbook.id}`));
    const updatedPayload = await readJson(updated);

    expect(updated.status).toBe(200);
    expectEnvelopeHeaders(updated, "req_cookbook_update");
    expect(updatedPayload.data).toMatchObject({
      updated: true,
      cookbook: { id: first.cookbook.id, title: renamed },
      mutation: { clientMutationId: "cm_cookbook_update", replayed: false },
    });

    const duplicateTitle = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${first.cookbook.id}`, "PATCH", ownerToken.token, "req_cookbook_update_duplicate", {
      clientMutationId: "cm_cookbook_update_duplicate",
      title: sameOwnerOtherCookbook.title,
    }), `cookbooks/${first.cookbook.id}`));
    expect(duplicateTitle.status).toBe(400);
    await expect(readJson(duplicateTitle)).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "title" } },
    });

    const deleted = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${first.cookbook.id}?clientMutationId=cm_cookbook_delete`, {
      method: "DELETE",
      headers: bearer(ownerToken.token, "req_cookbook_delete"),
    }) as unknown as Request, `cookbooks/${first.cookbook.id}`));
    const deletedPayload = await readJson(deleted);

    expect(deleted.status).toBe(200);
    expect(deletedPayload.data).toMatchObject({
      deleted: true,
      cookbook: { id: first.cookbook.id, title: renamed },
      mutation: { clientMutationId: "cm_cookbook_delete", replayed: false },
    });
    await expect(db.cookbook.findUnique({ where: { id: first.cookbook.id } })).resolves.toBeNull();
    await expect(db.recipe.findUnique({ where: { id: first.recipe.id } })).resolves.toMatchObject({ id: first.recipe.id });
  });

  it("returns internal_error when cookbook create and update writes fail unexpectedly", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const createToken = await createApiCredential(db, owner.id, "Cookbook fault writer", { scopes: ["kitchen:write"] });
    const fixture = await createCookbookFixture(db, "Api V1 Fault Cookbook");
    const updateToken = await createApiCredential(db, fixture.chef.id, "Cookbook update fault writer", { scopes: ["kitchen:write"] });
    const originalCreate = db.cookbook.create;
    const originalUpdate = db.cookbook.update;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const createSpy = vi.fn().mockRejectedValueOnce(new Error("cookbook create storage unavailable"));
      db.cookbook.create = createSpy as unknown as typeof db.cookbook.create;
      const createFailure = await action(routeArgs(jsonRequest("http://localhost/api/v1/cookbooks", "POST", createToken.token, "req_cookbook_create_fault", {
        clientMutationId: "cm_cookbook_create_fault",
        title: `Api V1 Fault Create ${faker.string.alphanumeric(8)}`,
      }), "cookbooks"));

      expect(createFailure.status).toBe(500);
      await expect(readJson(createFailure)).resolves.toMatchObject({
        requestId: "req_cookbook_create_fault",
        error: { code: "internal_error", status: 500 },
      });
      expect(createSpy).toHaveBeenCalledOnce();

      const updateSpy = vi.fn().mockRejectedValueOnce(new Error("cookbook update storage unavailable"));
      db.cookbook.update = updateSpy as unknown as typeof db.cookbook.update;
      const updateFailure = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}`, "PATCH", updateToken.token, "req_cookbook_update_fault", {
        clientMutationId: "cm_cookbook_update_fault",
        title: `Api V1 Fault Update ${faker.string.alphanumeric(8)}`,
      }), `cookbooks/${fixture.cookbook.id}`));

      expect(updateFailure.status).toBe(500);
      await expect(readJson(updateFailure)).resolves.toMatchObject({
        requestId: "req_cookbook_update_fault",
        error: { code: "internal_error", status: 500 },
      });
      expect(updateSpy).toHaveBeenCalledOnce();
    } finally {
      db.cookbook.create = originalCreate;
      db.cookbook.update = originalUpdate;
      errorSpy.mockRestore();
    }
  });

  it("adds and removes cookbook recipes with owner checks and idempotent no-op duplicate adds", async () => {
    const fixture = await createCookbookFixture(db, "Api V1 Membership Cookbook");
    const ownerToken = await createApiCredential(db, fixture.chef.id, "Cookbook membership writer", { scopes: ["kitchen:write"] });
    const outsider = await db.user.create({ data: createTestUser() });
    const outsiderToken = await createApiCredential(db, outsider.id, "Cookbook membership outsider", { scopes: ["kitchen:write"] });
    const recipeToAdd = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: `Api V1 Membership Recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const deletedRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: `Api V1 Membership Deleted ${faker.string.alphanumeric(8)}`,
        deletedAt: new Date(),
      },
    });

    const outsiderAdd = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "POST", outsiderToken.token, "req_cookbook_recipe_add_outsider", {
      clientMutationId: "cm_cookbook_recipe_add_outsider",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    expect(outsiderAdd.status).toBe(403);

    const missingRecipe = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${deletedRecipe.id}`, "POST", ownerToken.token, "req_cookbook_recipe_add_deleted", {
      clientMutationId: "cm_cookbook_recipe_add_deleted",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${deletedRecipe.id}`));
    expect(missingRecipe.status).toBe(404);
    await expect(readJson(missingRecipe)).resolves.toMatchObject({
      error: { code: "not_found", details: { resource: "recipe", recipeId: deletedRecipe.id } },
    });

    const added = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "POST", ownerToken.token, "req_cookbook_recipe_add", {
      clientMutationId: "cm_cookbook_recipe_add",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const addedPayload = await readJson(added);

    expect(added.status).toBe(201);
    expect(addedPayload.data).toMatchObject({
      added: true,
      recipeId: recipeToAdd.id,
      cookbook: { id: fixture.cookbook.id, recipeCount: 2 },
      mutation: { clientMutationId: "cm_cookbook_recipe_add", replayed: false },
    });
    expect(addedPayload.data.cookbook.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([
      fixture.recipe.id,
      recipeToAdd.id,
    ]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T15:00:00.000Z"));
    const duplicate = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "POST", ownerToken.token, "req_cookbook_recipe_add_duplicate", {
      clientMutationId: "cm_cookbook_recipe_add_duplicate",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const duplicatePayload = await readJson(duplicate);

    expect(duplicate.status).toBe(200);
    expect(duplicatePayload.data).toMatchObject({
      added: false,
      cookbook: { id: fixture.cookbook.id, recipeCount: 2 },
      mutation: { clientMutationId: "cm_cookbook_recipe_add_duplicate", replayed: false },
    });
    expect(duplicatePayload.data.cookbook.updatedAt).toBe("2026-07-01T15:00:00.000Z");

    vi.setSystemTime(new Date("2026-07-01T15:01:00.000Z"));
    const removed = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "DELETE", ownerToken.token, "req_cookbook_recipe_remove", {
      clientMutationId: "cm_cookbook_recipe_remove",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const removedPayload = await readJson(removed);

    expect(removed.status).toBe(200);
    expect(removedPayload.data).toMatchObject({
      removed: true,
      recipeId: recipeToAdd.id,
      cookbook: { id: fixture.cookbook.id, recipeCount: 1 },
      mutation: { clientMutationId: "cm_cookbook_recipe_remove", replayed: false },
    });
    expect(removedPayload.data.cookbook.updatedAt).toBe("2026-07-01T15:01:00.000Z");

    vi.setSystemTime(new Date("2026-07-01T15:02:00.000Z"));
    const removeAgain = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "DELETE", ownerToken.token, "req_cookbook_recipe_remove_again", {
      clientMutationId: "cm_cookbook_recipe_remove_again",
    }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const removeAgainPayload = await readJson(removeAgain);

    expect(removeAgain.status).toBe(200);
    expect(removeAgainPayload.data).toMatchObject({
      removed: false,
      cookbook: { id: fixture.cookbook.id, recipeCount: 1 },
      mutation: { clientMutationId: "cm_cookbook_recipe_remove_again", replayed: false },
    });
    expect(removeAgainPayload.data.cookbook.updatedAt).toBe("2026-07-01T15:02:00.000Z");

    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: recipeToAdd.id, addedById: fixture.chef.id },
    });
    const headerRemove = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, {
      method: "DELETE",
      headers: bearer(ownerToken.token, "req_cookbook_recipe_remove_header", {
        "X-Client-Mutation-Id": "cm_cookbook_recipe_remove_header",
      }),
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const headerRemovePayload = await readJson(headerRemove);

    expect(headerRemove.status).toBe(200);
    expect(headerRemovePayload.data).toMatchObject({
      removed: true,
      mutation: { clientMutationId: "cm_cookbook_recipe_remove_header", replayed: false },
    });

    await db.recipeInCookbook.create({
      data: { cookbookId: fixture.cookbook.id, recipeId: recipeToAdd.id, addedById: fixture.chef.id },
    });
    const queryRemove = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}?clientMutationId=cm_cookbook_recipe_remove_query`, {
      method: "DELETE",
      headers: bearer(ownerToken.token, "req_cookbook_recipe_remove_query"),
    }) as unknown as Request, `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));
    const queryRemovePayload = await readJson(queryRemove);

    expect(queryRemove.status).toBe(200);
    expect(queryRemovePayload.data).toMatchObject({
      removed: true,
      mutation: { clientMutationId: "cm_cookbook_recipe_remove_query", replayed: false },
    });
  });

  it("returns internal_error when cookbook recipe membership writes fail unexpectedly", async () => {
    const fixture = await createCookbookFixture(db, "Api V1 Membership Fault Cookbook");
    const token = await createApiCredential(db, fixture.chef.id, "Cookbook membership fault writer", { scopes: ["kitchen:write"] });
    const recipeToAdd = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.chef.id),
        title: `Api V1 Membership Fault Recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalTransaction = db.$transaction;

    try {
      const transactionSpy = vi.fn().mockRejectedValueOnce(new Error("membership storage unavailable"));
      db.$transaction = transactionSpy as unknown as typeof db.$transaction;
      const response = await action(routeArgs(jsonRequest(`http://localhost/api/v1/cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`, "POST", token.token, "req_cookbook_recipe_add_fault", {
        clientMutationId: "cm_cookbook_recipe_add_fault",
      }), `cookbooks/${fixture.cookbook.id}/recipes/${recipeToAdd.id}`));

      expect(response.status).toBe(500);
      await expect(readJson(response)).resolves.toMatchObject({
        requestId: "req_cookbook_recipe_add_fault",
        error: { code: "internal_error", status: 500 },
      });
      expect(transactionSpy).toHaveBeenCalledOnce();
    } finally {
      db.$transaction = originalTransaction;
      errorSpy.mockRestore();
    }
  });
});
