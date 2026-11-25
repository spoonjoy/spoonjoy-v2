// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

// The request's Prisma client, switchable: on merge-group run 45528383350 a wedged Prisma engine failed /chefs, so
// with a D1 binding the page must not build one, and must show what the Prisma path shows.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { loader } from "~/routes/chefs";
import { loadChefsPageFromD1 } from "~/lib/chefs-page-d1.server";

describe("Chefs loader on a D1 binding", () => {
  let d1: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  // Every kind of event in both directions, plus the rows each reader must leave out: deleted spoons and recipes,
  // the viewer's own recipes, another cook's private recipe, a household recipe from a cook they share a household
  // with (kept) and one they don't (dropped), and a chef the viewer blocked.
  async function busyKitchen() {
    const viewer = await createDrawerUser("chefs-d1-viewer");
    const friend = await createDrawerUser("chefs-d1-friend");
    const housemate = await createDrawerUser("chefs-d1-housemate");
    const stranger = await createDrawerUser("chefs-d1-stranger");
    const blocked = await createDrawerUser("chefs-d1-blocked");
    await db.user.update({ where: { id: viewer.id }, data: { photoUrl: "https://example.com/viewer.jpg" } });
    await db.user.update({ where: { id: friend.id }, data: { photoUrl: "https://example.com/friend.jpg" } });
    const household = await db.household.create({ data: { name: "Home" } });
    await db.householdMember.createMany({ data: [
      { householdId: household.id, userId: viewer.id, role: "owner" },
      { householdId: household.id, userId: housemate.id, role: "member" },
    ] });
    await db.chefBlock.create({ data: { blockerId: viewer.id, blockedId: blocked.id } });

    const mine = await createDrawerRecipe({ chefId: viewer.id, title: "My Soup", createdAt: new Date("2026-05-01T09:00:00Z") });
    const friends = await createDrawerRecipe({ chefId: friend.id, title: "Friend Rice", createdAt: new Date("2026-05-01T09:00:00Z") });
    const housemates = await createDrawerRecipe({ chefId: housemate.id, title: "House Stew", createdAt: new Date("2026-05-01T09:00:00Z") });
    const strangers = await createDrawerRecipe({ chefId: stranger.id, title: "Stranger Pie", createdAt: new Date("2026-05-01T09:00:00Z") });
    const secret = await createDrawerRecipe({ chefId: stranger.id, title: "Secret Pie", createdAt: new Date("2026-05-01T09:00:00Z") });
    const gone = await createDrawerRecipe({ chefId: friend.id, title: "Gone Rice", deletedAt: new Date("2026-05-02T00:00:00Z") });
    const blockedOnes = await createDrawerRecipe({ chefId: blocked.id, title: "Blocked Bread", createdAt: new Date("2026-05-01T09:00:00Z") });
    await db.recipe.update({ where: { id: housemates.id }, data: { visibility: "household" } });
    await db.recipe.update({ where: { id: strangers.id }, data: { visibility: "household" } });
    await db.recipe.update({ where: { id: secret.id }, data: { visibility: "private" } });

    const at = (day: number) => new Date(`2026-05-${String(day).padStart(2, "0")}T10:00:00Z`);
    await db.recipeSpoon.createMany({ data: [
      { chefId: viewer.id, recipeId: friends.id, cookedAt: at(3) },
      { chefId: viewer.id, recipeId: housemates.id, cookedAt: at(4) },
      { chefId: viewer.id, recipeId: strangers.id, cookedAt: at(5) },
      { chefId: viewer.id, recipeId: secret.id, cookedAt: at(6) },
      { chefId: viewer.id, recipeId: gone.id, cookedAt: at(7) },
      { chefId: viewer.id, recipeId: friends.id, cookedAt: at(8), deletedAt: at(9) },
      { chefId: viewer.id, recipeId: mine.id, cookedAt: at(10) },
      { chefId: viewer.id, recipeId: blockedOnes.id, cookedAt: at(11) },
      { chefId: friend.id, recipeId: mine.id, cookedAt: at(12) },
      { chefId: blocked.id, recipeId: mine.id, cookedAt: at(13) },
    ] });
    await createDrawerRecipe({ chefId: viewer.id, title: "Forked Rice", sourceRecipeId: friends.id, createdAt: at(14) });
    await createDrawerRecipe({ chefId: viewer.id, title: "Forked Secret", sourceRecipeId: secret.id, createdAt: at(15) });
    await createDrawerRecipe({ chefId: friend.id, title: "Their Soup", sourceRecipeId: mine.id, createdAt: at(16) });
    await createDrawerRecipe({ chefId: housemate.id, title: "Deleted Fork", sourceRecipeId: mine.id, createdAt: at(17), deletedAt: at(18) });
    const shelf = await db.cookbook.create({ data: { title: "Shelf", authorId: viewer.id } });
    const theirShelf = await db.cookbook.create({ data: { title: "Their Shelf", authorId: housemate.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: shelf.id, recipeId: housemates.id, addedById: viewer.id, createdAt: at(19) } });
    await db.recipeInCookbook.create({ data: { cookbookId: shelf.id, recipeId: secret.id, addedById: viewer.id, createdAt: at(20) } });
    await db.recipeInCookbook.create({ data: { cookbookId: theirShelf.id, recipeId: mine.id, addedById: housemate.id, createdAt: at(21) } });
    return viewer;
  }

  async function load(viewerId: string, binding: unknown) {
    return loader({
      request: new UndiciRequest("http://localhost:3000/chefs", { headers: await sessionHeaders(viewerId) }),
      context: { cloudflare: { env: binding ? { DB: binding } : {} } },
      params: {},
    } as unknown as Parameters<typeof loader>[0]);
  }

  it("shows what the Prisma path shows, while Prisma never answers", async () => {
    const viewer = await busyKitchen();
    platform.getRequestDb.mockImplementation(async () => db);
    const onPrisma = await load(viewer.id, null);
    expect(platform.getRequestDb).toHaveBeenCalled();

    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    const onD1 = await load(viewer.id, d1.binding);

    expect(platform.getRequestDb).not.toHaveBeenCalled();
    expect(onD1).toEqual(onPrisma);
    // The fixture reaches every reader: both lists and all six kinds of event, minus the rows they leave out.
    expect(onD1.fellowChefs.rows.map((row) => row.username).sort()).toEqual(
      [expect.stringContaining("chefs-d1-friend"), expect.stringContaining("chefs-d1-housemate"), expect.stringContaining("chefs-d1-stranger")],
    );
    expect(onD1.chefsUsingMyRecipes.rows.map((row) => row.username).sort()).toEqual(
      [expect.stringContaining("chefs-d1-friend"), expect.stringContaining("chefs-d1-housemate")],
    );
    expect(onD1.activity.map((row) => row.label)).toEqual([
      expect.stringMatching(/saved your My Soup\.$/),
      "You saved House Stew from " + onD1.activity[1]!.otherChef.username + ".",
      expect.stringMatching(/forked your My Soup\.$/),
      expect.stringMatching(/^You forked Friend Rice from /),
      expect.stringMatching(/cooked your My Soup\.$/),
      expect.stringMatching(/^You cooked House Stew from /),
      expect.stringMatching(/^You cooked Friend Rice from /),
    ]);
  });

  it("shows an empty kitchen for a chef with no photo", async () => {
    const viewer = await createDrawerUser("chefs-d1-new");
    await db.user.update({ where: { id: viewer.id }, data: { photoUrl: null } });
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    const page = await load(viewer.id, d1.binding);
    expect(page).toEqual({
      viewer: { id: viewer.id, username: viewer.username, photoUrl: null },
      fellowChefs: { rows: [], total: 0 },
      chefsUsingMyRecipes: { rows: [], total: 0 },
      activity: [],
    });
  });

  it("fails like findUniqueOrThrow for a chef who is gone", async () => {
    await expect(loadChefsPageFromD1(d1.binding, "no-such-chef")).rejects.toThrow("No user no-such-chef for the Chefs page");
  });
});
