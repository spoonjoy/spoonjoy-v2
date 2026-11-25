// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

// The request's Prisma client, switchable: on merge-group run 45528383350 a wedged Prisma engine failed
// fellow-chefs.data, so with a D1 binding the page must not build one, and must show what the Prisma path shows.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { loader } from "~/routes/users.$identifier.fellow-chefs";

describe("fellow chefs loader on a D1 binding", () => {
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

  async function load(identifier: string, viewerId: string, binding: unknown, search = "") {
    return loader({
      request: new UndiciRequest(`http://localhost:3000/users/${identifier}/fellow-chefs${search}`, { headers: await sessionHeaders(viewerId) }),
      context: { cloudflare: { env: binding ? { DB: binding } : {} } },
      params: { identifier },
    } as unknown as Parameters<typeof loader>[0]);
  }

  async function onBoth(identifier: string, viewerId: string, search = "") {
    platform.getRequestDb.mockImplementation(async () => db);
    const onPrisma = await load(identifier, viewerId, null, search).catch((error: unknown) => error);
    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    const onD1 = await load(identifier, viewerId, d1.binding, search).catch((error: unknown) => error);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    return { onPrisma, onD1 };
  }

  it("lists the chef's fellow chefs, a page at a time, as the Prisma path does, while Prisma never answers", async () => {
    const chef = await createDrawerUser("fellow-d1-chef");
    const viewer = await createDrawerUser("fellow-d1-viewer");
    const first = await createDrawerUser("fellow-d1-first");
    const second = await createDrawerUser("fellow-d1-second");
    const firsts = await createDrawerRecipe({ chefId: first.id, title: "First Soup" });
    const seconds = await createDrawerRecipe({ chefId: second.id, title: "Second Soup" });
    await db.recipeSpoon.createMany({ data: [
      { chefId: chef.id, recipeId: firsts.id, cookedAt: new Date("2026-05-01T10:00:00Z") },
      { chefId: chef.id, recipeId: seconds.id, cookedAt: new Date("2026-05-02T10:00:00Z") },
    ] });

    const { onPrisma, onD1 } = await onBoth(chef.username, viewer.id);
    expect(onD1).toEqual(onPrisma);
    expect(onD1).toMatchObject({ profileUsername: chef.username, viewerIsOwner: false, total: 2, page: 1 });
    expect((onD1 as { rows: { chefId: string }[] }).rows.map((row) => row.chefId)).toEqual([second.id, first.id]);

    const paged = await onBoth(chef.username, chef.id, "?page=2");
    expect(paged.onD1).toEqual(paged.onPrisma);
  });

  it("redirects an id to the username and 404s an unknown chef, as the Prisma path does", async () => {
    const chef = await createDrawerUser("fellow-d1-alias");
    const viewer = await createDrawerUser("fellow-d1-alias-viewer");

    const alias = await onBoth(chef.id, viewer.id);
    expect(alias.onD1).toBeInstanceOf(Response);
    expect((alias.onD1 as Response).headers.get("Location")).toBe(`/users/${chef.username}/fellow-chefs`);
    expect((alias.onPrisma as Response).headers.get("Location")).toBe(`/users/${chef.username}/fellow-chefs`);

    const missing = await onBoth("no-such-chef", viewer.id);
    expect((missing.onD1 as Response).status).toBe(404);
    expect((missing.onPrisma as Response).status).toBe(404);

    await db.chefBlock.create({ data: { blockerId: viewer.id, blockedId: chef.id } });
    const blocked = await onBoth(chef.username, viewer.id);
    expect((blocked.onD1 as Response).status).toBe(404);
    expect((blocked.onPrisma as Response).status).toBe(404);
  });
});
