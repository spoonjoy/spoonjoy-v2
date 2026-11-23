// Plan rules: what a random pick may choose for a meal. A rule names a weekday, a meal type, both or neither, and the
// tags, categories or tools (organizers) a recipe must all have. The most specific rule that matches a meal wins.
import { weekdayOf, type LocalDate } from "./local-date";
import { parseMealType, type MealType } from "./meal-type";
import type { Validated } from "./plan-entry";

export type PlanRule = { id: string; weekday: number | null; mealType: MealType | null; organizerIds: string[] };

export type PlanRuleInput = Omit<PlanRule, "id">;

/** A recipe a random pick may choose, with the organizers it has. */
export type PickCandidate = { id: string; organizerIds: readonly string[] };

export const MAX_RULE_ORGANIZERS = 10;

/** A meal type counts for more than a weekday: "dinners are quick" is about the meal more than the day. */
function specificity(rule: PlanRule): number {
  return (rule.mealType === null ? 0 : 2) + (rule.weekday === null ? 0 : 1);
}

/** The rule a meal on `date` at `mealType` follows, or null when none matches. The first of equally specific rules wins. */
export function ruleFor(rules: readonly PlanRule[], date: LocalDate, mealType: MealType): PlanRule | null {
  const weekday = weekdayOf(date);
  let best: PlanRule | null = null;
  for (const rule of rules) {
    if (rule.weekday !== null && rule.weekday !== weekday) continue;
    if (rule.mealType !== null && rule.mealType !== mealType) continue;
    if (best === null || specificity(rule) > specificity(best)) best = rule;
  }
  return best;
}

/**
 * A random recipe among those with every organizer the rule names. Recipes in `skip`, such as ones already planned
 * this week, are left out unless nothing else fits. `random` returns a number in [0, 1), like Math.random.
 */
export function pickRecipe(
  candidates: readonly PickCandidate[],
  rule: PlanRule | null,
  random: () => number,
  skip: readonly string[] = [],
): string | null {
  const required = rule?.organizerIds ?? [];
  const fits = candidates.filter((candidate) => required.every((id) => candidate.organizerIds.includes(id)));
  const fresh = fits.filter((candidate) => !skip.includes(candidate.id));
  const pool = fresh.length > 0 ? fresh : fits;
  if (pool.length === 0) return null;
  return pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)].id;
}

/** Null for "any", undefined for a value that can't be read. */
function weekdayInput(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const day = typeof value === "number" ? value : Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : undefined;
}

function mealTypeInput(value: unknown): MealType | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return parseMealType(value) ?? undefined;
}

/** Reads a rule from a form or an agent's call: each part is optional, and organizers are trimmed and deduplicated. */
export function validateRuleInput(input: Record<string, unknown>): Validated<PlanRuleInput> {
  const weekday = weekdayInput(input.weekday);
  if (weekday === undefined) return { ok: false, error: "Choose a day of the week." };
  const mealType = mealTypeInput(input.mealType);
  if (mealType === undefined) return { ok: false, error: "Choose a meal type." };
  const raw = Array.isArray(input.organizerIds) ? input.organizerIds : input.organizerIds === undefined ? [] : [input.organizerIds];
  const organizerIds = [...new Set(raw.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))];
  if (organizerIds.length > MAX_RULE_ORGANIZERS) {
    return { ok: false, error: `A rule can name at most ${MAX_RULE_ORGANIZERS} tags, categories or tools.` };
  }
  return { ok: true, value: { weekday, mealType, organizerIds } };
}
