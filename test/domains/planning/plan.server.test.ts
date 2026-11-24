// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { actingCookOf, addEntry, getWeek, moveEntry, plannableRecipes, prismaPlanStore, removeEntry, todayIn, type PlanScope, type PlanStore } from "~/domains/planning";
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

  it("says when the cook last made each planned recipe, on the plan's own calendar, from their live cooks only", async () => {
    const chef = await cook();
    const friend = await cook();
    const rice = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Lemon Herb Rice" } });
    const stew = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Bean Stew" } });
    const never = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Never Made" } });
    await db.mealPlan.create({ data: { ownerId: chef.id, timeZone: "America/Los_Angeles" } });
    await db.recipeSpoon.createMany({
      data: [
        { chefId: chef.id, recipeId: rice.id, cookedAt: new Date("2026-10-01T18:00:00Z") },
        // Late on Nov 2 in Los Angeles, already Nov 3 in UTC.
        { chefId: chef.id, recipeId: rice.id, cookedAt: new Date("2026-11-03T05:00:00Z") },
        { chefId: chef.id, recipeId: stew.id, cookedAt: new Date("2026-11-20T18:00:00Z"), deletedAt: new Date() },
        { chefId: friend.id, recipeId: stew.id, cookedAt: new Date("2026-11-21T18:00:00Z") },
      ],
    });
    for (const [id, recipe] of [["entry-rice", rice], ["entry-stew", stew], ["entry-never", never]] as const) {
      await addEntry(store, { cook: chef.id }, id, { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id });
    }
    await addEntry(store, { cook: chef.id }, "entry-note", { kind: "note", date: "2026-11-25", mealType: "lunch", title: "Out" });

    const week = await getWeek(store, { cook: chef.id }, "2026-11-24");
    expect(week.lastMade).toEqual({ [rice.id]: "2026-11-02" });
  });

  it("starts an empty week on Monday for a cook with no plan yet, and makes the plan once", async () => {
    const chef = await cook();
    const week = await getWeek(store, { cook: chef.id }, "2026-11-26");
    expect(week.start).toBe("2026-11-23");
    expect(week.days.map((day) => day.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.days.every((day) => day.entries.length === 0)).toBe(true);
    await getWeek(store, { cook: chef.id }, "2026-12-01");
    expect(await db.mealPlan.count({ where: { ownerId: chef.id } })).toBe(1);
  });

  it("plans a recipe at a scale and a note, each on its day, and keeps them to the cook's own plan", async () => {
    const chef = await cook();
    const friend = await cook();
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Lemon Herb Rice" } });

    const soup = await addEntry(store, { cook: chef.id }, "entry-soup", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id, scaleFactor: 2 });
    const out = await addEntry(store, { cook: chef.id }, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out", note: "Tacos" });
    await addEntry(store, { cook: chef.id }, "entry-lunch", { kind: "note", date: "2026-11-24", mealType: "lunch", title: "Leftovers" });
    await addEntry(store, { cook: friend.id }, "entry-friend", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Not yours" });

    expect(soup).toEqual({
      ok: true,
      value: {
        id: "entry-soup", date: "2026-11-24", mealType: "dinner", position: 0, kind: "recipe",
        recipeId: recipe.id, recipeTitle: "Lemon Herb Rice", title: "", note: "", scaleFactor: 2,
      },
    });
    expect(out.ok && out.value.position).toBe(1);

    const week = await getWeek(store, { cook: chef.id }, "2026-11-24");
    expect(week.days[1].entries.map((planned) => planned.id)).toEqual(["entry-lunch", "entry-soup", "entry-out"]);
    expect(week.days[1].entries[2]).toMatchObject({ title: "Eat out", note: "Tacos", recipeId: null, recipeTitle: null });
    expect(await db.planEntry.findUnique({ where: { id: "entry-soup" }, select: { addedById: true } })).toEqual({ addedById: chef.id });
  });

  it("adds an entry once when the same add is sent again", async () => {
    const chef = await cook();
    const input = { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" };
    const first = await addEntry(store, { cook: chef.id }, "entry-once", input);
    const again = await addEntry(store, { cook: chef.id }, "entry-once", { ...input, title: "Changed my mind" });
    expect(again).toEqual(first);
    expect(await db.planEntry.count()).toBe(1);
  });

  it("refuses an entry for a recipe the cook can't plan, or input it can't read", async () => {
    const chef = await cook();
    const gone = await db.recipe.create({ data: { ...createTestRecipe(chef.id), deletedAt: new Date() } });
    expect(await addEntry(store, { cook: chef.id }, "e1", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: gone.id })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    expect(await addEntry(store, { cook: chef.id }, "e2", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: "missing" })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    expect(await addEntry(store, { cook: chef.id }, "e3", { kind: "note", date: "nope", mealType: "dinner", title: "x" })).toEqual({ ok: false, error: "Choose a day for this meal." });
    expect(await db.planEntry.count()).toBe(0);
  });

  it("keeps a household's plan apart from its cooks' own: one plan per household, and its entries only there", async () => {
    const chef = await cook();
    const partner = await cook();
    const household = await db.household.create({ data: { name: "Our kitchen" } });
    const ours: PlanScope = { household: household.id, actingCook: chef.id };
    const theirs: PlanScope = { household: household.id, actingCook: partner.id };
    await addEntry(store, ours, "shared-dinner", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Tacos" });
    await addEntry(store, theirs, "shared-soup", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Soup" });
    await addEntry(store, { cook: chef.id }, "own-dinner", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Just me" });

    const titles = async (scope: PlanScope) => (await getWeek(store, scope, "2026-11-24")).days[1].entries.map((entry) => entry.title);
    expect(await titles(theirs)).toEqual(["Tacos", "Soup"]);
    expect(await titles({ cook: chef.id })).toEqual(["Just me"]);
    expect(await db.householdPlan.count()).toBe(1);
    expect(await db.householdPlanEntry.findMany({ select: { id: true, addedById: true }, orderBy: { id: "asc" } })).toEqual([
      { id: "shared-dinner", addedById: chef.id },
      { id: "shared-soup", addedById: partner.id },
    ]);

    expect(await moveEntry(store, theirs, "shared-soup", { date: "2026-11-24", mealType: "dinner", index: 0 })).toMatchObject({ ok: true });
    expect(await titles(ours)).toEqual(["Soup", "Tacos"]);
    expect(await moveEntry(store, ours, "own-dinner", { date: "2026-11-24", mealType: "dinner", index: 0 })).toEqual({ ok: false, error: "That meal isn't on your plan." });
    expect(await removeEntry(store, ours, "own-dinner")).toBe(false);
    expect(await removeEntry(store, ours, "shared-dinner")).toBe(true);
    expect(await addEntry(store, ours, "shared-dinner", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Again" })).toEqual({ ok: false, error: "That meal was removed from the plan." });
    expect(await titles(ours)).toEqual(["Soup"]);

    await db.household.delete({ where: { id: household.id } });
    expect(await db.householdPlanEntry.count()).toBe(0);
    expect(await titles({ cook: chef.id })).toEqual(["Just me"]);
  });

  it("acts as the acting cook on a household plan: they add the entries, their cooks count and their read rights apply", async () => {
    const host = await cook();
    const chef = await cook();
    const household = await db.household.create({ data: { name: "Our kitchen" } });
    const scope: PlanScope = { household: household.id, actingCook: chef.id };
    const hostsSecret = await db.recipe.create({ data: { ...createTestRecipe(host.id), visibility: "private" } });
    const chefs = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Chef's Curry", visibility: "private" } });
    await db.recipeSpoon.create({ data: { chefId: chef.id, recipeId: chefs.id, cookedAt: new Date("2026-11-20T18:00:00Z") } });

    expect(await addEntry(store, scope, "e1", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: hostsSecret.id })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    expect(await addEntry(store, scope, "e2", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: chefs.id })).toMatchObject({ ok: true });
    expect((await getWeek(store, scope, "2026-11-24")).lastMade).toEqual({ [chefs.id]: "2026-11-20" });
    expect((await plannableRecipes(store, scope, null)).recipes).toEqual([{ id: chefs.id, title: "Chef's Curry" }]);
    expect(actingCookOf(scope)).toBe(chef.id);
    expect(actingCookOf({ cook: host.id })).toBe(host.id);
  });

  it("refuses another cook's private or household recipe, and plans their public one", async () => {
    const chef = await cook();
    const friend = await cook();
    const hidden = await db.recipe.create({ data: { ...createTestRecipe(friend.id), visibility: "private" } });
    const shared = await db.recipe.create({ data: { ...createTestRecipe(friend.id), visibility: "household" } });
    const open = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Open Soup", visibility: "public" } });
    const refused = { ok: false, error: "That recipe isn't available to plan." };
    expect(await addEntry(store, { cook: chef.id }, "e1", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: hidden.id })).toEqual(refused);
    expect(await addEntry(store, { cook: chef.id }, "e2", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: shared.id })).toEqual(refused);
    expect(await addEntry(store, { cook: chef.id }, "e3", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: open.id })).toMatchObject({ ok: true, value: { recipeTitle: "Open Soup" } });
    const own = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "My Secret Stew", visibility: "private" } });
    expect(await addEntry(store, { cook: chef.id }, "e4", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: own.id })).toMatchObject({ ok: true, value: { recipeTitle: "My Secret Stew" } });
  });

  describe("the recipes a cook can plan", () => {
    it("lists a household's recipes on its plan too: its cooks' recipes the acting cook can read, and lets them be planned", async () => {
      const chef = await cook();
      const partner = await cook();
      const stranger = await cook();
      const household = await db.household.create({ data: { name: "Our kitchen" } });
      const recipe = (chefId: string, title: string, visibility: string) => db.recipe.create({ data: { ...createTestRecipe(chefId), title, visibility } });
      const mine = await recipe(chef.id, "Bean Stew", "private");
      const ours = await recipe(partner.id, "Family Lasagna", "household");
      const open = await recipe(partner.id, "Open Soup", "public");
      const secret = await recipe(partner.id, "Partner's Secret", "private");
      const notOurs = await recipe(stranger.id, "Their Household Pie", "household");
      await recipe(stranger.id, "Stranger's Public Tart", "public");
      const scope: PlanScope = { household: household.id, actingCook: chef.id, householdChefIds: new Set([partner.id]) };

      expect(await plannableRecipes(store, scope, null)).toEqual({
        recipes: [
          { id: mine.id, title: "Bean Stew" },
          { id: ours.id, title: "Family Lasagna" },
          { id: open.id, title: "Open Soup" },
        ],
        chosenRecipeId: null,
      });
      expect((await plannableRecipes(store, scope, ours.id)).chosenRecipeId).toBe(ours.id);
      expect((await plannableRecipes(store, scope, secret.id)).chosenRecipeId).toBeNull();
      const plan = (id: string, recipeId: string) => addEntry(store, scope, id, { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId });
      expect(await plan("e1", ours.id)).toMatchObject({ ok: true, value: { recipeTitle: "Family Lasagna" } });
      expect(await plan("e2", secret.id)).toEqual({ ok: false, error: "That recipe isn't available to plan." });
      expect(await plan("e3", notOurs.id)).toEqual({ ok: false, error: "That recipe isn't available to plan." });
      // A cook's own plan still reads only their own and public recipes.
      expect(await addEntry(store, { cook: chef.id }, "e4", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: ours.id })).toEqual({ ok: false, error: "That recipe isn't available to plan." });
    });

    it("lists their own recipes and the readable ones saved in their cookbooks, by title, once each", async () => {
      const chef = await cook();
      const friend = await cook();
      const mine = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Zucchini Bake", visibility: "private" } });
      const saved = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Apple Crumble", visibility: "public" } });
      const hidden = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Hidden Hash", visibility: "private" } });
      const gone = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Gone Gumbo", visibility: "public", deletedAt: new Date() } });
      await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Not Saved", visibility: "public" } });
      const books = await Promise.all(["Weeknights", "Sweets"].map((title) => db.cookbook.create({ data: { title, authorId: chef.id } })));
      const theirs = await db.cookbook.create({ data: { title: "Theirs", authorId: friend.id } });
      const save = (cookbookId: string, recipeId: string, addedById: string) => db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById } });
      await save(books[0]!.id, saved.id, chef.id);
      await save(books[1]!.id, saved.id, chef.id);
      await save(books[0]!.id, mine.id, chef.id);
      await save(books[0]!.id, hidden.id, chef.id);
      await save(books[0]!.id, gone.id, chef.id);
      await save(theirs.id, (await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Their Pick", visibility: "public" } })).id, friend.id);

      expect(await plannableRecipes(store, { cook: chef.id }, null)).toEqual({
        recipes: [{ id: saved.id, title: "Apple Crumble" }, { id: mine.id, title: "Zucchini Bake" }],
        chosenRecipeId: null,
      });
    });

    it("puts a recipe asked for by link first when the cook can read it, and ignores it when they can't", async () => {
      const chef = await cook();
      const friend = await cook();
      const mine = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Bean Stew" } });
      const open = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Open Soup", visibility: "public" } });
      const hidden = await db.recipe.create({ data: { ...createTestRecipe(friend.id), title: "Hidden Hash", visibility: "private" } });

      expect(await plannableRecipes(store, { cook: chef.id }, open.id)).toEqual({
        recipes: [{ id: open.id, title: "Open Soup" }, { id: mine.id, title: "Bean Stew" }],
        chosenRecipeId: open.id,
      });
      expect(await plannableRecipes(store, { cook: chef.id }, mine.id)).toEqual({ recipes: [{ id: mine.id, title: "Bean Stew" }], chosenRecipeId: mine.id });
      expect(await plannableRecipes(store, { cook: chef.id }, hidden.id)).toEqual({ recipes: [{ id: mine.id, title: "Bean Stew" }], chosenRecipeId: null });
      expect(await plannableRecipes(store, { cook: chef.id }, "missing")).toEqual({ recipes: [{ id: mine.id, title: "Bean Stew" }], chosenRecipeId: null });
    });
  });

  it("removes an entry from its own plan only, and a removed entry stays gone", async () => {
    const chef = await cook();
    const friend = await cook();
    await addEntry(store, { cook: chef.id }, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });

    expect(await removeEntry(store, { cook: friend.id }, "entry-out")).toBe(false);
    expect(await removeEntry(store, { cook: chef.id }, "entry-out")).toBe(true);
    expect(await removeEntry(store, { cook: chef.id }, "entry-out")).toBe(false);
    expect((await getWeek(store, { cook: chef.id }, "2026-11-24")).days[1].entries).toEqual([]);

    const readded = await addEntry(store, { cook: chef.id }, "entry-out", { kind: "note", date: "2026-11-24", mealType: "dinner", title: "Eat out" });
    expect(readded).toEqual({ ok: false, error: "That meal was removed from the plan." });
  });

  it("keeps an entry readable after its recipe is deleted", async () => {
    const chef = await cook();
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Gone Soup" } });
    await addEntry(store, { cook: chef.id }, "entry-soup", { kind: "recipe", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id });
    await db.recipe.delete({ where: { id: recipe.id } });
    expect((await getWeek(store, { cook: chef.id }, "2026-11-24")).days[1].entries[0]).toMatchObject({ kind: "recipe", recipeId: null, recipeTitle: "Gone Soup" });
  });

  it("opens on this week, in the plan's own time zone, when no week is asked for", async () => {
    const chef = await cook();
    await getWeek(store, { cook: chef.id }, null);
    await db.mealPlan.update({ where: { ownerId: chef.id }, data: { timeZone: "America/Los_Angeles" } });
    const week = await getWeek(store, { cook: chef.id }, null, new Date("2026-11-24T03:30:00Z"));
    expect(week).toMatchObject({ today: "2026-11-23", start: "2026-11-23", timeZone: "America/Los_Angeles" });
  });

  it("starts the week on the plan's own first day", async () => {
    const chef = await cook();
    await getWeek(store, { cook: chef.id }, "2026-11-24");
    await db.mealPlan.update({ where: { ownerId: chef.id }, data: { firstDayOfWeek: 0 } });
    expect((await getWeek(store, { cook: chef.id }, "2026-11-24")).start).toBe("2026-11-22");
  });

  describe("moving an entry", () => {
    async function plannedWeek() {
      const chef = await cook();
      for (const [id, date, mealType] of [["a", "2026-11-23", "dinner"], ["b", "2026-11-23", "dinner"], ["c", "2026-11-23", "dinner"], ["d", "2026-11-24", "lunch"]]) {
        await addEntry(store, { cook: chef.id }, id, { kind: "note", title: id, date, mealType });
      }
      return chef;
    }

    async function slot(ownerId: string, date: string, mealType: string) {
      const week = await getWeek(store, { cook: ownerId }, date);
      return week.days.find((day) => day.date === date)!.entries.filter((entry) => entry.mealType === mealType).map((entry) => entry.id);
    }

    it("reorders an entry inside its own day and meal", async () => {
      const chef = await plannedWeek();
      const moved = await moveEntry(store, { cook: chef.id }, "c", { date: "2026-11-23", mealType: "dinner", index: 0 });
      expect(moved).toMatchObject({ ok: true, value: { id: "c", date: "2026-11-23", mealType: "dinner", position: 0 } });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["c", "a", "b"]);
    });

    it("moves an entry to another day and meal, at the asked place, and leaves the rest in order", async () => {
      const chef = await plannedWeek();
      await moveEntry(store, { cook: chef.id }, "a", { date: "2026-11-24", mealType: "lunch", index: 1 });
      expect(await slot(chef.id, "2026-11-24", "lunch")).toEqual(["d", "a"]);
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["b", "c"]);
    });

    it("puts an entry last when the asked place is past the end, and first when it is below zero or not a number", async () => {
      const chef = await plannedWeek();
      await moveEntry(store, { cook: chef.id }, "a", { date: "2026-11-23", mealType: "dinner", index: 99 });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["b", "c", "a"]);
      await moveEntry(store, { cook: chef.id }, "a", { date: "2026-11-23", mealType: "dinner", index: -3 });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["a", "b", "c"]);
      await moveEntry(store, { cook: chef.id }, "c", { date: "2026-11-23", mealType: "dinner", index: Number.NaN });
      expect(await slot(chef.id, "2026-11-23", "dinner")).toEqual(["c", "a", "b"]);
    });

    it("refuses an entry that isn't on the cook's plan, or a place it can't read", async () => {
      const chef = await plannedWeek();
      const other = await cook();
      await addEntry(store, { cook: other.id }, "theirs", { kind: "note", title: "Theirs", date: "2026-11-23", mealType: "dinner" });
      await removeEntry(store, { cook: chef.id }, "b");
      const to = { date: "2026-11-25", mealType: "dinner", index: 0 };
      expect(await moveEntry(store, { cook: chef.id }, "theirs", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, { cook: chef.id }, "b", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, { cook: chef.id }, "missing", to)).toEqual({ ok: false, error: "That meal isn't on your plan." });
      expect(await moveEntry(store, { cook: chef.id }, "a", { ...to, date: "soon" })).toEqual({ ok: false, error: "Choose a day for this meal." });
      expect(await moveEntry(store, { cook: chef.id }, "a", { ...to, mealType: "brunch" })).toEqual({ ok: false, error: "Choose a meal type." });
      expect(await slot(other.id, "2026-11-23", "dinner")).toEqual(["theirs"]);
    });
  });
});
