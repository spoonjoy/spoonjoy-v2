// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  addEntry,
  addPlannedMealsToList,
  getWeek,
  isOnList,
  prismaPlanStore,
  removeEntry,
  scaleToList,
  type PlanEntry,
  type PlanStore,
  type ShoppingListPort,
} from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

function entry(overrides: Partial<PlanEntry>): PlanEntry {
  return { id: "e", date: "2026-11-23", mealType: "dinner", position: 0, kind: "recipe", recipeId: "r1", recipeTitle: "Rice", title: "", note: "", scaleFactor: 1, listedScale: 0, ...overrides };
}

describe("what a planned meal still needs on the list", () => {
  it("is the whole scale until the meal is on the list, then only what its scale grew by", () => {
    expect(scaleToList(entry({ scaleFactor: 2 }))).toBe(2);
    expect(scaleToList(entry({ scaleFactor: 2, listedScale: 2 }))).toBe(0);
    expect(scaleToList(entry({ scaleFactor: 3, listedScale: 2 }))).toBe(1);
    expect(scaleToList(entry({ scaleFactor: 0.3, listedScale: 0.1 }))).toBe(0.2);
  });

  it("is nothing once its scale went down, for a meal whose recipe was deleted, and for a note", () => {
    expect(scaleToList(entry({ scaleFactor: 1, listedScale: 2 }))).toBe(0);
    expect(scaleToList(entry({ recipeId: null }))).toBe(0);
    expect(scaleToList(entry({ kind: "note", recipeId: null, title: "Eat out" }))).toBe(0);
  });

  it("is on the list once all of its scale is, and a note never is", () => {
    expect(isOnList(entry({ scaleFactor: 2, listedScale: 2 }))).toBe(true);
    expect(isOnList(entry({ scaleFactor: 1, listedScale: 2 }))).toBe(true);
    expect(isOnList(entry({ scaleFactor: 3, listedScale: 2 }))).toBe(false);
    expect(isOnList(entry({}))).toBe(false);
    expect(isOnList(entry({ kind: "note", recipeId: null, title: "Eat out" }))).toBe(false);
  });
});

describe("adding planned meals to the shopping list", () => {
  let db: PrismaClient;
  let store: PlanStore;
  let added: Array<{ recipeId: string; scaleFactor: number; writeKey: string }>;
  let list: ShoppingListPort;
  const week = { from: "2026-11-23", to: "2026-11-29" } as const;

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

  async function cookWithRecipes() {
    const chef = await db.user.create({ data: createTestUser() });
    const rice = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Rice" } });
    const soup = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Soup" } });
    return { chef, rice, soup, scope: { cook: chef.id } };
  }

  async function listedScales(scope: { cook: string }) {
    const { days } = await getWeek(store, scope, week.from);
    return Object.fromEntries(days.flatMap((day) => day.entries).map((planned) => [planned.id, planned.listedScale]));
  }

  it("adds each new meal planned in the days asked for at its scale, keyed by the meal, and records it on the meal", async () => {
    const { rice, soup, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id, scaleFactor: 2 });
    await addEntry(store, scope, "wed", { kind: "recipe", date: "2026-11-25", mealType: "lunch", recipeId: rice.id, scaleFactor: 1 });
    await addEntry(store, scope, "thu", { kind: "recipe", date: "2026-11-26", mealType: "dinner", recipeId: soup.id });
    await addEntry(store, scope, "next-week", { kind: "recipe", date: "2026-11-30", mealType: "dinner", recipeId: soup.id });
    await addEntry(store, scope, "note", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });

    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 3, missing: 0 });

    expect(added).toEqual([
      { recipeId: rice.id, scaleFactor: 2, writeKey: "plan-entry:mon:0:2" },
      { recipeId: rice.id, scaleFactor: 1, writeKey: "plan-entry:wed:0:1" },
      { recipeId: soup.id, scaleFactor: 1, writeKey: "plan-entry:thu:0:1" },
    ]);
    expect(await listedScales(scope)).toEqual({ mon: 2, wed: 1, thu: 1, note: 0 });
  });

  it("after a reload adds nothing more, and a meal planned later adds only that meal", async () => {
    const { rice, soup, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addPlannedMealsToList(store, list, scope, week);
    added = [];

    // A fresh store is a reload or another device: all it has is what the meals recorded.
    store = prismaPlanStore(db);
    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 0, missing: 0 });
    expect(added).toEqual([]);

    await addEntry(store, scope, "tue", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: soup.id });
    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 1, missing: 0 });
    expect(added).toEqual([{ recipeId: soup.id, scaleFactor: 1, writeKey: "plan-entry:tue:0:1" }]);
  });

  it("adds the meal planned in place of a removed one, and takes nothing off the list for the removed meal", async () => {
    const { rice, soup, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addPlannedMealsToList(store, list, scope, week);
    await removeEntry(store, scope, "mon");
    await addEntry(store, scope, "mon-2", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: soup.id });
    added = [];

    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 1, missing: 0 });
    expect(added).toEqual([{ recipeId: soup.id, scaleFactor: 1, writeKey: "plan-entry:mon-2:0:1" }]);
  });

  it("adds only what a meal's scale grew by, and nothing when it shrank", async () => {
    const { rice, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addPlannedMealsToList(store, list, scope, week);
    added = [];

    await db.planEntry.update({ where: { id: "mon" }, data: { scaleFactor: 2 } });
    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 1, missing: 0 });
    expect(added).toEqual([{ recipeId: rice.id, scaleFactor: 1, writeKey: "plan-entry:mon:1:2" }]);
    expect(await listedScales(scope)).toEqual({ mon: 2 });

    added = [];
    await db.planEntry.update({ where: { id: "mon" }, data: { scaleFactor: 1 } });
    expect(await addPlannedMealsToList(store, list, scope, week)).toEqual({ meals: 0, missing: 0 });
    expect(added).toEqual([]);
    expect(await listedScales(scope)).toEqual({ mon: 2 });
  });

  it("hands a list that writes the meals together one key for them, after it gathered each", async () => {
    const { rice, soup, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addEntry(store, scope, "tue", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: soup.id, scaleFactor: 2 });
    const gathered: string[] = [];
    const together: ShoppingListPort = { ...list, async addGathered(writeKey) { gathered.push(`${added.length}:${writeKey}`); } };

    await addPlannedMealsToList(store, together, scope, week);
    expect(gathered).toEqual(["2:plan-entry:mon:0:1,plan-entry:tue:0:2"]);

    // With nothing new to add, the list is not asked to write.
    await addPlannedMealsToList(store, together, scope, week);
    expect(gathered).toHaveLength(1);
  });

  it("leaves the meals off the list's record when the list's write fails, so the next try adds them", async () => {
    const { rice, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    const failing: ShoppingListPort = { ...list, addGathered: async () => { throw new Error("D1 is down"); } };

    await expect(addPlannedMealsToList(store, failing, scope, week)).rejects.toThrow("D1 is down");
    expect(await listedScales(scope)).toEqual({ mon: 0 });
  });

  it("adds just one day when asked, and counts a meal whose recipe the list could not find, which it doesn't offer again", async () => {
    const { rice, scope } = await cookWithRecipes();
    await addEntry(store, scope, "mon", { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: rice.id });
    await addEntry(store, scope, "tue", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: rice.id, scaleFactor: 4 });
    list = { addRecipe: async () => false };

    expect(await addPlannedMealsToList(store, list, scope, { from: "2026-11-24", to: "2026-11-24" })).toEqual({ meals: 0, missing: 1 });
    expect(await listedScales(scope)).toEqual({ mon: 0, tue: 4 });
  });

  it("refuses a range backwards or longer than a week", async () => {
    const { scope } = await cookWithRecipes();
    await expect(addPlannedMealsToList(store, list, scope, { from: "2026-11-25", to: "2026-11-24" })).rejects.toThrow("from");
    await expect(addPlannedMealsToList(store, list, scope, { from: "2026-11-23", to: "2026-11-30" })).rejects.toThrow("week");
  });
});
