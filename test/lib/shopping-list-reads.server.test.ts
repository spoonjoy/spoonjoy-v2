// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { createUserSessionCookie } from "~/lib/session.server";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { readShoppingListFromD1, readShoppingListWithPrisma } from "~/lib/shopping-list-reads.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

async function seedList() {
  const user = await db.user.create({ data: createTestUser() });
  const other = await db.user.create({ data: createTestUser() });
  const cups = await db.unit.create({ data: { name: `cups ${user.id}` } });
  const [apple, basil, carrot, dill] = await Promise.all(
    ["apple", "basil", "carrot", "dill"].map((name) => db.ingredientRef.create({ data: { name: `${name} ${user.id}` } })),
  );
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  // Two rows share sortIndex 1, so the ingredient name breaks the tie.
  await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: carrot.id, unitId: cups.id, quantity: 2.5, sortIndex: 1, categoryKey: "produce", iconKey: "carrot" } });
  await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: basil.id, sortIndex: 1 } });
  await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: apple.id, sortIndex: 0, checked: true, checkedAt: new Date("2026-10-01T10:00:00Z") } });
  await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: dill.id, sortIndex: 2, deletedAt: new Date() } });
  const otherList = await db.shoppingList.create({ data: { authorId: other.id } });
  await db.shoppingListItem.create({ data: { shoppingListId: otherList.id, ingredientRefId: dill.id } });

  await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Zucchini bread" } });
  await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Apple pie" } });
  await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Gone soup", deletedAt: new Date() } });
  await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Not mine" } });
  return { user, other };
}

describe("shopping list page reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma reads return, in one D1 batch, scoped to the chef", async () => {
    const { user, other } = await seedList();

    for (const userId of [user.id, other.id]) {
      const before = d1.roundTrips();
      const fromD1 = await readShoppingListFromD1(d1.binding, userId);
      expect(d1.roundTrips() - before).toBe(1);
      expect(fromD1).toEqual(await readShoppingListWithPrisma(db, userId));
    }

    const reads = await readShoppingListFromD1(d1.binding, user.id);
    expect(reads.shoppingList.items.map((item) => item.ingredientRef.name.split(" ")[0])).toEqual(["apple", "basil", "carrot"]);
    expect(reads.shoppingList.items[0]).toMatchObject({ checked: true, checkedAt: new Date("2026-10-01T10:00:00Z"), unit: null });
    expect(reads.shoppingList.items[2]).toMatchObject({ quantity: 2.5, categoryKey: "produce", unit: { name: `cups ${user.id}` } });
    expect(reads.recipes.map((recipe) => recipe.title)).toEqual(["Apple pie", "Zucchini bread"]);
  });

  it("creates the list on a chef's first visit, once, and matches the Prisma reader's new list", async () => {
    const user = await db.user.create({ data: createTestUser() });

    const first = await readShoppingListFromD1(d1.binding, user.id, () => new Date("2026-10-10T08:00:00Z"));
    expect(first.shoppingList).toMatchObject({
      authorId: user.id,
      items: [],
      createdAt: new Date("2026-10-10T08:00:00Z"),
      updatedAt: new Date("2026-10-10T08:00:00Z"),
    });
    expect(first.recipes).toEqual([]);

    const writesBefore = d1.statements.filter(({ sql }) => sql.startsWith("INSERT")).length;
    const again = await readShoppingListFromD1(d1.binding, user.id);
    expect(again.shoppingList.id).toBe(first.shoppingList.id);
    expect(d1.statements.filter(({ sql }) => sql.startsWith("INSERT")).length).toBe(writesBefore);
    expect(again).toEqual(await readShoppingListWithPrisma(db, user.id));
    await expect(db.shoppingList.count({ where: { authorId: user.id } })).resolves.toBe(1);

    // The Prisma reader creates a list the same way.
    const viaPrisma = await db.user.create({ data: createTestUser() });
    await expect(readShoppingListWithPrisma(db, viaPrisma.id)).resolves.toMatchObject({
      shoppingList: { authorId: viaPrisma.id, items: [] },
      recipes: [],
    });
  });

  it("keeps the list a concurrent first visit created", async () => {
    const user = await db.user.create({ data: createTestUser() });
    let raced = false;
    const racing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        const isInsert = (statements as unknown as Array<{ sql: string }>)[0]!.sql.startsWith("INSERT");
        if (isInsert && !raced) {
          raced = true;
          await db.shoppingList.create({ data: { id: "list-from-the-other-request", authorId: user.id } });
        }
        return d1.binding.batch(statements as never);
      },
    };

    const reads = await readShoppingListFromD1(racing, user.id);

    expect(raced).toBe(true);
    expect(reads.shoppingList.id).toBe("list-from-the-other-request");
    await expect(db.shoppingList.count({ where: { authorId: user.id } })).resolves.toBe(1);
  });

  it("fails closed on a recipe row without an id or title", async () => {
    const user = await db.user.create({ data: createTestUser() });
    await db.shoppingList.create({ data: { authorId: user.id } });
    for (const bad of [{ id: null, title: "Soup" }, { id: "recipe-1", title: 7 }]) {
      const corrupt: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          const results = await d1.binding.batch(statements as never);
          return results.map((result, index) => (index === 2 ? { ...result, results: [bad] } : result));
        },
      };

      await expect(readShoppingListFromD1(corrupt, user.id)).rejects.toThrow("D1 recipe row is missing its id or title");
    }
  });
});

describe("shopping list loader on a D1 binding", () => {
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

  it("reads the page from D1 in two round trips and never constructs a Prisma client", async () => {
    const { user } = await seedList();
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
      getRequestDb,
    }));
    const { loader } = await import("~/routes/shopping-list");
    const cookie = (await createUserSessionCookie(user.id)).split(";")[0]!;

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/shopping-list", { headers: { Cookie: cookie } }),
      context: { cloudflare: { env: { DB: d1.binding } } },
      params: {},
    } as never);

    expect(getRequestDb).not.toHaveBeenCalled();
    // The session version check, then one batch for the page.
    expect(d1.roundTrips()).toBe(2);
    expect(result).toEqual(await readShoppingListWithPrisma(db, user.id));
  });
});
