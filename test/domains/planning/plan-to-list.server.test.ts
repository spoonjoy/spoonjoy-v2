// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { addEntry, addPlannedMealsToList, prismaPlanStore, recipesToShop, removeEntry, type PlanEntry, type PlanStore, type ShoppingListPort } from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

function entry(overrides: Partial<PlanEntry>): PlanEntry {
  return { id: "e", date: "2026-11-23", mealType: "dinner", position: 0, kind: "recipe", recipeId: "r1", recipeTitle: "Rice", title: "", note: "", scaleFactor: 1, ...overrides };
}

describe("recipes to shop for", () => {
  it("adds up the servings of a recipe planned more than once and leaves notes out", () => {
    const entries = [
      entry({ id: "a", recipeId: "rice", scaleFactor: 2 }),
      entry({ id: "b", recipeId: "soup", scaleFactor: 1 }),
      entry({ id: "c", recipeId: "rice", scaleFactor: 0.5, date: "2026-11-25" }),
      entry({ id: "d", kind: "note", recipeId: null, title: "Eat out" }),
    ];
    expect(recipesToShop(entries)).toEqual([
      { recipeId: "rice", scaleFactor: 2.5, entryIds: ["a", "c"] },
      { recipeId: "soup", scaleFactor: 1, entryIds: ["b"] },
    ]);
  });
});

describe("adding planned meals to the shopping list", () => {
  let db: PrismaClient;
  let store: PlanStore;
  let added: Array<{ recipeId: string; scaleFactor: number; writeKey: string }>;
  let list: ShoppingListPort;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    store = prismaPlanStore(db);
    added = [];
    list = {
      async addRecipe(recipeId, scaleFactor, writeKey) {
        added.push({ recipeId, scaleFactor, writeKey });
        return recipeId !== "gone";
      },
    };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("adds each recipe planned in the days asked for once, at its total servings, keyed by the submission", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const rice = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Rice" } });
    const soup = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Soup" } });
    await addEntry(store, { cook: chef.id }, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id, scaleFactor: 2 });
    await addEntry(store, { cook: chef.id }, "wed", { kind: "recipe", date: "2026-11-25", mealType: "lunch", recipeId: rice.id, scaleFactor: 1 });
    await addEntry(store, { cook: chef.id }, "thu", { kind: "recipe", date: "2026-11-26", mealType: "dinner", recipeId: soup.id });
    await addEntry(store, { cook: chef.id }, "removed", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: soup.id });
    await removeEntry(store, { cook: chef.id }, "removed");
    await addEntry(store, { cook: chef.id }, "next-week", { kind: "recipe", date: "2026-11-30", mealType: "dinner", recipeId: soup.id });
    await addEntry(store, { cook: chef.id }, "note", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });

    const result = await addPlannedMealsToList(store, list, { cook: chef.id }, { from: "2026-11-23", to: "2026-11-29" }, "submit-1");

    expect(added).toEqual([
      { recipeId: rice.id, scaleFactor: 3, writeKey: `submit-1:${rice.id}` },
      { recipeId: soup.id, scaleFactor: 1, writeKey: `submit-1:${soup.id}` },
    ]);
    expect(result).toEqual({ recipes: 2, missing: 0 });
  });

  it("adds just one day when asked, and counts a recipe the list could not find", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const rice = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Rice" } });
    await addEntry(store, { cook: chef.id }, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addEntry(store, { cook: chef.id }, "tue", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: rice.id, scaleFactor: 4 });
    list = { addRecipe: async () => false };

    expect(await addPlannedMealsToList(store, list, { cook: chef.id }, { from: "2026-11-24", to: "2026-11-24" }, "k")).toEqual({ recipes: 0, missing: 1 });
  });

  it("refuses a range backwards or longer than a week", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    await expect(addPlannedMealsToList(store, list, { cook: chef.id }, { from: "2026-11-25", to: "2026-11-24" }, "k")).rejects.toThrow("from");
    await expect(addPlannedMealsToList(store, list, { cook: chef.id }, { from: "2026-11-23", to: "2026-11-30" }, "k")).rejects.toThrow("week");
  });
});
