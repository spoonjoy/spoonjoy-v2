import { env } from "cloudflare:test";
import { trackedExecutionContext } from "./execution-contexts";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { action as apiV1Action } from "../../../app/routes/api.v1.$";
import { hashApiToken } from "../../../app/lib/api-auth.server";
import { getDb } from "../../../app/lib/db.server";
import { createUserSessionCookie } from "../../../app/lib/session.server";
import { handleShoppingListAction } from "../../../app/lib/shopping-list.server";
import { callSpoonjoyApiOperation } from "../../../app/lib/spoonjoy-api.server";
import { scheduleSpoonCoverStylization } from "../../../app/lib/spoon-cover-stylization.server";
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
const BOOK = "sca-book";
const STYLED = "sca-styled";
const COVER = "sca-cover";
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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => {
    throw new Error("expected the write to fail");
  }, (error: unknown) => error);
}

function routeContext(DB: D1Database = database()) {
  const routeEnv = new Proxy(env as object, {
    get: (target, property, receiver) => (property === "DB" ? DB : Reflect.get(target, property, receiver)),
  });
  return { cloudflare: { env: routeEnv, ctx: trackedExecutionContext() } };
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
    await run(`INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt") VALUES (?, 'Sca Book', ?, ?, ?)`, BOOK, CHEF, OLD, OLD);
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

  describe("adding one item with no unit", () => {
    const insert = /INSERT INTO "ShoppingListItem"/;
    const addition = /UPDATE "ShoppingListItem"\s+SET "quantity" = CASE/;

    async function unitless() {
      return rows<{ id: string; quantity: number | null; deleted: number }>(
        `SELECT "id", "quantity", "deletedAt" IS NOT NULL AS "deleted" FROM "ShoppingListItem"
         WHERE "shoppingListId" = ? AND "ingredientRefId" = ? AND "unitId" IS NULL`,
        LIST,
        APPLES,
      );
    }

    it("keeps one item with every amount when adds run concurrently", async () => {
      const [rest1, rest2, mcp1, mcp2] = await Promise.all([
        apiPost("shopping-list/items", { clientMutationId: "sca-unitless-1", name: "sca apples", quantity: 1 }),
        apiPost("shopping-list/items", { clientMutationId: "sca-unitless-2", name: "sca apples", quantity: 2 }),
        callSpoonjoyApiOperation("add_shopping_list_item", { name: "sca apples", quantity: 4 }, mcp()),
        callSpoonjoyApiOperation("add_shopping_list_item", { name: "sca apples", quantity: 8 }, mcp()),
      ]);

      // Exactly one of the four adds created the item; the others added to it.
      const created = [rest1, rest2].map((response) => (response.status === 201 ? 1 : 0))
        .concat([mcp1, mcp2].map((result) => (result as { created: number }).created));
      expect(created.reduce((sum, value) => sum + value, 0)).toBe(1);
      expect(await unitless()).toEqual([{ id: expect.any(String), quantity: 15, deleted: 0 }]);
    });

    it("adds to the item another add created between a REST add's read and its insert", async () => {
      const added = await apiPost(
        "shopping-list/items",
        { clientMutationId: "sca-unitless-race", name: "sca apples", quantity: 2 },
        interleaved(() => callSpoonjoyApiOperation("add_shopping_list_item", { name: "sca apples", quantity: 5 }, mcp()), insert),
      );

      expect(added.status).toBe(200);
      expect(added.body.data).toMatchObject({ created: false, updated: true, item: { quantity: 5 + 2 } });
      expect(await unitless()).toEqual([{ id: expect.any(String), quantity: 7, deleted: 0 }]);
    });

    it("creates the item again when it is deleted between a REST add's read and its addition", async () => {
      await run(
        `INSERT INTO "ShoppingListItem" ("id", "shoppingListId", "quantity", "unitId", "ingredientRefId", "sortIndex", "updatedAt")
         VALUES ('sca-unitless-gone', ?, 3, NULL, ?, 0, ?)`,
        LIST, APPLES, OLD,
      );

      const added = await apiPost(
        "shopping-list/items",
        { clientMutationId: "sca-unitless-gone", name: "sca apples", quantity: 2 },
        interleaved(() => run(`DELETE FROM "ShoppingListItem" WHERE "id" = 'sca-unitless-gone'`), addition),
      );

      expect(added.status).toBe(201);
      expect(added.body.data).toMatchObject({ created: true, updated: false, item: { quantity: 2 } });
      expect(await unitless()).toEqual([{ id: expect.not.stringMatching(/^sca-unitless-gone$/), quantity: 2, deleted: 0 }]);
    });

    it("answers not found, writing nothing, when the list is deleted during a REST add", async () => {
      try {
        const added = await apiPost(
          "shopping-list/items",
          { clientMutationId: "sca-unitless-no-list", name: "sca apples", quantity: 2 },
          interleaved(() => run(`DELETE FROM "ShoppingList" WHERE "id" = ?`, LIST), insert),
        );

        expect(added.status).toBe(404);
        expect(await unitless()).toEqual([]);
      } finally {
        await run(`INSERT OR IGNORE INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`, LIST, CHEF, OLD, OLD);
      }
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

  describe("cover stylization status", () => {
    async function seedCover() {
      await seedRecipe(STYLED, []);
      await run(
        `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
         VALUES ('sca-styled-membership', ?, ?, ?, ?, ?)`,
        BOOK, STYLED, CHEF, OLD, OLD,
      );
      await run(
        `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType", "createdAt")
         VALUES (?, ?, 'https://example.com/raw.jpg', 'spoon', ?)`,
        COVER, STYLED, OLD,
      );
    }

    async function coverState() {
      const [cover] = await rows(
        `SELECT "status", "generationStatus", "failureReason", "archivedAt" IS NOT NULL AS "archived" FROM "RecipeCover" WHERE "id" = ?`,
        COVER,
      );
      const [recipe] = await rows<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Recipe" WHERE "id" = ?`, STYLED);
      const [book] = await rows<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?`, BOOK);
      return { ...cover, recipeTouched: recipe!.updatedAt !== OLD, cookbookTouched: book!.updatedAt !== OLD };
    }

    const stylize = (DB: D1Database, rawPhotoUrl: string) => scheduleSpoonCoverStylization({
      db: prisma,
      userId: CHEF,
      recipeId: STYLED,
      coverId: COVER,
      rawPhotoUrl,
      recipeTitle: "Styled",
      env: { DB } as never,
    });

    afterEach(async () => {
      await run(`DELETE FROM "RecipeCover" WHERE "id" = ?`, COVER);
      await run(`DELETE FROM "RecipeInCookbook" WHERE "recipeId" = ?`, STYLED);
      await run(`DELETE FROM "Ingredient" WHERE "recipeId" = ?`, STYLED);
      await run(`DELETE FROM "RecipeStep" WHERE "recipeId" = ?`, STYLED);
      await run(`DELETE FROM "Recipe" WHERE "id" = ?`, STYLED);
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, BOOK);
    });

    it("updates the cover, its recipe and its cookbook together, or none of them", async () => {
      await seedCover();
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${BOOK}'`);

      expect(String(await rejection(stylize(database(), "https://example.com/raw.jpg")))).toContain(FAILURE);
      expect(await coverState()).toEqual({
        status: "ready", generationStatus: "none", failureReason: null, archived: 0, recipeTouched: false, cookbookTouched: false,
      });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      // No image provider is configured, so the processing cover is then marked failed.
      await stylize(database(), "https://example.com/raw.jpg");
      expect(await coverState()).toEqual({
        status: "ready",
        generationStatus: "failed",
        failureReason: "missing_image_provider_config",
        archived: 0,
        recipeTouched: true,
        cookbookTouched: true,
      });
    });

    it("leaves a cover archived after the failure check alone, touching nothing", async () => {
      await seedCover();

      await stylize(
        interleaved(() => run(`UPDATE "RecipeCover" SET "status" = 'archived', "archivedAt" = ? WHERE "id" = ?`, OLD, COVER)),
        " ",
      );

      expect(await coverState()).toEqual({
        status: "archived", generationStatus: "none", failureReason: null, archived: 1, recipeTouched: false, cookbookTouched: false,
      });
    });
  });

  describe("MCP add_recipe_to_cookbook", () => {
    async function memberships() {
      return (await rows<{ count: number }>(
        `SELECT COUNT(*) AS "count" FROM "RecipeInCookbook" WHERE "cookbookId" = ? AND "recipeId" = 'sca-pie'`,
        BOOK,
      ))[0]!.count;
    }

    async function bookTouched() {
      const [book] = await rows<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?`, BOOK);
      return book!.updatedAt !== OLD;
    }

    afterEach(async () => {
      await run(`DELETE FROM "RecipeInCookbook" WHERE "cookbookId" = ? AND "recipeId" = 'sca-pie'`, BOOK);
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, BOOK);
    });

    it("adds the membership and touches the cookbook together, or neither", async () => {
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${BOOK}'`);

      expect(String(await rejection(callSpoonjoyApiOperation("add_recipe_to_cookbook", { cookbookId: BOOK, recipeId: "sca-pie" }, mcp()))))
        .toContain(FAILURE);
      expect(await memberships()).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(callSpoonjoyApiOperation("add_recipe_to_cookbook", { cookbookId: BOOK, recipeId: "sca-pie" }, mcp()))
        .resolves.toMatchObject({ added: true });
      expect(await memberships()).toBe(1);
      expect(await bookTouched()).toBe(true);
    });

    it("answers 'already in the cookbook' when another add lands between the check and the write", async () => {
      const added = await callSpoonjoyApiOperation(
        "add_recipe_to_cookbook",
        { cookbookId: BOOK, recipeId: "sca-pie" },
        mcp(interleaved(() => run(
          `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
           VALUES ('sca-pie-membership', ?, 'sca-pie', ?, ?, ?)`,
          BOOK, CHEF, OLD, OLD,
        ))),
      );

      expect(added).toMatchObject({ added: false, cookbook: { id: BOOK, recipeCount: 1 } });
      expect(await memberships()).toBe(1);
      expect(await bookTouched()).toBe(true);
    });
  });
});
