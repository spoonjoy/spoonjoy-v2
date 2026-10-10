// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import {
  readChefProfileFromD1,
  readChefProfileWithPrisma,
  type ChefProfileRows,
} from "~/lib/chef-profile-reads.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

type Covered = { activeCoverId: string | null; activeCoverVariant: string | null; coverMode: string; covers: never[] };

// Covers are compared by what the page shows: the D1 reader returns only a recipe's
// active cover, the Prisma reader its whole history.
function shown<T extends Covered>({ covers, ...recipe }: T) {
  return { ...recipe, cover: getRecipeCoverDisplay(recipe, covers) };
}

function displayed(rows: ChefProfileRows) {
  return {
    ...rows,
    recipes: rows.recipes.map((recipe) => shown(recipe as never)),
    cookbooks: rows.cookbooks.map((cookbook) => ({
      ...cookbook,
      recipes: cookbook.recipes.map(({ recipe, ...entry }) => ({ ...entry, recipe: shown(recipe as never) })),
    })),
    recentSpoons: rows.recentSpoons.map(({ recipe, ...spoon }) => ({ ...spoon, recipe: shown(recipe as never) })),
  };
}

async function seedChef() {
  const chef = await db.user.create({ data: { ...createTestUser(), photoUrl: "https://example.com/c.jpg" } });
  const fan = await db.user.create({ data: createTestUser() });
  const other = await db.user.create({ data: createTestUser() });

  const recipe = (title: string, minute: number, extra: Record<string, unknown> = {}) =>
    db.recipe.create({ data: { title, chefId: chef.id, createdAt: at(minute), updatedAt: at(minute), ...extra } });

  const withCover = await recipe("With cover", 1, { description: "Tart", servings: "4" });
  const cover = await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/cover.jpg", sourceType: "chef-upload", createdAt: at(1) },
  });
  await db.recipeCover.create({
    data: { recipeId: withCover.id, imageUrl: "https://example.com/old.jpg", sourceType: "chef-upload", createdAt: at(0) },
  });
  await db.recipe.update({ where: { id: withCover.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image", updatedAt: at(1) } });
  // An active cover id that points at another recipe's cover is not this recipe's cover.
  const borrowed = await recipe("Borrowed cover", 2);
  await db.recipe.update({ where: { id: borrowed.id }, data: { activeCoverId: cover.id, updatedAt: at(2) } });
  const deleted = await recipe("Deleted", 3, { deletedAt: at(4) });
  const extras = await Promise.all([5, 6, 7].map((minute) => recipe(`Extra ${minute}`, minute)));
  const fanRecipe = await db.recipe.create({ data: { title: "Fan's", chefId: fan.id } });
  await db.recipe.create({ data: { title: "Not the chef's", chefId: other.id } });

  const book = await db.cookbook.create({ data: { title: "Book", authorId: chef.id, updatedAt: at(10) } });
  for (const [index, entry] of [withCover, ...extras, deleted].entries()) {
    await db.recipeInCookbook.create({
      data: { cookbookId: book.id, recipeId: entry.id, addedById: chef.id, createdAt: at(20 + index) },
    });
  }
  await db.cookbook.create({ data: { title: "Empty", authorId: chef.id, updatedAt: at(11) } });
  await db.cookbook.create({ data: { title: "Someone else's", authorId: other.id } });
  // A fan saves the chef's recipe: a kitchen visitor.
  const fanBook = await db.cookbook.create({ data: { title: "Fan book", authorId: fan.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: fanBook.id, recipeId: withCover.id, addedById: fan.id } });

  // The chef cooks their own recipe and the fan's (a fellow chef); one spoon is deleted.
  await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: withCover.id, cookedAt: at(30), note: "Good" } });
  await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: fanRecipe.id, cookedAt: at(31) } });
  await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: borrowed.id, cookedAt: at(32), deletedAt: at(33) } });
  await db.recipeSpoon.create({ data: { chefId: other.id, recipeId: withCover.id, cookedAt: at(34) } });

  return { chef, fan, other, extras, deleted };
}

describe("chef profile reads", () => {
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
    const { chef, extras, deleted } = await seedChef();

    for (const input of [
      { identifier: chef.username, recipeLimit: null },
      { identifier: chef.id, recipeLimit: null },
      { identifier: chef.username, recipeLimit: 2, recipeAfter: extras[2]!.id },
      { identifier: chef.username, recipeLimit: 2, recipeAfter: deleted.id },
      { identifier: chef.username, recipeLimit: 2, recipeAfter: "missing-recipe" },
    ]) {
      const before = d1.roundTrips();
      const fromD1 = await readChefProfileFromD1(d1.binding, input);
      expect(d1.roundTrips() - before).toBe(1);
      expect(displayed(fromD1)).toEqual(displayed(await readChefProfileWithPrisma(db, input)));
    }

    const rows = await readChefProfileFromD1(d1.binding, { identifier: chef.username, recipeLimit: null });
    expect(rows.matchedBy).toBe("username");
    expect(rows.recipes.map((recipe) => recipe.title)).toEqual(["Extra 7", "Extra 6", "Extra 5", "Borrowed cover", "With cover"]);
    expect(rows.recipeCount).toBe(5);
    expect(rows.recipes[4]!.covers).toHaveLength(1);
    expect(rows.recipes[3]!.covers).toEqual([]);
    expect(rows.cookbooks.map((cookbook) => [cookbook.title, cookbook._count.recipes, cookbook.recipes.length])).toEqual([
      ["Empty", 0, 0], ["Book", 4, 4],
    ]);
    expect(rows.cookbooks[1]!.recipes.map((entry) => entry.recipe.title)).not.toContain("Deleted");
    expect(rows.recentSpoons.map((spoon) => spoon.recipe.title)).toEqual(["Fan's", "With cover"]);
    expect(rows.recentSpoons[1]!.recipe.covers).toHaveLength(1);
    expect(rows.fellowChefsCount).toBe(1);
    expect(rows.kitchenVisitorsCount).toBe(2);

    const byId = await readChefProfileFromD1(d1.binding, { identifier: chef.id, recipeLimit: 2, recipeAfter: extras[2]!.id });
    expect(byId.matchedBy).toBe("id");
    expect(byId.recipes.map((recipe) => recipe.title)).toEqual(["Extra 6", "Extra 5"]);
    expect(byId.recipeCount).toBe(5);
    // A deleted cursor recipe still marks its place; an unknown one reads nothing.
    const afterDeleted = await readChefProfileFromD1(d1.binding, { identifier: chef.id, recipeLimit: null, recipeAfter: deleted.id });
    expect(afterDeleted.recipes.map((recipe) => recipe.title)).toEqual(["Borrowed cover", "With cover"]);
    const afterUnknown = await readChefProfileFromD1(d1.binding, { identifier: chef.id, recipeLimit: null, recipeAfter: "missing" });
    expect(afterUnknown.recipes).toEqual([]);
  });

  it("prefers a username match over another user whose id equals it", async () => {
    const first = await db.user.create({ data: createTestUser() });
    const named = await db.user.create({ data: { ...createTestUser(), username: first.id } });
    const input = { identifier: first.id, recipeLimit: null };
    for (const rows of [await readChefProfileFromD1(d1.binding, input), await readChefProfileWithPrisma(db, input)]) {
      expect(rows.profileUser?.id).toBe(named.id);
      expect(rows.matchedBy).toBe("username");
    }
  });

  it("returns no profile for an unknown chef", async () => {
    const input = { identifier: "missing-chef", recipeLimit: null };
    const fromD1 = await readChefProfileFromD1(d1.binding, input);
    expect(fromD1).toEqual({
      profileUser: null, matchedBy: null, recipes: [], recipeCount: 0, cookbooks: [], recentSpoons: [], fellowChefsCount: 0, kitchenVisitorsCount: 0,
    });
    expect(fromD1).toEqual(await readChefProfileWithPrisma(db, input));
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const input = { identifier: "chef", recipeLimit: null };
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readChefProfileFromD1(failing as never, input)).rejects.toThrow("D1_ERROR: lost");

    const rowsFor = (rows: unknown[][]) => ({
      prepare: d1.binding.prepare,
      batch: async () => rows.map((results) => ({ results })),
    });
    const user = { id: "u", username: "chef", photoUrl: null, createdAt: 1, byUsername: 1 };
    const total = [{ total: 0 }];
    await expect(readChefProfileFromD1(rowsFor([[{ ...user, username: 3 }], [], total, [], [], [], total, total]) as never, input))
      .rejects.toThrow("D1 column username");
    await expect(readChefProfileFromD1(rowsFor([[user], [], [{ total: null }], [], [], [], total, total]) as never, input))
      .rejects.toThrow("D1 column total is not a count");
    await expect(readChefProfileFromD1(rowsFor([[user], [], total, [], [], [], total, []]) as never, input))
      .rejects.toThrow("D1 column total is not a count");
    await expect(readChefProfileFromD1(rowsFor([[user], [], [], [], [], [], total, total]) as never, input))
      .rejects.toThrow("D1 column total is not a count");
    await expect(readChefProfileFromD1(rowsFor([[user], [], total, [], [], [], [], total]) as never, input))
      .rejects.toThrow("D1 column total is not a count");
    const spoon = {
      id: "s", chefId: "u", recipeId: "r", cookedAt: 1, photoUrl: null, note: null, nextTime: null, deletedAt: null, createdAt: 1, updatedAt: 1,
      recipe_id: "r", recipe_title: "t", recipe_chefId: "u", recipe_activeCoverId: null, recipe_activeCoverVariant: null, recipe_coverMode: "auto",
      cover_id: null, chef_id: "u", chef_username: 7, chef_photoUrl: null,
    };
    await expect(readChefProfileFromD1(rowsFor([[user], [], total, [], [], [spoon], total, total]) as never, input))
      .rejects.toThrow("D1 column chef_username");
  });
});

describe("chef profile loader on a D1 binding", () => {
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

  it("reads the page from D1 in one round trip and never constructs a Prisma client", async () => {
    const { chef } = await seedChef();
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loader } = await import("~/routes/users.$identifier");
    const context = { cloudflare: { env: { DB: d1.binding } } };
    const load = (identifier: string) =>
      loader({ request: new UndiciRequest(`http://localhost:3000/users/${identifier}`), context, params: { identifier } } as never);

    const result = await load(chef.username) as Exclude<Awaited<ReturnType<typeof load>>, Response>;
    expect(getRequestDb).not.toHaveBeenCalled();
    expect(d1.roundTrips()).toBe(1);
    expect(result.profile.id).toBe(chef.id);
    expect(result.recipes).toHaveLength(5);
    expect(result.recipes[4]).toMatchObject({ title: "With cover", coverImageUrl: "https://example.com/cover.jpg" });
    expect(result.recentSpoons).toHaveLength(2);
    expect(result.kitchenVisitorsCount).toBe(2);

    const redirect = await load(chef.id) as Response;
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(`/users/${chef.username}`);
    await expect(load("missing-chef")).rejects.toMatchObject({ status: 404 });
    expect(getRequestDb).not.toHaveBeenCalled();
  }, 30_000);

  it("pages a long recipe list after a cursor", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    await db.recipe.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        title: `Recipe ${String(index).padStart(2, "0")}`, chefId: chef.id, createdAt: at(index), updatedAt: at(index),
      })),
    });
    vi.resetModules();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb: vi.fn() }));
    const { loader } = await import("~/routes/users.$identifier");
    const context = { cloudflare: { env: { DB: d1.binding } } };
    const load = (path: string, identifier = chef.username) =>
      loader({ request: new UndiciRequest(`http://localhost:3000${path}`), context, params: { identifier } } as never);
    type Page = Exclude<Awaited<ReturnType<typeof load>>, Response>;

    const first = await load(`/users/${chef.username}`) as Page;
    expect(first.recipes).toHaveLength(24);
    expect(first.recipes[0]!.title).toBe("Recipe 29");
    expect(first.recipeCount).toBe(30);
    expect(first.after).toBeNull();
    expect(first.nextCursor).toBe(first.recipes[23]!.id);

    const second = await load(`/users/${chef.username}?after=${first.nextCursor}`) as Page;
    expect(second.recipes.map((recipe) => recipe.title)).toEqual(
      ["Recipe 05", "Recipe 04", "Recipe 03", "Recipe 02", "Recipe 01", "Recipe 00"],
    );
    expect(second.nextCursor).toBeNull();
    expect(second.canonicalUrl).toBe(`http://localhost:3000/users/${chef.username}`);

    const ignored = await load(`/users/${chef.username}?after=${encodeURIComponent("bad cursor!")}`) as Page;
    expect(ignored.after).toBeNull();
    expect(ignored.recipes).toHaveLength(24);
    const byId = await load(`/users/${chef.id}?after=${first.nextCursor}`, chef.id) as Response;
    expect(byId.headers.get("Location")).toBe(`/users/${chef.username}?after=${first.nextCursor}`);
    const byIdFirst = await load(`/users/${chef.id}`, chef.id) as Response;
    expect(byIdFirst.headers.get("Location")).toBe(`/users/${chef.username}`);
  }, 30_000);
});
