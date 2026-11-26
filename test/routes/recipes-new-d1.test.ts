// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// The request's Prisma client, switchable: with a D1 binding the new-recipe page reads the cook's default for new
// recipes from D1 and builds no Prisma client.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { loader } from "~/routes/recipes.new";

describe("new recipe loader on a D1 binding", () => {
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

  async function load(userId: string) {
    const cookie = (await createUserSessionCookie(userId)).split(";")[0];
    return loader({
      request: new UndiciRequest("http://localhost:3000/recipes/new", { headers: { Cookie: cookie } }) as unknown as Request,
      context: { cloudflare: { env: { DB: d1.binding } } },
      params: {},
    } as never);
  }

  it("starts the form at the cook's default, read from D1, while Prisma never answers", async () => {
    const cook = await createUser(db, faker.internet.email(), `new_d1_${faker.string.alphanumeric(8).toLowerCase()}`, "testPassword123");
    await db.user.update({ where: { id: cook.id }, data: { defaultRecipeVisibility: "household" } });

    expect(await load(cook.id)).toEqual({ visibilityDefault: "household" });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("starts the form at public for a cook who never chose a default", async () => {
    const cook = await createUser(db, faker.internet.email(), `new_d1_${faker.string.alphanumeric(8).toLowerCase()}`, "testPassword123");
    expect(await load(cook.id)).toEqual({ visibilityDefault: "public" });
  });
});
