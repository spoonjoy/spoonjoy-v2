// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { sessionStorage } from "~/lib/session.server";
import {
  readCookbookPageFromD1,
  readCookbookPageWithPrisma,
  type CookbookPageRows,
} from "~/lib/cookbook-page-reads.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

// Covers are compared by what the page shows: the D1 reader returns only a recipe's
// active cover, the Prisma reader its whole history.
function displayed(rows: CookbookPageRows) {
  if (!rows.cookbook) return rows;
  return {
    ...rows,
    cookbook: {
      ...rows.cookbook,
      recipes: rows.cookbook.recipes.map(({ recipe: { covers, ...recipe }, ...entry }) => {
        const cover = getRecipeCoverDisplay(recipe, covers);
        return {
          ...entry,
          recipe: { ...recipe, coverImageUrl: cover?.displayUrl ?? null, coverProvenanceLabel: cover?.provenanceLabel ?? null },
        };
      }),
    },
  };
}

async function seedCookbook() {
  const owner = await db.user.create({ data: createTestUser() });
  const friend = await db.user.create({ data: createTestUser() });
  const other = await db.user.create({ data: createTestUser() });

  const recipe = (title: string, chefId = owner.id, extra: Record<string, unknown> = {}) =>
    db.recipe.create({ data: { title, chefId, description: `${title} notes`, servings: "2", ...extra } });
  const cover = (recipeId: string, minute: number, extra: Record<string, unknown> = {}) =>
    db.recipeCover.create({
      data: { recipeId, imageUrl: `https://example.com/${recipeId}-${minute}.jpg`, sourceType: "chef-upload", createdAt: at(minute), ...extra },
    });
  const activate = (recipeId: string, activeCoverId: string | null, extra: Record<string, unknown> = {}) =>
    db.recipe.update({ where: { id: recipeId }, data: { activeCoverId, ...extra } });

  // Several covers in the history; the active one is neither the newest nor the oldest.
  const covered = await recipe("Covered");
  await cover(covered.id, 1);
  const active = await cover(covered.id, 2, { stylizedImageUrl: "https://example.com/stylized.jpg", sourceType: "ai-generated" });
  await cover(covered.id, 3);
  await activate(covered.id, active.id, { activeCoverVariant: "image" });

  // No variant chosen: the display falls back to the stylized image.
  const stylized = await recipe("Stylized", friend.id);
  const stylizedCover = await cover(stylized.id, 4, { stylizedImageUrl: "https://example.com/s2.jpg" });
  await activate(stylized.id, stylizedCover.id);

  // A processing cover shows its image while it has one.
  const processing = await recipe("Processing");
  await activate(processing.id, (await cover(processing.id, 5, { status: "processing" })).id);

  const noCover = await recipe("No cover");

  // Covers in the history but none active: nothing shows.
  const inactive = await recipe("Inactive history");
  await cover(inactive.id, 6);
  await cover(inactive.id, 7);

  const failed = await recipe("Failed cover");
  await cover(failed.id, 8);
  await activate(failed.id, (await cover(failed.id, 9, { status: "failed", generationStatus: "failed" })).id);

  const archived = await recipe("Archived cover");
  await cover(archived.id, 10);
  await activate(archived.id, (await cover(archived.id, 11, { archivedAt: at(12) })).id);

  const archivedStatus = await recipe("Archived status");
  await activate(archivedStatus.id, (await cover(archivedStatus.id, 13, { status: "archived" })).id);

  // An active cover id that points at another recipe's cover is not this recipe's cover.
  const borrowed = await recipe("Borrowed cover");
  await activate(borrowed.id, active.id);

  const coverOff = await recipe("Cover mode none");
  await activate(coverOff.id, (await cover(coverOff.id, 14)).id, { coverMode: "none" });

  const missingVariant = await recipe("Missing stylized");
  await activate(missingVariant.id, (await cover(missingVariant.id, 15)).id, { activeCoverVariant: "stylized" });

  const deleted = await recipe("Deleted", owner.id, { deletedAt: at(16) });
  await activate(deleted.id, (await cover(deleted.id, 16)).id);

  const book = await db.cookbook.create({ data: { title: "Weeknights", authorId: owner.id, createdAt: at(0), updatedAt: at(1) } });
  const entries = [covered, stylized, processing, noCover, inactive, failed, archived, archivedStatus, borrowed, coverOff, missingVariant, deleted];
  // The page lists entries oldest first. They are inserted newest first, and their recipes
  // were created in the opposite order to the page's, so neither insertion order nor the
  // (cookbookId, recipeId) index gives the page's order without the ORDER BY. "Covered" and
  // "Stylized" share a createdAt; the larger entry id is inserted first, so only the id
  // tiebreak puts "Stylized" (entry-tie-a) before "Covered" (entry-tie-b).
  for (const [index, entry] of entries.entries()) {
    await db.recipeInCookbook.create({
      data: {
        ...(index === 0 ? { id: "entry-tie-b" } : index === 1 ? { id: "entry-tie-a" } : {}),
        cookbookId: book.id,
        recipeId: entry.id,
        addedById: owner.id,
        createdAt: at(index === 1 ? 40 : 40 - index),
      },
    });
  }

  // The owner's recipes outside the cookbook; a deleted one and another chef's are never offered.
  await recipe("Zucchini bread");
  await recipe("Apple tart");
  await recipe("Gone", owner.id, { deletedAt: at(30) });
  await recipe("Friend's soup", friend.id);
  const elsewhere = await db.cookbook.create({ data: { title: "Elsewhere", authorId: owner.id } });
  const inOtherBook = await recipe("Banana loaf");
  await db.recipeInCookbook.create({ data: { cookbookId: elsewhere.id, recipeId: inOtherBook.id, addedById: owner.id } });

  const empty = await db.cookbook.create({ data: { title: "Empty", authorId: owner.id } });
  const othersBook = await db.cookbook.create({ data: { title: "Other's", authorId: other.id } });
  await db.recipeInCookbook.create({ data: { cookbookId: othersBook.id, recipeId: covered.id, addedById: other.id } });

  return { owner, friend, other, book, empty, othersBook };
}

describe("cookbook page reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma reads return, in one D1 batch, for every viewer", async () => {
    const { owner, friend, other, book, empty, othersBook } = await seedCookbook();

    const inputs = [
      { cookbookId: book.id, viewerId: null },
      { cookbookId: book.id, viewerId: owner.id },
      { cookbookId: book.id, viewerId: friend.id },
      { cookbookId: empty.id, viewerId: owner.id },
      { cookbookId: othersBook.id, viewerId: other.id },
      { cookbookId: othersBook.id, viewerId: owner.id },
      { cookbookId: "missing-cookbook", viewerId: null },
      { cookbookId: "missing-cookbook", viewerId: owner.id },
    ];
    for (const input of inputs) {
      const before = d1.roundTrips();
      const fromD1 = await readCookbookPageFromD1(d1.binding, input);
      expect(d1.roundTrips() - before).toBe(1);
      expect(displayed(fromD1)).toEqual(displayed(await readCookbookPageWithPrisma(db, input)));
    }
  });

  it("shows only live recipes, oldest entry first, with each recipe's active cover", async () => {
    const { owner, book } = await seedCookbook();
    const rows = displayed(await readCookbookPageFromD1(d1.binding, { cookbookId: book.id, viewerId: owner.id }));
    const cookbook = rows.cookbook!;

    expect(cookbook).toMatchObject({ id: book.id, title: "Weeknights", authorId: owner.id, author: { id: owner.id, username: owner.username } });
    const shown = Object.fromEntries(cookbook.recipes.map(({ recipe }) => [recipe.title, recipe.coverImageUrl]));
    expect(Object.keys(shown)).not.toContain("Deleted");
    expect(cookbook.recipes).toHaveLength(11);
    expect(cookbook.recipes.map((entry) => entry.recipe.title)).toEqual([
      "Missing stylized", "Cover mode none", "Borrowed cover", "Archived status", "Archived cover",
      "Failed cover", "Inactive history", "No cover", "Processing", "Stylized", "Covered",
    ]);
    expect(cookbook.recipes.slice(-2).map((entry) => entry.id)).toEqual(["entry-tie-a", "entry-tie-b"]);
    expect(cookbook.recipes.at(-1)!.recipe).toMatchObject({ title: "Covered", description: "Covered notes", servings: "2", chef: { username: owner.username } });
    // The chosen image variant of the active cover, not the newest cover or its stylized image.
    expect(shown["Covered"]).toMatch(/-2\.jpg$/);
    expect(shown["Stylized"]).toBe("https://example.com/s2.jpg");
    expect(shown["Processing"]).toMatch(/-5\.jpg$/);
    for (const title of ["No cover", "Inactive history", "Failed cover", "Archived cover", "Archived status", "Borrowed cover", "Cover mode none", "Missing stylized"]) {
      expect(shown[title], title).toBeNull();
    }

    expect(rows.availableRecipes).toEqual([
      { id: expect.any(String), title: "Apple tart" },
      { id: expect.any(String), title: "Banana loaf" },
      { id: expect.any(String), title: "Zucchini bread" },
    ]);
  });

  it("offers recipes to add only to the cookbook's owner", async () => {
    const { owner, friend, book, othersBook } = await seedCookbook();
    for (const input of [
      { cookbookId: book.id, viewerId: null },
      { cookbookId: book.id, viewerId: friend.id },
      { cookbookId: othersBook.id, viewerId: owner.id },
    ]) {
      expect((await readCookbookPageFromD1(d1.binding, input)).availableRecipes).toEqual([]);
    }
  });

  it("returns no cookbook when the id is unknown", async () => {
    const input = { cookbookId: "missing-cookbook", viewerId: null };
    expect(await readCookbookPageFromD1(d1.binding, input)).toEqual({ cookbook: null, availableRecipes: [] });
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const input = { cookbookId: "book", viewerId: "u" };
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readCookbookPageFromD1(failing as never, input)).rejects.toThrow("D1_ERROR: lost");

    const rowsFor = (rows: unknown[][]) => ({
      prepare: d1.binding.prepare,
      batch: async () => rows.map((results) => ({ results })),
    });
    const cookbook = { id: "book", title: "Book", authorId: "u", createdAt: 1, updatedAt: 1, author_id: "u", author_username: "chef" };
    await expect(readCookbookPageFromD1(rowsFor([[{ ...cookbook, author_username: 4 }], [], []]) as never, input))
      .rejects.toThrow("D1 column author_username");
    await expect(readCookbookPageFromD1(rowsFor([[cookbook], [], [{ id: "r", title: null }]]) as never, input))
      .rejects.toThrow("D1 column title");
    await expect(readCookbookPageFromD1(rowsFor([[cookbook], []]) as never, input))
      .rejects.toThrow("D1 batch returned 2 results for 3 statements");
  });
});

describe("cookbook page loader on a D1 binding", () => {
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
    const { owner, friend, book } = await seedCookbook();
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loader } = await import("~/routes/cookbooks.$id");
    // The session module the route loaded after the reset, whose per-request check it shares.
    const { getUserId } = await import("~/lib/session.server");
    const context = { cloudflare: { env: { DB: d1.binding } } };
    // The root loader checks the session for the same Request first, and the check runs
    // once per request, so the session read is done before the page's reads are counted.
    const load = async (id: string, viewerId: string | null) => {
      const headers = new Headers();
      if (viewerId) {
        const session = await sessionStorage.getSession();
        session.set("userId", viewerId);
        headers.set("Cookie", (await sessionStorage.commitSession(session)).split(";")[0]!);
      }
      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${id}`, { headers });
      expect(await getUserId(request as never, context.cloudflare.env as never)).toBe(viewerId);
      const before = d1.roundTrips();
      const result = await loader({ request, context, params: { id } } as never);
      pageRoundTrips = d1.roundTrips() - before;
      return result;
    };
    let pageRoundTrips = 0;

    const signedOut = await load(book.id, null);
    expect(pageRoundTrips).toBe(1);
    expect(signedOut.isOwner).toBe(false);
    expect(signedOut.availableRecipes).toEqual([]);
    expect(signedOut.cookbook.recipes).toHaveLength(11);
    const first = signedOut.cookbook.recipes.find((entry) => entry.recipe.title === "Covered")!.recipe;
    expect(Object.keys(first).sort()).toEqual(["chef", "coverImageUrl", "coverProvenanceLabel", "description", "id", "servings", "title"]);
    expect(first).toMatchObject({
      title: "Covered",
      description: "Covered notes",
      servings: "2",
      chef: { username: owner.username },
      coverImageUrl: expect.stringMatching(/-2\.jpg$/),
    });
    expect(signedOut.coverImageUrls).toEqual(signedOut.cookbook.recipes.map((entry) => entry.recipe.coverImageUrl));
    expect(signedOut.canonicalUrl).toBe(`http://localhost:3000/cookbooks/${book.id}`);

    const asOwner = await load(book.id, owner.id);
    expect(pageRoundTrips).toBe(1);
    expect(asOwner.isOwner).toBe(true);
    expect(asOwner.availableRecipes.map((recipe) => recipe.title)).toEqual(["Apple tart", "Banana loaf", "Zucchini bread"]);

    const asFriend = await load(book.id, friend.id);
    expect(pageRoundTrips).toBe(1);
    expect(asFriend.isOwner).toBe(false);
    expect(asFriend.availableRecipes).toEqual([]);

    await expect(load("missing-cookbook", null)).rejects.toMatchObject({ status: 404 });
    expect(getRequestDb).not.toHaveBeenCalled();
  });

  it("returns the same page from D1 as from Prisma", async () => {
    const { owner, friend, book } = await seedCookbook();
    const { loader } = await import("~/routes/cookbooks.$id");
    const load = async (viewerId: string | null, env: Record<string, unknown> | null) => {
      const headers = new Headers();
      if (viewerId) {
        const session = await sessionStorage.getSession();
        session.set("userId", viewerId);
        headers.set("Cookie", (await sessionStorage.commitSession(session)).split(";")[0]!);
      }
      return loader({
        request: new UndiciRequest(`http://localhost:3000/cookbooks/${book.id}`, { headers }),
        context: { cloudflare: { env } },
        params: { id: book.id },
      } as never);
    };
    for (const viewerId of [null, owner.id, friend.id]) {
      expect(await load(viewerId, { DB: d1.binding })).toEqual(await load(viewerId, null));
    }
  });
});
