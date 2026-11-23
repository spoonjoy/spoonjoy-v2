// The meal plan's actions, each declared once with Ouro UI's action model. Behind the meal-planner flag: a call from
// someone it is off for is refused as not found.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail } from "./fields.mts";

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

export const planMeal = defineAction({
  id: "plan_meal",
  consent: "write",
  label: "Plan a meal",
  description: "Put a recipe or a note on your meal plan.",
  agent: "Plan one meal on the person's meal plan: a recipe (give recipeId, from search_recipes or get_recipe, of any recipe they can see) or a note (give title, such as Eating out). It goes after the meals already planned for that day and meal type.",
  input: {
    ownerEmail,
    date: field.string({ label: "Day", description: "The day, as YYYY-MM-DD.", format: "date" }),
    mealType: field.string({ label: "Meal", description: "The meal type: breakfast, lunch, dinner, side, snack, drink or dessert." }),
    recipeId: field.string({ label: "Recipe", description: "Optional. The recipe to plan; leave it out to plan a note.", optional: true }),
    title: field.string({ label: "Title", description: "Optional. A note's title, up to 200 characters; required for a note.", optional: true, maxLength: 200 }),
    note: field.string({ label: "Note", description: "Optional. More about the meal, up to 2000 characters.", optional: true, maxLength: 2000, multiline: true }),
    scaleFactor: field.number({ label: "Servings scale", description: "Optional. Multiplies the recipe's servings for this meal only, above 0 and up to 50. Defaults to 1.", optional: true, min: 0, max: 50 }),
    idempotencyKey: idempotencyKey("Optional. Send the same key again when retrying this exact call, such as after a timeout, and the meal is planned once."),
  },
  output: {},
});

export const removeMealPlanEntry = defineAction({
  id: "remove_meal_plan_entry",
  consent: "write",
  label: "Remove planned meal",
  description: "Take a meal off your meal plan.",
  agent: "Remove one planned meal from the person's meal plan by its id, from get_meal_plan. Removing it again answers removed: false.",
  input: {
    ownerEmail,
    entryId: field.string({ label: "Meal", description: "The planned meal's id, from get_meal_plan." }),
  },
  output: {},
  destructive: true,
  idempotent: true,
});

export const planning = [getMealPlan, planMeal, removeMealPlanEntry];
