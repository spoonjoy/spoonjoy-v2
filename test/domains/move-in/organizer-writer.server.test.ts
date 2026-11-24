// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { organizersOnRecipe, prismaOrganizerStore, setRecipeOrganizers, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";
import { readMoveInOrganizerCounts } from "~/domains/move-in/adapters/storage/organizer-writer.server";
import { attachMovedInOrganizers } from "~/domains/move-in/adapters/storage/organizer-writer.server";
import { cleanupDatabase } from "../../helpers/cleanup";
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
