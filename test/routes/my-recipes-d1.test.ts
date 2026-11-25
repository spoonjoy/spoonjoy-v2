// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

// The request's Prisma client, held: on merge-group run 45528383350 a wedged Prisma engine failed /my-recipes, so
// with a D1 binding the page, organizer choices included, must not build one.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { loader } from "~/routes/my-recipes";

describe("My Recipes loader on a D1 binding", () => {
  let d1: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("filters by organizer and offers the cook's organizers while Prisma never answers", async () => {
    const viewer = await createDrawerUser("my-recipes-d1");
    const other = await createDrawerUser("my-recipes-d1-other");
    const wokSoup = await createDrawerRecipe({ chefId: viewer.id, title: "Wok Soup", updatedAt: new Date("2026-02-03T10:00:00Z") });
    const quickSoup = await createDrawerRecipe({ chefId: viewer.id, title: "Quick Soup", updatedAt: new Date("2026-02-02T10:00:00Z") });
    const quick = await db.organizer.create({ data: { ownerId: viewer.id, kind: "tag", name: "Quick", slug: "quick" } });
    const wok = await db.organizer.create({ data: { ownerId: viewer.id, kind: "tool", name: "Wok", slug: "wok" } });
    await db.organizer.create({ data: { ownerId: viewer.id, kind: "tag", name: "Cozy", slug: "cozy" } });
    await db.organizer.create({ data: { ownerId: other.id, kind: "category", name: "Theirs", slug: "theirs" } });
    await db.recipeOrganizer.createMany({
      data: [
        { recipeId: wokSoup.id, organizerId: quick.id },
        { recipeId: wokSoup.id, organizerId: wok.id },
        { recipeId: quickSoup.id, organizerId: quick.id },
      ],
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?with=tag:quick&without=tool:wok&with=category:theirs", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: { SPOONJOY_FLAGS: "organizers", DB: d1.binding } } },
      params: {},
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.recipes.map((recipe: { title: string }) => recipe.title)).toEqual(["Quick Soup"]);
    expect(result.filterParams).toEqual([["with", "tag:quick"], ["without", "tool:wok"]]);
    expect(result.organizerChoices).toEqual({
      tag: [{ name: "Cozy", value: "tag:cozy" }, { name: "Quick", value: "tag:quick" }],
      category: [],
      tool: [{ name: "Wok", value: "tool:wok" }],
    });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });
});
