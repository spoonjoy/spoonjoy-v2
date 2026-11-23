// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  addEntry,
  addRule,
  listRules,
  pickForMeal,
  prismaPlanRuleStore,
  prismaPlanStore,
  removeRule,
  MAX_PLAN_RULES,
  type PlanRuleStore,
  type PlanStore,
} from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let plans: PlanStore;
let rules: PlanRuleStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

async function organizer(ownerId: string, name: string) {
  return db.organizer.create({ data: { ownerId, kind: "tag", name, slug: name } });
}

async function recipe(chefId: string, title: string, organizerIds: string[] = []) {
  const made = await db.recipe.create({ data: { ...createTestRecipe(chefId), title } });
  for (const organizerId of organizerIds) await db.recipeOrganizer.create({ data: { recipeId: made.id, organizerId } });
  return made;
}

describe("plan rules, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    plans = prismaPlanStore(db);
    rules = prismaPlanRuleStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("adds a rule once per id and lists the plan's rules in the order they were added", async () => {
    const chef = await cook();
    const quick = await organizer(chef.id, "quick");
    const first = await addRule(plans, rules, chef.id, "r1", { mealType: "dinner", organizerIds: [quick.id] });
    expect(first).toEqual({ ok: true, value: { id: "r1", weekday: null, mealType: "dinner", organizerIds: [quick.id] } });
    expect(await addRule(plans, rules, chef.id, "r1", { mealType: "lunch" })).toEqual(first);
    await addRule(plans, rules, chef.id, "r2", { weekday: 5 });
    expect((await listRules(plans, rules, chef.id)).map((rule) => rule.id)).toEqual(["r1", "r2"]);
  });

  it("refuses a rule naming an organizer that isn't the cook's, input it can't read, or one rule too many", async () => {
    const chef = await cook();
    const other = await cook();
    const theirs = await organizer(other.id, "theirs");
    expect(await addRule(plans, rules, chef.id, "r1", { organizerIds: [theirs.id] })).toEqual({ ok: false, error: "Choose your own tags, categories or tools." });
    expect(await addRule(plans, rules, chef.id, "r2", { weekday: 9 })).toEqual({ ok: false, error: "Choose a day of the week." });
    for (let i = 0; i < MAX_PLAN_RULES; i++) await addRule(plans, rules, chef.id, `ok-${i}`, {});
    expect(await addRule(plans, rules, chef.id, "one-more", {})).toEqual({ ok: false, error: `A plan can have at most ${MAX_PLAN_RULES} rules.` });
  });

  it("removes a rule from the cook's own plan only", async () => {
    const chef = await cook();
    const other = await cook();
    await addRule(plans, rules, chef.id, "mine", {});
    expect(await removeRule(plans, rules, other.id, "mine")).toBe(false);
    expect(await removeRule(plans, rules, chef.id, "mine")).toBe(true);
    expect(await removeRule(plans, rules, chef.id, "mine")).toBe(false);
    expect(await listRules(plans, rules, chef.id)).toEqual([]);
  });

  it("picks one of the cook's own recipes that fits the meal's rule, skipping ones already planned that week", async () => {
    const chef = await cook();
    const other = await cook();
    const quick = await organizer(chef.id, "quick");
    const pasta = await recipe(chef.id, "Pasta", [quick.id]);
    const salad = await recipe(chef.id, "Salad", [quick.id]);
    await recipe(chef.id, "Stew");
    await recipe(other.id, "Their quick dish");
    await db.recipe.update({ where: { id: (await recipe(chef.id, "Deleted", [quick.id])).id }, data: { deletedAt: new Date() } });
    await addRule(plans, rules, chef.id, "dinners", { mealType: "dinner", organizerIds: [quick.id] });
    await addEntry(plans, chef.id, "planned", { kind: "recipe", recipeId: pasta.id, date: "2026-11-23", mealType: "lunch" });
    await addEntry(plans, chef.id, "out", { kind: "note", title: "Eating out", date: "2026-11-24", mealType: "dinner" });

    const meal = { date: "2026-11-26", mealType: "dinner" };
    expect(await pickForMeal(plans, rules, chef.id, meal, () => 0)).toEqual({ ok: true, value: { recipeId: salad.id, title: "Salad", ruleId: "dinners" } });
    expect(await pickForMeal(plans, rules, chef.id, { ...meal, mealType: "lunch" }, () => 0.99)).toMatchObject({ ok: true, value: { ruleId: null } });
  });

  it("says so when no recipe fits, and refuses a meal it can't read", async () => {
    const chef = await cook();
    const quick = await organizer(chef.id, "quick");
    await addRule(plans, rules, chef.id, "dinners", { mealType: "dinner", organizerIds: [quick.id] });
    await recipe(chef.id, "Stew");
    expect(await pickForMeal(plans, rules, chef.id, { date: "2026-11-26", mealType: "dinner" }, () => 0)).toEqual({ ok: false, error: "No recipe fits this meal's rule yet." });
    expect(await pickForMeal(plans, rules, chef.id, { date: "later", mealType: "dinner" }, () => 0)).toEqual({ ok: false, error: "Choose a day for this meal." });
    expect(await pickForMeal(plans, rules, chef.id, { date: "2026-11-26", mealType: "brunch" }, () => 0)).toEqual({ ok: false, error: "Choose a meal type." });
  });

  it("reads a stored rule whose organizer list isn't a JSON array of ids as naming the ids it can", async () => {
    const chef = await cook();
    const plan = await plans.planFor(chef.id);
    await db.planRule.create({ data: { id: "a", mealPlanId: plan.id, organizerIds: "not json" } });
    await db.planRule.create({ data: { id: "b", mealPlanId: plan.id, organizerIds: '{"id":"x"}' } });
    await db.planRule.create({ data: { id: "c", mealPlanId: plan.id, organizerIds: '["x",1]', mealType: "dinner", weekday: 2 } });
    expect(await listRules(plans, rules, chef.id)).toEqual([
      { id: "a", weekday: null, mealType: null, organizerIds: [] },
      { id: "b", weekday: null, mealType: null, organizerIds: [] },
      { id: "c", weekday: 2, mealType: "dinner", organizerIds: ["x"] },
    ]);
  });
});
