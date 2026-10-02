// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import {
  readKitchenHomeFromD1,
  readKitchenHomeWithPrisma,
  type KitchenHomeRows,
} from "~/lib/kitchen-home.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

// Covers are compared by what the page shows: the D1 reader returns only a recipe's
// active cover, the Prisma reader its whole history.
function displayed(rows: KitchenHomeRows) {
  return {
    ...rows,
    recipes: rows.recipes.map(({ covers, ...recipe }) => ({ ...recipe, cover: getRecipeCoverDisplay(recipe, covers) })),
    cookbooks: rows.cookbooks.map((cookbook) => ({
      ...cookbook,
      recipes: cookbook.recipes.map(({ recipe: { covers, ...recipe }, ...entry }) => ({
        ...entry,
        recipe: { ...recipe, cover: getRecipeCoverDisplay(recipe, covers) },
      })),
    })),
  };
}

async function seedKitchen() {
  const owner = await db.user.create({ data: { ...createTestUser(), photoUrl: "https://example.com/o.jpg" } });
  const viewer = await db.user.create({ data: createTestUser() });
  const other = await db.user.create({ data: createTestUser() });

  const recipe = (title: string, minute: number, extra: Record<string, unknown> = {}) =>
    db.recipe.create({
      data: { title, chefId: owner.id, createdAt: at(minute), updatedAt: at(minute), ...extra },
    });

  const withCover = await recipe("With cover", 1, { description: "Tart", servings: "4" });
  const cover = await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/c.jpg", sourceType: "chef-upload", createdAt: at(1) },
  });
  await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/old.jpg", sourceType: "chef-upload", createdAt: at(0) },
  });
  await db.recipe.update({ where: { id: withCover.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image" } });

  const archived = await recipe("Archived cover", 2);
  const archivedCover = await db.recipeCover.create({
    data: { recipeId: archived.id, imageUrl: "https://example.com/a.jpg", sourceType: "chef-upload", archivedAt: at(2) },
  });
  await db.recipe.update({ where: { id: archived.id }, data: { activeCoverId: archivedCover.id } });

  // An active cover id that points at another recipe's cover is not this recipe's cover.
  const borrowed = await recipe("Borrowed cover", 3);
  await db.recipe.update({ where: { id: borrowed.id }, data: { activeCoverId: cover.id } });

  const deleted = await recipe("Deleted", 4, { deletedAt: at(5) });
  const others = await Promise.all([5, 6, 7, 8].map((minute) => recipe(`Extra ${minute}`, minute)));
  await db.recipe.create({ data: { title: "Not the owner's", chefId: other.id } });

  const big = await db.cookbook.create({ data: { title: "Big", authorId: owner.id, updatedAt: at(10) } });
  // The deleted recipe is the newest entry, and two entries share a timestamp: the card
  // skips the deleted recipe and breaks the tie by id.
  for (const [index, entry] of [withCover, ...others].entries()) {
    await db.recipeInCookbook.create({
      data: { cookbookId: big.id, recipeId: entry.id, addedById: owner.id, createdAt: at(20 + Math.min(index, 2)) },
    });
  }
  await db.recipeInCookbook.create({
    data: { cookbookId: big.id, recipeId: deleted.id, addedById: owner.id, createdAt: at(29) },
  });
  await db.cookbook.create({ data: { title: "Empty", authorId: owner.id, updatedAt: at(11) } });
  const small = await db.cookbook.create({ data: { title: "Small", authorId: owner.id, updatedAt: at(9) } });
  await db.recipeInCookbook.create({
    data: { cookbookId: small.id, recipeId: archived.id, addedById: viewer.id, createdAt: at(30) },
  });
  await db.cookbook.create({ data: { title: "Someone else's", authorId: other.id } });

  // Refresh updatedAt after the cover updates so ordering is deterministic.
  for (const [index, id] of [withCover.id, archived.id, borrowed.id].entries()) {
    await db.recipe.update({ where: { id }, data: { updatedAt: at(40 + index) } });
  }

  return { owner, viewer, other };
}

describe("kitchen home reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma reads return, in one D1 batch", async () => {
    const { owner, viewer } = await seedKitchen();

    for (const input of [
      { viewerId: viewer.id, kitchenUserWhere: { id: owner.id } },
      { viewerId: owner.id, kitchenUserWhere: { id: owner.id } },
      { viewerId: null, kitchenUserWhere: { username: owner.username } },
    ]) {
      const before = d1.roundTrips();
      const fromD1 = await readKitchenHomeFromD1(d1.binding, input);
      expect(d1.roundTrips() - before).toBe(1);
      expect(displayed(fromD1)).toEqual(displayed(await readKitchenHomeWithPrisma(db, input)));
    }

    const rows = await readKitchenHomeFromD1(d1.binding, { viewerId: viewer.id, kitchenUserWhere: { id: owner.id } });
    expect(rows.recipes.map((recipe) => recipe.title)).toEqual([
      "Borrowed cover", "Archived cover", "With cover", "Extra 8", "Extra 7", "Extra 6", "Extra 5",
    ]);
    expect(rows.recipes[2]!.covers).toHaveLength(1);
    expect(rows.recipes[0]!.covers).toEqual([]);
    expect(rows.cookbooks.map((cookbook) => [cookbook.title, cookbook._count.recipes, cookbook.recipes.length])).toEqual([
      ["Empty", 0, 0], ["Big", 5, 4], ["Small", 1, 1],
    ]);
    const bigPreview = rows.cookbooks[1]!.recipes;
    expect(bigPreview.map((entry) => entry.recipe.title)).not.toContain("Deleted");
    // Extra 6, 7 and 8 share the newest timestamp and come highest id first.
    const tied = bigPreview.slice(0, 3).map((entry) => entry.id);
    expect(tied).toEqual([...tied].sort().reverse());
    expect(rows.viewer?.id).toBe(viewer.id);
  });

  it("orders recipes sharing an updatedAt by newest created, then highest id, in both readers", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const shared = at(5);
    const make = (title: string, createdMinute: number, id: string) =>
      db.recipe.create({ data: { id, title, chefId: owner.id, createdAt: at(createdMinute), updatedAt: shared } });
    await make("Created first", 1, "z-first");
    await make("Created last, low id", 3, "a-last");
    await make("Created last, high id", 3, "m-last");
    await make("Updated later", 2, "b-later").then((recipe) =>
      db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: at(9) } }));

    const input = { viewerId: null, kitchenUserWhere: { id: owner.id } };
    const expected = ["Updated later", "Created last, high id", "Created last, low id", "Created first"];
    for (const rows of [await readKitchenHomeFromD1(d1.binding, input), await readKitchenHomeWithPrisma(db, input)]) {
      expect(rows.recipes.map((recipe) => recipe.title)).toEqual(expected);
    }
  });

  it("returns no kitchen for an unknown chef, and no viewer for an unknown viewer", async () => {
    const input = { viewerId: "missing-viewer", kitchenUserWhere: { username: "missing-chef" } };
    const fromD1 = await readKitchenHomeFromD1(d1.binding, input);
    expect(fromD1).toEqual({ viewer: null, kitchenUser: null, recipes: [], cookbooks: [] });
    expect(fromD1).toEqual(await readKitchenHomeWithPrisma(db, input));
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(
      readKitchenHomeFromD1(failing as never, { viewerId: null, kitchenUserWhere: { id: "x" } }),
    ).rejects.toThrow("D1_ERROR: lost");

    const rowsFor = (rows: unknown[][]) => ({
      prepare: d1.binding.prepare,
      batch: async () => rows.map((results) => ({ results })),
    });
    const user = { id: "u", username: "chef", photoUrl: null };
    const input = { viewerId: "v", kitchenUserWhere: { id: "u" } };
    await expect(readKitchenHomeFromD1(rowsFor([[{ ...user, email: 3 }], [user], [], [], []]) as never, input))
      .rejects.toThrow("D1 column email is not a string");
    await expect(readKitchenHomeFromD1(rowsFor([[], [{ ...user, photoUrl: 1 }], [], [], []]) as never, input))
      .rejects.toThrow("D1 column photoUrl is not a string");
    const cookbook = { id: "c", title: "t", authorId: "u", createdAt: 1, updatedAt: 1, recipeCount: 1 };
    const entry = {
      id: "e", cookbookId: "c", recipeId: "r", addedById: "u", createdAt: 1, updatedAt: 1,
      recipe_id: "r", recipe_title: "t", recipe_activeCoverId: null, recipe_activeCoverVariant: null, recipe_coverMode: null, cover_id: null,
    };
    await expect(readKitchenHomeFromD1(rowsFor([[], [user], [], [cookbook], [entry]]) as never, input))
      .rejects.toThrow("D1 column recipe_coverMode does not hold a string value");
    await expect(readKitchenHomeFromD1(rowsFor([[], [user], [], [{ ...cookbook, recipeCount: null }], []]) as never, input))
      .rejects.toThrow("D1 column recipeCount is not a count");
    await expect(
      readKitchenHomeFromD1(rowsFor([[], [user], [{ id: "r", title: "t", description: null, servings: null, activeCoverId: null, activeCoverVariant: null, coverMode: null, cover_id: null }], [], []]) as never, input),
    ).rejects.toThrow("D1 column coverMode is not a string");
  });
});

describe("kitchen home loader on a D1 binding", () => {
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

  async function loaderWithoutPrisma() {
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loader } = await import("~/routes/_index");
    return { loader, getRequestDb };
  }

  it("reads the page from D1 in two round trips and never constructs a Prisma client", async () => {
    const { owner } = await seedKitchen();
    const cookie = (await createUserSessionCookie(owner.id)).split(";")[0]!;
    const { loader, getRequestDb } = await loaderWithoutPrisma();
    const context = { cloudflare: { env: { DB: d1.binding } } };

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/", { headers: { Cookie: cookie } }),
      context,
      params: {},
    } as never);

    expect(getRequestDb).not.toHaveBeenCalled();
    // The session version check, then one batch for the page.
    expect(d1.roundTrips()).toBe(2);
    expect(result.isOwner).toBe(true);
    expect(result.kitchenUser?.id).toBe(owner.id);
    expect(result.recipes[2]).toMatchObject({ title: "With cover", coverImageUrl: "https://example.com/c.jpg" });

    await expect(
      loader({
        request: new UndiciRequest("http://localhost:3000/?chef=missing-chef"),
        context,
        params: {},
      } as never),
    ).rejects.toMatchObject({ status: 404 });

    const orphan = await loader({
      request: new UndiciRequest("http://localhost:3000/", {
        headers: { Cookie: (await createUserSessionCookie(owner.id)).split(";")[0]! },
      }),
      context: { cloudflare: { env: { DB: { ...d1.binding, batch: async () => [[], [], [], [], []].map((results) => ({ results })) } } } },
      params: {},
    } as never);
    expect(orphan).toMatchObject({ kitchenUser: null, viewer: null, recipes: [], cookbooks: [] });
    expect(getRequestDb).not.toHaveBeenCalled();
  });
});
