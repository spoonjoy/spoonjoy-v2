import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { loader, action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../utils";

// The native profile surface (spoonjoy-apple ProfileChefGraphSurfaceRepository) decodes
// these payloads; the key sets below are the fields its Codable models read, plus the
// extra fields the API adds for other clients.

let db: PrismaClient;
let d1: SqliteD1 | null = null;

function get(path: string, options: { token?: string; env?: Record<string, unknown> | null } = {}) {
  const headers: Record<string, string> = { "X-Request-Id": "req_user_profile" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const request = new UndiciRequest(`http://localhost/api/v1/${path}`, { headers }) as unknown as Request;
  const splat = path.split("?")[0];
  return loader({ request, params: { "*": splat }, context: { cloudflare: { env: options.env ?? null } } } as any);
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function chef(username?: string, extra: Record<string, unknown> = {}) {
  return db.user.create({
    data: { ...createTestUser(), ...(username ? { username } : {}), ...extra },
  });
}

async function recipeFor(chefId: string, extra: Record<string, unknown> = {}) {
  return db.recipe.create({ data: { ...createTestRecipe(chefId), ...extra } });
}

async function withActiveCover(recipeId: string, imageUrl: string) {
  const cover = await db.recipeCover.create({
    data: { recipeId, imageUrl, sourceType: "chef-upload" },
  });
  await db.recipe.update({ where: { id: recipeId }, data: { activeCoverId: cover.id, activeCoverVariant: "image" } });
  return cover;
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
});

afterEach(async () => {
  d1?.close();
  d1 = null;
  await cleanupDatabase();
});

async function profileFixture() {
  const suffix = faker.string.alphanumeric(8).toLowerCase();
  const owner = await chef(`profile_owner_${suffix}`, {
    photoUrl: "/photos/profiles/owner/avatar.jpg",
    createdAt: new Date("2026-06-15T12:00:00.000Z"),
  });
  const other = await chef(`profile_other_${suffix}`);

  const covered = await recipeFor(owner.id, {
    title: "Covered Pasta",
    description: "Weeknight pasta",
    servings: "4",
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  });
  await withActiveCover(covered.id, "/photos/recipes/covered/cover.jpg");
  const plain = await recipeFor(owner.id, {
    title: "Plain Soup",
    description: null,
    servings: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  const deleted = await recipeFor(owner.id, { title: "Deleted Stew", deletedAt: new Date() });
  const otherRecipe = await recipeFor(other.id, { title: "Other Chef Tart" });

  const cookbook = await db.cookbook.create({ data: { title: "Weeknights", authorId: owner.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: covered.id, addedById: owner.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: deleted.id, addedById: owner.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: otherRecipe.id, addedById: owner.id } });

  const spoon = await db.recipeSpoon.create({
    data: {
      chefId: owner.id,
      recipeId: otherRecipe.id,
      cookedAt: new Date("2026-07-03T18:30:00.000Z"),
      photoUrl: "/photos/spoons/owner/spoon.jpg",
      note: "Extra lemon",
      nextTime: "Less salt",
    },
  });
  await db.recipeSpoon.create({
    data: { chefId: owner.id, recipeId: otherRecipe.id, deletedAt: new Date() },
  });
  // A visitor cooks the owner's recipe.
  await db.recipeSpoon.create({ data: { chefId: other.id, recipeId: covered.id } });

  return { owner, other, covered, plain, deleted, otherRecipe, cookbook, spoon };
}

describe("GET /api/v1/users/{identifier}", () => {
  it("returns the public profile in the native ProfileSurfaceData shape", async () => {
    const fixture = await profileFixture();

    const response = await get(`users/${fixture.owner.username}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    const body = await readJson(response);
    expect(body).toMatchObject({ ok: true, requestId: "req_user_profile" });
    const data = body.data;
    expect(Object.keys(data).sort()).toEqual([
      "cookbooks",
      "fellowChefsCount",
      "isOwner",
      "kitchenVisitorsCount",
      "profile",
      "recentSpoons",
      "recipeCount",
      "recipes",
      "recipesNextCursor",
    ]);
    expect(data.profile).toEqual({
      id: fixture.owner.id,
      username: fixture.owner.username,
      photoUrl: "https://spoonjoy.app/photos/profiles/owner/avatar.jpg",
      joinedLabel: "Joined Jun 2026",
      joinedAt: "2026-06-15T12:00:00.000Z",
      href: `/users/${fixture.owner.username}`,
      canonicalUrl: `https://spoonjoy.app/users/${fixture.owner.username}`,
    });
    expect(data.isOwner).toBe(false);
    expect(data.recipeCount).toBe(2);
    expect(data.recipesNextCursor).toBeNull();
    expect(data.recipes).toEqual([
      {
        id: fixture.covered.id,
        title: "Covered Pasta",
        description: "Weeknight pasta",
        servings: "4",
        coverImageUrl: "https://spoonjoy.app/photos/recipes/covered/cover.jpg",
        coverProvenanceLabel: expect.any(String),
        href: `/recipes/${fixture.covered.id}`,
        canonicalUrl: `https://spoonjoy.app/recipes/${fixture.covered.id}`,
      },
      {
        id: fixture.plain.id,
        title: "Plain Soup",
        description: null,
        servings: null,
        coverImageUrl: null,
        coverProvenanceLabel: null,
        href: `/recipes/${fixture.plain.id}`,
        canonicalUrl: `https://spoonjoy.app/recipes/${fixture.plain.id}`,
      },
    ]);
    expect(data.cookbooks).toHaveLength(1);
    expect(data.cookbooks[0]).toMatchObject({
      id: fixture.cookbook.id,
      title: "Weeknights",
      recipeCount: 2,
      href: `/cookbooks/${fixture.cookbook.id}`,
      canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
    });
    expect(data.cookbooks[0].recipes.map((recipe: any) => recipe.id).sort()).toEqual(
      [fixture.covered.id, fixture.otherRecipe.id].sort(),
    );
    for (const preview of data.cookbooks[0].recipes) {
      expect(Object.keys(preview).sort()).toEqual(["canonicalUrl", "coverImageUrl", "coverProvenanceLabel", "href", "id", "title"]);
    }
    expect(data.recentSpoons).toEqual([
      {
        id: fixture.spoon.id,
        cookedAt: "2026-07-03T18:30:00.000Z",
        photoUrl: "https://spoonjoy.app/photos/spoons/owner/spoon.jpg",
        note: "Extra lemon",
        nextTime: "Less salt",
        chef: {
          id: fixture.owner.id,
          username: fixture.owner.username,
          photoUrl: "https://spoonjoy.app/photos/profiles/owner/avatar.jpg",
        },
        recipe: { id: fixture.otherRecipe.id, title: "Other Chef Tart", chefId: fixture.other.id },
        coverImageUrl: null,
        coverProvenanceLabel: null,
      },
    ]);
    expect(data.fellowChefsCount).toBe(1);
    expect(data.kitchenVisitorsCount).toBe(1);
  });

  it("answers a user id directly, without redirecting", async () => {
    const fixture = await profileFixture();

    const response = await get(`users/${fixture.owner.id}`);

    expect(response.status).toBe(200);
    const { data } = await readJson(response);
    expect(data.profile.username).toBe(fixture.owner.username);
    expect(data.profile.href).toBe(`/users/${fixture.owner.username}`);
  });

  it("sets isOwner from the bearer credential and stops public caching", async () => {
    const fixture = await profileFixture();
    const ownerToken = await createApiCredential(db, fixture.owner.id, "Native app", { scopes: ["kitchen:read"] });
    const otherToken = await createApiCredential(db, fixture.other.id, "Native app", { scopes: ["account:read"] });

    const asOwner = await get(`users/${fixture.owner.username}`, { token: ownerToken.token });
    const asOther = await get(`users/${fixture.owner.username}`, { token: otherToken.token });

    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await readJson(asOwner)).data.isOwner).toBe(true);
    expect((await readJson(asOther)).data.isOwner).toBe(false);
  });

  it("returns the api-v1 not_found envelope for an unknown chef", async () => {
    const response = await get("users/nobody_here");

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      requestId: "req_user_profile",
      error: { code: "not_found", status: 404, message: "Chef not found", details: { resource: "user", identifier: "nobody_here" } },
    });
  });

  it("rejects an invalid bearer token instead of answering anonymously", async () => {
    const fixture = await profileFixture();

    const response = await get(`users/${fixture.owner.username}`, { token: "sj_not_a_real_token" });

    expect(response.status).toBe(401);
    expect((await readJson(response)).error.code).toBe("invalid_token");
  });

  it("pages recipes 24 at a time through recipesNextCursor", async () => {
    const owner = await chef();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    for (let index = 0; index < 26; index += 1) {
      await recipeFor(owner.id, { title: `Recipe ${index}`, updatedAt: new Date(base + index * 60_000) });
    }

    const first = (await readJson(await get(`users/${owner.username}`))).data;
    expect(first.recipes).toHaveLength(24);
    expect(first.recipeCount).toBe(26);
    expect(first.recipes[0].title).toBe("Recipe 25");
    expect(first.recipesNextCursor).toBe(first.recipes[23].id);

    const second = (await readJson(await get(`users/${owner.username}?after=${first.recipesNextCursor}`))).data;
    expect(second.recipes.map((recipe: any) => recipe.title)).toEqual(["Recipe 1", "Recipe 0"]);
    expect(second.recipesNextCursor).toBeNull();

    const empty = (await readJson(await get(`users/${owner.username}?after=`))).data;
    expect(empty.recipes).toHaveLength(24);
  });

  it("rejects a malformed recipe cursor", async () => {
    const owner = await chef();

    const response = await get(`users/${owner.username}?after=${encodeURIComponent("not a cursor!")}`);

    expect(response.status).toBe(400);
    expect((await readJson(response)).error.code).toBe("invalid_cursor");
  });

  it("returns null cover fields when the active cover has no public URL", async () => {
    const owner = await chef();
    const recipe = await recipeFor(owner.id);
    await withActiveCover(recipe.id, "data:image/png;base64,AAAA");

    const { data } = await readJson(await get(`users/${owner.username}`));

    expect(data.recipes[0]).toMatchObject({ id: recipe.id, coverImageUrl: null, coverProvenanceLabel: null });
    expect(data.profile.photoUrl).toBeNull();
    expect(data.cookbooks).toEqual([]);
    expect(data.recentSpoons).toEqual([]);
  });

  it("reads the same profile through the D1 binding", async () => {
    const fixture = await profileFixture();
    d1 = sqliteD1();

    const viaD1 = await get(`users/${fixture.owner.username}`, { env: { DB: d1.binding } });
    const viaPrisma = await get(`users/${fixture.owner.username}`);

    expect(viaD1.status).toBe(200);
    expect(d1.roundTrips()).toBe(1);
    expect((await readJson(viaD1)).data).toEqual((await readJson(viaPrisma)).data);
  });

  it("does not answer other methods", async () => {
    const owner = await chef();
    const request = new UndiciRequest(`http://localhost/api/v1/users/${owner.username}`, { method: "POST" }) as unknown as Request;

    const response = await action({ request, params: { "*": `users/${owner.username}` }, context: { cloudflare: { env: null } } } as any);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow") ?? (await readJson(response)).error.details.allow).toContain("GET");
  });
});

async function graphFixture() {
  const suffix = faker.string.alphanumeric(8).toLowerCase();
  const focal = await chef(`graph_focal_${suffix}`);
  const julia = await chef(`graph_julia_${suffix}`, { photoUrl: "/photos/profiles/julia/avatar.jpg" });
  const marco = await chef(`graph_marco_${suffix}`);
  const visitor = await chef(`graph_visitor_${suffix}`);

  const juliaRecipe = await recipeFor(julia.id);
  const marcoRecipe = await recipeFor(marco.id);
  const focalRecipe = await recipeFor(focal.id);

  // focal cooks julia's recipe twice and forks marco's recipe: two fellow chefs.
  await db.recipeSpoon.create({ data: { chefId: focal.id, recipeId: juliaRecipe.id, cookedAt: new Date("2026-07-01T00:00:00.000Z") } });
  await db.recipeSpoon.create({ data: { chefId: focal.id, recipeId: juliaRecipe.id, cookedAt: new Date("2026-07-05T00:00:00.000Z") } });
  await db.recipe.create({
    data: { ...createTestRecipe(focal.id), sourceRecipeId: marcoRecipe.id, createdAt: new Date("2026-07-02T00:00:00.000Z") },
  });
  // visitor saves focal's recipe: one kitchen visitor.
  const visitorBook = await db.cookbook.create({ data: { title: "Saved", authorId: visitor.id } });
  await db.recipeInCookbook.create({
    data: { cookbookId: visitorBook.id, recipeId: focalRecipe.id, addedById: visitor.id, createdAt: new Date("2026-07-04T00:00:00.000Z") },
  });

  return { focal, julia, marco, visitor };
}

describe("GET /api/v1/users/{identifier}/fellow-chefs and kitchen-visitors", () => {
  it("lists fellow chefs in the native ProfileGraphPage shape", async () => {
    const fixture = await graphFixture();

    const response = await get(`users/${fixture.focal.username}/fellow-chefs?page=1&limit=50`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    const { data } = await readJson(response);
    expect(data).toEqual({
      profile: {
        id: fixture.focal.id,
        username: fixture.focal.username,
        href: `/users/${fixture.focal.username}`,
        canonicalUrl: `https://spoonjoy.app/users/${fixture.focal.username}`,
      },
      direction: "fellow-chefs",
      isOwner: false,
      page: 1,
      pageSize: 50,
      total: 2,
      nextCursor: null,
      rows: [
        {
          chefId: fixture.julia.id,
          username: fixture.julia.username,
          photoUrl: "https://spoonjoy.app/photos/profiles/julia/avatar.jpg",
          href: `/users/${fixture.julia.username}`,
          canonicalUrl: `https://spoonjoy.app/users/${fixture.julia.username}`,
          interactionCounts: { spoons: 2, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: "2026-07-05T00:00:00.000Z",
        },
        {
          chefId: fixture.marco.id,
          username: fixture.marco.username,
          photoUrl: null,
          href: `/users/${fixture.marco.username}`,
          canonicalUrl: `https://spoonjoy.app/users/${fixture.marco.username}`,
          interactionCounts: { spoons: 0, forks: 1, cookbookSaves: 0 },
          latestInteractionAt: "2026-07-02T00:00:00.000Z",
        },
      ],
      emptyState: null,
    });
    expect(data).not.toHaveProperty("source");
  });

  it("lists kitchen visitors and accepts a user id", async () => {
    const fixture = await graphFixture();
    const token = await createApiCredential(db, fixture.focal.id, "Native app", { scopes: ["kitchen:read"] });

    const response = await get(`users/${fixture.focal.id}/kitchen-visitors`, { token: token.token });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { data } = await readJson(response);
    expect(data).toMatchObject({ direction: "kitchen-visitors", isOwner: true, page: 1, pageSize: 50, total: 1, nextCursor: null, emptyState: null });
    expect(data.rows).toEqual([
      expect.objectContaining({
        chefId: fixture.visitor.id,
        interactionCounts: { spoons: 0, forks: 0, cookbookSaves: 1 },
        latestInteractionAt: "2026-07-04T00:00:00.000Z",
      }),
    ]);
  });

  it("pages with page and limit and returns the next page number as nextCursor", async () => {
    const fixture = await graphFixture();

    const first = (await readJson(await get(`users/${fixture.focal.username}/fellow-chefs?page=1&limit=1`))).data;
    const second = (await readJson(await get(`users/${fixture.focal.username}/fellow-chefs?page=2&limit=1`))).data;

    expect(first).toMatchObject({ page: 1, pageSize: 1, total: 2, nextCursor: "2" });
    expect(first.rows.map((row: any) => row.chefId)).toEqual([fixture.julia.id]);
    expect(second).toMatchObject({ page: 2, pageSize: 1, total: 2, nextCursor: null, emptyState: null });
    expect(second.rows.map((row: any) => row.chefId)).toEqual([fixture.marco.id]);
  });

  it("returns the native empty state when a page has no rows", async () => {
    const lonely = await chef();

    const fellow = (await readJson(await get(`users/${lonely.username}/fellow-chefs?limit=`))).data;
    const visitors = (await readJson(await get(`users/${lonely.username}/kitchen-visitors?page=`))).data;

    expect(fellow).toMatchObject({ total: 0, rows: [], nextCursor: null });
    expect(fellow.emptyState).toEqual({
      title: "No fellow chefs yet",
      message: "Fellow chefs appear after this chef cooks, forks, or saves recipes from other chefs.",
      systemImage: "person.2",
    });
    expect(visitors.emptyState).toEqual({
      title: "No kitchen visitors yet",
      message: "Kitchen visitors appear after other chefs cook, fork, or save this chef's recipes.",
      systemImage: "person.crop.circle.badge.clock",
    });
  });

  it("rejects invalid page and limit values", async () => {
    const owner = await chef();

    for (const query of ["page=0", "page=1.5", "page=abc", "limit=0", "limit=101", "limit=2.5"]) {
      const response = await get(`users/${owner.username}/fellow-chefs?${query}`);
      expect(response.status, query).toBe(400);
      expect((await readJson(response)).error.code, query).toBe("validation_error");
    }
  });

  it("returns not_found for an unknown chef", async () => {
    for (const direction of ["fellow-chefs", "kitchen-visitors"]) {
      const response = await get(`users/nobody_here/${direction}`);
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: false,
        error: { code: "not_found", message: "Chef not found", details: { resource: "user", identifier: "nobody_here" } },
      });
    }
  });

  it("does not serve other sub-resources under a chef", async () => {
    const owner = await chef();

    const response = await get(`users/${owner.username}/recipes`);

    expect(response.status).toBe(404);
    expect((await readJson(response)).error.code).toBe("not_found");
  });
});
