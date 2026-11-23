// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { addEntry, getWeek, moveEntry, prismaPlanStore, removeEntry, todayIn, type PlanStore } from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let store: PlanStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

describe("planning today", () => {
  it("is the calendar day in the plan's own time zone, not the server's", () => {
    const now = new Date("2026-11-24T03:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-11-24");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-11-23");
    expect(todayIn("Not/AZone", now)).toBe("2026-11-24");
  });
});

describe("planning a week, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    store = prismaPlanStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("starts an empty week on Monday for a cook with no plan yet, and makes the plan once", async () => {
    const chef = await cook();
    const week = await getWeek(store, chef.id, "2026-11-26");
    expect(week.start).toBe("2026-11-23");
    expect(week.days.map((day) => day.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.days.every((day) => day.entries.length === 0)).toBe(true);
    await getWeek(store, chef.id, "2026-12-01");
    expect(await db.mealPlan.count({ where: { ownerId: chef.id } })).toBe(1);
  });

  it("plans a recipe at a scale and a note, each on its day, and keeps them to the cook's own plan", async () => {
    const chef = await cook();
    const friend = await cook();
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Lemon Herb Rice" } });

    const soup = await addEntry(store, chef.id, "entry-soup", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id, scaleFactor: 2 });
    const out = await addEntry(store, chef.id, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out", note: "Tacos" });
    await addEntry(store, chef.id, "entry-lunch", { kind: "note", date: "2026-11-24", mealType: "lunch", title: "Leftovers" });
    await addEntry(store, friend.id, "entry-friend", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Not yours" });

    expect(soup).toEqual({
      ok: true,
      value: {
        id: "entry-soup", date: "2026-11-24", mealType: "dinner", position: 0, kind: "recipe",
        recipeId: recipe.id, recipeTitle: "Lemon Herb Rice", title: "", note: "", scaleFactor: 2,
      },
    });
    expect(out.ok && out.value.position).toBe(1);

    const week = await getWeek(store, chef.id, "2026-11-24");
    expect(week.days[1].entries.map((planned) => planned.id)).toEqual(["entry-lunch", "entry-soup", "entry-out"]);
    expect(week.days[1].entries[2]).toMatchObject({ title: "Eat out", note: "Tacos", recipeId: null, recipeTitle: null });
    expect(await db.planEntry.findUnique({ where: { id: "entry-soup" }, select: { addedById: true } })).toEqual({ addedById: chef.id });
  });

  it("adds an entry once when the same add is sent again", async () => {
    const chef = await cook();
    const input = { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" };
    const first = await addEntry(store, chef.id, "entry-once", input);
    const again = await addEntry(store, chef.id, "entry-once", { ...input, title: "Changed my mind" });
    expect(again).toEqual(first);
    expect(await db.planEntry.count()).toBe(1);
  });

  it("refuses an entry for a recipe the cook can't plan, or input it can't read", async () => {
    const chef = await cook();
    const gone = await db.recipe.create({ data: { ...createTestRecipe(chef.id), deletedAt: new Date() } });
    expect(await addEntry(store, chef.id, "e1", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: gone.id })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    expect(await addEntry(store, chef.id, "e2", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: "missing" })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    expect(await addEntry(store, chef.id, "e3", { kind: "note", date: "nope", mealType: "dinner", title: "x" })).toEqual({ ok: false, error: "Choose a day for this meal." });
    expect(await db.planEntry.count()).toBe(0);
  });

  it("removes an entry from its own plan only, and a removed entry stays gone", async () => {
    const chef = await cook();
    const friend = await cook();
    await addEntry(store, chef.id, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });

    expect(await removeEntry(store, friend.id, "entry-out")).toBe(false);
    expect(await removeEntry(store, chef.id, "entry-out")).toBe(true);
    expect(await removeEntry(store, chef.id, "entry-out")).toBe(false);
    expect((await getWeek(store, chef.id, "2026-11-24")).days[1].entries).toEqual([]);

    const readded = await addEntry(store, chef.id, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });
    expect(readded).toEqual({ ok: false, error: "That meal was removed from the plan." });
  });

  it("keeps an entry readable after its recipe is deleted", async () => {
    const chef = await cook();
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Gone Soup" } });
    await addEntry(store, chef.id, "entry-soup", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id });
    await db.recipe.delete({ where: { id: recipe.id } });
    expect((await getWeek(store, chef.id, "2026-11-24")).days[1].entries[0]).toMatchObject({ kind: "recipe", recipeId: null, recipeTitle: "Gone Soup" });
  });

  it("opens on this week, in the plan's own time zone, when no week is asked for", async () => {
    const chef = await cook();
    await getWeek(store, chef.id, null);
    await db.mealPlan.update({ where: { ownerId: chef.id }, data: { timeZone: "America/Los_Angeles" } });
    const week = await getWeek(store, chef.id, null, new Date("2026-11-24T03:30:00Z"));
    expect(week).toMatchObject({ today: "2026-11-23", start: "2026-11-23", timeZone: "America/Los_Angeles" });
  });

  it("starts the week on the plan's own first day", async () => {
    const chef = await cook();
    await getWeek(store, chef.id, "2026-11-24");
    await db.mealPlan.update({ where: { ownerId: chef.id }, data: { firstDayOfWeek: 0 } });
    expect((await getWeek(store, chef.id, "2026-11-24")).start).toBe("2026-11-22");
  });

  describe("moving an entry", () => {
    async function plannedWeek() {
      const chef = await cook();
      for (const [id, date, mealType] of [["a", "2026-11-23", "dinner"], ["b", "2026-11-23", "dinner"], ["c", "2026-11-23", "dinner"], ["d", "2026-11-24", "lunch"]]) {
        await addEntry(store, chef.id, id, { kind: "note", title: id, date, mealType });
      }
      return chef;
    }

    async function slot(ownerId: string, date: string, mealType: string) {
      const week = await getWeek(store, ownerId, date);
      return week.days.find((day) => day.date === date)!.entries.filter((entry) => entry.mealType === mealType).map((entry) => entry.id);
    }

    it("reorders an entry inside its own day and meal", async () => {
      const chef = await plannedWeek();
      const moved = await moveEntry(store, chef.id, "c", { date: "2026-11-23", mealType: "dinner", index: 0 });
      expect(moved).toMatchObject({ ok: true, value: { id: "c", date: "2026-11-23", mealType: "dinner", position: 0 } });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["c", "a", "b"]);
    });

    it("moves an entry to another day and meal, at the asked place, and leaves the rest in order", async () => {
      const chef = await plannedWeek();
      await moveEntry(store, chef.id, "a", { date: "2026-11-24", mealType: "lunch", index: 1 });
      expect(await slot(chef.id, "2026-11-24", "lunch")).toEqual(["d", "a"]);
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["b", "c"]);
    });

    it("puts an entry last when the asked place is past the end, and first when it is below zero or not a number", async () => {
      const chef = await plannedWeek();
      await moveEntry(store, chef.id, "a", { date: "2026-11-23", mealType: "dinner", index: 99 });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["b", "c", "a"]);
      await moveEntry(store, chef.id, "a", { date: "2026-11-23", mealType: "dinner", index: -3 });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["a", "b", "c"]);
      await moveEntry(store, chef.id, "c", { date: "2026-11-23", mealType: "dinner", index: Number.NaN });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["c", "a", "b"]);
    });

    it("refuses an entry that isn't on the cook's plan, or a place it can't read", async () => {
      const chef = await plannedWeek();
      const other = await cook();
      await addEntry(store, other.id, "theirs", { kind: "note", title: "Theirs", date: "2026-11-23", mealType: "dinner" });
      await removeEntry(store, chef.id, "b");
      const to = { date: "2026-11-25", mealType: "dinner", index: 0 };
      expect(await moveEntry(store, chef.id, "theirs", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, chef.id, "b", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, chef.id, "missing", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, chef.id, "a", { ...to, date: "soon" })).toEqual({ ok: false, error: "Choose a day for this meal." });
      expect(await moveEntry(store, chef.id, "a", { ...to, mealType: "brunch" })).toEqual({ ok: false, error: "Choose a meal type." });
      expect(await slot(other.id, "2026-11-23", "dinner")).toEqual(["theirs"]);
    });
  });
});
