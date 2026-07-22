import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

const mocked = vi.hoisted(() => ({
  db: null as PrismaClientType | null,
}));

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

const { action } = await import("~/routes/api.v1.$");

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

function withD1TransactionGuard(
  db: PrismaClientType,
  interceptArrayTransaction?: (
    operations: unknown[],
    execute: () => unknown,
  ) => unknown,
): PrismaClientType {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "$transaction") {
        return Reflect.get(target, property, receiver);
      }

      return (input: unknown, ...rest: unknown[]) => {
        if (typeof input === "function") {
          throw new Error("D1 interactive transactions are not supported");
        }

        const transaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
        const execute = () => transaction.apply(target, [input, ...rest]);
        return interceptArrayTransaction
          ? interceptArrayTransaction(input as unknown[], execute)
          : execute();
      };
    },
  });
}

describe("API v1 shopping-list mutations on D1", () => {
  let db: PrismaClientType;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    mocked.db = withD1TransactionGuard(db);
  });

  afterEach(async () => {
    mocked.db = null;
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("creates idempotent shopping-list items without interactive transactions", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "D1 shopping writer", {
      scopes: ["shopping_list:write"],
    });
    await db.shoppingList.create({ data: { authorId: user.id } });

    const response = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": "req_d1_shopping",
        },
        body: JSON.stringify({
          clientMutationId: "d1-create-item",
          name: `D1 Eggs ${faker.string.alphanumeric(6)}`,
          quantity: 12,
        }),
      }) as unknown as Request,
      "shopping-list/items",
    ));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_d1_shopping",
      data: {
        created: true,
        mutation: { clientMutationId: "d1-create-item", replayed: false },
      },
    });
  });

  it("runs bulk shopping-list recipe and clear mutations without interactive transactions", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "D1 shopping bulk writer", {
      scopes: ["shopping_list:write"],
    });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    const recipe = await db.recipe.create({ data: createTestRecipe(user.id) });
    await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        stepTitle: "Gather",
        description: "Gather D1 ingredients.",
      },
    });
    const unit = await getOrCreateUnit(db, `d1 unit ${faker.string.alphanumeric(6)}`.toLowerCase());
    const ingredientRef = await getOrCreateIngredientRef(db, `d1 ingredient ${faker.string.alphanumeric(6)}`.toLowerCase());
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 2,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });
    const checkedRef = await getOrCreateIngredientRef(db, `d1 checked ${faker.string.alphanumeric(6)}`.toLowerCase());
    await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: checkedRef.id,
        checked: true,
        checkedAt: new Date(),
        sortIndex: 0,
      },
    });

    const addFromRecipe = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": "req_d1_shopping_add_recipe",
        },
        body: JSON.stringify({
          clientMutationId: "d1-add-recipe",
          recipeId: recipe.id,
          scaleFactor: 1,
        }),
      }) as unknown as Request,
      "shopping-list/add-from-recipe",
    ));

    expect(addFromRecipe.status).toBe(200);
    await expect(addFromRecipe.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_d1_shopping_add_recipe",
      data: {
        created: 1,
        updated: 0,
        mutation: { clientMutationId: "d1-add-recipe", replayed: false },
      },
    });

    const clearCompleted = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/shopping-list/clear-completed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": "req_d1_shopping_clear_completed",
        },
        body: JSON.stringify({ clientMutationId: "d1-clear-completed" }),
      }) as unknown as Request,
      "shopping-list/clear-completed",
    ));

    expect(clearCompleted.status).toBe(200);
    await expect(clearCompleted.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_d1_shopping_clear_completed",
      data: {
        removed: 1,
        mutation: { clientMutationId: "d1-clear-completed", replayed: false },
      },
    });

    const clearAll = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/shopping-list/clear-all", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": "req_d1_shopping_clear_all",
        },
        body: JSON.stringify({ clientMutationId: "d1-clear-all" }),
      }) as unknown as Request,
      "shopping-list/clear-all",
    ));

    expect(clearAll.status).toBe(200);
    await expect(clearAll.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_d1_shopping_clear_all",
      data: {
        removed: 1,
        mutation: { clientMutationId: "d1-clear-all", replayed: false },
      },
    });
  });

  it("rebuilds and retries the complete array transaction once after a uniqueness conflict", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "D1 shopping retry writer", {
      scopes: ["shopping_list:write"],
    });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    const recipe = await db.recipe.create({ data: createTestRecipe(user.id) });
    await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        stepTitle: "Retry",
        description: "Retry every coalesced mutation.",
      },
    });
    const unit = await getOrCreateUnit(db, `d1 retry unit ${faker.string.alphanumeric(6)}`.toLowerCase());
    const firstRef = await getOrCreateIngredientRef(db, `d1 retry first ${faker.string.alphanumeric(6)}`.toLowerCase());
    const secondRef = await getOrCreateIngredientRef(db, `d1 retry second ${faker.string.alphanumeric(6)}`.toLowerCase());
    await db.ingredient.createMany({
      data: [
        {
          id: "compat-d1-retry-a",
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: firstRef.id,
        },
        {
          id: "compat-d1-retry-z",
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: secondRef.id,
        },
      ],
    });

    const attempts: unknown[][] = [];
    mocked.db = withD1TransactionGuard(db, async (operations, execute) => {
      attempts.push(operations);
      if (attempts.length === 1) {
        await db.shoppingListItem.create({
          data: {
            id: "compat-d1-retry-race-winner",
            shoppingListId: list.id,
            ingredientRefId: firstRef.id,
            unitId: unit.id,
            quantity: 4,
            sortIndex: 0,
          },
        });
        throw Object.assign(new Error("Unique constraint failed on the fields"), {
          code: "P2002",
          meta: {
            modelName: "ShoppingListItem",
            target: ["shoppingListId", "unitId", "ingredientRefId"],
          },
        });
      }
      return execute();
    });
    const request = (requestId: string) => new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        clientMutationId: "compat-d1-retry",
        recipeId: recipe.id,
      }),
    }) as unknown as Request;

    const response = await action(routeArgs(request("req_compat_d1_retry"), "shopping-list/add-from-recipe"));
    const payload = await response.json() as any;
    expect(response.status).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(["data", "ok", "requestId"]);
    expect(Object.keys(payload.data).sort()).toEqual(["created", "items", "mutation", "recipe", "updated"]);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_compat_d1_retry",
      data: {
        created: 1,
        updated: 1,
        mutation: { clientMutationId: "compat-d1-retry", replayed: false },
      },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toHaveLength(2);
    expect(attempts[1]).toHaveLength(2);
    expect(attempts[1]).not.toBe(attempts[0]);
    expect(attempts[1][0]).not.toBe(attempts[0][0]);
    await expect(db.shoppingListItem.findUniqueOrThrow({
      where: { id: "compat-d1-retry-race-winner" },
    })).resolves.toMatchObject({ quantity: 5, deletedAt: null });
    expect(await db.shoppingListItem.count({
      where: {
        shoppingListId: list.id,
        ingredientRefId: { in: [firstRef.id, secondRef.id] },
      },
    })).toBe(2);

    const replay = await action(routeArgs(request("req_compat_d1_retry_replay"), "shopping-list/add-from-recipe"));
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_compat_d1_retry_replay",
      data: { mutation: { clientMutationId: "compat-d1-retry", replayed: true } },
    });
    expect(attempts).toHaveLength(2);
  });
});
