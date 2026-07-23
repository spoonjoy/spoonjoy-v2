import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  createTestUser,
  getOrCreateIngredientRef,
  getOrCreateUnit,
} from "../utils";

type SeedShoppingListItemInput = {
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  checked: boolean;
  checkedAt: Date | null;
  deletedAt: Date | null;
  categoryKey: string | null;
  iconKey: string | null;
  sortIndex: number;
};

type SeedCompatibilityModule = {
  provisionSeedShoppingListItem: (
    db: PrismaClient,
    input: SeedShoppingListItemInput,
  ) => Promise<{ id: string }>;
};

async function loadProvisioner() {
  const module = await vi.importActual<SeedCompatibilityModule>(
    "../../app/lib/shopping-list-seed-compat.server",
  );
  return module.provisionSeedShoppingListItem;
}

async function createListFixture(db: PrismaClient, suffix: string) {
  const user = await db.user.create({ data: createTestUser() });
  const shoppingList = await db.shoppingList.create({
    data: { authorId: user.id },
  });
  const ingredientRef = await getOrCreateIngredientRef(
    db,
    `seed compat ${suffix}`,
  );

  return { shoppingList, ingredientRef };
}

async function installActiveIdentityIndex(db: PrismaClient) {
  await db.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "ShoppingListItem_active_identity_key"',
  );
  await db.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key"',
  );
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "ShoppingListItem_active_identity_key"
    ON "ShoppingListItem" (
      "shoppingListId",
      "ingredientRefId",
      COALESCE('u:' || "unitId", 'n:')
    )
    WHERE "deletedAt" IS NULL
  `);
}

async function restoreFullIdentityIndex(db: PrismaClient) {
  await db.shoppingListItem.deleteMany({});
  await db.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "ShoppingListItem_active_identity_key"',
  );
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key"
    ON "ShoppingListItem" ("shoppingListId", "unitId", "ingredientRefId")
  `);
}

afterEach(async () => {
  await cleanupDatabase();
  await installActiveIdentityIndex(await getLocalDb());
});

describe("shopping-list seed compatibility provisioner", () => {
  it.each([
    {
      label: "legacy Prisma columns",
      error: {
        code: "P2002",
        meta: { target: ["shoppingListId", "unitId", "ingredientRefId"] },
      },
    },
    {
      label: "Prisma expression index array",
      error: {
        code: "P2002",
        meta: { target: ["index 'ShoppingListItem_active_identity_key'"] },
      },
    },
    {
      label: "Prisma expression index string",
      error: {
        code: "P2002",
        meta: { target: "ShoppingListItem_active_identity_key" },
      },
    },
    {
      label: "legacy SQLite message",
      error: new Error(
        "UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefId",
      ),
    },
    {
      label: "expression-index SQLite message",
      error: new Error(
        "UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key'",
      ),
    },
  ])("rereads the active seed identity after a $label conflict", async ({ error }) => {
    const winner = { id: "seed-race-winner" };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const create = vi.fn().mockRejectedValue(error);
    const update = vi.fn().mockResolvedValue(winner);
    const provision = await loadProvisioner();

    await expect(provision({
      shoppingListItem: { findFirst, create, update },
    } as unknown as PrismaClient, {
      shoppingListId: "list",
      ingredientRefId: "ref",
      unitId: null,
      quantity: 3,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: "produce",
      iconKey: "leaf",
      sortIndex: 2,
    })).resolves.toBe(winner);
    expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: winner.id },
      data: expect.objectContaining({ quantity: 3, sortIndex: 2 }),
    }));
    expect(findFirst).toHaveBeenCalledTimes(3);
  });

  it.each([
    { label: "null", error: null },
    { label: "primitive", error: "unique" },
    { label: "other Prisma code", error: { code: "P2025", message: "not found" } },
    { label: "wrong legacy target length", error: { code: "P2002", meta: { target: ["shoppingListId"] } } },
    { label: "wrong legacy target order", error: { code: "P2002", meta: { target: ["shoppingListId", "ingredientRefId", "unitId"] } } },
    { label: "wrong expression index", error: { code: "P2002", meta: { target: "Other_index" } } },
    { label: "non-string message", error: { message: 42 } },
    { label: "lookalike SQLite message", error: new Error("UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key_extra'") },
  ])("propagates a $label non-seed conflict without rereading", async ({ error }) => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const provision = await loadProvisioner();

    await expect(provision({
      shoppingListItem: {
        findFirst,
        create: vi.fn().mockRejectedValue(error),
        update: vi.fn(),
      },
    } as unknown as PrismaClient, {
      shoppingListId: "list",
      ingredientRefId: "ref",
      unitId: null,
      quantity: null,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: null,
      iconKey: null,
      sortIndex: 0,
    })).rejects.toBe(error);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("propagates a recognized seed conflict when no active winner exists", async () => {
    const conflict = {
      code: "P2002",
      meta: { target: "ShoppingListItem_active_identity_key" },
    };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const provision = await loadProvisioner();

    await expect(provision({
      shoppingListItem: {
        findFirst,
        create: vi.fn().mockRejectedValue(conflict),
        update: vi.fn(),
      },
    } as unknown as PrismaClient, {
      shoppingListId: "list",
      ingredientRefId: "ref",
      unitId: null,
      quantity: null,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: null,
      iconKey: null,
      sortIndex: 0,
    })).rejects.toBe(conflict);
    expect(findFirst).toHaveBeenCalledTimes(3);
  });

  it("prefers the earliest active unitless identity before every tombstone", async () => {
    const db = await getLocalDb();
    await restoreFullIdentityIndex(db);
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "active first",
    );
    const tombstoneTime = new Date("2026-01-01T00:00:00.000Z");

    const tombstone = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-00-tombstone",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 100,
        deletedAt: tombstoneTime,
        sortIndex: -100,
      },
    });
    const laterActive = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-30-active-later-sort",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 30,
        sortIndex: 3,
      },
    });
    const laterById = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-a-active-later-id",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 20,
        sortIndex: 2,
      },
    });
    const expectedActive = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-A-active-first-id",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 10,
        sortIndex: 2,
      },
    });
    const provision = await loadProvisioner();

    const result = await provision(db, {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: null,
      quantity: 7,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: "produce",
      iconKey: "leaf",
      sortIndex: 8,
    });

    expect(result.id).toBe(expectedActive.id);
    await expect(
      db.shoppingListItem.findUniqueOrThrow({
        where: { id: expectedActive.id },
      }),
    ).resolves.toMatchObject({
      quantity: 7,
      deletedAt: null,
      categoryKey: "produce",
      iconKey: "leaf",
      sortIndex: 8,
    });
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: tombstone.id } }),
    ).resolves.toMatchObject({
      quantity: 100,
      deletedAt: tombstoneTime,
      sortIndex: -100,
    });
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: laterActive.id } }),
    ).resolves.toMatchObject({
      quantity: 30,
      sortIndex: 3,
    });
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: laterById.id } }),
    ).resolves.toMatchObject({
      quantity: 20,
      sortIndex: 2,
    });
  });

  it("sets the migrated active unitless survivor and leaves its tombstone untouched", async () => {
    const db = await getLocalDb();
    await installActiveIdentityIndex(db);
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "post 0025 active first",
    );
    const tombstone = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-post-0025-tombstone",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 100,
        deletedAt: new Date("2026-01-01T00:00:00.000Z"),
        sortIndex: -1,
      },
    });
    const active = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-post-0025-active",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 3,
        sortIndex: 2,
      },
    });
    const provision = await loadProvisioner();

    const result = await provision(db, {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: null,
      quantity: 7,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: "produce",
      iconKey: "leaf",
      sortIndex: 8,
    });

    expect(result.id).toBe(active.id);
    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: active.id } }))
      .resolves.toMatchObject({
        quantity: 7,
        deletedAt: null,
        categoryKey: "produce",
        iconKey: "leaf",
        sortIndex: 8,
      });
    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: tombstone.id } }))
      .resolves.toMatchObject({ quantity: 100, deletedAt: expect.any(Date), sortIndex: -1 });
  });

  it("restores the earliest unitless tombstone by sortIndex and binary id", async () => {
    const db = await getLocalDb();
    await installActiveIdentityIndex(db);
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "tombstone order",
    );
    const deletedAt = new Date("2026-01-02T00:00:00.000Z");
    const laterBySort = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-30-tombstone-later-sort",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 30,
        deletedAt,
        sortIndex: 3,
      },
    });
    const laterById = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-a-tombstone-later-id",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 20,
        deletedAt,
        sortIndex: 1,
      },
    });
    const expectedTombstone = await db.shoppingListItem.create({
      data: {
        id: "seed-gap-A-tombstone-first-id",
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 10,
        deletedAt,
        sortIndex: 1,
      },
    });
    const provision = await loadProvisioner();

    const result = await provision(db, {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: null,
      quantity: 6,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: null,
      iconKey: null,
      sortIndex: 0,
    });

    expect(result.id).toBe(expectedTombstone.id);
    await expect(
      db.shoppingListItem.findUniqueOrThrow({
        where: { id: expectedTombstone.id },
      }),
    ).resolves.toMatchObject({
      quantity: 6,
      deletedAt: null,
      sortIndex: 0,
    });
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: laterBySort.id } }),
    ).resolves.toMatchObject({
      quantity: 30,
      deletedAt,
      sortIndex: 3,
    });
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: laterById.id } }),
    ).resolves.toMatchObject({
      quantity: 20,
      deletedAt,
      sortIndex: 1,
    });
  });

  it("restores a tombstone under the old full unitful identity index", async () => {
    const db = await getLocalDb();
    await restoreFullIdentityIndex(db);
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "full index tombstone",
    );
    const unit = await getOrCreateUnit(db, "seed compat full index unit");
    const [identityIndex] = await db.$queryRawUnsafe<
      Array<{ sql: string | null }>
    >(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'index'
         AND name = 'ShoppingListItem_shoppingListId_unitId_ingredientRefId_key'`,
    );

    expect(identityIndex?.sql).toContain("CREATE UNIQUE INDEX");
    expect(identityIndex?.sql).not.toMatch(/\bWHERE\b/i);

    const tombstone = await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: unit.id,
        quantity: 99,
        checked: true,
        checkedAt: new Date("2025-01-01T00:00:00.000Z"),
        deletedAt: new Date("2025-01-02T00:00:00.000Z"),
        categoryKey: "legacy",
        iconKey: "legacy-icon",
        sortIndex: 99,
      },
    });
    const checkedAt = new Date("2026-02-03T04:05:06.000Z");
    const provision = await loadProvisioner();

    const result = await provision(db, {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: unit.id,
      quantity: 4,
      checked: true,
      checkedAt,
      deletedAt: null,
      categoryKey: "pantry",
      iconKey: "jar",
      sortIndex: 1,
    });

    expect(result.id).toBe(tombstone.id);
    expect(
      await db.shoppingListItem.findMany({
        where: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
        },
      }),
    ).toEqual([
      expect.objectContaining({
        id: tombstone.id,
        quantity: 4,
        checked: true,
        checkedAt,
        deletedAt: null,
        categoryKey: "pantry",
        iconKey: "jar",
        sortIndex: 1,
      }),
    ]);
  });

  it("sets every configured field exactly on rerun without aggregation or duplicate accumulation", async () => {
    const db = await getLocalDb();
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "exact rerun",
    );
    const unit = await getOrCreateUnit(db, "seed compat exact rerun unit");
    const firstCheckedAt = new Date("2026-03-01T00:00:00.000Z");
    const secondCheckedAt = new Date("2026-03-02T00:00:00.000Z");
    const identity = {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: unit.id,
    };
    const provision = await loadProvisioner();

    const first = await provision(db, {
      ...identity,
      quantity: 2,
      checked: true,
      checkedAt: firstCheckedAt,
      deletedAt: null,
      categoryKey: "produce",
      iconKey: "leaf",
      sortIndex: 12,
    });
    const second = await provision(db, {
      ...identity,
      quantity: 5,
      checked: true,
      checkedAt: secondCheckedAt,
      deletedAt: null,
      categoryKey: "pantry",
      iconKey: null,
      sortIndex: 3,
    });

    expect(second.id).toBe(first.id);
    await expect(
      db.shoppingListItem.findUniqueOrThrow({ where: { id: first.id } }),
    ).resolves.toMatchObject({
      quantity: 5,
      checked: true,
      checkedAt: secondCheckedAt,
      deletedAt: null,
      categoryKey: "pantry",
      iconKey: null,
      sortIndex: 3,
    });

    const third = await provision(db, {
      ...identity,
      quantity: null,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: null,
      iconKey: "basket",
      sortIndex: 0,
    });

    expect(third.id).toBe(first.id);
    expect(await db.shoppingListItem.findMany({ where: identity })).toEqual([
      expect.objectContaining({
        id: first.id,
        quantity: null,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: null,
        iconKey: "basket",
        sortIndex: 0,
      }),
    ]);
  });

  it("propagates saved_recipe_cutover_pending without translating or swallowing it", async () => {
    const db = await getLocalDb();
    const { shoppingList, ingredientRef } = await createListFixture(
      db,
      "cutover propagation",
    );
    const triggerName = "test_seed_cutover_pending";
    await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: null,
        quantity: 9,
        sortIndex: 9,
      },
    });

    // Native Prisma erases RAISE text as P2003, so retain the token in the
    // missing relation while exercising the same BEFORE-trigger failure path.
    await db.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON ShoppingListItem
      BEGIN
        SELECT * FROM saved_recipe_cutover_pending;
      END
    `);

    try {
      const provision = await loadProvisioner();
      await expect(
        provision(db, {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 1,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          categoryKey: null,
          iconKey: null,
          sortIndex: 0,
        }),
      ).rejects.toThrow(/saved_recipe_cutover_pending/);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });
});
