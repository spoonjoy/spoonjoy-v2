// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import {
  ensureSearchIndexFresh,
  rebuildSearchIndex,
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

  it("shares one index with the Prisma path, so the two never rebuild each other's index", async () => {
    const { lemonRice } = await seedSearchData();

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
    const firstStatement = d1.statements.length;
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "plum", scope: "recipes" })).resolves.toMatchObject([{ id: lemonRice.id }]);
    // Index check + search, reads for the queued entities, replace their documents, search again.
    expect(d1.roundTrips() - before).toBe(4);
    const statements = d1.statements.slice(firstStatement).map((statement) => statement.sql);
    expect(statements).not.toContain(`DELETE FROM "SearchDocument"`);
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

  it("fails closed on D1 errors and malformed index-state rows", async () => {
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(searchSpoonjoyFromD1(failing as never, { query: "rice" })).rejects.toThrow("D1_ERROR: lost");

    const empty = { prepare: d1.binding.prepare, batch: async (statements: unknown[]) => statements.map(() => ({ results: [] })) };
    await expect(searchSpoonjoyFromD1(empty as never, { query: "rice" })).rejects.toThrow("D1 column triggerCount is not a count");
  });
});

describe("per-entity search index maintenance", () => {
  const SOURCE_TABLE_READ = /FROM "(User|Recipe|RecipeCover|RecipeStep|Ingredient|IngredientRef|Unit|Cookbook|RecipeInCookbook|ShoppingListItem)"/;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  function statementsSince(index: number) {
    return d1.statements.slice(index).map((statement) => statement.sql);
  }

  function isFullRebuild(statements: string[]) {
    return statements.includes(`DELETE FROM "SearchDocument"`);
  }

  async function documentSnapshot() {
    return db.$queryRawUnsafe<unknown[]>(
      `SELECT entityType, entityId, ownerId, ownerUsername, sortAt, title, subtitle, body, href, imageUrl, metadata
       FROM "SearchDocument" ORDER BY entityType, entityId`,
    );
  }

  async function queued() {
    return db.$queryRawUnsafe<Array<{ entityType: string; entityId: string }>>(
      `SELECT "entityType", "entityId" FROM "SearchDirtyEntity" ORDER BY "seq"`,
    );
  }

  it("answers a search with no queued writes without reading any source table", async () => {
    await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    const start = d1.statements.length;
    const before = d1.roundTrips();
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "rice" })).resolves.not.toHaveLength(0);
    expect(d1.roundTrips() - before).toBe(1);
    const statements = statementsSince(start);
    expect(statements.filter((sql) => SOURCE_TABLE_READ.test(sql))).toEqual([]);
    expect(statements.some((sql) => sql.includes("COUNT(*) FROM \"Recipe\""))).toBe(false);
  });

  it("re-indexes an edited recipe and its cookbook without rebuilding the index", async () => {
    const { lemonRice, cookbook } = await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    await db.recipe.update({ where: { id: lemonRice.id }, data: { title: "Midnight Plum Rice" } });
    expect(await queued()).toEqual(
      expect.arrayContaining([
        { entityType: "recipe", entityId: lemonRice.id },
        { entityType: "cookbook", entityId: cookbook.id },
      ]),
    );

    const start = d1.statements.length;
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "midnight plum", scope: "recipes" }))
      .resolves.toMatchObject([{ id: lemonRice.id, title: "Midnight Plum Rice" }]);
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "midnight plum", scope: "cookbooks" }))
      .resolves.toMatchObject([{ id: cookbook.id, metadata: { recipeTitles: expect.arrayContaining(["Midnight Plum Rice"]) } }]);
    expect(isFullRebuild(statementsSince(start))).toBe(false);
    expect(await queued()).toEqual([]);
  });

  it("re-indexes only the shopping item when one is checked off", async () => {
    await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    const item = await db.shoppingListItem.findFirstOrThrow({ where: { checked: false, quantity: 1.5 } });
    await db.shoppingListItem.update({ where: { id: item.id }, data: { checked: true } });
    expect(await queued()).toEqual([{ entityType: "shopping-list-item", entityId: item.id }]);

    const list = await db.shoppingList.findUniqueOrThrow({ where: { id: item.shoppingListId } });
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "lemon", scope: "shopping-list", viewerId: list.authorId }))
      .resolves.toMatchObject([{ id: item.id, metadata: { checked: true } }]);
  });

  it("ends with exactly the documents a full rebuild produces after every kind of write", async () => {
    const { chef, friend, lemonRice, cookbook } = await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    const soup = await db.recipe.findFirstOrThrow({ where: { title: "Tomato Soup" } });
    const risotto = await db.recipe.findFirstOrThrow({ where: { title: "Saffron Risotto" } });
    await db.recipe.update({ where: { id: lemonRice.id }, data: { title: "Lemon Herb Pilaf", description: "Now a pilaf" } });
    await db.recipeStep.update({
      where: { recipeId_stepNum: { recipeId: soup.id, stepNum: 2 } },
      data: { description: "Ladle into warm bowls" },
    });
    const cup = await db.unit.findFirstOrThrow({ where: { name: { startsWith: "cup_" } } });
    const basil = await getOrCreateIngredientRef(db, "basil");
    await db.ingredient.create({ data: { recipeId: soup.id, stepNum: 2, quantity: 3, unitId: cup.id, ingredientRefId: basil.id } });
    await db.recipeCover.create({ data: { recipeId: soup.id, imageUrl: "https://example.com/soup.jpg", sourceType: "spoon" } });
    await db.cookbook.update({ where: { id: cookbook.id }, data: { title: "Weeknight Grains" } });
    await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: soup.id, addedById: chef.id } });
    await db.recipeInCookbook.deleteMany({ where: { cookbookId: cookbook.id, recipeId: risotto.id } });
    const second = await db.cookbook.create({ data: { title: "Friend Favourites", authorId: friend.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: second.id, recipeId: risotto.id, addedById: friend.id } });
    await db.user.update({ where: { id: friend.id }, data: { username: `renamed_${friend.username}` } });
    await db.unit.update({ where: { id: cup.id }, data: { name: `${cup.name}_renamed` } });
    await db.ingredientRef.update({ where: { id: basil.id }, data: { name: "sweet basil" } });
    const items = await db.shoppingListItem.findMany({ orderBy: { sortIndex: "asc" } });
    await db.shoppingListItem.update({ where: { id: items[0]!.id }, data: { checked: true } });
    await db.shoppingListItem.update({ where: { id: items[1]!.id }, data: { deletedAt: new Date() } });
    await db.recipe.update({ where: { id: risotto.id }, data: { deletedAt: new Date() } });
    const doomed = await db.recipe.create({ data: { title: "Doomed Toast", chefId: chef.id } });
    await db.recipe.delete({ where: { id: doomed.id } });
    await db.cookbook.delete({ where: { id: second.id } });
    await createChef("latecomer");

    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    const incremental = await documentSnapshot();
    expect(await queued()).toEqual([]);

    await db.$executeRawUnsafe(`DELETE FROM "SearchIndexMetadata"`);
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    expect(await documentSnapshot()).toEqual(incremental);
    expect(incremental.length).toBeGreaterThanOrEqual(8);
  });

  it("reinstalls the triggers with a full rebuild when one has gone missing", async () => {
    const { lemonRice } = await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });

    await db.$executeRawUnsafe(`DROP TRIGGER "SearchDirty_Recipe_update"`);
    await db.recipe.update({ where: { id: lemonRice.id }, data: { title: "Untracked Quince Rice" } });
    expect(await queued()).not.toContainEqual({ entityType: "recipe", entityId: lemonRice.id });

    const start = d1.statements.length;
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "untracked quince", scope: "recipes" }))
      .resolves.toMatchObject([{ id: lemonRice.id }]);
    expect(isFullRebuild(statementsSince(start))).toBe(true);
    const [row] = await db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'SearchDirty_Recipe_update'`,
    );
    expect(Number(row!.count)).toBe(1);
  });

  it("falls back to one full rebuild when more writes are queued than a search should re-index", async () => {
    await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    const chef = await createChef("bulkqueue");
    // One statement, so 205 recipes queue 205 documents (plus the chef) at once.
    await db.$executeRawUnsafe(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 204)
       INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt")
       SELECT 'bulk-queue-' || i, 'Queued Barley ' || i, ?, ?, ? FROM n`,
      chef.id,
      Date.now(),
      Date.now(),
    );
    expect((await queued()).length).toBeGreaterThan(200);

    const start = d1.statements.length;
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "queued barley", limit: 50 })).resolves.toHaveLength(50);
    expect(isFullRebuild(statementsSince(start))).toBe(true);
    expect(await queued()).toEqual([]);
  });

  it("clears queue rows of an entity type it does not index", async () => {
    await seedSearchData();
    await searchSpoonjoyFromD1(d1.binding, { query: "rice" });
    await db.$executeRawUnsafe(
      `INSERT INTO "SearchDirtyEntity" ("entityType", "entityId", "seq") VALUES ('retired-type', 'x', 1)`,
    );

    const start = d1.statements.length;
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "rice" })).resolves.not.toHaveLength(0);
    expect(statementsSince(start).filter((sql) => SOURCE_TABLE_READ.test(sql))).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("keeps the Prisma path's index current from the same queue", async () => {
    const { lemonRice } = await seedSearchData();
    await searchSpoonjoy(db, { query: "rice" });
    await db.recipe.update({ where: { id: lemonRice.id }, data: { title: "Prisma Fig Rice" } });
    await expect(searchSpoonjoy(db, { query: "prisma fig", scope: "recipes" })).resolves.toMatchObject([{ id: lemonRice.id }]);
    expect(await queued()).toEqual([]);
    await expect(searchSpoonjoyFromD1(d1.binding, { query: "prisma fig", scope: "recipes" })).resolves.toMatchObject([{ id: lemonRice.id }]);
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
