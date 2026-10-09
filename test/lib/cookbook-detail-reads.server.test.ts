// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import {
  readCookbookDetailFromD1,
  readCookbookDetailWithPrisma,
  type CookbookDetailRows,
} from "~/lib/cookbook-detail-reads.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

// Covers are compared by what the page shows: the D1 reader returns only a recipe's
// active cover, the Prisma reader its whole history.
function displayed(rows: CookbookDetailRows) {
  return {
    ...rows,
    cookbook: rows.cookbook && {
      ...rows.cookbook,
      recipes: rows.cookbook.recipes.map(({ recipe: { covers, ...recipe }, ...entry }) => ({
        ...entry,
        recipe: { ...recipe, cover: getRecipeCoverDisplay(recipe, covers) },
      })),
    },
  };
}

async function seedCookbook() {
  const owner = await db.user.create({ data: createTestUser() });
  const friend = await db.user.create({ data: createTestUser() });
  const recipe = (title: string, chefId = owner.id, extra: Record<string, unknown> = {}) =>
    db.recipe.create({ data: { title, chefId, ...extra } });

  const withCover = await recipe("With cover", owner.id, { description: "Tart", servings: "4" });
  const cover = await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/c.jpg", sourceType: "chef-upload", createdAt: at(1) },
  });
  await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/old.jpg", sourceType: "chef-upload", createdAt: at(0) },
  });
  await db.recipe.update({ where: { id: withCover.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image" } });
  const friends = await recipe("Friend's", friend.id);
  const deleted = await recipe("Deleted", owner.id, { deletedAt: at(2) });
  await recipe("Banana bread");
  await recipe("Zucchini fritters");
  await recipe("Deleted and not added", owner.id, { deletedAt: at(3) });
  await recipe("Friend's other", friend.id);

  const book = await db.cookbook.create({ data: { title: "Weeknights", authorId: owner.id } });
  // Two entries share a timestamp: the page breaks the tie by id.
  for (const [entry, minute] of [[friends, 10], [withCover, 10], [deleted, 11]] as const) {
    await db.recipeInCookbook.create({
      data: { cookbookId: book.id, recipeId: entry.id, addedById: owner.id, createdAt: at(minute) },
    });
  }
  return { owner, friend, book };
}

describe("cookbook detail reads", () => {
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
    const { owner, friend, book } = await seedCookbook();

    for (const viewerId of [owner.id, friend.id, null]) {
      const input = { cookbookId: book.id, viewerId };
      const before = d1.roundTrips();
      const fromD1 = await readCookbookDetailFromD1(d1.binding, input);
      expect(d1.roundTrips() - before).toBe(1);
      expect(displayed(fromD1)).toEqual(displayed(await readCookbookDetailWithPrisma(db, input)));
    }

    const rows = await readCookbookDetailFromD1(d1.binding, { cookbookId: book.id, viewerId: owner.id });
    expect(rows.cookbook?.author).toEqual({ id: owner.id, username: owner.username });
    const titles = rows.cookbook!.recipes.map((entry) => entry.recipe.title);
    expect(titles).toHaveLength(2);
    expect(titles).not.toContain("Deleted");
    const tied = rows.cookbook!.recipes.map((entry) => entry.id);
    expect(tied).toEqual([...tied].sort());
    const covered = rows.cookbook!.recipes.find((entry) => entry.recipe.title === "With cover")!;
    expect(covered.recipe.covers).toHaveLength(1);
    expect(covered.recipe.chef.username).toBe(owner.username);
    expect(rows.availableRecipes.map((recipe) => recipe.title)).toEqual(["Banana bread", "Zucchini fritters"]);

    const asFriend = await readCookbookDetailFromD1(d1.binding, { cookbookId: book.id, viewerId: friend.id });
    expect(asFriend.availableRecipes).toEqual([]);
  });

  it("returns no cookbook for an unknown id", async () => {
    const input = { cookbookId: "missing", viewerId: null };
    const fromD1 = await readCookbookDetailFromD1(d1.binding, input);
    expect(fromD1).toEqual({ cookbook: null, availableRecipes: [] });
    expect(fromD1).toEqual(await readCookbookDetailWithPrisma(db, input));
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const input = { cookbookId: "c", viewerId: null };
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readCookbookDetailFromD1(failing as never, input)).rejects.toThrow("D1_ERROR: lost");

    const rowsFor = (rows: unknown[][]) => ({
      prepare: d1.binding.prepare,
      batch: async () => rows.map((results) => ({ results })),
    });
    const cookbook = { id: "c", title: "t", authorId: "u", createdAt: 1, updatedAt: 1, author_id: "u", author_username: "chef" };
    await expect(readCookbookDetailFromD1(rowsFor([[{ ...cookbook, author_username: 4 }], [], []]) as never, input))
      .rejects.toThrow("D1 column author_username");
    const entry = {
      id: "e", cookbookId: "c", recipeId: "r", addedById: "u", createdAt: 1, updatedAt: 1,
      recipe_id: "r", recipe_title: "t", recipe_description: null, recipe_servings: null,
      recipe_activeCoverId: null, recipe_activeCoverVariant: null, recipe_coverMode: "auto", cover_id: null, chef_username: null,
    };
    await expect(readCookbookDetailFromD1(rowsFor([[cookbook], [entry], []]) as never, input))
      .rejects.toThrow("D1 column chef_username");
    await expect(readCookbookDetailFromD1(rowsFor([[cookbook], [], [{ id: "r", title: 5 }]]) as never, input))
      .rejects.toThrow("D1 column title");
  });
});

describe("cookbook loader on a D1 binding", () => {
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

  it("reads the page from D1 and never constructs a Prisma client", async () => {
    const { owner, book } = await seedCookbook();
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loader } = await import("~/routes/cookbooks.$id");
    const context = { cloudflare: { env: { DB: d1.binding } } };
    const cookie = (await createUserSessionCookie(owner.id)).split(";")[0]!;
    const load = (id: string, headers: Record<string, string> = {}) =>
      loader({ request: new UndiciRequest(`http://localhost:3000/cookbooks/${id}`, { headers }), context, params: { id } } as never);

    const anonymous = await load(book.id);
    expect(d1.roundTrips()).toBe(1);
    expect(anonymous.isOwner).toBe(false);
    expect(anonymous.availableRecipes).toEqual([]);
    expect(anonymous.cookbook.recipes.find((entry) => entry.recipe.title === "With cover")?.recipe.coverImageUrl)
      .toBe("https://example.com/c.jpg");

    const asOwner = await load(book.id, { Cookie: cookie });
    expect(asOwner.isOwner).toBe(true);
    expect(asOwner.availableRecipes.map((recipe) => recipe.title)).toEqual(["Banana bread", "Zucchini fritters"]);

    await expect(load("missing")).rejects.toMatchObject({ status: 404 });
    expect(getRequestDb).not.toHaveBeenCalled();
  });
});
