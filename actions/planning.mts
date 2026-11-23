// The meal plan's actions, each declared once with Ouro UI's action model. Behind the meal-planner flag: a call from
// someone it is off for is refused as not found.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { ownerEmail } from "./fields.mts";

export const getMealPlan = defineAction({
  id: "get_meal_plan",
  consent: "read",
  label: "Get meal plan",
  description: "See a week of your meal plan.",
  agent: "Fetch one week of the person's meal plan: seven days from the plan's first day of the week, each with its planned meals in meal order. A meal is a recipe at a servings scale (scaleFactor multiplies the recipe's servings) or a note. Leave week out for this week in the plan's own time zone.",
  input: {
    ownerEmail,
    week: field.string({ label: "Week", description: "Optional. Any day of the week to fetch, as YYYY-MM-DD.", optional: true, format: "date" }),
  },
  output: {},
});

export const planning = [getMealPlan];
