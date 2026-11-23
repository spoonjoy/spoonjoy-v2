// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { addEntry, lastMade, markCooked, prismaLastMadeStore, prismaPlanStore, removeEntry, type LastMadeStore, type PlanStore } from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let plans: PlanStore;
let made: LastMadeStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

describe("last made, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    plans = prismaPlanStore(db);
    made = prismaLastMadeStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("marks a planned meal cooked and clears it again, only on the cook's own live entries", async () => {
    const chef = await cook();
    const friend = await cook();
    await addEntry(plans, chef.id, "entry-mine", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Tacos" });
    await addEntry(plans, chef.id, "entry-gone", { kind: "note", date: "2026-11-24", mealType: "lunch", title: "Soup" });
    await removeEntry(plans, chef.id, "entry-gone");
    await addEntry(plans, friend.id, "entry-theirs", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Pasta" });
    const at = new Date("2026-11-24T19:00:00Z");

    expect(await markCooked(made, chef.id, "entry-mine", true, at)).toBe(true);
    expect((await db.planEntry.findUnique({ where: { id: "entry-mine" } }))?.cookedAt).toEqual(at);
    expect(await markCooked(made, chef.id, "entry-mine", false, at)).toBe(true);
    expect((await db.planEntry.findUnique({ where: { id: "entry-mine" } }))?.cookedAt).toBeNull();

    expect(await markCooked(made, chef.id, "entry-gone", true, at)).toBe(false);
    expect(await markCooked(made, chef.id, "entry-theirs", true, at)).toBe(false);
    expect(await markCooked(made, chef.id, "no-such-entry", true, at)).toBe(false);
    expect((await db.planEntry.findUnique({ where: { id: "entry-theirs" } }))?.cookedAt).toBeNull();
  });

  it("takes each recipe's latest cook from the cook's own logs and cooked plan entries", async () => {
    const chef = await cook();
    const friend = await cook();
    const rice = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Lemon Herb Rice" } });
    const stew = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Bean Stew" } });
    const pie = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Apple Pie" } });
    const never = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Never Made" } });

    await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: rice.id, cookedAt: new Date("2026-11-01T18:00:00Z") } });
    await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: rice.id, cookedAt: new Date("2026-11-10T18:00:00Z") } });
    await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: rice.id, cookedAt: new Date("2026-11-20T18:00:00Z"), deletedAt: new Date() } });
    await db.recipeSpoon.create({ data: { chefId: friend.id, recipeId: stew.id, cookedAt: new Date("2026-11-22T18:00:00Z") } });

    await addEntry(plans, chef.id, "entry-stew", { kind: "recipe", date: "2026-11-12", mealType: "dinner", recipeId: stew.id });
    await markCooked(made, chef.id, "entry-stew", true, new Date("2026-11-12T19:00:00Z"));
    await addEntry(plans, chef.id, "entry-rice", { kind: "recipe", date: "2026-11-05", mealType: "dinner", recipeId: rice.id });
    await markCooked(made, chef.id, "entry-rice", true, new Date("2026-11-05T19:00:00Z"));
    await addEntry(plans, chef.id, "entry-pie", { kind: "recipe", date: "2026-11-15", mealType: "dessert", recipeId: pie.id });
    await markCooked(made, chef.id, "entry-pie", true, new Date("2026-11-15T19:00:00Z"));
    await removeEntry(plans, chef.id, "entry-pie");
    await addEntry(plans, friend.id, "entry-friend-pie", { kind: "recipe", date: "2026-11-16", mealType: "dessert", recipeId: pie.id });
    await markCooked(made, friend.id, "entry-friend-pie", true, new Date("2026-11-16T19:00:00Z"));

    const result = await lastMade(made, chef.id, [rice.id, stew.id, pie.id, never.id, rice.id]);
    expect(result).toEqual(new Map([
      [rice.id, new Date("2026-11-10T18:00:00Z")],
      [stew.id, new Date("2026-11-12T19:00:00Z")],
    ]));
    expect(await lastMade(made, chef.id, [])).toEqual(new Map());
  });
});
