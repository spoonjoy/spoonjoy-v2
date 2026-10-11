import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { d1WriteOnceKey } from "../../../app/lib/d1-write-once.server";
import { putShoppingListItemOnceOnD1 } from "../../../app/lib/shopping-list-d1-actions.server";
import { flakyD1 } from "../../helpers/flaky-d1";
import { applyRepositoryMigrations } from "./repository-migrations";

// The REST shopping item add (POST /api/v1/shopping-list/items) against Wrangler's real D1
// (workerd), with the connection failing after the batch committed or with the batch landing
// late. Quantities add up, so each mutation must add exactly once.

const CHEF = "api-shopping-retry-chef";
const LIST = "api-shopping-retry-list";
const REF = "api-shopping-retry-lemons";
const OLD = "2026-01-01T00:00:00.000Z";
const ADD_BATCH = /INSERT INTO "ShoppingListItem"/;

function database(): D1Database {
  return env.DB as D1Database;
}

async function quantity(): Promise<number | null> {
  const row = await database().prepare(`SELECT "quantity" FROM "ShoppingListItem" WHERE "shoppingListId" = ?`).bind(LIST).first<{ quantity: number }>();
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
    itemId: `${LIST}-item`,
    writeKey,
    now: new Date(),
  });
}

describe("the REST shopping item add on Wrangler D1 when its connection drops", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    await database().batch([
      database().prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`)
        .bind(CHEF, `${CHEF}@example.com`, "api_shopping_retry_chef", OLD, OLD),
      database().prepare(`INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`)
        .bind(LIST, CHEF, OLD, OLD),
      database().prepare(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, 'api shopping retry lemons', ?)`)
        .bind(REF, OLD),
    ]);
  });

  it("adds each mutation once when one batch's answer was lost and another's landed late", async () => {
    const flaky = flakyD1(database());
    flaky.failNext(ADD_BATCH, "lost-answer");
    await expect(put(flaky.binding, "first", 2)).resolves.toBe(`${LIST}-item`);
    expect(await quantity()).toBe(2);

    flaky.failNext(ADD_BATCH, "late");
    await expect(put(flaky.binding, "second", 3)).resolves.toBe(`${LIST}-item`);
    expect(await quantity()).toBe(5);

    // The client resubmits the first mutation: it adds nothing more.
    await put(flaky.binding, "first", 2);
    expect(flaky.failures()).toBe(2);
    expect(await quantity()).toBe(5);
  });
});
