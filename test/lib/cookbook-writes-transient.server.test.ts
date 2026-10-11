// @vitest-environment node
// The shared cookbook writes (API v1, the tools API and the cookbook page) when D1's connection
// drops: each ends with the rows of one clean run and the answer that run gives, however many
// tries it takes, and gives up with a retryable error rather than a 500 when D1 stays unreachable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  addRecipeToCookbook,
  createCookbookWithRecipe,
  deleteCookbookWithTombstone,
  removeRecipeFromCookbook,
} from "~/lib/cookbook-membership-compat.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestRecipe, createTestUser } from "../utils";

const CREATE = /INSERT INTO "Cookbook"/;
const ADD = /INSERT INTO "RecipeInCookbook"/;
const REMOVE = /DELETE FROM "RecipeInCookbook"/;
const DELETE = /INSERT INTO "NativeSyncTombstone"/;
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const SEEDED_AT = new Date("2026-10-01T09:00:00Z");

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;
let recipeId: string;
let cookbookId: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
  userId = (await db.user.create({ data: createTestUser() })).id;
  recipeId = (await db.recipe.create({ data: createTestRecipe(userId) })).id;
  cookbookId = (await db.cookbook.create({ data: { title: "Weeknights", authorId: userId, updatedAt: SEEDED_AT } })).id;
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

const memberships = () => db.recipeInCookbook.findMany({ where: { recipeId }, select: { cookbookId: true } });
const touched = async () =>
  (await db.cookbook.findUniqueOrThrow({ where: { id: cookbookId } })).updatedAt.getTime() > SEEDED_AT.getTime();

describe("making a cookbook with a recipe in it", () => {
  it.each(OUTCOMES)("makes one cookbook with the recipe when a try is %s", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(CREATE, outcome);

    const made = await createCookbookWithRecipe({ database: db, nativeDatabase: flaky.binding, title: "Sunday", userId, recipeId });

    expect(flaky.failures()).toBe(1);
    expect(made.title).toBe("Sunday");
    expect(await db.cookbook.findMany({ where: { title: "Sunday" }, select: { id: true } })).toEqual([{ id: made.id }]);
    expect(await memberships()).toEqual([{ cookbookId: made.id }]);
  });

  it("still answers a title the chef already uses as a conflict", async () => {
    await expect(createCookbookWithRecipe({ database: db, nativeDatabase: d1.binding, title: "Weeknights", userId, recipeId }))
      .rejects.toThrow(/UNIQUE constraint failed: Cookbook\.authorId, Cookbook\.title/);
    expect(await memberships()).toEqual([]);
  });

  it("gives up with a retryable error, writing nothing, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(CREATE, "lost", "lost", "lost", "lost");

    await expect(createCookbookWithRecipe({ database: db, nativeDatabase: flaky.binding, title: "Sunday", userId, recipeId }))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.cookbook.count({ where: { title: "Sunday" } })).toBe(0);
  });
});

describe("saving a recipe to a cookbook", () => {
  const add = (nativeDatabase: unknown, database: PrismaClient = db) =>
    addRecipeToCookbook({ database, nativeDatabase: nativeDatabase as never, cookbookId, recipeId, userId });

  it.each(OUTCOMES)("adds it once and answers added when a try is %s", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD, outcome);

    await expect(add(flaky.binding)).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    expect(await memberships()).toEqual([{ cookbookId }]);
    expect(await touched()).toBe(true);
  });

  it("answers not added when another request saved it in between", async () => {
    // The first try is lost, and before the retry another request saves the same recipe.
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD, "lost");
    let raced = false;
    const binding = {
      ...flaky.binding,
      prepare: (sql: string) => flaky.binding.prepare(sql),
      batch: async (statements: never[]) => {
        try {
          return await flaky.binding.batch(statements);
        } catch (error) {
          if (!raced) {
            raced = true;
            await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
          }
          throw error;
        }
      },
    };

    await expect(add(binding)).resolves.toBe(false);
    expect(await memberships()).toEqual([{ cookbookId }]);
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD, "lost", "lost", "lost", "lost");

    await expect(add(flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await memberships()).toEqual([]);
  });

  it.each(OUTCOMES)("touches a cookbook the recipe is already in when the touch is %s", async (outcome) => {
    await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyPrisma(db);
    flaky.failNext("cookbook", "update", outcome);

    await expect(add(d1.binding, flaky.db)).resolves.toBe(false);

    expect(flaky.failures()).toBe(1);
    expect(await touched()).toBe(true);
  });

  it("gives up touching with a retryable error when every try is lost", async () => {
    await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyPrisma(db);
    flaky.failNext("cookbook", "update", "lost", "lost", "lost", "lost");

    await expect(add(d1.binding, flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await touched()).toBe(false);
  });
});

describe("taking a recipe out of a cookbook", () => {
  const remove = (nativeDatabase: unknown, by: "recipe" | "membership" = "recipe", membershipId?: string) =>
    removeRecipeFromCookbook({
      database: db,
      nativeDatabase: nativeDatabase as never,
      cookbookId,
      ...(by === "recipe" ? { recipeId } : { membershipId }),
    });

  it.each(OUTCOMES)("removes it and answers removed when a try is %s", async (outcome) => {
    const membership = await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REMOVE, outcome);

    await expect(remove(flaky.binding, "membership", membership.id)).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    expect(await memberships()).toEqual([]);
    expect(await touched()).toBe(true);
  });

  it.each(OUTCOMES)("answers not removed for a recipe that was not in it when a try is %s", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REMOVE, outcome);

    await expect(remove(flaky.binding)).resolves.toBe(false);

    expect(flaky.failures()).toBe(1);
    expect(await touched()).toBe(true);
  });

  it("gives up with a retryable error when every try is lost", async () => {
    await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REMOVE, "lost", "lost", "lost", "lost");

    await expect(remove(flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await memberships()).toEqual([{ cookbookId }]);
    expect(await touched()).toBe(false);
  });
});

describe("deleting a cookbook", () => {
  const remove = (nativeDatabase: unknown) =>
    deleteCookbookWithTombstone({ database: db, nativeDatabase: nativeDatabase as never, accountId: userId, cookbookId, title: "Weeknights" });

  it.each(OUTCOMES)("deletes it and leaves one tombstone when a try is %s", async (outcome) => {
    await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyD1(d1.binding);
    flaky.failNext(DELETE, outcome);

    await remove(flaky.binding);

    expect(flaky.failures()).toBe(1);
    expect(await db.cookbook.count({ where: { id: cookbookId } })).toBe(0);
    expect(await memberships()).toEqual([]);
    expect(await db.nativeSyncTombstone.findMany({ where: { resourceId: cookbookId }, select: { resourceType: true, title: true } }))
      .toEqual([{ resourceType: "cookbook", title: "Weeknights" }]);
  });

  it("gives up with a retryable error, keeping the cookbook, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(DELETE, "lost", "lost", "lost", "lost");

    await expect(remove(flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.cookbook.count({ where: { id: cookbookId } })).toBe(1);
    expect(await db.nativeSyncTombstone.count({ where: { resourceId: cookbookId } })).toBe(0);
  });
});
