// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { callSpoonjoyApiOperation } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The weekly loop on a D1 binding: add a recipe, clear the list, add the recipe again. A cleared
// row is kept only so its identity can be reused, so the re-add must restart from the recipe's
// amount. Before the fix the D1 batch added on top of the cleared quantity (2 eggs, then 4, then
// 6), on every surface that shares the batch: the web page, API v1 and MCP.

const mocked = vi.hoisted(() => ({ db: null as PrismaClient | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn(async () => {
      if (!mocked.db) throw new Error("test db was not configured");
      return mocked.db;
    }),
  };
});

const { action: apiAction } = await import("~/routes/api.v1.$");
const { action: webAction } = await import("~/routes/shopping-list");

let db: PrismaClient;
let d1: SqliteD1;

async function seed() {
  const user = await db.user.create({ data: createTestUser() });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  const recipe = await db.recipe.create({ data: { title: `Lasagna ${user.id}`, chefId: user.id } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 1, description: "Layer" } });
  const each = await db.unit.upsert({ where: { name: "readd each" }, update: {}, create: { name: "readd each" } });
  const egg = await db.ingredientRef.upsert({ where: { name: "readd egg" }, update: {}, create: { name: "readd egg" } });
  const salt = await db.ingredientRef.upsert({ where: { name: "readd salt" }, update: {}, create: { name: "readd salt" } });
  await db.ingredient.createMany({
    data: [
      { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: each.id, ingredientRefId: egg.id },
      { recipeId: recipe.id, stepNum: 1, quantity: 1, unitId: each.id, ingredientRefId: salt.id },
    ],
  });
  return { user, list, recipe };
}

async function quantities(listId: string) {
  const items = await db.shoppingListItem.findMany({
    where: { shoppingListId: listId },
    include: { ingredientRef: true },
    orderBy: { ingredientRef: { name: "asc" } },
  });
  return items.map((item) => [item.ingredientRef.name, item.quantity, item.deletedAt === null]);
}

async function clearAll(listId: string) {
  await db.shoppingListItem.updateMany({
    where: { shoppingListId: listId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

async function expectWeeklyLoopRestarts(listId: string, addRecipe: (week: number) => Promise<void>) {
  for (const week of [1, 2, 3]) {
    await addRecipe(week);
    expect(await quantities(listId)).toEqual([
      ["readd egg", 2, true],
      ["readd salt", 1, true],
    ]);
    await clearAll(listId);
  }
}

describe("re-adding a recipe after clearing the shopping list, on D1", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    mocked.db = db;
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    mocked.db = null;
    d1.close();
    await cleanupDatabase();
  });

  it("restarts cleared quantities from the recipe on MCP", async () => {
    const { user, list, recipe } = await seed();
    const principal = {
      id: user.id,
      email: user.email,
      username: user.username,
      source: "bearer" as const,
      scopes: ["shopping_list:write"],
    };

    await expectWeeklyLoopRestarts(list.id, async () => {
      const before = d1.statements.length;
      await callSpoonjoyApiOperation(
        "add_recipe_to_shopping_list",
        { recipeId: recipe.id },
        { db, principal, env: { DB: d1.binding } },
      );
      // The write went through the D1 batch, not the Prisma fallback.
      expect(d1.statements.length).toBeGreaterThan(before);
    });
  });

  it("restarts cleared quantities from the recipe on API v1", async () => {
    const { user, list, recipe } = await seed();
    const credential = await createApiCredential(db, user.id, "readd writer", { scopes: ["shopping_list:write"] });

    await expectWeeklyLoopRestarts(list.id, async (week) => {
      const before = d1.statements.length;
      const response = await apiAction({
        request: new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
          method: "POST",
          headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ clientMutationId: `readd-week-${week}`, recipeId: recipe.id, scaleFactor: 1 }),
        }) as unknown as Request,
        params: { "*": "shopping-list/add-from-recipe" },
        context: { cloudflare: { env: { DB: d1.binding } } },
      } as never);
      expect(response.status).toBe(200);
      expect(d1.statements.length).toBeGreaterThan(before);
    });
  });

  it("restarts cleared quantities from the recipe on the web shopping list", async () => {
    const { user, list, recipe } = await seed();
    const cookie = (await createUserSessionCookie(user.id)).split(";")[0];

    await expectWeeklyLoopRestarts(list.id, async () => {
      const before = d1.statements.length;
      const body = new UndiciFormData();
      body.append("intent", "addFromRecipe");
      body.append("recipeId", recipe.id);
      await webAction({
        request: new UndiciRequest("http://localhost/shopping-list", {
          method: "POST",
          headers: { Cookie: cookie },
          body,
        }) as unknown as Request,
        params: {},
        context: { cloudflare: { env: { DB: d1.binding } } },
      } as never);
      expect(d1.statements.length).toBeGreaterThan(before);
    });
  });

  it("keeps adding on top of a live or checked row", async () => {
    const { user, list, recipe } = await seed();
    const principal = {
      id: user.id,
      email: user.email,
      username: user.username,
      source: "bearer" as const,
      scopes: ["shopping_list:write"],
    };
    const add = () => callSpoonjoyApiOperation(
      "add_recipe_to_shopping_list",
      { recipeId: recipe.id },
      { db, principal, env: { DB: d1.binding } },
    );

    await add();
    await db.shoppingListItem.updateMany({ where: { shoppingListId: list.id }, data: { checked: true, checkedAt: new Date() } });
    await add();

    expect(await quantities(list.id)).toEqual([
      ["readd egg", 4, true],
      ["readd salt", 2, true],
    ]);
  });
});
