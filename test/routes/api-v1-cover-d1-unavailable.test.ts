// @vitest-environment node
// An API v1 cover change that D1 cannot take is not the client's mistake: the error passes
// through rather than being answered as a 400 validation error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1 } from "../helpers/flaky-d1";
import { createTestUser } from "../utils";

// Prisma reads go to the local test database; the D1 binding carries the cover writes.
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: () => getLocalDb(),
}));

const { action: apiV1Action } = await import("~/routes/api.v1.$");

let db: PrismaClient;
let d1: SqliteD1;

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("API v1 cover activation while D1 is unavailable", () => {
  it("does not answer a validation error, and leaves the recipe's cover as it was", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({ data: { title: "Bread", chefId: chef.id } });
    const cover = await db.recipeCover.create({ data: { recipeId: recipe.id, imageUrl: "/photos/covers/a.jpg", sourceType: "chef-upload" } });
    const token = (await createApiCredential(db, chef.id, "covers", { scopes: ["kitchen:write"] })).token;
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/UPDATE "Recipe" SET/, "lost", "lost", "lost", "lost");

    // How an unavailable database is answered and logged belongs to the API's error mapping;
    // this test only holds that the cover mapper passes it through.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const path = `recipes/${recipe.id}/covers/${cover.id}`;
    const answer = await apiV1Action({
      request: new UndiciRequest(`http://localhost/api/v1/${path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId: "activate-1", variant: "image" }),
      }) as unknown as Request,
      params: { "*": path },
      context: { cloudflare: { env: { DB: flaky.binding }, ctx: { waitUntil: () => undefined } } },
    } as never) as Response;

    expect(flaky.failures()).toBe(4);
    expect(answer.status).not.toBe(400);
    expect(((await answer.json()) as { error: { code: string } }).error.code).not.toBe("validation_error");
    logged.mockRestore();
    await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).resolves.toMatchObject({ activeCoverId: null });
  });
});
