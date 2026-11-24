// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { organizersOnRecipe, prismaOrganizerStore, setRecipeOrganizers, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";
import { readMoveInOrganizerCounts } from "~/domains/move-in/adapters/storage/organizer-writer.server";
import { attachMovedInOrganizers, attachMovedInOrganizersTogether } from "~/domains/move-in/adapters/storage/organizer-writer.server";
import { cleanupDatabase } from "../../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let store: OrganizerStore;

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  store = prismaOrganizerStore(db);
});

afterEach(async () => {
  await cleanupDatabase();
});

async function kitchen() {
  const cook = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({ data: createTestRecipe(cook.id) });
  const source = await db.importSource.create({ data: { id: crypto.randomUUID(), ownerId: cook.id, kind: "mealie-backup", instanceKey: "k", label: "Home" } });
  return { ownerId: cook.id, recipeId: recipe.id, sourceId: source.id, jobId: "job-1" };
}

const none = { tags: [], categories: [], tools: [] };

const on = async (recipeId: string, kind: OrganizerKind) => (await organizersOnRecipe(store, recipeId, kind)).map((organizer) => organizer.name);

describe("attachMovedInOrganizers", () => {
  it("puts the tags, categories and tools on the recipe beside the ones it has, once each, and again changes nothing", async () => {
    const at = await kitchen();
    const { ownerId, recipeId } = at;
    await setRecipeOrganizers(store, ownerId, recipeId, "tag", ["Cozy"]);
    const moved = { ...at, tags: ["Quick", "quick"], categories: ["Dinner"], tools: [] };

    await attachMovedInOrganizers(db, moved);
    await attachMovedInOrganizers(db, moved);

    expect(await on(recipeId, "tag")).toEqual(["Cozy", "Quick"]);
    expect(await on(recipeId, "category")).toEqual(["Dinner"]);
    expect(await on(recipeId, "tool")).toEqual([]);
    expect(await db.organizer.count({ where: { ownerId } })).toBe(3);
  });

  it("uses the tag the cook already has under another spelling", async () => {
    const at = await kitchen();
    const { ownerId, recipeId } = at;
    const other = await db.recipe.create({ data: createTestRecipe(ownerId) });
    await setRecipeOrganizers(store, ownerId, other.id, "tag", ["QUICK"]);

    await attachMovedInOrganizers(db, { ...at, ...none, tags: ["quick"] });

    expect(await on(recipeId, "tag")).toEqual(["QUICK"]);
    expect(await db.organizer.count({ where: { ownerId } })).toBe(1);
  });

  it("refuses a recipe that isn't the cook's", async () => {
    const { recipeId } = await kitchen();
    const theirs = await kitchen();
    await expect(attachMovedInOrganizers(db, { ...theirs, recipeId, ...none, tags: ["Quick"] })).rejects.toThrow("the recipe is no longer in your kitchen");
    expect(await on(recipeId, "tag")).toEqual([]);
    expect(await readMoveInOrganizerCounts(db, theirs)).toEqual({ tags: 0, categories: 0, tools: 0 });
  });

  it("never takes off a tag the cook puts on while it runs", async () => {
    const at = await kitchen();
    const racing: OrganizerStore = {
      ...store,
      async organizersOf(ownerId, kind) {
        const existing = await store.organizersOf(ownerId, kind);
        await setRecipeOrganizers(store, ownerId, at.recipeId, "tag", ["Cozy"]);
        return existing;
      },
    };

    await attachMovedInOrganizers(db, { ...at, ...none, tags: ["Quick"] }, racing);

    expect(await on(at.recipeId, "tag")).toEqual(["Cozy", "Quick"]);
  });

  it("counts each organizer a move-in put on its recipes once, by kind, while it is still in the kitchen", async () => {
    const at = await kitchen();
    const second = await db.recipe.create({ data: createTestRecipe(at.ownerId) });
    await attachMovedInOrganizers(db, { ...at, tags: ["Quick", "Cozy"], categories: ["Dinner"], tools: [] });
    await attachMovedInOrganizers(db, { ...at, recipeId: second.id, tags: ["quick"], categories: [], tools: ["Wok", "x".repeat(61)] });

    expect(await readMoveInOrganizerCounts(db, at)).toEqual({ tags: 2, categories: 1, tools: 1 });
    expect(await readMoveInOrganizerCounts(db, { ...at, jobId: "job-2" })).toEqual({ tags: 0, categories: 0, tools: 0 });

    await db.organizer.deleteMany({ where: { ownerId: at.ownerId, slug: "cozy" } });
    expect(await readMoveInOrganizerCounts(db, at)).toEqual({ tags: 1, categories: 1, tools: 1 });

    // A later move-in of the same backup has its own count, and leaves this one's as it was.
    await attachMovedInOrganizers(db, { ...at, jobId: "job-2", ...none, tags: ["Quick"] });
    expect(await readMoveInOrganizerCounts(db, { ...at, jobId: "job-2" })).toEqual({ tags: 1, categories: 0, tools: 0 });
    expect(await readMoveInOrganizerCounts(db, at)).toEqual({ tags: 1, categories: 1, tools: 1 });

    // One the cook takes off every recipe, or whose recipes are deleted, is no longer counted.
    await db.recipeOrganizer.deleteMany({ where: { organizer: { ownerId: at.ownerId, slug: "dinner" } } });
    await db.recipe.update({ where: { id: second.id }, data: { deletedAt: new Date() } });
    expect(await readMoveInOrganizerCounts(db, at)).toEqual({ tags: 1, categories: 0, tools: 0 });
  });
});

describe("attachMovedInOrganizersTogether", () => {
  let d1: SqliteD1;
  const now = new Date("2026-11-24T12:00:00.000Z");

  beforeEach(() => {
    d1 = sqliteD1();
  });

  afterEach(() => d1.close());

  it("puts a chunk's tags, categories and tools on its recipes in two round trips, making each organizer once as the first recipe spells it, and again changes nothing", async () => {
    const at = await kitchen();
    const { ownerId, recipeId } = at;
    const second = await db.recipe.create({ data: createTestRecipe(ownerId) });
    const other = await db.recipe.create({ data: createTestRecipe(ownerId) });
    await setRecipeOrganizers(store, ownerId, recipeId, "tag", ["Cozy"]);
    await setRecipeOrganizers(store, ownerId, other.id, "tool", ["SKILLET"]);
    const chunk = [
      { ...at, tags: ["Quick", "quick"], categories: ["Dinner"], tools: [] },
      { ...at, recipeId: second.id, tags: ["quick"], categories: [], tools: ["skillet", "x".repeat(61)] },
      { ...at, recipeId: other.id, ...none },
    ];

    expect(await attachMovedInOrganizersTogether(d1.binding, chunk, now)).toEqual([null, null, null]);
    expect(d1.roundTrips()).toBe(2);
    expect(await attachMovedInOrganizersTogether(d1.binding, chunk, now)).toEqual([null, null, null]);

    expect(await on(recipeId, "tag")).toEqual(["Cozy", "Quick"]);
    expect(await on(recipeId, "category")).toEqual(["Dinner"]);
    expect(await on(second.id, "tag")).toEqual(["Quick"]);
    expect(await on(second.id, "tool")).toEqual(["SKILLET"]);
    expect(await on(other.id, "tag")).toEqual([]);
    expect(await db.organizer.count({ where: { ownerId } })).toBe(4);
    expect(await readMoveInOrganizerCounts(db, at)).toEqual({ tags: 1, categories: 1, tools: 1 });
  });

  it("answers an error for a recipe that isn't the cook's or was deleted, and still brings the rest", async () => {
    const at = await kitchen();
    const theirs = await kitchen();
    const deleted = await db.recipe.create({ data: { ...createTestRecipe(at.ownerId), deletedAt: new Date() } });
    const answers = await attachMovedInOrganizersTogether(d1.binding, [
      { ...theirs, recipeId: at.recipeId, ...none, tags: ["Theirs"] },
      { ...at, recipeId: deleted.id, ...none, tags: ["Gone"] },
      { ...at, ...none, tags: ["Quick"] },
    ], now);

    expect(answers.map((answer) => answer?.message ?? null)).toEqual(["the recipe is no longer in your kitchen", "the recipe is no longer in your kitchen", null]);
    expect(await on(at.recipeId, "tag")).toEqual(["Quick"]);
    expect(await db.organizer.count()).toBe(1);
  });

  it("writes nothing for a chunk with none to put on, and reads nothing for an empty one", async () => {
    const at = await kitchen();
    expect(await attachMovedInOrganizersTogether(d1.binding, [], now)).toEqual([]);
    expect(d1.roundTrips()).toBe(0);
    expect(await attachMovedInOrganizersTogether(d1.binding, [{ ...at, ...none }], now)).toEqual([null]);
    expect(d1.roundTrips()).toBe(1);
  });

  it("reads a chunk of many recipes in pieces D1 accepts", async () => {
    const at = await kitchen();
    const many = [];
    for (let n = 0; n < 95; n++) many.push({ ...at, recipeId: (await db.recipe.create({ data: createTestRecipe(at.ownerId) })).id, ...none, tags: ["Quick"] });

    expect(await attachMovedInOrganizersTogether(d1.binding, many, now)).toEqual(many.map(() => null));
    expect(d1.statements.filter((statement) => statement.sql.startsWith(`SELECT "id", "chefId"`)).map((statement) => statement.params.length)).toEqual([90, 5]);
    expect(await db.recipeOrganizer.count()).toBe(95);
  });

  it("throws when its write fails, so each recipe can go alone", async () => {
    const at = await kitchen();
    let trips = 0;
    const failing = { prepare: d1.binding.prepare, batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => (++trips === 1 ? d1.binding.batch(statements) : Promise.reject(new Error("D1 is down"))) };
    await expect(attachMovedInOrganizersTogether(failing, [{ ...at, ...none, tags: ["Quick"] }], now)).rejects.toThrow("D1 is down");
    expect(await db.organizer.count()).toBe(0);
  });
});
