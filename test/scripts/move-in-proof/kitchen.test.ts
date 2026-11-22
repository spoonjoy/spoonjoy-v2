import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  KITCHEN_SIZES,
  expectedCounts,
  generateKitchen,
  kitchenFingerprint,
} from "../../../scripts/move-in-proof/kitchen.mjs";

const small = generateKitchen("small");
const large = generateKitchen("large");

function keysOf(items: Array<{ key: string }>) {
  return new Set(items.map((item) => item.key));
}

describe("generateKitchen", () => {
  it("returns the same kitchen for the same seed", () => {
    expect(generateKitchen("small")).toEqual(small);
    expect(generateKitchen("small", { seed: DEFAULT_SEED })).toEqual(small);
  });

  it("returns a different kitchen for a different seed", () => {
    expect(kitchenFingerprint(generateKitchen("small", { seed: DEFAULT_SEED + 1 }))).not.toBe(
      kitchenFingerprint(small),
    );
  });

  it("refuses an unknown size", () => {
    expect(() => generateKitchen("huge")).toThrow('Unknown kitchen size "huge"; use small or large.');
  });

  it("makes a 20-recipe and a 500-recipe kitchen", () => {
    expect(small.recipes).toHaveLength(20);
    expect(large.recipes).toHaveLength(500);
    expect(KITCHEN_SIZES.small.recipes).toBe(20);
    expect(KITCHEN_SIZES.large.recipes).toBe(500);
  });

  it("gives the household an owner and a second member who owns recipes", () => {
    for (const kitchen of [small, large]) {
      expect(kitchen.household.members.map((member) => member.key)).toEqual(["owner", "member"]);
      const owners = new Set(kitchen.recipes.map((recipe) => recipe.owner));
      expect(owners).toEqual(new Set(["owner", "member"]));
      const memberRecipes = kitchen.recipes.filter((recipe) => recipe.owner === "member").length;
      expect(memberRecipes).toBeGreaterThan(0);
      expect(memberRecipes).toBeLessThan(kitchen.recipes.length / 2);
    }
  });

  it("uses synthetic addresses that cannot reach anyone", () => {
    for (const member of large.household.members) {
      expect(member.email).toMatch(/@move-in-proof\.example$/);
    }
  });

  it("gives every recipe, food and organizer a unique name", () => {
    for (const kitchen of [small, large]) {
      for (const list of [kitchen.recipes, kitchen.foods, kitchen.units, kitchen.tags, kitchen.categories, kitchen.tools, kitchen.labels]) {
        const names = list.map((item: { name: string }) => item.name.toLowerCase());
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it("links ingredients to known foods and units, and steps to the recipe's own ingredients", () => {
    const foods = keysOf(large.foods);
    const units = keysOf(large.units);
    let linkedSteps = 0;
    for (const recipe of large.recipes) {
      const ingredientKeys = new Set(recipe.ingredients.map((ingredient) => ingredient.key));
      expect(ingredientKeys.size).toBe(recipe.ingredients.length);
      for (const ingredient of recipe.ingredients) {
        if (ingredient.food) expect(foods.has(ingredient.food)).toBe(true);
        if (ingredient.unit) expect(units.has(ingredient.unit)).toBe(true);
      }
      const recipeFoods = recipe.ingredients.flatMap((ingredient) => (ingredient.food ? [ingredient.food] : []));
      expect(new Set(recipeFoods).size).toBe(recipeFoods.length);
      expect(recipe.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of recipe.steps) {
        for (const reference of step.ingredientRefs) expect(ingredientKeys.has(reference)).toBe(true);
        if (step.ingredientRefs.length > 0) linkedSteps += 1;
      }
    }
    expect(linkedSteps).toBeGreaterThan(large.recipes.length);
  });

  it("tags, categorizes and equips recipes only with organizers the kitchen has", () => {
    const tags = keysOf(large.tags);
    const categories = keysOf(large.categories);
    const tools = keysOf(large.tools);
    for (const recipe of large.recipes) {
      for (const tag of recipe.tags) expect(tags.has(tag)).toBe(true);
      for (const category of recipe.categories) expect(categories.has(category)).toBe(true);
      for (const tool of recipe.tools) expect(tools.has(tool)).toBe(true);
      expect(recipe.categories.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives most recipes a photo and some timeline events a photo", () => {
    const counts = expectedCounts(large);
    expect(counts.recipesWithPhoto).toBeGreaterThan(400);
    expect(counts.recipesWithPhoto).toBeLessThan(500);
    expect(counts.timelineEventsWithPhoto).toBeGreaterThan(0);
    expect(counts.timelineEventsWithPhoto).toBeLessThan(counts.timelineEvents);
  });

  it("has ratings, favorites and comments from both members on recipes that exist", () => {
    const recipes = keysOf(large.recipes);
    for (const rating of large.ratings) {
      expect(recipes.has(rating.recipe)).toBe(true);
      if (rating.rating === null) {
        expect(rating.favorite).toBe(true);
      } else {
        expect(rating.rating).toBeGreaterThanOrEqual(1);
        expect(rating.rating).toBeLessThanOrEqual(5);
      }
    }
    const pairs = large.ratings.map((rating) => `${rating.user}:${rating.recipe}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(new Set(large.ratings.map((rating) => rating.user))).toEqual(new Set(["owner", "member"]));
    expect(large.ratings.some((rating) => rating.favorite)).toBe(true);
    expect(new Set(large.comments.map((comment) => comment.user))).toEqual(new Set(["owner", "member"]));
    for (const comment of large.comments) expect(recipes.has(comment.recipe)).toBe(true);
    for (const event of large.timelineEvents) {
      expect(recipes.has(event.recipe)).toBe(true);
      expect(event.timestamp).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:00Z$/);
    }
  });

  it("builds filter cookbooks that each match the recipes with their tag", () => {
    for (const kitchen of [small, large]) {
      expect(kitchen.cookbooks.length).toBeGreaterThanOrEqual(3);
      for (const cookbook of kitchen.cookbooks) {
        const matching = kitchen.recipes.filter((recipe) => recipe.tags.includes(cookbook.tag)).length;
        expect(cookbook.expectedRecipes).toBe(matching);
        expect(matching).toBeGreaterThan(0);
      }
    }
  });

  it("plans meals over several weeks, mixing recipe and note entries", () => {
    const recipes = keysOf(large.recipes);
    const dates = new Set(large.mealPlans.map((entry) => entry.date));
    expect(dates.size).toBe(KITCHEN_SIZES.large.mealPlanWeeks * 7);
    expect(KITCHEN_SIZES.small.mealPlanWeeks).toBeGreaterThanOrEqual(2);
    for (const entry of large.mealPlans) {
      if (entry.recipe) expect(recipes.has(entry.recipe)).toBe(true);
      else expect(entry.title.length).toBeGreaterThan(0);
      expect(["breakfast", "lunch", "dinner", "side"]).toContain(entry.entryType);
    }
    expect(large.mealPlans.some((entry) => !entry.recipe)).toBe(true);
    const slots = large.mealPlans.map((entry) => `${entry.date}:${entry.entryType}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("fills shopping lists with labeled, checked and note items without repeating a food", () => {
    const labels = keysOf(large.labels);
    const foods = keysOf(large.foods);
    const units = keysOf(large.units);
    for (const list of large.shoppingLists) {
      const listFoods = list.items.flatMap((item) => (item.food ? [item.food] : []));
      expect(new Set(listFoods).size).toBe(listFoods.length);
      const notes = list.items.filter((item) => !item.food).map((item) => item.note);
      expect(new Set(notes).size).toBe(notes.length);
      for (const item of list.items) {
        if (item.label) expect(labels.has(item.label)).toBe(true);
        if (item.food) expect(foods.has(item.food)).toBe(true);
        if (item.unit) expect(units.has(item.unit)).toBe(true);
      }
    }
    const counts = expectedCounts(large);
    expect(counts.shoppingListItemsChecked).toBeGreaterThan(0);
    expect(counts.shoppingListItemsLabeled).toBeGreaterThan(0);
    expect(counts.shoppingListItemsChecked).toBeLessThan(counts.shoppingListItems);
  });
});

describe("expectedCounts", () => {
  it("counts every entity the move-in lane compares", () => {
    const counts = expectedCounts(small);
    const ingredients = small.recipes.flatMap((recipe) => recipe.ingredients);
    const steps = small.recipes.flatMap((recipe) => recipe.steps);
    expect(counts).toEqual({
      users: 2,
      households: 1,
      recipes: 20,
      recipesByMember: {
        owner: small.recipes.filter((recipe) => recipe.owner === "owner").length,
        member: small.recipes.filter((recipe) => recipe.owner === "member").length,
      },
      recipesWithPhoto: small.recipes.filter((recipe) => recipe.photo).length,
      recipeNotes: small.recipes.reduce((sum, recipe) => sum + recipe.notes.length, 0),
      ingredients: ingredients.length,
      ingredientsWithFood: ingredients.filter((ingredient) => ingredient.food).length,
      ingredientsWithUnit: ingredients.filter((ingredient) => ingredient.unit).length,
      steps: steps.length,
      stepIngredientReferences: steps.reduce((sum, step) => sum + step.ingredientRefs.length, 0),
      foods: small.foods.length,
      units: small.units.length,
      labels: small.labels.length,
      tags: small.tags.length,
      categories: small.categories.length,
      tools: small.tools.length,
      recipeTags: small.recipes.reduce((sum, recipe) => sum + recipe.tags.length, 0),
      recipeCategories: small.recipes.reduce((sum, recipe) => sum + recipe.categories.length, 0),
      recipeTools: small.recipes.reduce((sum, recipe) => sum + recipe.tools.length, 0),
      ratings: small.ratings.filter((rating) => rating.rating !== null).length,
      favorites: small.ratings.filter((rating) => rating.favorite).length,
      comments: small.comments.length,
      timelineEvents: small.timelineEvents.length,
      timelineEventsWithPhoto: small.timelineEvents.filter((event) => event.photo).length,
      cookbooks: small.cookbooks.length,
      cookbookRecipes: Object.fromEntries(small.cookbooks.map((cookbook) => [cookbook.name, cookbook.expectedRecipes])),
      mealPlanEntries: small.mealPlans.length,
      mealPlanRecipeEntries: small.mealPlans.filter((entry) => entry.recipe).length,
      mealPlanNoteEntries: small.mealPlans.filter((entry) => !entry.recipe).length,
      shoppingLists: small.shoppingLists.length,
      shoppingListItems: small.shoppingLists.reduce((sum, list) => sum + list.items.length, 0),
      shoppingListItemsChecked: small.shoppingLists.reduce((sum, list) => sum + list.items.filter((item) => item.checked).length, 0),
      shoppingListItemsLabeled: small.shoppingLists.reduce((sum, list) => sum + list.items.filter((item) => item.label).length, 0),
    });
  });

  it("includes favorites that carry no star rating", () => {
    const kitchen = generateKitchen("large");
    expect(kitchen.ratings.some((rating) => rating.rating === null && rating.favorite)).toBe(true);
  });
});

describe("kitchenFingerprint", () => {
  it("is a sha256 of the kitchen that does not depend on key order", () => {
    const fingerprint = kitchenFingerprint(small);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.entries(small).reverse());
    expect(kitchenFingerprint(reordered as typeof small)).toBe(fingerprint);
  });

  it("stays pinned, so two runs and two machines publish the same kitchen", () => {
    expect({ small: kitchenFingerprint(small), large: kitchenFingerprint(large) }).toMatchInlineSnapshot(`
      {
        "large": "51e45f233bbf8132c42a63d9635ec0c1c8713638ced6ad8843df22b6c63aa47c",
        "small": "9bf0307d9e3ee3ff975eb3f392cbae98c66efae8ef74427205dd5978ca9247f9",
      }
    `);
  });
});
