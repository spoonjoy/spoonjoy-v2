// GET /api/v1/cooking-now: the signed-in cook's in-progress recipes, for a browser session or a
// bearer token with kitchen:read, and never another cook's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { COOKING_NOW_IDLE_MS, recordCookingNow } from "~/lib/cooking-now.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../utils";

const ATTEMPT = "11111111-1111-4111-8111-111111111111";

function routeArgs(request: Request) {
  return {
    request,
    params: { "*": "cooking-now" },
    context: { cloudflare: { env: { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
  } as any;
}

function cookingNowRequest(headers: Record<string, string>) {
  return new UndiciRequest("http://localhost/api/v1/cooking-now", {
    headers: { "X-Request-Id": "req_cooking_now", ...headers },
  }) as unknown as Request;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0]!;
}

describe("API v1 cooking now", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let d1: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function cookWithTwoRecipes() {
    const cook = await db.user.create({ data: createTestUser() });
    const older = await db.recipe.create({ data: { ...createTestRecipe(cook.id), title: "Older Soup" } });
    const newer = await db.recipe.create({ data: { ...createTestRecipe(cook.id), title: "Newer Bread" } });
    for (const stepNum of [1, 2, 3]) {
      await db.recipeStep.create({ data: { recipeId: newer.id, stepNum, description: `Step ${stepNum}` } });
    }
    const now = Date.now();
    await recordCookingNow(d1.binding, {
      userId: cook.id, recipeId: older.id, attemptId: ATTEMPT, revision: 1, activeStepId: null, activeStepIndex: 1, checkedCount: 0, touchedAt: now - 60_000,
    });
    await recordCookingNow(d1.binding, {
      userId: cook.id, recipeId: newer.id, attemptId: ATTEMPT, revision: 3, activeStepId: "step-2", activeStepIndex: 1, checkedCount: 0, touchedAt: now,
    });
    return { cook, older, newer, now };
  }

  it("lists the bearer's recipes newest first with what a card shows", async () => {
    const { cook, older, newer, now } = await cookWithTwoRecipes();
    const credential = await createApiCredential(db, cook.id, "Cooking now reader", { scopes: ["kitchen:read"] });

    const response = await loader(routeArgs(cookingNowRequest({ Authorization: `Bearer ${credential.token}` })));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(payload).toMatchObject({ ok: true, requestId: "req_cooking_now" });
    expect(payload.data.recipes.map((entry: any) => entry.recipe.title)).toEqual(["Newer Bread", "Older Soup"]);
    expect(payload.data.recipes[0]).toEqual({
      recipe: {
        id: newer.id,
        title: "Newer Bread",
        coverImageUrl: null,
        href: `/recipes/${newer.id}`,
        canonicalUrl: `https://spoonjoy.app/recipes/${newer.id}`,
      },
      activeStepId: "step-2",
      activeStepIndex: 1,
      stepCount: 3,
      checkedCount: 0,
      totalCount: 0,
      allCheckedAt: null,
      touchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + COOKING_NOW_IDLE_MS).toISOString(),
    });
    expect(payload.data.recipes[1].recipe.id).toBe(older.id);
  });

  it("reads the same list for the cook's browser session", async () => {
    const { cook, newer, older } = await cookWithTwoRecipes();

    const response = await loader(routeArgs(cookingNowRequest({ Cookie: await sessionCookie(cook.id) })));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.data.recipes.map((entry: any) => entry.recipe.id)).toEqual([newer.id, older.id]);
  });

  it("shows a cook nothing of another cook's list", async () => {
    await cookWithTwoRecipes();
    const other = await db.user.create({ data: createTestUser() });

    const response = await loader(routeArgs(cookingNowRequest({ Cookie: await sessionCookie(other.id) })));

    expect((await response.json() as any).data).toEqual({ recipes: [] });
  });

  it("requires a signed-in cook", async () => {
    const response = await loader(routeArgs(cookingNowRequest({})));

    expect(response.status).toBe(401);
    expect((await response.json() as any).error.code).toBe("authentication_required");
  });

  it("requires kitchen:read from a token", async () => {
    const { cook } = await cookWithTwoRecipes();
    const credential = await createApiCredential(db, cook.id, "Shopping only", { scopes: ["shopping_list:read"] });

    const response = await loader(routeArgs(cookingNowRequest({ Authorization: `Bearer ${credential.token}` })));

    expect(response.status).toBe(403);
    expect((await response.json() as any).error.code).toBe("insufficient_scope");
  });
});
