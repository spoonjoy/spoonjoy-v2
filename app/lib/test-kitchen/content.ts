import type { CookRecipe } from "~/components/cook/cook-controller";

/** The Test Kitchen's one recipe: a page of Spoonjoy anyone can cook from without an account. */
export interface TestKitchenRecipe {
  recipe: CookRecipe;
  /** What the dish makes, shown under the title. */
  servings: string;
  /** One line about the dish. */
  description: string;
  /** The cover photo under `public/`, and what it shows. */
  cover: { src: string; alt: string; width: number; height: number };
}

const RECIPE_ID = "test-kitchen-crispy-chickpeas";
const step = (n: number) => `${RECIPE_ID}-step-${n}`;
const ingredient = (n: number, slug: string) => `${RECIPE_ID}-ingredient-${n}-${slug}`;
const output = (n: number, from: number) => `${RECIPE_ID}-output-${n}-from-${from}`;

/**
 * Crispy lemon chickpeas with herby yogurt: three steps, each with ingredients to tick off, a
 * twelve-minute timer on the first, and a last step that uses what the first two made.
 */
export const TEST_KITCHEN: TestKitchenRecipe = {
  servings: "Serves 2",
  description: "Roasted chickpeas, a bright yogurt and a squeeze of lemon: a weeknight bowl in three steps.",
  cover: {
    src: "/test-kitchen/crispy-chickpeas.webp",
    alt: "A shallow bowl of golden roasted chickpeas on herby yogurt, with lemon wedges and dill",
    width: 1200,
    height: 800,
  },
  recipe: {
    id: RECIPE_ID,
    title: "Crispy Lemon Chickpeas",
    steps: [
      {
        id: step(1),
        stepNum: 1,
        stepTitle: "Roast the chickpeas",
        description: "Pat the chickpeas dry, toss them with the oil, paprika and salt, and roast at 220°C (425°F) until crisp and deep gold, shaking the tray once.",
        duration: 12,
      },
      {
        id: step(2),
        stepNum: 2,
        stepTitle: "Whisk the herby yogurt",
        description: "Stir the lemon zest, dill and grated garlic into the yogurt, with a pinch of salt.",
        duration: null,
      },
      {
        id: step(3),
        stepNum: 3,
        stepTitle: "Build the bowls",
        description: "Spread the yogurt in two bowls, pile the hot chickpeas on top, then finish with lemon juice and flaky salt.",
        duration: null,
      },
    ],
    ingredientsByStep: new Map([
      [step(1), [
        { id: ingredient(1, "chickpeas"), quantity: 1.5, unit: "cups", name: "cooked chickpeas", categoryLabel: "Pantry" },
        { id: ingredient(1, "olive-oil"), quantity: 2, unit: "tbsp", name: "olive oil", categoryLabel: "Pantry" },
        { id: ingredient(1, "paprika"), quantity: 1, unit: "tsp", name: "smoked paprika", categoryLabel: "Spices" },
        { id: ingredient(1, "salt"), quantity: 0.5, unit: "tsp", name: "salt", categoryLabel: "Spices" },
      ]],
      [step(2), [
        { id: ingredient(2, "yogurt"), quantity: 1, unit: "cup", name: "thick yogurt", categoryLabel: "Dairy" },
        { id: ingredient(2, "lemon-zest"), quantity: 1, unit: "tsp", name: "lemon zest", categoryLabel: "Produce" },
        { id: ingredient(2, "dill"), quantity: 2, unit: "tbsp", name: "chopped dill", categoryLabel: "Produce" },
        { id: ingredient(2, "garlic"), quantity: 1, unit: "clove", name: "garlic", categoryLabel: "Produce" },
      ]],
      [step(3), [
        { id: ingredient(3, "lemon"), quantity: 0.5, unit: "whole", name: "lemon", categoryLabel: "Produce" },
        { id: ingredient(3, "flaky-salt"), quantity: null, unit: "pinch", name: "flaky salt", categoryLabel: "Spices" },
      ]],
    ]),
    stepOutputUsesByStep: new Map([
      [step(3), [
        { id: output(3, 1), stepNumber: 1, stepTitle: "Roast the chickpeas" },
        { id: output(3, 2), stepNumber: 2, stepTitle: "Whisk the herby yogurt" },
      ]],
    ]),
  },
};
