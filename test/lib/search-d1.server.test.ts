// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import {
  ensureSearchIndexFresh,
  rebuildSearchIndex,
  searchSourceFingerprint,
  searchSourceFingerprintFromD1,
  searchSpoonjoy,
  searchSpoonjoyFromD1,
  type SearchOptions,
} from "~/lib/search.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

async function createChef(prefix: string, photoUrl: string | null = null) {
  return db.user.create({
    data: { ...createTestUser(), username: `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`, photoUrl },
  });
}

async function seedSearchData() {
  const chef = await createChef("pantrychef", "https://example.com/chef.jpg");
  const friend = await createChef("pantryfriend");
  const cup = await getOrCreateUnit(db, `cup_${faker.string.alphanumeric(5).toLowerCase()}`);

  const recipe = async (chefId: string, title: string, ingredients: string[], extra: Record<string, unknown> = {}) => {
    const created = await db.recipe.create({
      data: { title, description: `${title} for the pantry`, servings: "2", chefId, sourceUrl: "https://example.com/src", ...extra },
    });
    await db.recipeStep.create({
      data: { recipeId: created.id, stepNum: 1, stepTitle: "Prep", description: `Prepare ${ingredients.join(" and ")}` },
    });
    await db.recipeStep.create({ data: { recipeId: created.id, stepNum: 2, stepTitle: null, description: "Serve warm" } });
    for (const [index, name] of ingredients.entries()) {
      const ref = await getOrCreateIngredientRef(db, name);
      await db.ingredient.create({
        data: { recipeId: created.id, stepNum: index % 2 === 0 ? 1 : 2, quantity: 0.5 + index, unitId: cup.id, ingredientRefId: ref.id },
      });
    }
    return created;
  };

  const lemonRice = await recipe(chef.id, "Lemon Herb Rice", ["jasmine rice", "lemon", "parsley"]);
  const cover = await db.recipeCover.create({
    data: {
      recipeId: lemonRice.id,
      imageUrl: "https://example.com/rice.jpg",
      stylizedImageUrl: "https://example.com/rice-editorial.jpg",
      sourceType: "spoon",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await db.recipe.update({ where: { id: lemonRice.id }, data: { activeCoverId: cover.id, activeCoverVariant: "stylized" } });
  await recipe(chef.id, "Tomato Soup", ["tomato", "garlic"]);
  const risotto = await recipe(friend.id, "Saffron Risotto", ["arborio rice", "saffron", "butter"]);
  await recipe(friend.id, "Deleted Rice Pudding", ["rice"], { deletedAt: new Date("2026-02-01T00:00:00.000Z") });

  const cookbook = await db.cookbook.create({ data: { title: "Weeknight Rice", authorId: chef.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: lemonRice.id, addedById: chef.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: risotto.id, addedById: chef.id } });

  const list = await db.shoppingList.create({ data: { authorId: chef.id } });
  const lemon = await getOrCreateIngredientRef(db, "lemon");
  const rice = await getOrCreateIngredientRef(db, "jasmine rice");
  await db.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: lemon.id, unitId: cup.id, quantity: 1.5, categoryKey: "produce", iconKey: "lemon" },
  });
  await db.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: rice.id, unitId: null, quantity: null, checked: true, sortIndex: 3 },
  });
  const friendList = await db.shoppingList.create({ data: { authorId: friend.id } });
  await db.shoppingListItem.create({ data: { shoppingListId: friendList.id, ingredientRefId: lemon.id, quantity: 2 } });

  return { chef, friend, lemonRice, cookbook };
}

describe("searchSpoonjoyFromD1", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma search returns for every scope and query shape", async () => {
    const { chef, friend } = await seedSearchData();
    const cases: SearchOptions[] = [
      { query: "rice" },
      { query: "rice", viewerId: chef.id },
      { query: "lemon", scope: "shopping-list", viewerId: chef.id },
      { query: "lemon", scope: "shopping-list", viewerId: friend.id, ownerId: friend.id },
      { query: "lemon", scope: "shopping-list" },
      { query: "rice, saffron, garlic", scope: "recipes" },
      { query: "pantrychef", scope: "chefs" },
      { query: "weeknight", scope: "cookbooks" },
      { query: "", viewerId: chef.id, limit: 3 },
      { query: "" },
      { query: "!!!" },
      { query: "pudding" },
    ];

    for (const options of cases) {
      const fromD1 = await searchSpoonjoyFromD1(d1.binding, options);
      expect(fromD1, JSON.stringify(options)).toEqual(await searchSpoonjoy(db, options));
    }

    // Without options it lists everything public, newest first.
    expect(await searchSpoonjoyFromD1(d1.binding)).toEqual(await searchSpoonjoy(db));

    const results = await searchSpoonjoyFromD1(d1.binding, { query: "lemon", viewerId: chef.id });
    expect(results.find((result) => result.type === "shopping-list-item")).toMatchObject({
      ownerId: chef.id,
      metadata: { quantity: 1.5, checked: false, categoryKey: "produce" },
    });
    expect(results.find((result) => result.type === "recipe")).toMatchObject({
      imageUrl: "https://example.com/rice-editorial.jpg",
      metadata: { coverVariant: "stylized", ingredientNames: ["jasmine rice", "lemon", "parsley"], stepCount: 2 },
    });
    // Another chef's shopping list never shows up, signed in or not.
    expect(results.filter((result) => result.type === "shopping-list-item").every((result) => result.ownerId === chef.id)).toBe(true);
  });

  it("indexes the same documents as the Prisma rebuild", async () => {
    await seedSearchData();
    await rebuildSearchIndex(db);
    const prismaDocuments = await db.$queryRawUnsafe(`SELECT * FROM "SearchDocument" ORDER BY rowid`);
    await db.$executeRawUnsafe(`DELETE FROM "SearchIndexMetadata"`);

    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    const d1Documents = await db.$queryRawUnsafe(`SELECT * FROM "SearchDocument" ORDER BY rowid`);
    expect(d1Documents).toEqual(prismaDocuments);
    expect((d1Documents as unknown[]).length).toBeGreaterThan(8);
  });

  it("agrees with the Prisma path on freshness, so the two never rebuild each other's index", async () => {
    const { lemonRice } = await seedSearchData();
    expect(await searchSourceFingerprintFromD1(d1.binding)).toBe(await searchSourceFingerprint(db));

    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    await db.$executeRawUnsafe(
      `UPDATE "SearchDocument" SET "title" = 'Cached Marker' WHERE "entityId" = ?`,
      lemonRice.id,
    );
    await ensureSearchIndexFresh(db);
    await expect(searchSpoonjoy(db, { query: "cached marker" })).resolves.toHaveLength(1);
  });

  it("answers from a fresh index in one round trip and rebuilds in four when the data changed", async () => {
    const { lemonRice } = await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    await db.$executeRawUnsafe(`UPDATE "SearchDocument" SET "title" = 'Cached Marker' WHERE "entityId" = ?`, lemonRice.id);
    let before = d1.roundTrips();
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "cached marker" })).resolves.toMatchObject([{ id: lemonRice.id }]);
    expect(d1.roundTrips() - before).toBe(1);

    await db.recipe.update({ where: { id: lemonRice.id }, data: { title: "Bright Plum Rice" } });
    before = d1.roundTrips();
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "plum", scope: "recipes" })).resolves.toMatchObject([{ id: lemonRice.id }]);
    // Freshness check + search, source reads, replace the index, search again.
    expect(d1.roundTrips() - before).toBe(4);
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "cached marker" })).resolves.toEqual([]);
  });

  it("splits a large rebuild into several insert statements and keeps document order", async () => {
    const chef = await createChef("bulkchef");
    const longText = "slow simmered ".repeat(400);
    for (let index = 0; index < 20; index += 1) {
      await db.recipe.create({
        data: { title: `Bulk Stew ${String(index).padStart(2, "0")}`, description: longText, chefId: chef.id },
      });
    }

    await expect(searchSpoonjoyFromD1(d1.binding, { query: "bulk stew", limit: 50 })).resolves.toHaveLength(20);
    const inserts = d1.statements.filter((statement) => statement.sql.startsWith(`INSERT INTO "SearchDocument"`));
    expect(inserts.length).toBeGreaterThan(1);
    const rows = await db.$queryRawUnsafe<Array<{ title: string }>>(
      `SELECT title FROM "SearchDocument" WHERE entityType = 'recipe' ORDER BY rowid`,
    );
    const recipesById = await db.recipe.findMany({ orderBy: { id: "asc" }, select: { title: true } });
    expect(rows.map((row) => row.title)).toEqual(recipesById.map((recipe) => recipe.title));
  });

  it("returns nothing without touching D1 when the search cannot match", async () => {
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "!!!" })).resolves.toEqual([]);
    await expect(searchSpoonjoyFromD1(d1.binding, { scope: "shopping-list" })).resolves.toEqual([]);
    expect(d1.roundTrips()).toBe(0);
  });

  it("fails closed on D1 errors and malformed freshness rows", async () => {
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(searchSpoonjoyFromD1(failing as never, { query: "rice" })).rejects.toThrow("D1_ERROR: lost");
    await expect(searchSourceFingerprintFromD1(failing as never)).rejects.toThrow("D1_ERROR: lost");

    const empty = { prepare: d1.binding.prepare, batch: async (statements: unknown[]) => statements.map(() => ({ results: [] })) };
    await expect(searchSpoonjoyFromD1(empty as never, { query: "rice" })).rejects.toThrow("D1 search fingerprint returned no row");
  });
});

describe("search loader on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  it("searches through D1 and never constructs a Prisma client", async () => {
    const { chef } = await seedSearchData();
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loader } = await import("~/routes/search");
    const cookie = (await createUserSessionCookie(chef.id)).split(";")[0]!;

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/search?q=lemon&scope=shopping", { headers: { Cookie: cookie } }),
      context: { cloudflare: { env: { DB: d1.binding } } },
      params: {},
    } as never);

    expect(getRequestDb).not.toHaveBeenCalled();
    expect(result).toMatchObject({ query: "lemon", scope: "shopping-list", isAuthenticated: true });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ type: "shopping-list-item", ownerId: chef.id });
  });
});
