import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  addRecipeToCookbook,
  asCompatibleCookbookD1Database,
  createCookbookWithRecipe,
  deleteCookbookWithTombstone,
  removeRecipeFromCookbook,
  type CompatibleCookbookD1Database,
} from "~/lib/cookbook-membership-compat.server";

function nativeDatabase(results: Array<{ meta?: { changes?: number } }> = []) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const batch = vi.fn(async () => results);
  const database: CompatibleCookbookD1Database = {
    prepare(sql) {
      const captured = { sql, values: [] as unknown[] };
      statements.push(captured);
      const statement = {
        bind(...values: unknown[]) {
          captured.values = values;
          return statement;
        },
      };
      return statement;
    },
    batch,
  };
  return { database, batch, statements };
}

function databaseStub() {
  const transactionClient = {
    cookbook: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    recipeInCookbook: {
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    nativeSyncTombstone: {
      upsert: vi.fn(async () => ({})),
    },
  };
  const database = {
    cookbook: { update: vi.fn(async () => ({})) },
    recipeInCookbook: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback: (transaction: typeof transactionClient) => unknown) => (
      callback(transactionClient)
    )),
  } as unknown as PrismaClient;
  return { database, transactionClient };
}

describe("cookbook membership compatibility transactions", () => {
  it("recognizes only callable native D1 bindings", () => {
    expect(asCompatibleCookbookD1Database(null)).toBeNull();
    expect(asCompatibleCookbookD1Database({ prepare() {} })).toBeNull();
    const binding = { prepare() {}, batch() {} };
    expect(asCompatibleCookbookD1Database(binding)).toBe(binding);
  });

  it("creates a cookbook and membership in one native or local transaction", async () => {
    const native = nativeDatabase();
    const first = databaseStub();
    const created = await createCookbookWithRecipe({
      database: first.database,
      nativeDatabase: native.database,
      title: "Native cookbook",
      userId: "user-id",
      recipeId: "recipe-id",
    });

    expect(created).toMatchObject({ title: "Native cookbook" });
    expect(created.id).toBeTypeOf("string");
    expect(native.batch).toHaveBeenCalledOnce();
    expect(native.statements.map(({ sql }) => sql)).toEqual([
      expect.stringContaining('INSERT INTO "Cookbook"'),
      expect.stringContaining('INSERT INTO "RecipeInCookbook"'),
    ]);
    expect(first.database.$transaction).not.toHaveBeenCalled();

    const local = databaseStub();
    await createCookbookWithRecipe({
      database: local.database,
      nativeDatabase: null,
      title: "Local cookbook",
      userId: "user-id",
      recipeId: "recipe-id",
    });
    expect(local.database.$transaction).toHaveBeenCalledOnce();
    expect(local.transactionClient.cookbook.create).toHaveBeenCalledOnce();
    expect(local.transactionClient.recipeInCookbook.create).toHaveBeenCalledOnce();
  });

  it("touches and reports an existing membership without opening a transaction", async () => {
    const local = databaseStub();
    vi.mocked(local.database.recipeInCookbook.findUnique).mockResolvedValueOnce({ id: "membership-id" } as never);

    await expect(addRecipeToCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
      userId: "user-id",
    })).resolves.toBe(false);
    expect(local.database.cookbook.update).toHaveBeenCalledOnce();
    expect(local.database.$transaction).not.toHaveBeenCalled();
  });

  it("adds a missing membership atomically through native D1 and local Prisma", async () => {
    const native = nativeDatabase();
    const first = databaseStub();
    await expect(addRecipeToCookbook({
      database: first.database,
      nativeDatabase: native.database,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
      userId: "user-id",
    })).resolves.toBe(true);
    expect(native.statements).toHaveLength(2);
    expect(first.database.$transaction).not.toHaveBeenCalled();

    const local = databaseStub();
    await expect(addRecipeToCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
      userId: "user-id",
    })).resolves.toBe(true);
    expect(local.transactionClient.recipeInCookbook.create).toHaveBeenCalledOnce();
    expect(local.transactionClient.cookbook.update).toHaveBeenCalledOnce();
  });

  it.each([
    Object.assign(new Error("Prisma membership race"), {
      code: "P2002",
      meta: { target: ["cookbookId", "recipeId"] },
    }),
    new Error(
      "D1_ERROR: UNIQUE constraint failed: RecipeInCookbook.cookbookId, RecipeInCookbook.recipeId",
    ),
  ])("turns only an exact membership uniqueness race into an idempotent touch", async (error) => {
    const local = databaseStub();
    vi.mocked(local.database.$transaction).mockRejectedValueOnce(error);

    await expect(addRecipeToCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
      userId: "user-id",
    })).resolves.toBe(false);
    expect(local.database.cookbook.update).toHaveBeenCalledOnce();
  });

  it.each([
    Object.assign(new Error("bare Prisma uniqueness"), { code: "P2002" }),
    Object.assign(new Error("different Prisma uniqueness"), {
      code: "P2002",
      meta: { target: ["cookbookId", "recipeId", "id"] },
    }),
    new Error(
      "UNIQUE constraint failed: RecipeInCookbook.cookbookId, RecipeInCookbook.recipeId, RecipeInCookbook.id",
    ),
    new Error(
      "UNIQUE constraint failed: RecipeInCookbook.cookbookId, RecipeInCookbook.recipeIdExtra",
    ),
    new Error(
      "UNIQUE constraint failed: RecipeInCookbook.cookbookId, RecipeInCookbook.recipeId.foo",
    ),
    "not an error object",
  ])("propagates a non-membership conflict without touching the cookbook", async (error) => {
    const local = databaseStub();
    vi.mocked(local.database.$transaction).mockRejectedValueOnce(error);

    await expect(addRecipeToCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
      userId: "user-id",
    })).rejects.toBe(error);
    expect(local.database.cookbook.update).not.toHaveBeenCalled();
  });

  it("removes by recipe or membership id and reports native D1 changes", async () => {
    const removed = nativeDatabase([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    const first = databaseStub();
    await expect(removeRecipeFromCookbook({
      database: first.database,
      nativeDatabase: removed.database,
      cookbookId: "cookbook-id",
      membershipId: "membership-id",
      recipeId: "ignored-recipe-id",
    })).resolves.toBe(true);
    expect(removed.statements[0].sql).toContain('"id" = ?');

    const absent = nativeDatabase([{ meta: { changes: 0 } }, { meta: { changes: 1 } }]);
    await expect(removeRecipeFromCookbook({
      database: databaseStub().database,
      nativeDatabase: absent.database,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
    })).resolves.toBe(false);
    expect(absent.statements[0].sql).toContain('"recipeId" = ?');
  });

  it("rejects malformed remove inputs and missing D1 mutation metadata", async () => {
    await expect(removeRecipeFromCookbook({
      database: databaseStub().database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
    })).rejects.toThrow("A cookbook membership id or recipe id is required");

    await expect(removeRecipeFromCookbook({
      database: databaseStub().database,
      nativeDatabase: nativeDatabase([]).database,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
    })).rejects.toThrow("D1 cookbook batch did not report mutation changes");
  });

  it("removes locally and returns the transaction delete count", async () => {
    const local = databaseStub();
    await expect(removeRecipeFromCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      recipeId: "recipe-id",
    })).resolves.toBe(true);
    vi.mocked(local.transactionClient.recipeInCookbook.deleteMany).mockResolvedValueOnce({ count: 0 });
    await expect(removeRecipeFromCookbook({
      database: local.database,
      nativeDatabase: null,
      cookbookId: "cookbook-id",
      membershipId: "membership-id",
    })).resolves.toBe(false);
  });

  it("deletes with a tombstone in one native or local transaction", async () => {
    const native = nativeDatabase();
    const first = databaseStub();
    await deleteCookbookWithTombstone({
      database: first.database,
      nativeDatabase: native.database,
      accountId: "user-id",
      cookbookId: "cookbook-id",
      title: "Cookbook",
    });
    expect(native.statements.map(({ sql }) => sql)).toEqual([
      expect.stringContaining('INSERT INTO "NativeSyncTombstone"'),
      expect.stringContaining('DELETE FROM "Cookbook"'),
    ]);
    expect(first.database.$transaction).not.toHaveBeenCalled();

    const local = databaseStub();
    await deleteCookbookWithTombstone({
      database: local.database,
      nativeDatabase: null,
      accountId: "user-id",
      cookbookId: "cookbook-id",
      title: "Cookbook",
    });
    expect(local.transactionClient.nativeSyncTombstone.upsert).toHaveBeenCalledOnce();
    expect(local.transactionClient.cookbook.delete).toHaveBeenCalledOnce();
  });
});
