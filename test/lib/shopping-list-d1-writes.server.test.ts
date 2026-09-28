// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// Adding a recipe to the shopping list with a D1 binding: the item writes go to D1 as one
// batch (through the SQLite-backed fake binding) and each existing item's quantity is added
// in SQL. Without a race the rows match the Prisma path; with another add landing between
// the reads and the batch, both amounts land.

let db: PrismaClient;
let d1: SqliteD1;

const OLD = new Date("2026-01-01T00:00:00.000Z");

async function owner(): Promise<{ principal: ApiPrincipal; listId: string }> {
  const testUser = createTestUser();
  const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  return {
    principal: { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["shopping_list:write"] },
    listId: list.id,
  };
}

function context(principal: ApiPrincipal, DB?: D1ReadDatabase): SpoonjoyApiContext {
  return { db, principal, env: DB ? { DB } : null };
}

/** A recipe using flour twice (coalesced), eggs, salt and sugar. */
async function seedRecipe(chefId: string) {
  const recipe = await db.recipe.create({ data: { title: "Parity Bread", chefId } });
  await db.recipeStep.createMany({
    data: [1, 2].map((stepNum) => ({ recipeId: recipe.id, stepNum, description: `Step ${stepNum}` })),
  });
  const cup = await db.unit.create({ data: { name: "parity cup" } });
  const each = await db.unit.create({ data: { name: "parity each" } });
  const refs = Object.fromEntries(await Promise.all(["flour", "egg", "salt", "sugar"].map(async (name) => [
    name,
    await db.ingredientRef.create({ data: { name: `parity ${name}` } }),
  ])));
  await db.ingredient.createMany({
    data: [
      { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: cup.id, ingredientRefId: refs.flour.id },
      { recipeId: recipe.id, stepNum: 2, quantity: 1, unitId: cup.id, ingredientRefId: refs.flour.id },
      { recipeId: recipe.id, stepNum: 1, quantity: 3, unitId: each.id, ingredientRefId: refs.egg.id },
      { recipeId: recipe.id, stepNum: 2, quantity: 1, unitId: each.id, ingredientRefId: refs.salt.id },
      { recipeId: recipe.id, stepNum: 2, quantity: 4, unitId: cup.id, ingredientRefId: refs.sugar.id },
    ],
  });
  return { recipeId: recipe.id, cupId: cup.id, eachId: each.id, refs };
}

/** Existing items: flour active, eggs checked, salt removed with no quantity; sugar is new. */
async function seedList(listId: string, seeded: Awaited<ReturnType<typeof seedRecipe>>) {
  await db.shoppingListItem.createMany({
    data: [
      { shoppingListId: listId, ingredientRefId: seeded.refs.flour.id, unitId: seeded.cupId, quantity: 1, sortIndex: 0, updatedAt: OLD },
      { shoppingListId: listId, ingredientRefId: seeded.refs.egg.id, unitId: seeded.eachId, quantity: 2, sortIndex: 1, checked: true, checkedAt: OLD, updatedAt: OLD },
      { shoppingListId: listId, ingredientRefId: seeded.refs.salt.id, unitId: seeded.eachId, quantity: null, sortIndex: 2, deletedAt: OLD, updatedAt: OLD },
    ],
  });
}

async function listRows(listId: string) {
  const items = await db.shoppingListItem.findMany({
    where: { shoppingListId: listId },
    include: { ingredientRef: true, unit: true },
    orderBy: { ingredientRef: { name: "asc" } },
  });
  return items.map((item) => ({
    name: item.ingredientRef.name,
    unit: item.unit?.name ?? null,
    quantity: item.quantity,
    checked: item.checked,
    checkedAt: item.checkedAt,
    deleted: item.deletedAt !== null,
    sortIndex: item.sortIndex,
    categoryKey: item.categoryKey,
    iconKey: item.iconKey,
    touched: item.updatedAt.getTime() > OLD.getTime(),
  }));
}

/** The binding, but `before` runs once just ahead of the first batch: another request's add. */
function interleaved(before: () => Promise<unknown>): D1ReadDatabase {
  let pending = true;
  return {
    prepare: (sql) => d1.binding.prepare(sql),
    async batch(statements) {
      if (pending) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements as never);
    },
  };
}

describe("adding a recipe to the shopping list on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("writes one batch that leaves the same rows as the Prisma path", async () => {
    const viaPrisma = await owner();
    const viaD1 = await owner();
    const seeded = await seedRecipe(viaPrisma.principal.id);
    await seedList(viaPrisma.listId, seeded);
    await seedList(viaD1.listId, seeded);

    const prismaResult = await callSpoonjoyApiOperation(
      "add_recipe_to_shopping_list",
      { recipeId: seeded.recipeId },
      context(viaPrisma.principal),
    );
    const before = d1.statements.length;
    const d1Result = await callSpoonjoyApiOperation(
      "add_recipe_to_shopping_list",
      { recipeId: seeded.recipeId },
      context(viaD1.principal, d1.binding),
    );

    expect(d1.statements.length - before).toBe(8);
    expect(d1Result).toMatchObject({ created: 1, updated: 3 });
    expect(prismaResult).toMatchObject({ created: 1, updated: 3 });
    const rows = await listRows(viaD1.listId);
    expect(rows).toEqual(await listRows(viaPrisma.listId));
    expect(rows.map((row) => [row.name, row.quantity, row.checked, row.deleted])).toEqual([
      ["parity egg", 5, false, false],
      ["parity flour", 4, false, false],
      ["parity salt", 1, false, false],
      ["parity sugar", 4, false, false],
    ]);
  });

  it("keeps both amounts when another add lands between the reads and the batch", async () => {
    const chef = await owner();
    const seeded = await seedRecipe(chef.principal.id);
    await seedList(chef.listId, seeded);

    await callSpoonjoyApiOperation(
      "add_recipe_to_shopping_list",
      { recipeId: seeded.recipeId },
      context(chef.principal, interleaved(() => callSpoonjoyApiOperation(
        "add_recipe_to_shopping_list",
        { recipeId: seeded.recipeId },
        context(chef.principal, d1.binding),
      ))),
    );

    const rows = await listRows(chef.listId);
    expect(rows.map((row) => [row.name, row.quantity, row.deleted])).toEqual([
      ["parity egg", 2 + 3 + 3, false],
      ["parity flour", 1 + 3 + 3, false],
      ["parity salt", 1 + 1, false],
      ["parity sugar", 4 + 4, false],
    ]);
    // The losing batch saw sugar missing, found it created, and was built again from fresh reads.
    expect(await db.shoppingListItem.count({ where: { shoppingListId: chef.listId } })).toBe(4);
  });

  it("adds to the item another add created first instead of creating a second one", async () => {
    const chef = await owner();
    const seeded = await seedRecipe(chef.principal.id);

    await callSpoonjoyApiOperation(
      "add_recipe_to_shopping_list",
      { recipeId: seeded.recipeId },
      context(chef.principal, interleaved(() => callSpoonjoyApiOperation(
        "add_recipe_to_shopping_list",
        { recipeId: seeded.recipeId },
        context(chef.principal, d1.binding),
      ))),
    );

    // Every item was missing when this add read the list; the create guards stop its batch
    // and the retry adds to the items the other add created.
    const rows = await listRows(chef.listId);
    expect(rows.map((row) => [row.name, row.unit, row.quantity])).toEqual([
      ["parity egg", "parity each", 6],
      ["parity flour", "parity cup", 6],
      ["parity salt", "parity each", 2],
      ["parity sugar", "parity cup", 8],
    ]);
  });

  it("adds a single item's quantity to what the row holds when the statement runs", async () => {
    const chef = await owner();
    const seeded = await seedRecipe(chef.principal.id);
    await seedList(chef.listId, seeded);
    const flour = await db.shoppingListItem.findFirstOrThrow({
      where: { shoppingListId: chef.listId, ingredientRefId: seeded.refs.flour.id },
    });
    // Another add of 5 lands after this one read flour (quantity 1) and before its write.
    const client = db as unknown as { $executeRaw: (...args: unknown[]) => Promise<number> };
    const original = client.$executeRaw.bind(db);
    const spy = vi.spyOn(client, "$executeRaw").mockImplementationOnce(async (...args) => {
      await db.shoppingListItem.update({ where: { id: flour.id }, data: { quantity: { increment: 5 } } });
      return original(...args);
    });

    try {
      await callSpoonjoyApiOperation(
        "add_shopping_list_item",
        { name: "parity flour", unit: "parity cup", quantity: 2 },
        context(chef.principal),
      );
    } finally {
      spy.mockRestore();
    }

    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: flour.id } }))
      .resolves.toMatchObject({ quantity: 1 + 5 + 2, deletedAt: null });
  });
});
