// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The MCP and tool shopping adds on D1 when D1's connection drops. Quantities add up, so a
// retry within the call must add once; the call has no client key to make a resubmit safe.

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const ADD_BATCH = /INSERT INTO "ShoppingListItem"/;

let db: PrismaClient;
let d1: SqliteD1;
let principal: ApiPrincipal;
let listId: string;

function context(DB: unknown): SpoonjoyApiContext {
  return { db, principal, env: { DB } as never };
}

async function quantities() {
  const items = await db.shoppingListItem.findMany({ where: { shoppingListId: listId }, include: { ingredientRef: true } });
  return Object.fromEntries(items.map((item) => [item.ingredientRef.name, item.quantity]));
}

/** A recipe of 2 cups of flour and 3 eggs, with 1 cup of flour already on the list. */
async function seedRecipe() {
  const recipe = await db.recipe.create({ data: { title: "Once Bread", chefId: principal.id } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 1, description: "Mix" } });
  const cup = await db.unit.create({ data: { name: "once cup" } });
  const each = await db.unit.create({ data: { name: "once each" } });
  const flour = await db.ingredientRef.create({ data: { name: "once flour" } });
  const egg = await db.ingredientRef.create({ data: { name: "once egg" } });
  await db.ingredient.createMany({
    data: [
      { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: cup.id, ingredientRefId: flour.id },
      { recipeId: recipe.id, stepNum: 1, quantity: 3, unitId: each.id, ingredientRefId: egg.id },
    ],
  });
  await db.shoppingListItem.create({ data: { shoppingListId: listId, ingredientRefId: flour.id, unitId: cup.id, quantity: 1, sortIndex: 0 } });
  return recipe.id;
}

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
  const testUser = createTestUser();
  const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
  listId = (await db.shoppingList.create({ data: { authorId: user.id } })).id;
  principal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["shopping_list:write"] };
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("the add_shopping_list_item tool on D1", () => {
  it.each(OUTCOMES)("adds once, answering created, when the batch is %s", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, outcome);

    const result = await callSpoonjoyApiOperation("add_shopping_list_item", { name: "Limes", quantity: 2 }, context(flaky.binding));

    expect(flaky.failures()).toBe(1);
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(await quantities()).toEqual({ limes: 2 });
  });

  it("adds to an existing item once, answering updated, when the answer was lost", async () => {
    await callSpoonjoyApiOperation("add_shopping_list_item", { name: "Limes", quantity: 2 }, context(d1.binding));
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost-answer");

    const result = await callSpoonjoyApiOperation("add_shopping_list_item", { name: "Limes", quantity: 3 }, context(flaky.binding));

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(await quantities()).toEqual({ limes: 5 });
  });

  it("gives up with a retryable error, adding nothing, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost", "lost", "lost", "lost");

    await expect(callSpoonjoyApiOperation("add_shopping_list_item", { name: "Limes", quantity: 2 }, context(flaky.binding)))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await quantities()).toEqual({});
  });
});

describe("the add_recipe_to_shopping_list tool on D1", () => {
  it.each(OUTCOMES)("adds each ingredient once, answering the counts, when the batch is %s", async (outcome) => {
    const recipeId = await seedRecipe();
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, outcome);

    const result = await callSpoonjoyApiOperation("add_recipe_to_shopping_list", { recipeId }, context(flaky.binding));

    expect(flaky.failures()).toBe(1);
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(await quantities()).toEqual({ "once flour": 3, "once egg": 3 });
  });

  it("gives up with a retryable error, adding nothing, when every try is lost", async () => {
    const recipeId = await seedRecipe();
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost", "lost", "lost", "lost");

    await expect(callSpoonjoyApiOperation("add_recipe_to_shopping_list", { recipeId }, context(flaky.binding)))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await quantities()).toEqual({ "once flour": 1 });
  });
});
