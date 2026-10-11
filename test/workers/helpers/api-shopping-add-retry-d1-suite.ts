import { env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { d1WriteOnceKey } from "../../../app/lib/d1-write-once.server";
import { getDb } from "../../../app/lib/db.server";
import { callSpoonjoyApiOperation } from "../../../app/lib/spoonjoy-api.server";
import { putShoppingListItemOnceOnD1 } from "../../../app/lib/shopping-list-d1-actions.server";
import { flakyD1 } from "../../helpers/flaky-d1";
import { applyRepositoryMigrations } from "./repository-migrations";

// The shopping adds (REST and tool, one item or a recipe) against Wrangler's real D1 (workerd),
// with the connection failing after the batch committed or with the batch landing late.
// Quantities add up, so each add must land exactly once.

const CHEF = "api-shopping-retry-chef";
const EMAIL = "api-shopping-retry-chef@example.com";
const RECIPE = "api-shopping-retry-recipe";
const LIST = "api-shopping-retry-list";
const REF = "api-shopping-retry-lemons";
const OLD = "2026-01-01T00:00:00.000Z";
const ADD_BATCH = /INSERT INTO "ShoppingListItem"/;

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function quantity(ref = REF): Promise<number | null> {
  const row = await database().prepare(`SELECT "quantity" FROM "ShoppingListItem" WHERE "shoppingListId" = ? AND "ingredientRefId" = ?`)
    .bind(LIST, ref).first<{ quantity: number }>();
  return row?.quantity ?? null;
}

async function put(binding: D1Database, mutation: string, amount: number) {
  const writeKey = await d1WriteOnceKey({ userId: CHEF, operation: "api_v1.shopping_item_create", token: mutation, request: { amount } });
  return putShoppingListItemOnceOnD1(binding as never, {
    shoppingListId: LIST,
    ingredientRefId: REF,
    unitId: null,
    quantity: amount,
    categoryKey: null,
    iconKey: null,
    itemId: `${LIST}-item-${mutation}`,
    writeKey,
    now: new Date(),
  });
}

describe("the REST shopping item add on Wrangler D1 when its connection drops", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    await database().batch([
      database().prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`)
        .bind(CHEF, EMAIL, "api_shopping_retry_chef", OLD, OLD),
      database().prepare(`INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`)
        .bind(LIST, CHEF, OLD, OLD),
      database().prepare(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, 'api shopping retry lemons', ?)`)
        .bind(REF, OLD),
      database().prepare(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES ('api-shopping-retry-sugar', 'api shopping retry sugar', ?)`)
        .bind(OLD),
      database().prepare(`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES ('api-shopping-retry-cup', 'api shopping retry cup', ?)`)
        .bind(OLD),
      database().prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "coverMode", "createdAt", "updatedAt") VALUES (?, 'Retry Bars', ?, 'auto', ?, ?)`)
        .bind(RECIPE, CHEF, OLD, OLD),
      database().prepare(`INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description", "updatedAt") VALUES ('api-shopping-retry-step', ?, 1, 'Mix', ?)`)
        .bind(RECIPE, OLD),
      database().prepare(`INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt") VALUES ('api-shopping-retry-ingredient', ?, 1, 2, 'api-shopping-retry-cup', 'api-shopping-retry-sugar', ?)`)
        .bind(RECIPE, OLD),
    ]);
    prisma = await getDb({ DB: database() });
  });

  it("adds each mutation once when one batch's answer was lost and another's landed late", async () => {
    const flaky = flakyD1(database());
    flaky.failNext(ADD_BATCH, "lost-answer");
    await expect(put(flaky.binding, "first", 2)).resolves.toEqual({ id: `${LIST}-item-first`, created: true });
    expect(await quantity()).toBe(2);

    flaky.failNext(ADD_BATCH, "late");
    await expect(put(flaky.binding, "second", 3)).resolves.toEqual({ id: `${LIST}-item-first`, created: false });
    expect(await quantity()).toBe(5);

    // The client resubmits the first mutation: it adds nothing more.
    await put(flaky.binding, "first", 2);
    expect(flaky.failures()).toBe(2);
    expect(await quantity()).toBe(5);
  });

  it("adds a recipe's ingredients once through the tool when the batch's answer was lost", async () => {
    const flaky = flakyD1(database());
    flaky.failNext(/INSERT INTO "ShoppingListItem"/, "lost-answer");

    const result = await callSpoonjoyApiOperation("add_recipe_to_shopping_list", { recipeId: RECIPE }, {
      db: prisma,
      env: { DB: flaky.binding } as never,
      principal: { id: CHEF, email: EMAIL, username: "api_shopping_retry_chef", source: "bearer", scopes: ["shopping_list:write"] },
    });

    expect(flaky.failures()).toBe(1);
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(await quantity("api-shopping-retry-sugar")).toBe(2);
  });
});
