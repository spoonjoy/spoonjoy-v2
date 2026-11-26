// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import {
  readCookbookListFromD1,
  readCookbookListWithPrisma,
  readPublicRecipesFromD1,
  readPublicRecipesWithPrisma,
  readSavedRecipesFromD1,
  readSavedRecipesWithPrisma,
} from "~/lib/collection-reads.server";
import {
  searchMyRecipes,
  searchMyRecipesFromD1,
} from "~/lib/my-recipes-search.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit, shareHousehold } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

async function seedCollections() {
  const chef = await db.user.create({ data: { ...createTestUser(), username: `listchef_${Date.now()}` } });
  const friend = await db.user.create({ data: createTestUser() });
  const stranger = await db.user.create({ data: createTestUser() });

  const recipe = (chefId: string, title: string, minute: number, extra: Record<string, unknown> = {}) =>
    db.recipe.create({
      data: { title, chefId, description: `${title} notes`, servings: "2", createdAt: at(minute), updatedAt: at(minute), ...extra },
    });

  const lemon = await recipe(chef.id, "Lemon Rice", 1);
  const cover = await db.recipeCover.create({
    data: { recipeId: lemon.id, imageUrl: "https://example.com/lemon.jpg", sourceType: "chef-upload" },
  });
  await db.recipe.update({ where: { id: lemon.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image", updatedAt: at(1) } });
  const soup = await recipe(chef.id, "Tomato Soup", 2);
  const risotto = await recipe(friend.id, "Saffron Risotto", 3);
  const deleted = await recipe(friend.id, "Gone Pudding", 4, { deletedAt: at(5) });
  const extras = [];
  for (let minute = 6; minute < 10; minute += 1) extras.push(await recipe(friend.id, `Friend Stew ${minute}`, minute));

  const unit = await getOrCreateUnit(db, "cup-collection-reads");
  const saffron = await getOrCreateIngredientRef(db, "saffron-collection-reads");
  await db.recipeStep.create({ data: { recipeId: soup.id, stepNum: 1, description: "Simmer" } });
  await db.ingredient.create({ data: { recipeId: soup.id, stepNum: 1, quantity: 1, unitId: unit.id, ingredientRefId: saffron.id } });

  const weeknight = await db.cookbook.create({ data: { title: "Weeknight", authorId: chef.id, updatedAt: at(20) } });
  const favourites = await db.cookbook.create({ data: { title: "Favourites", authorId: chef.id, updatedAt: at(21) } });
  await db.cookbook.create({ data: { title: "Empty", authorId: chef.id, updatedAt: at(19) } });
  await db.cookbook.create({ data: { title: "Friend's", authorId: friend.id } });
  const entry = (cookbookId: string, recipeId: string, minute: number) =>
    db.recipeInCookbook.create({
      data: { cookbookId, recipeId, addedById: chef.id, createdAt: at(minute), updatedAt: at(minute) },
    });
  // Weeknight has six entries: a deleted recipe (the newest) and two that share a timestamp.
  await entry(weeknight.id, lemon.id, 30);
  await entry(weeknight.id, risotto.id, 31);
  await entry(weeknight.id, extras[0]!.id, 32);
  await entry(weeknight.id, extras[1]!.id, 33);
  await entry(weeknight.id, extras[2]!.id, 33);
  await entry(weeknight.id, deleted.id, 34);
  await entry(favourites.id, risotto.id, 35);
  await entry(favourites.id, soup.id, 36);

  return { chef, friend, stranger, lemon, soup, risotto, deleted };
}

describe("collection reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("reads public recipes as Prisma does, with and without a search", async () => {
    await seedCollections();
    for (const input of [
      { query: "", limit: 48 },
      { query: "", limit: 3 },
      { query: "stew", limit: 48 },
      { query: "pudding", limit: 48 },
      { query: "nothing-matches-this", limit: 48 },
    ]) {
      const before = d1.roundTrips();
      const fromD1 = await readPublicRecipesFromD1(d1.binding, input);
      expect(fromD1, JSON.stringify(input)).toEqual(await readPublicRecipesWithPrisma(db, input));
      if (!input.query) expect(d1.roundTrips() - before).toBe(1);
    }
    const all = await readPublicRecipesFromD1(d1.binding, { query: "", limit: 48 });
    expect(all.map((recipe) => recipe.title)).not.toContain("Gone Pudding");
    expect(all.find((recipe) => recipe.title === "Lemon Rice")).toMatchObject({ coverImageUrl: "https://example.com/lemon.jpg" });
    await expect(readPublicRecipesFromD1(d1.binding, { query: "stew", limit: 48 })).resolves.toHaveLength(4);
  });

  it("lists only public recipes, so a private or household recipe never shows in all public recipes", async () => {
    const chef = await db.user.create({ data: { ...createTestUser(), username: `visibilitychef_${Date.now()}` } });
    const recipe = (title: string, minute: number, visibility: string) =>
      db.recipe.create({ data: { title, chefId: chef.id, visibility, createdAt: at(minute), updatedAt: at(minute) } });
    await recipe("Shared Chowder", 1, "public");
    const secret = await recipe("Secret Chowder", 2, "private");
    await recipe("Family Chowder", 3, "household");
    await recipe("Open Chowder", 4, "public");

    for (const input of [
      { query: "", limit: 48 },
      { query: "chowder", limit: 48 },
      { query: "", limit: 48, after: secret.id },
    ]) {
      const fromD1 = await readPublicRecipesFromD1(d1.binding, input);
      expect(fromD1, JSON.stringify(input)).toEqual(await readPublicRecipesWithPrisma(db, input));
      expect(fromD1.map((listed) => listed.title), JSON.stringify(input)).not.toContain("Secret Chowder");
      expect(fromD1.map((listed) => listed.title), JSON.stringify(input)).not.toContain("Family Chowder");
    }
    const all = await readPublicRecipesFromD1(d1.binding, { query: "", limit: 48 });
    expect(all.map((listed) => listed.title)).toEqual(["Open Chowder", "Shared Chowder"]);
    const searched = await readPublicRecipesFromD1(d1.binding, { query: "chowder", limit: 48 });
    expect(searched.map((listed) => listed.title).sort()).toEqual(["Open Chowder", "Shared Chowder"]);
    // A page after a private recipe still continues from its place in the order.
    const afterSecret = await readPublicRecipesFromD1(d1.binding, { query: "", limit: 48, after: secret.id });
    expect(afterSecret.map((listed) => listed.title)).toEqual(["Shared Chowder"]);
  });

  it("pages through public recipes after a cursor, as Prisma does, with every recipe on exactly one page", async () => {
    const chef = await db.user.create({ data: { ...createTestUser(), username: `pagechef_${Date.now()}` } });
    // Seven recipes, three sharing one timestamp, so the id must break the tie consistently.
    const minutes = [5, 4, 4, 4, 3, 2, 1];
    const created = [];
    for (const [index, minute] of minutes.entries()) {
      created.push(await db.recipe.create({
        data: { title: `Paged ${index}`, chefId: chef.id, createdAt: at(minute), updatedAt: at(minute) },
      }));
    }
    const gone = await db.recipe.create({
      data: { title: "Paged gone", chefId: chef.id, createdAt: at(3), updatedAt: at(3), deletedAt: at(6) },
    });

    const walk = async (read: (after: string | null) => Promise<{ id: string }[]>) => {
      const seen: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const rows = await read(after);
        seen.push(...rows.map((row) => row.id));
        if (rows.length < 3) break;
        after = rows[rows.length - 1]!.id;
      }
      return seen;
    };

    const fromD1 = await walk((after) => readPublicRecipesFromD1(d1.binding, { query: "", limit: 3, after }));
    const fromPrisma = await walk((after) => readPublicRecipesWithPrisma(db, { query: "", limit: 3, after }));
    expect(fromD1).toEqual(fromPrisma);
    expect([...fromD1].sort()).toEqual(created.map((recipe) => recipe.id).sort());
    expect(new Set(fromD1).size).toBe(created.length);
    expect(fromD1).not.toContain(gone.id);

    // Each page is one round trip, and a page after a deleted recipe still continues from its place.
    const before = d1.roundTrips();
    const afterGone = await readPublicRecipesFromD1(d1.binding, { query: "", limit: 48, after: gone.id });
    expect(d1.roundTrips() - before).toBe(1);
    expect(afterGone).toEqual(await readPublicRecipesWithPrisma(db, { query: "", limit: 48, after: gone.id }));
    // The deleted recipe ties Paged 4 on time and has the later id, so Paged 4 comes right after it.
    expect(afterGone.map((recipe) => recipe.title)).toEqual(["Paged 4", "Paged 5", "Paged 6"]);

    // An unknown cursor reads nothing rather than starting over.
    await expect(readPublicRecipesFromD1(d1.binding, { query: "", limit: 3, after: "no-such-recipe" })).resolves.toEqual([]);
    await expect(readPublicRecipesWithPrisma(db, { query: "", limit: 3, after: "no-such-recipe" })).resolves.toEqual([]);

    // A search ignores the cursor: search results are one ranked page.
    const searched = await readPublicRecipesFromD1(d1.binding, { query: "paged", limit: 48, after: created[0]!.id });
    expect(searched).toEqual(await readPublicRecipesWithPrisma(db, { query: "paged", limit: 48, after: created[0]!.id }));
  });

  it("reads saved recipes as Prisma does, only from the user's own cookbooks", async () => {
    const { chef, friend, stranger, risotto } = await seedCollections();
    for (const userId of [chef.id, friend.id, stranger.id]) {
      expect(await readSavedRecipesFromD1(d1.binding, userId)).toEqual(await readSavedRecipesWithPrisma(db, userId));
    }
    const saved = await readSavedRecipesFromD1(d1.binding, chef.id);
    expect(saved.map((recipe) => recipe.title)).not.toContain("Gone Pudding");
    expect(saved.find((recipe) => recipe.id === risotto.id)?.savedCookbookTitles).toEqual(["Favourites", "Weeknight"]);
    await expect(readSavedRecipesFromD1(d1.binding, stranger.id)).resolves.toEqual([]);
  });

  it("reads the cookbook list as Prisma does, previewing the newest four recipes that are not deleted", async () => {
    const { chef, friend, stranger } = await seedCollections();
    for (const userId of [chef.id, friend.id, stranger.id]) {
      const before = d1.roundTrips();
      const fromD1 = await readCookbookListFromD1(d1.binding, userId);
      expect(d1.roundTrips() - before).toBe(1);
      expect(fromD1).toEqual(await readCookbookListWithPrisma(db, userId));
    }
    const [favourites, weeknight, empty] = await readCookbookListFromD1(d1.binding, chef.id);
    expect([favourites!.title, weeknight!.title, empty!.title]).toEqual(["Favourites", "Weeknight", "Empty"]);
    // Six entries, one of them a deleted recipe: the card counts five, as the kitchen home does.
    expect(weeknight!._count.recipes).toBe(5);
    expect(weeknight!.recipes.map((entry) => entry.recipe.title)).toHaveLength(4);
    expect(weeknight!.recipes.map((entry) => entry.recipe.title)).not.toContain("Gone Pudding");
    expect(weeknight!.searchableRecipeTitles).not.toContain("Gone Pudding");
    const tied = weeknight!.recipes.slice(0, 2).map((entry) => entry.id);
    expect(tied).toEqual([...tied].sort().reverse());
    expect(empty!.recipes).toEqual([]);
  });

  it("keeps a household recipe in saved recipes and cookbook cards for its cook's household only, on D1 as on Prisma", async () => {
    const { chef, friend, stranger, risotto } = await seedCollections();
    await db.recipe.update({ where: { id: risotto.id }, data: { visibility: "household" } });
    await shareHousehold(db, chef.id, friend.id);
    const strangersBook = await db.cookbook.create({ data: { title: "Stranger's", authorId: stranger.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: strangersBook.id, recipeId: risotto.id, addedById: stranger.id } });

    const browse = { query: "", limit: 48 };
    const browsed = await readPublicRecipesFromD1(d1.binding, browse);
    expect(browsed).toEqual(await readPublicRecipesWithPrisma(db, browse));
    expect(browsed.map((recipe) => recipe.id)).not.toContain(risotto.id);

    const saved = await readSavedRecipesFromD1(d1.binding, chef.id);
    expect(saved).toEqual(await readSavedRecipesWithPrisma(db, chef.id));
    expect(saved.map((recipe) => recipe.id)).toContain(risotto.id);
    const cookbooks = await readCookbookListFromD1(d1.binding, chef.id);
    expect(cookbooks).toEqual(await readCookbookListWithPrisma(db, chef.id));
    expect(cookbooks.find((cookbook) => cookbook.title === "Favourites")!._count.recipes).toBe(2);

    const strangerSaved = await readSavedRecipesFromD1(d1.binding, stranger.id);
    expect(strangerSaved).toEqual(await readSavedRecipesWithPrisma(db, stranger.id));
    expect(strangerSaved).toEqual([]);
    const strangerBooks = await readCookbookListFromD1(d1.binding, stranger.id);
    expect(strangerBooks).toEqual(await readCookbookListWithPrisma(db, stranger.id));
    expect(strangerBooks[0]).toMatchObject({ _count: { recipes: 0 }, recipes: [] });
  });

  it("leaves another cook's private recipe out of browsing, saved recipes and cookbook cards, on D1 as on Prisma", async () => {
    const { chef, friend, risotto } = await seedCollections();
    await db.recipe.update({ where: { id: risotto.id }, data: { visibility: "private" } });

    const browse = { query: "", limit: 48 };
    const browsed = await readPublicRecipesFromD1(d1.binding, browse);
    expect(browsed).toEqual(await readPublicRecipesWithPrisma(db, browse));
    expect(browsed.map((recipe) => recipe.id)).not.toContain(risotto.id);
    await expect(readPublicRecipesFromD1(d1.binding, { query: "saffron risotto", limit: 48 })).resolves.toEqual([]);

    const saved = await readSavedRecipesFromD1(d1.binding, chef.id);
    expect(saved).toEqual(await readSavedRecipesWithPrisma(db, chef.id));
    expect(saved.map((recipe) => recipe.id)).not.toContain(risotto.id);

    const cookbooks = await readCookbookListFromD1(d1.binding, chef.id);
    expect(cookbooks).toEqual(await readCookbookListWithPrisma(db, chef.id));
    const favourites = cookbooks.find((cookbook) => cookbook.title === "Favourites")!;
    expect(favourites._count.recipes).toBe(1);
    expect(favourites.recipes.map((entry) => entry.recipe.id)).not.toContain(risotto.id);
    expect(favourites.searchableRecipeTitles).toEqual(["Tomato Soup"]);

    // Its cook still finds it in what they saved.
    const friendsBook = await db.cookbook.findFirstOrThrow({ where: { authorId: friend.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: friendsBook.id, recipeId: risotto.id, addedById: friend.id } });
    const own = await readSavedRecipesFromD1(d1.binding, friend.id);
    expect(own).toEqual(await readSavedRecipesWithPrisma(db, friend.id));
    expect(own.map((recipe) => recipe.id)).toContain(risotto.id);
  });

  it("reads my recipes as the Prisma search does, in one batch", async () => {
    const { chef, friend } = await seedCollections();
    const cases = [
      { query: "", page: 1 },
      { query: "", page: 1, pageSize: 1 },
      { query: "", page: 2, pageSize: 1 },
      { query: "SOUP", page: 1 },
      { query: "saffron-collection", page: 1 },
      { query: "listchef", page: 1 },
      { query: "zzz-no-match", page: 1 },
    ];
    for (const options of cases) {
      const before = d1.roundTrips();
      const fromD1 = await searchMyRecipesFromD1(d1.binding, { ownerId: chef.id, ...options });
      expect(d1.roundTrips() - before).toBe(1);
      expect(fromD1, JSON.stringify(options)).toEqual(
        await searchMyRecipes(db, { ownerId: chef.id, ownerUsername: chef.username, ...options }),
      );
    }
    await expect(searchMyRecipesFromD1(d1.binding, { ownerId: friend.id })).resolves.toMatchObject({
      recipes: expect.arrayContaining([expect.objectContaining({ title: "Saffron Risotto" })]),
    });
    await expect(searchMyRecipesFromD1(d1.binding, { ownerId: "missing-owner" })).rejects.toThrow("My recipes owner not found");
  });

  it("narrows my recipes by organizers on D1 as the Prisma search does, in one batch", async () => {
    const { chef } = await seedCollections();
    const [first, second] = await db.recipe.findMany({ where: { chefId: chef.id, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 2 });
    const quick = await db.organizer.create({ data: { ownerId: chef.id, kind: "tag", name: "Quick", slug: "quick" } });
    const wok = await db.organizer.create({ data: { ownerId: chef.id, kind: "tool", name: "Wok", slug: "wok" } });
    await db.recipeOrganizer.createMany({
      data: [
        { recipeId: first!.id, organizerId: quick.id },
        { recipeId: first!.id, organizerId: wok.id },
        { recipeId: second!.id, organizerId: quick.id },
      ],
    });
    const quickTag = { kind: "tag" as const, slug: "quick" };
    const wokTool = { kind: "tool" as const, slug: "wok" };
    const cases = [
      { organizers: { with: [quickTag], without: [] } },
      { organizers: { with: [quickTag], without: [wokTool] } },
      { organizers: { with: [], without: [wokTool] } },
      { organizers: { with: [quickTag], without: [] }, query: first!.title.slice(0, 4) },
    ];
    for (const options of cases) {
      const before = d1.roundTrips();
      const fromD1 = await searchMyRecipesFromD1(d1.binding, { ownerId: chef.id, ...options });
      expect(d1.roundTrips() - before).toBe(1);
      const fromPrisma = await searchMyRecipes(db, { ownerId: chef.id, ownerUsername: chef.username, ...options });
      expect(fromD1, JSON.stringify(options)).toEqual(fromPrisma);
      expect(fromPrisma.recipes.length, JSON.stringify(options)).toBeGreaterThan(0);
    }
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const { chef } = await seedCollections();
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readPublicRecipesFromD1(failing as never, { query: "", limit: 5 })).rejects.toThrow("D1_ERROR: lost");
    await expect(readSavedRecipesFromD1(failing as never, chef.id)).rejects.toThrow("D1_ERROR: lost");
    await expect(readCookbookListFromD1(failing as never, chef.id)).rejects.toThrow("D1_ERROR: lost");
    await expect(searchMyRecipesFromD1(failing as never, { ownerId: chef.id })).rejects.toThrow("D1_ERROR: lost");

    const tampered = (edit: (results: Array<{ results: Record<string, unknown>[] }>) => void) => ({
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        const results = (await d1.binding.batch(statements)) as Array<{ results: Record<string, unknown>[] }>;
        edit(results);
        return results;
      },
    });
    await expect(readPublicRecipesFromD1(tampered((r) => { r[0]!.results[0]!.chefUsername = null; }) as never, { query: "", limit: 5 }))
      .rejects.toThrow("D1 column chefUsername does not hold a string value");
    await expect(readSavedRecipesFromD1(tampered((r) => { r[0]!.results[0]!.cookbookTitle = 1; }) as never, chef.id))
      .rejects.toThrow("D1 column cookbookTitle does not hold a string value");
    await expect(readCookbookListFromD1(tampered((r) => { r[2]!.results[0]!.title = null; }) as never, chef.id))
      .rejects.toThrow("D1 column title does not hold a string value");
    await expect(searchMyRecipesFromD1(tampered((r) => { r[1]!.results[0]!.servings = 2; }) as never, { ownerId: chef.id }))
      .rejects.toThrow("D1 column servings does not hold a string? value");
  });
});

describe("list loaders on a D1 binding", () => {
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

  it("serve /recipes, /my-recipes, /saved-recipes and /cookbooks from D1, matching the Prisma pages", async () => {
    const { chef } = await seedCollections();
    const pages = {
      recipes: await import("~/routes/recipes._index"),
      myRecipes: await import("~/routes/my-recipes"),
      saved: await import("~/routes/saved-recipes"),
      cookbooks: await import("~/routes/cookbooks._index"),
    };
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const d1Pages = {
      recipes: await import("~/routes/recipes._index"),
      myRecipes: await import("~/routes/my-recipes"),
      saved: await import("~/routes/saved-recipes"),
      cookbooks: await import("~/routes/cookbooks._index"),
    };
    const cookie = (await createUserSessionCookie(chef.id)).split(";")[0]!;
    const args = (path: string, env: unknown) => ({
      request: new UndiciRequest(`http://localhost:3000${path}`, { headers: { Cookie: cookie } }),
      context: { cloudflare: { env } },
      params: {},
    }) as never;

    for (const [name, path] of [
      ["recipes", "/recipes"],
      ["recipes", "/recipes?q=stew"],
      ["myRecipes", "/my-recipes?q=soup"],
      ["saved", "/saved-recipes"],
      ["saved", "/saved-recipes?q=risotto"],
      ["cookbooks", "/cookbooks"],
      ["cookbooks", "/cookbooks?q=friend+stew"],
    ] as const) {
      const fromD1 = await d1Pages[name].loader(args(path, { DB: d1.binding }));
      expect(fromD1, path).toEqual(await pages[name].loader(args(path, null)));
    }
    expect(getRequestDb).not.toHaveBeenCalled();
    // It imports four route modules twice and loads seven pages each way, Cookbooks' smart list included.
  }, 30_000);
});
