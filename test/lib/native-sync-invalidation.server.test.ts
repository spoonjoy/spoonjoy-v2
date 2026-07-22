import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import {
  nativeSyncDeletedKind,
  nativeSyncTombstoneUpsertOperation,
  recordNativeSyncTombstone,
  touchNativeSyncCookbookOperation,
  touchNativeSyncCookbooksForRecipe,
  touchNativeSyncCookbooksForRecipeOperation,
  touchNativeSyncRecipe,
  touchNativeSyncRecipeAndContainingCookbooks,
  touchNativeSyncRecipeOperation,
} from "~/lib/native-sync-invalidation.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe } from "../utils";
import { faker } from "@faker-js/faker";

describe("native sync invalidation helpers", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("recognizes only native sync delete resource kinds", () => {
    expect(nativeSyncDeletedKind("recipe")).toBe("recipe");
    expect(nativeSyncDeletedKind("cookbook")).toBe("cookbook");
    expect(nativeSyncDeletedKind("shoppingItem")).toBeNull();
  });

  it("defaults a standalone cookbook touch operation to the current time", () => {
    const update = vi.fn(() => Promise.resolve({}));
    const operation = touchNativeSyncCookbookOperation({
      cookbook: { update },
    } as never, "cookbook-id");

    expect(operation).toBeInstanceOf(Promise);
    expect(update).toHaveBeenCalledWith({
      where: { id: "cookbook-id" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("creates and updates durable native sync tombstones", async () => {
    const user = await createUser(db, "sync-helper@example.com", `sync_helper_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const firstDeletedAt = new Date("2026-07-01T10:00:00.000Z");
    const secondDeletedAt = new Date("2026-07-01T11:00:00.000Z");

    await nativeSyncTombstoneUpsertOperation(db, {
      accountId: user.id,
      resourceType: "recipe",
      resourceId: "recipe_1",
      title: null,
      deletedAt: firstDeletedAt,
      updatedAt: firstDeletedAt,
    });
    await recordNativeSyncTombstone(db, {
      accountId: user.id,
      resourceType: "recipe",
      resourceId: "recipe_1",
      parentResourceId: "cookbook_1",
      title: "Deleted helper recipe",
      deletedAt: secondDeletedAt,
      updatedAt: secondDeletedAt,
    });

    await expect(db.nativeSyncTombstone.findMany({
      where: { accountId: user.id, resourceType: "recipe", resourceId: "recipe_1" },
    })).resolves.toEqual([
      expect.objectContaining({
        parentResourceId: "cookbook_1",
        title: "Deleted helper recipe",
        deletedAt: secondDeletedAt,
        updatedAt: secondDeletedAt,
      }),
    ]);
  });

  it("touches recipe and cookbook parent revisions for native sync", async () => {
    const user = await createUser(db, "sync-touch@example.com", `sync_touch_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        authorId: user.id,
        title: `Sync Touch Cookbook ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    const secondUser = await createUser(db, "sync-touch-saver@example.com", `sync_touch_saver_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const containingCookbook = await db.cookbook.create({
      data: {
        authorId: secondUser.id,
        title: `Sync Containing Cookbook ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: containingCookbook.id, recipeId: recipe.id, addedById: secondUser.id },
    });

    await touchNativeSyncRecipe(db, recipe.id, new Date("2026-07-01T10:00:00.000Z"));
    await db.$transaction([
      touchNativeSyncRecipeOperation(db, recipe.id, new Date("2026-07-01T10:30:00.000Z")),
      touchNativeSyncCookbookOperation(db, cookbook.id, new Date("2026-07-01T11:00:00.000Z")),
    ]);
    await touchNativeSyncCookbooksForRecipe(db, recipe.id, new Date("2026-07-01T11:30:00.000Z"));
    await db.$transaction([
      touchNativeSyncCookbooksForRecipeOperation(db, recipe.id, new Date("2026-07-01T12:00:00.000Z")),
    ]);
    await touchNativeSyncRecipeAndContainingCookbooks(db, recipe.id, new Date("2026-07-01T12:30:00.000Z"));

    await expect(db.recipe.findUnique({ where: { id: recipe.id }, select: { updatedAt: true } }))
      .resolves.toEqual({ updatedAt: new Date("2026-07-01T12:30:00.000Z") });
    await expect(db.cookbook.findUnique({ where: { id: cookbook.id }, select: { updatedAt: true } }))
      .resolves.toEqual({ updatedAt: new Date("2026-07-01T11:00:00.000Z") });
    await expect(db.cookbook.findUnique({ where: { id: containingCookbook.id }, select: { updatedAt: true } }))
      .resolves.toEqual({ updatedAt: new Date("2026-07-01T12:30:00.000Z") });
  });

  it("uses the current time when touching containing cookbook revisions without an explicit timestamp", async () => {
    const user = await createUser(db, "sync-touch-now@example.com", `sync_touch_now_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        authorId: user.id,
        title: `Sync Touch Now Cookbook ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: user.id },
    });

    const beforeCookbookTouch = Date.now();
    await touchNativeSyncCookbooksForRecipeOperation(db, recipe.id);
    const cookbookAfterOperation = await db.cookbook.findUniqueOrThrow({
      where: { id: cookbook.id },
      select: { updatedAt: true },
    });
    expect(cookbookAfterOperation.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCookbookTouch);

    const beforeCombinedTouch = Date.now();
    await touchNativeSyncRecipeAndContainingCookbooks(db, recipe.id);

    await expect(db.recipe.findUnique({ where: { id: recipe.id }, select: { updatedAt: true } }))
      .resolves.toEqual({ updatedAt: expect.any(Date) });
    const [recipeAfterCombinedTouch, cookbookAfterCombinedTouch] = await Promise.all([
      db.recipe.findUniqueOrThrow({ where: { id: recipe.id }, select: { updatedAt: true } }),
      db.cookbook.findUniqueOrThrow({ where: { id: cookbook.id }, select: { updatedAt: true } }),
    ]);
    expect(recipeAfterCombinedTouch.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCombinedTouch);
    expect(cookbookAfterCombinedTouch.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCombinedTouch);
  });
});
