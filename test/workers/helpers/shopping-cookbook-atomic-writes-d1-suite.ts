import { createExecutionContext, env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { action as apiV1Action } from "../../../app/routes/api.v1.$";
import { hashApiToken } from "../../../app/lib/api-auth.server";
import { getDb } from "../../../app/lib/db.server";
import { createUserSessionCookie } from "../../../app/lib/session.server";
import { handleShoppingListAction } from "../../../app/lib/shopping-list.server";
import { callSpoonjoyApiOperation } from "../../../app/lib/spoonjoy-api.server";
import { expectConsoleError } from "../../warning-policy";
import { applyRepositoryMigrations } from "./repository-migrations";

// Shopping-list and cookbook writes against Wrangler's real D1 (workerd). Another request's
// write is landed between an action's reads and its write, deterministically, by a binding
// that runs it just ahead of the action's batch (or its single write statement). Both
// requests' changes must survive, and a lost race must answer what the checks would.

const CHEF = "sca-chef";
const EMAIL = "sca-chef@example.com";
const LIST = "sca-list";
const TOKEN = "sj_shopping_cookbook_atomic_d1";
const ORIGIN = "https://spoonjoy.test";
const OLD = "2026-01-01T00:00:00.000Z";
const APPLES = "sca-apples";
const FLOUR = "sca-flour";
const EACH = "sca-each";
const FAILURE = "shopping_cookbook_injected_failure";
const TRIGGER = "ShoppingCookbookAtomic_injected_failure";

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function run(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

/** Makes the next matching write abort, as a failing statement late in a batch would. */
async function failOn(event: "INSERT" | "UPDATE" | "DELETE", table: string, when: string) {
  await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
  await run(`CREATE TRIGGER "${TRIGGER}" BEFORE ${event} ON "${table}" WHEN ${when}
    BEGIN SELECT RAISE(ABORT, '${FAILURE}'); END`);
}

/** The binding, but a failing batch rejects with `error`, so the logged error is known. */
function failingWith(error: Error): D1Database {
  const real = database();
  return {
    prepare: (sql: string) => real.prepare(sql),
    exec: (sql: string) => real.exec(sql),
    async batch(statements: D1PreparedStatement[]) {
      try {
        return await real.batch(statements);
      } catch {
        throw error;
      }
    },
  } as never;
}

async function rows<T = Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T[]> {
  return (await database().prepare(sql).bind(...values).all<T>()).results;
}

async function shoppingItems() {
  return rows<{ ingredientRefId: string; quantity: number | null; deleted: number; checked: number }>(
    `SELECT "ingredientRefId", "quantity", "deletedAt" IS NOT NULL AS "deleted", "checked"
     FROM "ShoppingListItem" WHERE "shoppingListId" = ? ORDER BY "ingredientRefId", "id"`,
    LIST,
  );
}

/**
 * The binding, but `before` runs once, just ahead of the first batch or of the first
 * statement whose SQL matches `statement`: another request landing between this one's
 * reads and its write.
 */
function interleaved(before: () => Promise<unknown>, statement?: RegExp): D1Database {
  const real = database();
  let pending = true;
  const runBefore = async () => {
    if (!pending) return;
    pending = false;
    await before();
  };
  const hooked = (bound: D1PreparedStatement): D1PreparedStatement => ({
    bind: (...values: unknown[]) => hooked(bound.bind(...values)),
    first: async (...args: unknown[]) => {
      await runBefore();
      return (bound.first as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    all: async () => {
      await runBefore();
      return bound.all();
    },
    raw: async (...args: unknown[]) => {
      await runBefore();
      return (bound.raw as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    run: async () => {
      await runBefore();
      return bound.run();
    },
  }) as never;
  return {
    prepare: (sql: string) => (statement?.test(sql) && pending ? hooked(real.prepare(sql)) : real.prepare(sql)),
    exec: (sql: string) => real.exec(sql),
    dump: () => real.dump(),
    withSession: (...args: unknown[]) => (real.withSession as (...a: unknown[]) => unknown)(...args),
    async batch(statements: D1PreparedStatement[]) {
      if (!statement) await runBefore();
      return real.batch(statements);
    },
  } as never;
}

function routeContext(DB: D1Database = database()) {
  const routeEnv = new Proxy(env as object, {
    get: (target, property, receiver) => (property === "DB" ? DB : Reflect.get(target, property, receiver)),
  });
  return { cloudflare: { env: routeEnv, ctx: createExecutionContext() } };
}

async function webAddRecipe(recipeId: string, scaleFactor: string, DB?: D1Database) {
  const cookie = await createUserSessionCookie(CHEF, env as never, new Request(`${ORIGIN}/shopping-list`));
  const form = new FormData();
  form.set("intent", "addFromRecipe");
  form.set("recipeId", recipeId);
  form.set("scaleFactor", scaleFactor);
  return handleShoppingListAction({
    request: new Request(`${ORIGIN}/shopping-list`, { method: "POST", headers: { Cookie: cookie }, body: form }),
    context: routeContext(DB) as never,
  });
}

async function apiPost(path: string, body: Record<string, unknown>, DB?: D1Database) {
  const response = await apiV1Action({
    request: new Request(`${ORIGIN}/api/v1/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "X-Request-Id": `req_${body.clientMutationId}` },
      body: JSON.stringify(body),
    }),
    params: { "*": path },
    context: routeContext(DB),
  } as never);
  return { status: response.status, body: await response.json() as { data: Record<string, unknown> } };
}

function mcp(DB: D1Database = database()) {
  return {
    db: prisma,
    env: { DB },
    principal: {
      id: CHEF, email: EMAIL, username: "sca_chef", source: "bearer" as const,
      scopes: ["kitchen:read", "kitchen:write", "shopping_list:write"],
    },
  };
}

async function seedRecipe(id: string, ingredients: Array<[ref: string, quantity: number]>) {
  await run(
    `INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
    id, `Recipe ${id}`, CHEF, OLD, OLD,
  );
  await run(
    `INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description", "updatedAt") VALUES (?, ?, 1, 'Gather', ?)`,
    `${id}-step`, id, OLD,
  );
  for (const [ref, quantity] of ingredients) {
    await run(
      `INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt")
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      `${id}-${ref}`, id, quantity, EACH, ref, OLD,
    );
  }
}

async function seedItem(ref: string, quantity: number | null, extra: { checked?: boolean; deleted?: boolean } = {}) {
  await run(
    `INSERT INTO "ShoppingListItem" ("id", "shoppingListId", "quantity", "unitId", "ingredientRefId", "checked",
       "checkedAt", "deletedAt", "sortIndex", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    `sca-item-${ref}`, LIST, quantity, EACH, ref, extra.checked ? 1 : 0, extra.checked ? OLD : null,
    extra.deleted ? OLD : null, OLD,
  );
}

describe("atomic shopping-list and cookbook writes on Wrangler D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    await run(
      `INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, 'sca_chef', ?, ?)`,
      CHEF, EMAIL, OLD, OLD,
    );
    await run(
      `INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "createdAt", "updatedAt")
       VALUES ('sca-credential', ?, 'Shopping cookbook atomic', ?, ?, 'kitchen:read kitchen:write shopping_list:write', ?, ?)`,
      CHEF, await hashApiToken(TOKEN), TOKEN.slice(0, 12), OLD, OLD,
    );
    await run(`INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`, LIST, CHEF, OLD, OLD);
    await run(`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, 'sca each', ?)`, EACH, OLD);
    for (const [id, name] of [[APPLES, "sca apples"], [FLOUR, "sca flour"]]) {
      await run(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)`, id, name, OLD);
    }
    await seedRecipe("sca-pie", [[APPLES, 2]]);
    await seedRecipe("sca-crumble", [[APPLES, 3], [FLOUR, 1]]);
  });

  afterEach(async () => {
    await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
    await run(`DELETE FROM "ShoppingListItem" WHERE "shoppingListId" = ?`, LIST);
  });

  describe("adding recipes to the shopping list", () => {
    it("keeps both amounts when two web adds sharing an ingredient interleave", async () => {
      await seedItem(APPLES, 1, { checked: true });

      await webAddRecipe("sca-pie", "2", interleaved(() => webAddRecipe("sca-crumble", "1")));

      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 1 + 3 + 4, deleted: 0, checked: 0 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });

    it("keeps both amounts when two web adds run concurrently", async () => {
      await seedItem(APPLES, 1);

      await Promise.all([webAddRecipe("sca-pie", "1"), webAddRecipe("sca-crumble", "1")]);

      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 1 + 2 + 3, deleted: 0, checked: 0 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });

    it("adds to the item another add created after this one found it missing", async () => {
      await webAddRecipe("sca-pie", "1", interleaved(() => webAddRecipe("sca-crumble", "1")));

      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 2 + 3, deleted: 0, checked: 0 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });

    it("answers a REST add with the quantity each item stores after an MCP add lands in between", async () => {
      await seedItem(APPLES, null, { deleted: true });

      const added = await apiPost(
        "shopping-list/add-from-recipe",
        { clientMutationId: "sca-rest-add", recipeId: "sca-pie" },
        interleaved(() => callSpoonjoyApiOperation("add_recipe_to_shopping_list", { recipeId: "sca-crumble" }, mcp())),
      );

      expect(added.status).toBe(200);
      expect(added.body.data).toMatchObject({ created: 0, updated: 1, items: [{ name: "sca apples", quantity: 3 + 2 }] });
      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 5, deleted: 0, checked: 0 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });

    it("keeps both amounts when a web add lands inside an MCP add", async () => {
      await seedItem(APPLES, 4);

      const result = await callSpoonjoyApiOperation(
        "add_recipe_to_shopping_list",
        { recipeId: "sca-crumble" },
        mcp(interleaved(() => webAddRecipe("sca-pie", "1"))),
      );

      expect(result).toMatchObject({ created: 1, updated: 1 });
      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 4 + 2 + 3, deleted: 0, checked: 0 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });
  });

  describe("adding one item", () => {
    const addition = /UPDATE "ShoppingListItem"\s+SET "quantity" = CASE/;

    it("keeps both amounts when an MCP add lands between a REST add's read and its write", async () => {
      await seedItem(APPLES, 1);

      const added = await apiPost(
        "shopping-list/items",
        { clientMutationId: "sca-rest-item", name: "sca apples", unit: "sca each", quantity: 2 },
        interleaved(
          () => callSpoonjoyApiOperation("add_shopping_list_item", { name: "sca apples", unit: "sca each", quantity: 5 }, mcp()),
          addition,
        ),
      );

      expect(added.status).toBe(200);
      expect(added.body.data).toMatchObject({ created: false, item: { quantity: 1 + 5 + 2 } });
      expect(await shoppingItems()).toEqual([{ ingredientRefId: APPLES, quantity: 8, deleted: 0, checked: 0 }]);
    });

    it("keeps both amounts when a web add lands between an MCP add's read and its write", async () => {
      await seedItem(APPLES, 1);
      const webAdd = async () => {
        const cookie = await createUserSessionCookie(CHEF, env as never, new Request(`${ORIGIN}/shopping-list`));
        const form = new FormData();
        form.set("intent", "addItem");
        form.set("ingredientName", "sca apples");
        form.set("unitName", "sca each");
        form.set("quantity", "3");
        return handleShoppingListAction({
          request: new Request(`${ORIGIN}/shopping-list`, { method: "POST", headers: { Cookie: cookie }, body: form }),
          context: routeContext() as never,
        });
      };
      const interleavedPrisma = await getDb({ DB: interleaved(webAdd, addition) });

      await callSpoonjoyApiOperation(
        "add_shopping_list_item",
        { name: "sca apples", unit: "sca each", quantity: 2 },
        { ...mcp(), db: interleavedPrisma },
      );

      expect(await shoppingItems()).toEqual([{ ingredientRefId: APPLES, quantity: 1 + 3 + 2, deleted: 0, checked: 0 }]);
    });
  });

  describe("clearing the shopping list", () => {
    /** 95 items: more than one statement's worth of ids (D1 binds at most 100 values). */
    async function seedBulk() {
      for (let index = 0; index < 95; index++) {
        const ref = `sca-bulk-${String(index).padStart(2, "0")}`;
        await run(`INSERT OR IGNORE INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)`, ref, ref, OLD);
        await seedItem(ref, index);
      }
    }

    async function activeCount() {
      return (await shoppingItems()).filter((item) => item.deleted === 0).length;
    }

    it("clears every item or none when a late statement fails", async () => {
      await seedBulk();
      await failOn("UPDATE", "ShoppingListItem", `OLD."id" = 'sca-item-sca-bulk-94' AND NEW."deletedAt" IS NOT NULL`);
      const batchError = new Error(FAILURE);
      expectConsoleError("[api-v1] internal_error", {
        requestId: "req_sca-clear-failed",
        method: "POST",
        path: "/api/v1/shopping-list/clear-all",
        error: { name: batchError.name, message: batchError.message, stack: batchError.stack },
      });

      const failed = await apiPost("shopping-list/clear-all", { clientMutationId: "sca-clear-failed" }, failingWith(batchError));
      expect(failed.status).toBe(500);
      expect(await activeCount()).toBe(95);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const cleared = await apiPost("shopping-list/clear-all", { clientMutationId: "sca-clear" });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({ removed: 95 });
      expect(await activeCount()).toBe(0);
    });

    it("leaves an item added after the read on the list, and reports only what it cleared", async () => {
      await seedItem(APPLES, 1, { checked: true });

      const cleared = await apiPost(
        "shopping-list/clear-all",
        { clientMutationId: "sca-clear-race" },
        interleaved(() => callSpoonjoyApiOperation("add_shopping_list_item", { name: "sca flour", unit: "sca each", quantity: 1 }, mcp())),
      );

      expect(cleared.body.data).toMatchObject({ removed: 1, items: [{ name: "sca apples", deletedAt: expect.any(String) }] });
      expect(await shoppingItems()).toEqual([
        { ingredientRefId: APPLES, quantity: 1, deleted: 1, checked: 1 },
        { ingredientRefId: FLOUR, quantity: 1, deleted: 0, checked: 0 },
      ]);
    });
  });
});
