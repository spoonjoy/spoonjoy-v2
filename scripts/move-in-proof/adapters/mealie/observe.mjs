// Reads a seeded kitchen back from the source app and counts it in the shape expectedCounts()
// uses, so the harness can prove the server holds exactly the generated kitchen before it exports.
// Also returns each recipe's full JSON, which export.mjs writes out as the per-recipe fixtures.
import { eachLimited } from "./client.mjs";

const CONCURRENCY = 4;

const filled = (value) => value !== null && value !== undefined && value !== "";

export async function observeKitchen({ profile, kitchen, seeded }) {
  const owner = seeded.sessions.owner;
  const members = kitchen.household.members;
  const userKeyById = new Map(members.map((member) => [seeded.users[member.key].id, member.key]));

  const summaries = await owner.all("/api/recipes");
  const recipes = [];
  const comments = [];
  await eachLimited(summaries, CONCURRENCY, async (summary) => {
    recipes.push(await owner.get(`/api/recipes/${summary.slug}`));
    comments.push(...(await owner.get(`/api/recipes/${summary.slug}/comments`)));
  });
  recipes.sort((a, b) => a.slug.localeCompare(b.slug));

  const ingredients = recipes.flatMap((recipe) => recipe.recipeIngredient ?? []);
  const steps = recipes.flatMap((recipe) => recipe.recipeInstructions ?? []);
  const sum = (items, count) => items.reduce((total, item) => total + count(item), 0);

  const ratings = [];
  for (const member of members) {
    const mine = await seeded.sessions[member.key].get("/api/users/self/ratings");
    ratings.push(...mine.ratings);
  }

  const events = (await owner.all("/api/recipes/timeline/events")).filter((event) => event.eventType === "info");

  const cookbooks = await owner.all(profile.paths.cookbooks);
  const cookbookRecipes = {};
  for (const cookbook of cookbooks) {
    cookbookRecipes[cookbook.name] = (await owner.all("/api/recipes", { cookbook: cookbook.id })).length;
  }

  const mealPlans = await owner.all(profile.paths.mealPlans, { start_date: "2026-01-01", end_date: "2026-12-31" });

  const lists = await owner.all(profile.paths.shoppingLists);
  const listIds = new Set(lists.map((list) => list.id));
  const items = (await owner.all(profile.paths.shoppingItems)).filter((item) => listIds.has(item.shoppingListId));

  const users = (await seeded.adminSession.all("/api/admin/users")).filter((user) => user.groupId === seeded.group.id);
  const householdIds = new Set(users.map((user) => (profile.households ? user.householdId : user.groupId)));

  const recipesByMember = Object.fromEntries(members.map((member) => [member.key, 0]));
  for (const recipe of recipes) {
    const key = userKeyById.get(recipe.userId);
    if (key) recipesByMember[key] += 1;
  }

  const counts = {
    users: users.length,
    households: householdIds.size,
    recipes: recipes.length,
    recipesByMember,
    recipesWithPhoto: recipes.filter((recipe) => filled(recipe.image)).length,
    recipeNotes: sum(recipes, (recipe) => (recipe.notes ?? []).length),
    ingredients: ingredients.length,
    ingredientsWithFood: ingredients.filter((ingredient) => ingredient.food).length,
    ingredientsWithUnit: ingredients.filter((ingredient) => ingredient.unit).length,
    steps: steps.length,
    stepIngredientReferences: sum(steps, (step) => (step.ingredientReferences ?? []).length),
    foods: (await owner.all("/api/foods")).length,
    units: (await owner.all("/api/units")).length,
    labels: (await owner.all(profile.paths.labels)).length,
    tags: (await owner.all("/api/organizers/tags")).length,
    categories: (await owner.all("/api/organizers/categories")).length,
    tools: (await owner.all("/api/organizers/tools")).length,
    recipeTags: sum(recipes, (recipe) => (recipe.tags ?? []).length),
    recipeCategories: sum(recipes, (recipe) => (recipe.recipeCategory ?? []).length),
    recipeTools: sum(recipes, (recipe) => (recipe.tools ?? []).length),
    ratings: ratings.filter((rating) => rating.rating !== null && rating.rating > 0).length,
    favorites: ratings.filter((rating) => rating.isFavorite).length,
    comments: comments.length,
    timelineEvents: events.length,
    timelineEventsWithPhoto: events.filter((event) => event.image === "has image").length,
    cookbooks: cookbooks.length,
    cookbookRecipes,
    mealPlanEntries: mealPlans.length,
    mealPlanRecipeEntries: mealPlans.filter((entry) => entry.recipeId).length,
    mealPlanNoteEntries: mealPlans.filter((entry) => !entry.recipeId).length,
    shoppingLists: lists.length,
    shoppingListItems: items.length,
    shoppingListItemsChecked: items.filter((item) => item.checked).length,
    shoppingListItemsLabeled: items.filter((item) => item.labelId).length,
  };
  return { counts, recipes };
}
