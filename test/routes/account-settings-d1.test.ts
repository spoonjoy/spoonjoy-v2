// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// The request's Prisma client, switchable: on merge-group run 45528383350 a wedged Prisma engine failed
// /account/settings, so with a D1 binding the page must not build one, and must show what the Prisma path shows.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { loader } from "~/routes/account.settings";

const chef = (prefix: string) => createUser(db, faker.internet.email(), `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`, "testPassword123");

describe("account settings loader on a D1 binding", () => {
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

  async function load(userId: string, env: Record<string, unknown>) {
    const cookie = (await createUserSessionCookie(userId)).split(";")[0];
    return loader({
      request: new UndiciRequest("http://localhost:3000/account/settings", { headers: { Cookie: cookie } }) as unknown as Request,
      context: { cloudflare: { env } },
      params: {},
    } as never);
  }

  it("shows the blocked chefs, newest first, and the recipe default that the Prisma path shows, while Prisma never answers", async () => {
    const viewer = await chef("settings_viewer");
    const older = await chef("settings_older");
    const newer = await chef("settings_newer");
    await db.user.update({ where: { id: viewer.id }, data: { defaultRecipeVisibility: "private" } });
    await db.chefBlock.create({ data: { blockerId: viewer.id, blockedId: older.id, createdAt: new Date("2026-05-01T10:00:00Z") } });
    await db.chefBlock.create({ data: { blockerId: viewer.id, blockedId: newer.id, createdAt: new Date("2026-05-02T10:00:00Z") } });
    await db.chefBlock.create({ data: { blockerId: newer.id, blockedId: viewer.id } });
    const flags = { SPOONJOY_FLAGS: "recipe_visibility" };

    platform.getRequestDb.mockImplementation(async () => db);
    const onPrisma = await load(viewer.id, flags);
    expect(platform.getRequestDb).toHaveBeenCalled();

    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    const onD1 = await load(viewer.id, { ...flags, DB: d1.binding });

    expect(platform.getRequestDb).not.toHaveBeenCalled();
    expect(onD1).toEqual(onPrisma);
    expect(onD1.blockedChefs).toEqual([{ id: newer.id, username: newer.username }, { id: older.id, username: older.username }]);
    expect(onD1.recipeVisibilityDefault).toBe("private");
    expect(onD1.serverAdmin).toBe(false);
  });

  it("asks Prisma only on a self-hosted server, for who its admin is", async () => {
    const viewer = await chef("settings_admin");
    platform.getRequestDb.mockImplementation(async () => db);
    const page = await load(viewer.id, { DB: d1.binding, SPOONJOY_SELF_HOSTED: "true" });
    expect(page.serverAdmin).toBe(true);
    expect(page.blockedChefs).toEqual([]);
    expect(page.recipeVisibilityDefault).toBeNull();
    expect(platform.getRequestDb).toHaveBeenCalledTimes(1);
  });
});
