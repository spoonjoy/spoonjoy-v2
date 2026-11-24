// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { organizersOnRecipe, prismaOrganizerStore, setRecipeOrganizers, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";
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
  return { ownerId: cook.id, recipeId: recipe.id };
}

const on = async (recipeId: string, kind: OrganizerKind) => (await organizersOnRecipe(store, recipeId, kind)).map((organizer) => organizer.name);

describe("attachMovedInOrganizers", () => {
  it("puts the tags, categories and tools on the recipe beside the ones it has, once each, and again changes nothing", async () => {
    const { ownerId, recipeId } = await kitchen();
    await setRecipeOrganizers(store, ownerId, recipeId, "tag", ["Cozy"]);
    const moved = { ownerId, recipeId, tags: ["Quick", "quick"], categories: ["Dinner"], tools: [] };

    await attachMovedInOrganizers(store, moved);
    await attachMovedInOrganizers(store, moved);

    expect(await on(recipeId, "tag")).toEqual(["Cozy", "Quick"]);
    expect(await on(recipeId, "category")).toEqual(["Dinner"]);
    expect(await on(recipeId, "tool")).toEqual([]);
    expect(await db.organizer.count({ where: { ownerId } })).toBe(3);
  });

  it("uses the tag the cook already has under another spelling", async () => {
    const { ownerId, recipeId } = await kitchen();
    const other = await db.recipe.create({ data: createTestRecipe(ownerId) });
    await setRecipeOrganizers(store, ownerId, other.id, "tag", ["QUICK"]);

    await attachMovedInOrganizers(store, { ownerId, recipeId, tags: ["quick"], categories: [], tools: [] });

    expect(await on(recipeId, "tag")).toEqual(["QUICK"]);
    expect(await db.organizer.count({ where: { ownerId } })).toBe(1);
  });

  it("refuses a recipe that isn't the cook's", async () => {
    const { recipeId } = await kitchen();
    const { ownerId } = await kitchen();
    await expect(attachMovedInOrganizers(store, { ownerId, recipeId, tags: ["Quick"], categories: [], tools: [] })).rejects.toThrow(
      "the recipe is no longer in your kitchen",
    );
    expect(await on(recipeId, "tag")).toEqual([]);
  });
});
