// @vitest-environment node
// /cooking-now.json: the signed-in cook's Cooking now list for the web's pill and tab badge, read
// from D1 without a Prisma client on a Worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { recordCookingNow } from "~/lib/cooking-now.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

async function loaderWithoutPrisma() {
  vi.resetModules();
  const getRequestDb = vi.fn();
  vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
  const { loader } = await import("~/routes/cooking-now.json");
  return { loader, getRequestDb };
}

function request(cookie?: string) {
  return new UndiciRequest("http://localhost:3000/cooking-now.json", { headers: cookie ? { Cookie: cookie } : {} }) as unknown as Request;
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
});

afterEach(async () => {
  vi.doUnmock("~/lib/route-platform.server");
  vi.resetModules();
  d1.close();
  await cleanupDatabase();
});

async function cookWithARecipe() {
  const cook = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({ data: { ...createTestRecipe(cook.id), title: "Lemon Herb Rice" } });
  await recordCookingNow(d1.binding, {
    userId: cook.id, recipeId: recipe.id, attemptId: "a", revision: 1, activeStepId: null, activeStepIndex: 1, checkedCount: 0, touchedAt: Date.now(),
  });
  return { cook, recipe, cookie: (await createUserSessionCookie(cook.id)).split(";")[0]! };
}

describe("/cooking-now.json", () => {
  it("answers the signed-in cook's list from D1 without a Prisma client, never cached", async () => {
    const { recipe, cookie } = await cookWithARecipe();
    const { loader, getRequestDb } = await loaderWithoutPrisma();

    const response = await loader({ request: request(cookie), context: { cloudflare: { env: { DB: d1.binding } } }, params: {} } as never);
    const body = await response.json() as { ok: boolean; data: { recipes: Array<{ recipe: { id: string; href: string } }> } };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.ok).toBe(true);
    expect(body.data.recipes.map((entry) => entry.recipe)).toEqual([
      { id: recipe.id, title: "Lemon Herb Rice", coverImageUrl: null, href: `/recipes/${recipe.id}` },
    ]);
    expect(getRequestDb).not.toHaveBeenCalled();
  });

  it("reads the same list through Prisma where there is no D1 binding", async () => {
    const { recipe, cookie } = await cookWithARecipe();
    const { loader } = await import("~/routes/cooking-now.json");

    const response = await loader({ request: request(cookie), context: {}, params: {} } as never);

    expect(((await response.json()) as { data: { recipes: Array<{ recipe: { id: string } }> } }).data.recipes.map((entry) => entry.recipe.id)).toEqual([recipe.id]);
  });

  it("answers 401 to a visitor", async () => {
    const { loader } = await import("~/routes/cooking-now.json");

    const response = await loader({ request: request(), context: {}, params: {} } as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });
});
