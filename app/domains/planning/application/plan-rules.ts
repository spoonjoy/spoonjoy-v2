// Plan rules, stored, and the random pick that follows them. The store is a port, so the same rules run on D1 in the
// Worker and SQLite in tests.
import type { PlanStore } from "./plan";
import { addDays, parseLocalDate, startOfWeek, type LocalDate } from "../model/local-date";
import { parseMealType } from "../model/meal-type";
import type { Validated } from "../model/plan-entry";
import { pickRecipe, ruleFor, validateRuleInput, type PickCandidate, type PlanRule } from "../model/plan-rule";

export interface PlanRuleStore {
  /** The plan's rules, oldest first. */
  rulesFor(planId: string): Promise<PlanRule[]>;
  insertRule(planId: string, rule: PlanRule): Promise<void>;
  /** Deletes a rule of this plan; false when there was none. */
  deleteRule(planId: string, ruleId: string): Promise<boolean>;
  /** Which of these organizer ids belong to the cook. */
  ownedOrganizerIds(ownerId: string, organizerIds: readonly string[]): Promise<string[]>;
  /** The cook's own live recipes, each with its organizers and title. */
  pickCandidates(ownerId: string): Promise<(PickCandidate & { title: string })[]>;
}

export const MAX_PLAN_RULES = 50;

export async function listRules(plans: PlanStore, rules: PlanRuleStore, ownerId: string): Promise<PlanRule[]> {
  const plan = await plans.planFor(ownerId);
  return rules.rulesFor(plan.id);
}

/** Adds a rule. `ruleId` comes from the caller, so sending the same add again returns the rule the first one made. */
export async function addRule(
  plans: PlanStore,
  rules: PlanRuleStore,
  ownerId: string,
  ruleId: string,
  raw: Record<string, unknown>,
): Promise<Validated<PlanRule>> {
  const plan = await plans.planFor(ownerId);
  const existing = await rules.rulesFor(plan.id);
  const same = existing.find((rule) => rule.id === ruleId);
  if (same) return { ok: true, value: same };
  if (existing.length >= MAX_PLAN_RULES) return { ok: false, error: `A plan can have at most ${MAX_PLAN_RULES} rules.` };
  const input = validateRuleInput(raw);
  if (!input.ok) return input;
  const owned = await rules.ownedOrganizerIds(ownerId, input.value.organizerIds);
  if (owned.length !== input.value.organizerIds.length) return { ok: false, error: "Choose your own tags, categories or tools." };
  const rule: PlanRule = { id: ruleId, ...input.value };
  await rules.insertRule(plan.id, rule);
  return { ok: true, value: rule };
}

export async function removeRule(plans: PlanStore, rules: PlanRuleStore, ownerId: string, ruleId: string): Promise<boolean> {
  const plan = await plans.planFor(ownerId);
  return rules.deleteRule(plan.id, ruleId);
}

/**
 * A random recipe for a meal: one of the cook's own recipes that fits the meal's rule, leaving out recipes already
 * planned that week unless nothing else fits. `random` returns a number in [0, 1), like Math.random.
 */
export async function pickForMeal(
  plans: PlanStore,
  rules: PlanRuleStore,
  ownerId: string,
  meal: { date: unknown; mealType: unknown },
  random: () => number,
): Promise<Validated<{ recipeId: string; title: string; ruleId: string | null }>> {
  const date = parseLocalDate(meal.date);
  if (!date) return { ok: false, error: "Choose a day for this meal." };
  const mealType = parseMealType(meal.mealType);
  if (!mealType) return { ok: false, error: "Choose a meal type." };
  const plan = await plans.planFor(ownerId);
  const start: LocalDate = startOfWeek(date, plan.firstDayOfWeek);
  const [planRules, candidates, week] = await Promise.all([
    rules.rulesFor(plan.id),
    rules.pickCandidates(ownerId),
    plans.entriesBetween(plan.id, start, addDays(start, 6)),
  ]);
  const rule = ruleFor(planRules, date, mealType);
  const planned = week.flatMap((entry) => (entry.recipeId ? [entry.recipeId] : []));
  const recipeId = pickRecipe(candidates, rule, random, planned);
  const picked = candidates.find((candidate) => candidate.id === recipeId);
  if (!picked) return { ok: false, error: "No recipe fits this meal's rule yet." };
  return { ok: true, value: { recipeId: picked.id, title: picked.title, ruleId: rule?.id ?? null } };
}
