// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1 } from "../helpers/flaky-d1";
import { D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import { createTestRecipe, createTestUser } from "../utils";

const spies = vi.hoisted(() => ({ getRequestDb: null as null | ReturnType<typeof vi.fn> }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  spies.getRequestDb = vi.fn(actual.getRequestDb);
  return { ...actual, getRequestDb: spies.getRequestDb };
});

const { action } = await import("~/routes/shopping-list");

let db: PrismaClient;
let d1: SqliteD1;

const SEEDED_AT = new Date("2026-10-01T09:00:00Z");

interface Kitchen {
  userId: string;
  cookie: string;
  listId: string;
  recipeId: string;
  deletedRecipeId: string;
  items: Record<string, string>;
}

// One list in every state an add has to handle: an active item, a checked one, a removed one and
// an item without a unit, plus a recipe that overlaps the list and repeats an ingredient.
async function seedKitchen(): Promise<Kitchen> {
  const user = await db.user.create({ data: createTestUser() });
  const [cups, tbsp] = await Promise.all(["cups", "tbsp"].map((name) => db.unit.create({ data: { name } })));
  const [flour, eggs, milk, salt, butter, pepper] = await Promise.all(
    ["flour", "eggs", "milk", "salt", "butter", "pepper"].map((name) => db.ingredientRef.create({ data: { name } })),
  );
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  const item = (data: Record<string, unknown>) =>
    db.shoppingListItem.create({ data: { shoppingListId: list.id, updatedAt: SEEDED_AT, ...data } as never });
  // Ids run against list order, and salt and pepper tie on sort index with pepper changed first
  // but its id sorting last, so renumbering has to order by sort index, then last change, then id.
  const flourItem = await item({ id: `${user.id}-4`, ingredientRefId: flour!.id, unitId: cups!.id, quantity: 2, sortIndex: 0, categoryKey: "produce" });
  const eggsItem = await item({ id: `${user.id}-3`, ingredientRefId: eggs!.id, quantity: 6, sortIndex: 1, checked: true, checkedAt: SEEDED_AT });
  const milkItem = await item({ id: `${user.id}-2`, ingredientRefId: milk!.id, unitId: cups!.id, quantity: 1, sortIndex: 2, deletedAt: SEEDED_AT });
  const saltItem = await item({ id: `${user.id}-1`, ingredientRefId: salt!.id, quantity: null, sortIndex: 2 });
  // The unique index does not cover a null unit, so an item without one can also have a removed
  // copy; an add goes to the active one.
  await item({ id: `${user.id}-6`, ingredientRefId: salt!.id, quantity: 9, sortIndex: 0, deletedAt: SEEDED_AT });
  const pepperItem = await item({ id: `${user.id}-5`, ingredientRefId: pepper!.id, quantity: 1, sortIndex: 2, updatedAt: new Date(SEEDED_AT.getTime() - 60_000) });

  const recipe = await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Pancakes" } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 1, description: "Mix" } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 2, description: "Fry" } });
  await db.ingredient.createMany({
    data: [
      { recipeId: recipe.id, stepNum: 1, quantity: 1, unitId: cups!.id, ingredientRefId: flour!.id },
      { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: cups!.id, ingredientRefId: milk!.id },
      { recipeId: recipe.id, stepNum: 2, quantity: 0.5, unitId: cups!.id, ingredientRefId: flour!.id },
      { recipeId: recipe.id, stepNum: 2, quantity: 3, unitId: tbsp!.id, ingredientRefId: butter!.id },
      // "Pepper to taste": no amount, so the list item has no quantity.
      { recipeId: recipe.id, stepNum: 2, quantity: 0, unitId: tbsp!.id, ingredientRefId: pepper!.id },
    ],
  });
  const deletedRecipe = await db.recipe.create({ data: { ...createTestRecipe(user.id), deletedAt: SEEDED_AT } });

  return {
    userId: user.id,
    cookie: (await createUserSessionCookie(user.id)).split(";")[0]!,
    listId: list.id,
    recipeId: recipe.id,
    deletedRecipeId: deletedRecipe.id,
    items: { flour: flourItem.id, eggs: eggsItem.id, milk: milkItem.id, salt: saltItem.id, pepper: pepperItem.id },
  };
}

type Step = Record<string, string> | ((kitchen: Kitchen) => Record<string, string>);

async function submit(kitchen: Kitchen, fields: Record<string, string>, env: Record<string, unknown> | null) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return action({
    request: new UndiciRequest("http://localhost:3000/shopping-list", {
      method: "POST",
      headers: { Cookie: kitchen.cookie },
      body: form,
    }),
    context: { cloudflare: { env } },
    params: {},
  } as never);
}

/** The list as a shopper sees it, without ids or timestamps. */
async function snapshot(kitchen: Kitchen) {
  const items = await db.shoppingListItem.findMany({
    where: { shoppingListId: kitchen.listId },
    include: { ingredientRef: true, unit: true },
  });
  return {
    items: items
      .map((item) => ({
        name: `${item.ingredientRef.name}${item.unit ? ` (${item.unit.name})` : ""}`,
        quantity: item.quantity,
        checked: item.checked,
        checkedAt: item.checkedAt !== null,
        deleted: item.deletedAt !== null,
        sortIndex: item.sortIndex,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        touched: item.updatedAt.getTime() > SEEDED_AT.getTime(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || Number(left.deleted) - Number(right.deleted)),
    lists: await db.shoppingList.count({ where: { authorId: kitchen.userId } }),
    ingredientRefs: (await db.ingredientRef.findMany({ select: { name: true } })).map(({ name }) => name).sort(),
    units: (await db.unit.findMany({ select: { name: true } })).map(({ name }) => name).sort(),
  };
}

/** Runs the same submissions on Prisma and on D1, from the same seeded list, and returns both results. */
async function onBothPaths(steps: Step[]) {
  const results: Array<{ responses: unknown[]; state: Awaited<ReturnType<typeof snapshot>> }> = [];
  for (const env of [null, { DB: d1.binding }]) {
    await cleanupDatabase();
    const kitchen = await seedKitchen();
    spies.getRequestDb!.mockClear();
    const responses: unknown[] = [];
    for (const step of steps) {
      const fields = typeof step === "function" ? step(kitchen) : step;
      responses.push(await submit(kitchen, fields, env).then(
        (result) => (result as { data?: unknown } | null)?.data ?? result,
        (error: unknown) => (error instanceof Response ? { status: error.status } : Promise.reject(error)),
      ));
    }
    if (env) expect(spies.getRequestDb).not.toHaveBeenCalled();
    else expect(spies.getRequestDb).toHaveBeenCalled();
    results.push({ responses, state: await snapshot(kitchen) });
  }
  const [prisma, onD1] = results;
  expect(onD1).toEqual(prisma);
  return onD1!;
}

function item(state: Awaited<ReturnType<typeof snapshot>>, name: string) {
  return state.items.find((entry) => entry.name === name);
}

describe("shopping list actions on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("adds typed items as the Prisma path does: to an active, a checked and a removed item, and as new ones", async () => {
    const { responses, state } = await onBothPaths([
      { intent: "addItem", ingredientName: "Flour", unitName: "Cups", quantity: "1" },
      { intent: "addItem", ingredientName: "eggs", quantity: "2" },
      { intent: "addItem", ingredientName: "milk", unitName: "cups", quantity: "4" },
      { intent: "addItem", ingredientName: "Basil", unitName: "Bunch", quantity: "1" },
      { intent: "addItem", ingredientName: "salt", quantity: "" },
    ]);

    expect(responses).toEqual(Array(5).fill({ success: true, intent: "addItem" }));
    // An active item adds in place, and the typed item's resolved category replaces its own.
    const flourCategory = resolveIngredientAffordance("Flour", null, null).categoryKey;
    expect(flourCategory).not.toBe("produce");
    expect(item(state, "flour (cups)")).toMatchObject({ quantity: 3, sortIndex: 0, categoryKey: flourCategory, touched: true });
    // A checked item adds on top, unchecks and moves to the end.
    expect(item(state, "eggs")).toMatchObject({ quantity: 8, checked: false, checkedAt: false, sortIndex: 3 });
    // A removed item restarts from the added amount and comes back at the end.
    expect(item(state, "milk (cups)")).toMatchObject({ quantity: 4, deleted: false, sortIndex: 4 });
    // A new ingredient and unit are created, and the item goes last.
    expect(item(state, "basil (bunch)")).toMatchObject({ quantity: 1, sortIndex: 5, checked: false });
    expect(state.ingredientRefs).toContain("basil");
    expect(state.units).toContain("bunch");
    // No quantity keeps the stored one, on the active salt; its removed copy stays removed.
    expect(state.items.filter((entry) => entry.name === "salt")).toEqual([
      expect.objectContaining({ quantity: null, sortIndex: 2, deleted: false, touched: true }),
      expect.objectContaining({ quantity: 9, deleted: true, touched: false }),
    ]);
    expect(state.lists).toBe(1);
  });

  it("adds a recipe as the Prisma path does: scaled, combined by identity, and onto the end", async () => {
    const { responses, state } = await onBothPaths([
      (kitchen) => ({ intent: "addFromRecipe", recipeId: kitchen.recipeId, scaleFactor: "2" }),
      (kitchen) => ({ intent: "addFromRecipe", recipeId: kitchen.deletedRecipeId }),
      { intent: "addFromRecipe", recipeId: "no-such-recipe" },
    ]);

    expect(responses).toEqual([{ success: true, intent: "addFromRecipe" }, { status: 404 }, { status: 404 }]);
    // 1 + 0.5 cups of flour, doubled, added to the 2 already on the list; a recipe keeps the
    // item's own category.
    expect(item(state, "flour (cups)")).toMatchObject({ quantity: 5, sortIndex: 0, categoryKey: "produce" });
    // The removed milk restarts from the recipe's doubled 2 cups.
    expect(item(state, "milk (cups)")).toMatchObject({ quantity: 4, deleted: false, sortIndex: 3 });
    expect(item(state, "butter (tbsp)")).toMatchObject({ quantity: 6, sortIndex: 4 });
    expect(item(state, "pepper (tbsp)")).toMatchObject({ quantity: null, sortIndex: 5 });
    expect(item(state, "eggs")).toMatchObject({ checked: true, touched: false });
  });

  it("checks, unchecks, removes and clears as the Prisma path does, closing the gaps", async () => {
    const { state } = await onBothPaths([
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.salt!, nextChecked: "true" }),
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.pepper!, nextChecked: "true" }),
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.flour!, nextChecked: "true" }),
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.flour!, nextChecked: "false" }),
      // Saying no target state is refused, and leaves salt checked.
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.salt! }),
      (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.eggs!, nextChecked: "false" }),
      (kitchen) => ({ intent: "removeItem", itemId: kitchen.items.flour! }),
      { intent: "toggleCheck" },
      { intent: "removeItem" },
      { intent: "noSuchIntent" },
    ]);

    // Flour left the list, so the rest close up: eggs, then salt and pepper, which tie on sort index
    // and now go in the order they were checked.
    expect(item(state, "flour (cups)")).toMatchObject({ deleted: true, checked: false });
    expect(item(state, "eggs")).toMatchObject({ checked: false, checkedAt: false, sortIndex: 0 });
    expect(item(state, "pepper")).toMatchObject({ checked: true, checkedAt: true, sortIndex: 2 });
    expect(item(state, "salt")).toMatchObject({ checked: true, checkedAt: true, sortIndex: 1 });

    const cleared = await onBothPaths([{ intent: "clearCompleted" }]);
    // The checked eggs leave and pepper, changed before salt, closes up to 1. Only rows whose
    // position changes are written: flour stays at 0 and salt at 2.
    expect(item(cleared.state, "eggs")).toMatchObject({ deleted: true });
    expect(item(cleared.state, "flour (cups)")).toMatchObject({ deleted: false, sortIndex: 0, touched: false });
    expect(item(cleared.state, "pepper")).toMatchObject({ deleted: false, sortIndex: 1, touched: true });
    expect(item(cleared.state, "salt")).toMatchObject({ deleted: false, sortIndex: 2, touched: false });

    const empty = await onBothPaths([{ intent: "clearAll" }]);
    expect(empty.state.items.filter((entry) => !entry.deleted)).toEqual([]);
  });

  it("creates the list on a chef's first write", async () => {
    await cleanupDatabase();
    const kitchen = await seedKitchen();
    await db.shoppingList.delete({ where: { id: kitchen.listId } });

    await expect(submit(kitchen, { intent: "addItem", ingredientName: "rice", unitName: "cups", quantity: "1" }, { DB: d1.binding }))
      .resolves.toMatchObject({ data: { success: true } });

    const list = await db.shoppingList.findUniqueOrThrow({ where: { authorId: kitchen.userId }, include: { items: true } });
    expect(list.items).toEqual([expect.objectContaining({ quantity: 1, sortIndex: 0 })]);
  });

  it("answers 404 when the list is deleted while an item is being added", async () => {
    const kitchen = await seedKitchen();
    let deleted = false;
    const deleting: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        const isAdd = (statements as unknown as Array<{ sql: string }>).some((statement) => statement.sql.includes('"IngredientRef"'));
        if (isAdd && !deleted) {
          deleted = true;
          await db.shoppingList.delete({ where: { id: kitchen.listId } });
        }
        return d1.binding.batch(statements as never);
      },
    };

    await expect(submit(kitchen, { intent: "addItem", ingredientName: "rice", unitName: "cups", quantity: "1" }, { DB: deleting }))
      .rejects.toMatchObject({ status: 404 });
    expect(deleted).toBe(true);
  });

  it("writes each intent in one D1 batch after the list lookup", async () => {
    const kitchen = await seedKitchen();
    const env = { DB: d1.binding };
    const intents: Array<Record<string, string>> = [
      { intent: "addItem", ingredientName: "rice", unitName: "cups", quantity: "1" },
      { intent: "toggleCheck", itemId: kitchen.items.salt!, nextChecked: "true" },
      { intent: "removeItem", itemId: kitchen.items.salt! },
      { intent: "clearCompleted" },
      { intent: "clearAll" },
    ];
    for (const fields of intents) {
      const before = d1.roundTrips();
      await submit(kitchen, fields, env);
      // The session check, the list lookup, then the intent's one batch.
      expect(d1.roundTrips() - before).toBe(3);
    }
    const before = d1.roundTrips();
    await submit(kitchen, { intent: "addFromRecipe", recipeId: kitchen.recipeId }, env);
    // The recipe's ingredients are read, then written, each in one batch.
    expect(d1.roundTrips() - before).toBe(4);
  });

  it("adds a recipe with no ingredients without writing", async () => {
    const kitchen = await seedKitchen();
    const empty = await db.recipe.create({ data: createTestRecipe(kitchen.userId) });
    const before = d1.roundTrips();

    await expect(submit(kitchen, { intent: "addFromRecipe", recipeId: empty.id }, { DB: d1.binding }))
      .resolves.toMatchObject({ data: { success: true } });
    expect(d1.roundTrips() - before).toBe(3);
  });
});

describe("shopping list actions when D1's connection drops", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  const WRITES = /UPDATE "ShoppingListItem"/;
  const ENSURE_LIST = /INSERT INTO "ShoppingList" /;
  const steps: Step[] = [
    (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.pepper!, nextChecked: "true" }),
    (kitchen) => ({ intent: "toggleCheck", itemId: kitchen.items.eggs!, nextChecked: "false" }),
    (kitchen) => ({ intent: "removeItem", itemId: kitchen.items.flour! }),
    { intent: "clearCompleted" },
    { intent: "clearAll" },
  ];

  /** Runs the steps, each write's first batch failing as `outcome` when given, and returns the list. */
  async function runSteps(outcome?: "lost" | "lost-answer") {
    await cleanupDatabase();
    const kitchen = await seedKitchen();
    const flaky = flakyD1(d1.binding);
    for (const step of steps) {
      if (outcome) flaky.failNext(WRITES, outcome);
      if (outcome) flaky.failNext(ENSURE_LIST, outcome);
      await submit(kitchen, typeof step === "function" ? step(kitchen) : step, { DB: flaky.binding });
    }
    const { items } = await snapshot(kitchen);
    return { items: items.map(({ touched: _touched, ...entry }) => entry), failures: flaky.failures() };
  }

  it("ends as one clean run would when each write's answer was lost after it committed, or it never arrived", async () => {
    const clean = await runSteps();
    const answersLost = await runSteps("lost-answer");
    const writesLost = await runSteps("lost");

    // Each step's list lookup and its write both failed once.
    expect(answersLost).toEqual({ ...clean, failures: 2 * steps.length });
    expect(writesLost).toEqual({ ...clean, failures: 2 * steps.length });
  });

  it("answers a retryable 503 the page shows when every try fails, writing nothing", async () => {
    const kitchen = await seedKitchen();
    const before = await snapshot(kitchen);
    const flaky = flakyD1(d1.binding);
    flaky.failNext(WRITES, "lost", "lost", "lost", "lost");

    const answer = await submit(kitchen, { intent: "removeItem", itemId: kitchen.items.flour! }, { DB: flaky.binding }) as unknown as {
      data: unknown;
      init: { status: number };
    };

    expect(answer.init.status).toBe(503);
    expect(answer.data).toEqual({ intent: "removeItem", error: D1_WRITE_UNAVAILABLE_MESSAGE, errorCode: "temporarily_unavailable", retryable: true });
    expect(await snapshot(kitchen)).toEqual(before);
  });

  // An add's batch claims its write-once key first; the adds run only under that claim.
  const ADD = /"ApiIdempotencyKey"[\s\S]*"ShoppingListItem"/;
  const addSteps: Step[] = [
    { intent: "addItem", ingredientName: "Flour", unitName: "Cups", quantity: "1", writeToken: "add-flour-token" },
    { intent: "addItem", ingredientName: "eggs", quantity: "2" },
    { intent: "addItem", ingredientName: "Basil", unitName: "Bunch", quantity: "1", writeToken: "add-basil-token" },
    (kitchen) => ({ intent: "addFromRecipe", recipeId: kitchen.recipeId, scaleFactor: "2", writeToken: "add-recipe-token" }),
    (kitchen) => ({ intent: "addFromRecipe", recipeId: kitchen.recipeId }),
  ];

  /** Runs the add steps, each add's batch failing first as `outcome` when given, and returns the list. */
  async function runAdds(outcome?: "lost" | "lost-answer" | "late") {
    await cleanupDatabase();
    const kitchen = await seedKitchen();
    const flaky = flakyD1(d1.binding);
    const responses: unknown[] = [];
    for (const step of addSteps) {
      if (outcome) flaky.failNext(ADD, outcome);
      const result = await submit(kitchen, typeof step === "function" ? step(kitchen) : step, { DB: flaky.binding });
      responses.push((result as { data?: unknown }).data);
    }
    const { items, ingredientRefs, units } = await snapshot(kitchen);
    return {
      responses,
      items: items.map(({ touched: _touched, ...entry }) => entry),
      ingredientRefs,
      units,
      failures: flaky.failures(),
    };
  }

  it("adds each item and recipe once when an add's answer was lost, it never arrived, or it landed late", async () => {
    const clean = await runAdds();
    // 2 on the list, 1 typed, 1.5 cups doubled by the first recipe add and 1.5 by the second.
    expect(clean.items.find((entry) => entry.name === "flour (cups)")).toMatchObject({ quantity: 7.5 });

    for (const outcome of ["lost", "lost-answer", "late"] as const) {
      // A late batch lands just before the next add's, so the last add's late batch is not in yet.
      const run = await runAdds(outcome);
      expect({ outcome, ...run }).toEqual({ outcome, ...clean, failures: addSteps.length });
    }
  });

  it("adds once for a resubmit of the same form, and again for a changed form or a new token", async () => {
    const kitchen = await seedKitchen();
    const env = { DB: d1.binding };
    const lemons = { intent: "addItem", ingredientName: "lemon", quantity: "2", writeToken: "lemon-form-1" };

    // A double tap, and a resubmit after a 503 whose write in fact committed.
    await submit(kitchen, lemons, env);
    await expect(submit(kitchen, lemons, env)).resolves.toMatchObject({ data: { success: true, intent: "addItem" } });
    expect(item(await snapshot(kitchen), "lemon")).toMatchObject({ quantity: 2 });

    // The chef changed the amount before submitting again: a different add.
    await submit(kitchen, { ...lemons, quantity: "3" }, env);
    expect(item(await snapshot(kitchen), "lemon")).toMatchObject({ quantity: 5 });

    // The form's next token, after a success: another add.
    await submit(kitchen, { ...lemons, writeToken: "lemon-form-2" }, env);
    expect(item(await snapshot(kitchen), "lemon")).toMatchObject({ quantity: 7 });

    // The same recipe form twice adds its ingredients once.
    const recipeForm = { intent: "addFromRecipe", recipeId: kitchen.recipeId, writeToken: "recipe-form-1" };
    await submit(kitchen, recipeForm, env);
    await submit(kitchen, recipeForm, env);
    expect(item(await snapshot(kitchen), "butter (tbsp)")).toMatchObject({ quantity: 3 });
  });

  it("answers a retryable 503 for an add when every try fails, writing nothing, and the resubmit adds once", async () => {
    const kitchen = await seedKitchen();
    const before = await snapshot(kitchen);
    const flaky = flakyD1(d1.binding);
    const lemons = { intent: "addItem", ingredientName: "lemon", quantity: "2", writeToken: "lemon-503-token" };
    flaky.failNext(ADD, "lost", "lost", "lost", "late");

    const answer = await submit(kitchen, lemons, { DB: flaky.binding }) as unknown as { data: unknown; init: { status: number } };

    expect(answer.init.status).toBe(503);
    expect(answer.data).toMatchObject({ intent: "addItem", errorCode: "temporarily_unavailable", retryable: true });
    expect(await snapshot(kitchen)).toEqual(before);

    // The last try lands while the chef resubmits the same form: the lemons go on once.
    await submit(kitchen, lemons, { DB: flaky.binding });
    expect(item(await snapshot(kitchen), "lemon")).toMatchObject({ quantity: 2 });
  });

  it("drops the chef's expired keys for the same add, and keeps the rest", async () => {
    const kitchen = await seedKitchen();
    const key = (id: string, operation: string, expiresAt: Date) => db.apiIdempotencyKey.create({
      data: { id, userId: kitchen.userId, clientKey: `chef:${kitchen.userId}`, key: id, operation, requestHash: "x", expiresAt },
    });
    const past = new Date(Date.now() - 1000);
    await key("expired-add", "shopping_list.add_item", past);
    await key("live-add", "shopping_list.add_item", new Date(Date.now() + 60_000));
    await key("expired-fork", "web.fork_recipe", past);

    await submit(kitchen, { intent: "addItem", ingredientName: "lemon", quantity: "2" }, { DB: d1.binding });

    const ids = (await db.apiIdempotencyKey.findMany({ where: { userId: kitchen.userId }, select: { id: true, operation: true } }))
      .map(({ id, operation }) => (id.startsWith("expired") || id.startsWith("live") ? id : operation)).sort();
    expect(ids).toEqual(["expired-fork", "live-add", "shopping_list.add_item"]);
  });

  it("passes any other failure through", async () => {
    const kitchen = await seedKitchen();
    const broken: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      batch: async () => { throw new Error("D1 is down hard"); },
    };
    await expect(submit(kitchen, { intent: "clearAll" }, { DB: broken })).rejects.toThrow("D1 is down hard");
  });
});

