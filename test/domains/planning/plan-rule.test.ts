import { describe, expect, it } from "vitest";
import { pickRecipe, ruleFor, validateRuleInput, type PlanRule, type PickCandidate } from "~/domains/planning";

const anyDinner: PlanRule = { id: "dinner", weekday: null, mealType: "dinner", organizerIds: ["quick"] };
const fridays: PlanRule = { id: "friday", weekday: 5, mealType: null, organizerIds: ["treat"] };
const fridayDinner: PlanRule = { id: "friday-dinner", weekday: 5, mealType: "dinner", organizerIds: ["pizza"] };
const everything: PlanRule = { id: "all", weekday: null, mealType: null, organizerIds: [] };

describe("which plan rule a meal follows", () => {
  const rules = [everything, anyDinner, fridays, fridayDinner];

  it("takes the rule for that weekday and meal type over one for the meal type, the weekday, or every meal", () => {
    // 2026-11-27 is a Friday; 2026-11-26 a Thursday.
    expect(ruleFor(rules, "2026-11-27", "dinner")?.id).toBe("friday-dinner");
    expect(ruleFor(rules, "2026-11-26", "dinner")?.id).toBe("dinner");
    expect(ruleFor(rules, "2026-11-27", "lunch")?.id).toBe("friday");
    expect(ruleFor(rules, "2026-11-26", "lunch")?.id).toBe("all");
  });

  it("prefers a meal type rule over a weekday rule when both match and nothing names both", () => {
    expect(ruleFor([fridays, anyDinner], "2026-11-27", "dinner")?.id).toBe("dinner");
  });

  it("has no rule when none matches", () => {
    expect(ruleFor([fridayDinner], "2026-11-26", "dinner")).toBeNull();
    expect(ruleFor([], "2026-11-26", "dinner")).toBeNull();
  });
});

describe("picking a recipe at random", () => {
  const candidates: PickCandidate[] = [
    { id: "pasta", organizerIds: ["quick"] },
    { id: "stew", organizerIds: [] },
    { id: "pizza", organizerIds: ["quick", "pizza"] },
  ];

  it("picks among the recipes that have every organizer the rule names", () => {
    expect(pickRecipe(candidates, anyDinner, () => 0)).toBe("pasta");
    expect(pickRecipe(candidates, anyDinner, () => 0.99)).toBe("pizza");
    expect(pickRecipe(candidates, { ...anyDinner, organizerIds: ["quick", "pizza"] }, () => 0.5)).toBe("pizza");
  });

  it("picks among every recipe when there is no rule, or the rule names no organizer", () => {
    expect(pickRecipe(candidates, null, () => 0.5)).toBe("stew");
    expect(pickRecipe(candidates, everything, () => 0.99)).toBe("pizza");
  });

  it("leaves out recipes the cook asked to skip, such as ones already planned, unless nothing else fits", () => {
    expect(pickRecipe(candidates, anyDinner, () => 0, ["pasta"])).toBe("pizza");
    expect(pickRecipe(candidates, anyDinner, () => 0, ["pasta", "pizza"])).toBe("pasta");
  });

  it("picks nothing when no recipe fits", () => {
    expect(pickRecipe(candidates, { ...anyDinner, organizerIds: ["missing"] }, () => 0)).toBeNull();
    expect(pickRecipe([], null, () => 0)).toBeNull();
  });
});

describe("a plan rule from a form or an agent", () => {
  it("reads a weekday, a meal type and organizers, each optional", () => {
    expect(validateRuleInput({ weekday: "5", mealType: "dinner", organizerIds: ["a", "a", " b "] })).toEqual({
      ok: true,
      value: { weekday: 5, mealType: "dinner", organizerIds: ["a", "b"] },
    });
    expect(validateRuleInput({ weekday: "", mealType: "" })).toEqual({ ok: true, value: { weekday: null, mealType: null, organizerIds: [] } });
    expect(validateRuleInput({ weekday: 0, organizerIds: "a" })).toEqual({ ok: true, value: { weekday: 0, mealType: null, organizerIds: ["a"] } });
  });

  it("refuses a weekday or meal type it can't read, and more than ten organizers", () => {
    expect(validateRuleInput({ weekday: 7 })).toEqual({ ok: false, error: "Choose a day of the week." });
    expect(validateRuleInput({ weekday: "Friday" })).toEqual({ ok: false, error: "Choose a day of the week." });
    expect(validateRuleInput({ mealType: "brunch" })).toEqual({ ok: false, error: "Choose a meal type." });
    expect(validateRuleInput({ organizerIds: Array.from({ length: 11 }, (_, i) => `o${i}`) })).toEqual({ ok: false, error: "A rule can name at most 10 tags, categories or tools." });
  });
});
