// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { addShoppingListItem, type ShoppingListItemAdd } from "~/lib/shopping-list-mutations.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

// The single-item add shared by web, REST and MCP, against the real SQLite schema. The
// unique index treats a null unit as distinct, so the create is a conditional insert; an
// addition that finds its item gone, or a create that finds it taken, reads again.

let db: PrismaClient;
let listId: string;
let eggsId: string;

async function rows() {
  return db.shoppingListItem.findMany({
    where: { shoppingListId: listId },
    select: { id: true, quantity: true, unitId: true, deletedAt: true, checked: true, sortIndex: true, categoryKey: true },
    orderBy: { id: "asc" },
  });
}

function eggs(quantity: number | null, extra: Partial<ShoppingListItemAdd> = {}): ShoppingListItemAdd {
  return {
    identity: { shoppingListId: listId, ingredientRefId: eggsId, unitId: null },
    quantity,
    categoryKey: null,
    iconKey: null,
    nextSortIndex: async () => 7,
    ...extra,
  };
}

/** Runs `before` once, just ahead of the next raw write: another request landing in between. */
function beforeNextWrite(before: () => Promise<unknown>) {
  const client = db as unknown as { $executeRaw: (...args: unknown[]) => Promise<number> };
  const original = client.$executeRaw.bind(client);
  const spy = vi.spyOn(client, "$executeRaw").mockImplementationOnce(async (...args: unknown[]) => {
    await before();
    return original(...args);
  });
  spy.mockImplementation(original);
  return spy;
}

describe("adding one shopping-list item", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    const user = await db.user.create({ data: createTestUser() });
    listId = (await db.shoppingList.create({ data: { authorId: user.id } })).id;
    eggsId = (await db.ingredientRef.create({ data: { name: "item add eggs" } })).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("creates a unit-less item, then adds to it", async () => {
    const created = await addShoppingListItem(db, eggs(2, { categoryKey: "dairy" }));
    expect(created).toEqual({ created: true, id: expect.any(String) });
    await expect(addShoppingListItem(db, eggs(3))).resolves.toEqual({ created: false, id: created!.id });

    expect(await rows()).toEqual([
      { id: created!.id, quantity: 5, unitId: null, deletedAt: null, checked: false, sortIndex: 7, categoryKey: "dairy" },
    ]);
  });

  it("keeps one unit-less item with every amount when adds run concurrently", async () => {
    await Promise.all([1, 2, 3, 4, 5].map((quantity) => addShoppingListItem(db, eggs(quantity))));

    expect(await rows()).toEqual([expect.objectContaining({ quantity: 15, unitId: null })]);
  });

  it("adds to the unit-less item another add created between the read and the insert", async () => {
    const write = beforeNextWrite(() => db.shoppingListItem.create({
      data: { id: "item-add-winner", shoppingListId: listId, ingredientRefId: eggsId, unitId: null, quantity: 4 },
    }));

    await expect(addShoppingListItem(db, eggs(3))).resolves.toEqual({ created: false, id: "item-add-winner" });

    // The insert that found the identity taken, then the addition.
    expect(write).toHaveBeenCalledTimes(2);
    expect(await rows()).toEqual([expect.objectContaining({ id: "item-add-winner", quantity: 7 })]);
  });

  it("creates the item again when it was deleted between the read and the addition", async () => {
    await db.shoppingListItem.create({
      data: { id: "item-add-gone", shoppingListId: listId, ingredientRefId: eggsId, unitId: null, quantity: 4 },
    });
    beforeNextWrite(() => db.shoppingListItem.delete({ where: { id: "item-add-gone" } }));

    const added = await addShoppingListItem(db, eggs(3));

    expect(added).toEqual({ created: true, id: expect.any(String) });
    expect(await rows()).toEqual([expect.objectContaining({ id: added!.id, quantity: 3 })]);
  });

  it("answers null and writes nothing when the list was deleted meanwhile", async () => {
    await db.shoppingListItem.create({
      data: { id: "item-add-cascade", shoppingListId: listId, ingredientRefId: eggsId, unitId: null, quantity: 4 },
    });
    beforeNextWrite(() => db.shoppingList.delete({ where: { id: listId } }));

    await expect(addShoppingListItem(db, eggs(3))).resolves.toBeNull();
    await expect(db.shoppingListItem.count({ where: { shoppingListId: listId } })).resolves.toBe(0);
  });

  it("rethrows an addition failure that is not a lost race", async () => {
    await db.shoppingListItem.create({
      data: { shoppingListId: listId, ingredientRefId: eggsId, unitId: null, quantity: 4 },
    });
    vi.spyOn(db as unknown as { $executeRaw: () => Promise<number> }, "$executeRaw")
      .mockRejectedValueOnce(new Error("disk I/O error"));

    await expect(addShoppingListItem(db, eggs(3))).rejects.toThrow("disk I/O error");
  });

  it("gives up after three lost races", async () => {
    await db.shoppingListItem.create({
      data: { shoppingListId: listId, ingredientRefId: eggsId, unitId: null, quantity: 4 },
    });
    const write = vi.spyOn(db as unknown as { $executeRaw: () => Promise<number> }, "$executeRaw").mockResolvedValue(0);

    await expect(addShoppingListItem(db, eggs(3))).rejects.toThrow("Shopping list item add kept losing to concurrent writes");
    expect(write).toHaveBeenCalledTimes(3);
  });
});
