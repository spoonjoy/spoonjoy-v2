// The move-in proof's synthetic kitchen: a deterministic household shaped like a real one, with
// recipes (photos, foods, units, linked steps, organizers, notes), ratings, comments, timeline
// events, filter cookbooks, several weeks of meal plans and shopping lists. It is plain data with
// no I/O: adapters turn it into a source app's API calls, and expectedCounts() says what a faithful
// copy of it holds. The same seed always gives the same kitchen (faker is seeded and nothing reads
// the clock), so two runs publish the same manifest.
import { createHash } from "node:crypto";
import { Faker, base, en } from "@faker-js/faker";

export const GENERATOR_VERSION = 1;
export const DEFAULT_SEED = 20261122;

export const KITCHEN_SIZES = Object.freeze({
  small: Object.freeze({
    recipes: 20,
    foods: 40,
    units: 12,
    labels: 6,
    tags: 8,
    categories: 6,
    tools: 6,
    cookbooks: 3,
    mealPlanWeeks: 2,
    shoppingLists: 2,
    shoppingItems: [8, 12],
  }),
  large: Object.freeze({
    recipes: 500,
    foods: 250,
    units: 20,
    labels: 10,
    tags: 30,
    categories: 15,
    tools: 20,
    cookbooks: 8,
    mealPlanWeeks: 8,
    shoppingLists: 5,
    shoppingItems: [15, 30],
  }),
});

const UNITS = [
  ["teaspoon", "tsp"],
  ["tablespoon", "tbsp"],
  ["cup", "c"],
  ["gram", "g"],
  ["kilogram", "kg"],
  ["milliliter", "ml"],
  ["liter", "l"],
  ["ounce", "oz"],
  ["pound", "lb"],
  ["pinch", ""],
  ["clove", ""],
  ["can", ""],
  ["slice", ""],
  ["bunch", ""],
  ["sprig", ""],
  ["piece", "pc"],
  ["stick", ""],
  ["handful", ""],
  ["dash", ""],
  ["quart", "qt"],
];

const LABELS = [
  ["Produce", "#4CAF50"],
  ["Dairy", "#2196F3"],
  ["Meat and Fish", "#F44336"],
  ["Pantry", "#FF9800"],
  ["Spices", "#9C27B0"],
  ["Bakery", "#795548"],
  ["Frozen", "#00BCD4"],
  ["Drinks", "#3F51B5"],
  ["Snacks", "#FFC107"],
  ["Household", "#607D8B"],
];

const TAGS = [
  "Weeknight", "Make Ahead", "Vegetarian", "Vegan", "Gluten Free", "Kid Friendly", "Spicy", "One Pot",
  "Holiday", "Meal Prep", "Quick", "Comfort Food", "Summer", "Winter", "Grilling", "Freezer Friendly",
  "Budget", "High Protein", "Low Carb", "Party", "Brunch", "Picnic", "Date Night", "Batch Cooking",
  "Leftovers", "Sheet Pan", "Slow Cooker", "Pressure Cooker", "No Bake", "Family Favorite",
];

const CATEGORIES = [
  "Dinner", "Breakfast", "Lunch", "Dessert", "Appetizer", "Side", "Soup", "Salad", "Bread", "Drink",
  "Snack", "Sauce", "Baking", "Main Course", "Condiment",
];

const TOOLS = [
  "Sheet Pan", "Dutch Oven", "Stand Mixer", "Blender", "Food Processor", "Cast Iron Skillet",
  "Pressure Cooker", "Slow Cooker", "Grill", "Wok", "Rolling Pin", "Mandoline", "Immersion Blender",
  "Microplane", "Thermometer", "Kitchen Scale", "Pasta Machine", "Springform Pan", "Muffin Tin", "Air Fryer",
];

const SHOPPING_LISTS = ["Weekly Groceries", "Warehouse Run", "Farmers Market", "Party Supplies", "Pantry Restock"];

const HOUSEHOLD_NOTES = [
  "paper towels", "dish soap", "birthday candles", "aluminum foil", "zip-top bags", "coffee filters",
  "sparkling water", "bag of ice", "parchment paper", "sponges", "trash bags", "napkins",
];

const INGREDIENT_NOTES = [
  "finely chopped", "to taste", "divided", "at room temperature", "optional", "packed", "thinly sliced",
  "for garnish", "melted", "rinsed and drained",
];

const NOTE_ONLY_INGREDIENTS = [
  "Salt and pepper to taste", "Fresh herbs for serving", "Oil for the pan", "Water as needed",
  "Lemon wedges to serve", "Flaky salt to finish",
];

const STEP_VERBS = ["Combine", "Whisk", "Stir in", "Fold in", "Simmer", "Roast", "Sear", "Toss", "Season", "Chop"];

const STEP_ENDINGS = [
  "until fragrant", "until golden", "for about 5 minutes", "until just combined", "until tender",
  "over medium heat", "and set aside", "until the edges brown", "until glossy", "and taste for salt",
];

const COMMENTS = [
  "Made this twice this week, everyone asked for seconds.", "Used half the salt and it was perfect.",
  "Great with a squeeze of lemon at the end.", "Took longer than listed in my oven.",
  "Doubled the garlic, no regrets.", "Kids loved it.", "Freezes really well.",
  "Swapped in what we had and it still worked.", "Next time I'll add more heat.", "A keeper.",
];

const TIMELINE_MESSAGES = [
  "Turned out great.", "Served it with a green salad.", "A little too salty this time.",
  "Brought it to the potluck.", "Made it ahead and reheated it.", "Added extra herbs.",
];

const RECIPE_NOTES = [
  ["Storage", "Keeps for three days in the fridge."],
  ["Make ahead", "Prep the vegetables the night before."],
  ["Substitutions", "Any firm white fish works here."],
  ["Serving", "Best served warm with crusty bread."],
  ["Scaling", "Doubles easily in a larger pan."],
  ["Heat", "Leave out the chili for kids."],
];

const BREAKFAST_NOTES = ["Overnight oats", "Toast and eggs", "Yogurt and fruit", "Leftover pancakes", "Smoothies"];

const QUANTITIES = [0.25, 0.5, 0.75, 1, 1, 1, 1.5, 2, 2, 3, 4, 6, 8, 250, 500];

const MEAL_PLAN_START = Date.UTC(2026, 0, 5); // a Monday
const TIMELINE_START = Date.UTC(2026, 0, 5);
const DAY_MS = 24 * 60 * 60 * 1000;

function sizeConfig(size) {
  const config = Object.hasOwn(KITCHEN_SIZES, size) ? KITCHEN_SIZES[size] : undefined;
  if (!config) throw new Error(`Unknown kitchen size "${size}"; use small or large.`);
  return config;
}

function pad(number, width = 3) {
  return String(number).padStart(width, "0");
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function titleCase(text) {
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

// Draws names until `count` distinct ones (ignoring case) exist; a draw that repeats gets a
// numbered variant after a few tries, so a small faker list never stalls the generator.
function uniqueNames(count, draw) {
  const seen = new Set();
  const names = [];
  let attempts = 0;
  while (names.length < count) {
    attempts += 1;
    let name = draw();
    if (seen.has(name.toLowerCase()) && attempts > 5) name = `${name} ${names.length + 1}`;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    attempts = 0;
  }
  return names;
}

function organizers(prefix, names, count) {
  return names.slice(0, count).map((name, index) => ({ key: `${prefix}-${pad(index)}`, name }));
}

function makeRecipe(f, index, names, kitchen) {
  const key = `recipe-${pad(index)}`;
  const owner = index % 5 === 3 ? "member" : "owner";
  const ingredientCount = f.number.int({ min: 3, max: 12 });
  const recipeFoods = f.helpers.arrayElements(kitchen.foods, ingredientCount);
  const ingredients = recipeFoods.map((food, position) => {
    const ingredientKey = `${key}-ing-${pad(position, 2)}`;
    if (f.datatype.boolean({ probability: 0.1 })) {
      return { key: ingredientKey, food: null, unit: null, quantity: null, note: f.helpers.arrayElement(NOTE_ONLY_INGREDIENTS) };
    }
    return {
      key: ingredientKey,
      food: food.key,
      unit: f.datatype.boolean({ probability: 0.7 }) ? f.helpers.arrayElement(kitchen.units).key : null,
      quantity: f.helpers.arrayElement(QUANTITIES),
      note: f.datatype.boolean({ probability: 0.3 }) ? f.helpers.arrayElement(INGREDIENT_NOTES) : "",
    };
  });
  const foodNames = new Map(kitchen.foods.map((food) => [food.key, food.name]));
  const steps = Array.from({ length: f.number.int({ min: 2, max: 8 }) }, (_, position) => {
    const references = f.datatype.boolean({ probability: 0.7 })
      ? f.helpers.arrayElements(ingredients, { min: 1, max: Math.min(3, ingredients.length) })
      : [];
    const named = references.map((ingredient) => foodNames.get(ingredient.food) ?? ingredient.note.toLowerCase());
    const subject = named.length > 0 ? ` the ${named.join(", ")}` : "";
    return {
      key: `${key}-step-${pad(position, 2)}`,
      text: `${f.helpers.arrayElement(STEP_VERBS)}${subject} ${f.helpers.arrayElement(STEP_ENDINGS)}.`,
      ingredientRefs: references.map((ingredient) => ingredient.key),
    };
  });
  const tags = f.helpers.arrayElements(kitchen.tags, { min: 0, max: 4 }).map((tag) => tag.key);
  // The first recipes each carry one cookbook's tag, so every filter cookbook has a recipe.
  const cookbookTag = index < kitchen.cookbookTags.length ? kitchen.cookbookTags[index] : null;
  if (cookbookTag && !tags.includes(cookbookTag)) tags.push(cookbookTag);
  const servings = f.number.int({ min: 1, max: 8 });
  const prep = f.helpers.arrayElement([5, 10, 15, 20, 30]);
  const cook = f.helpers.arrayElement([10, 20, 30, 45, 60, 90]);
  return {
    key,
    owner,
    name: names[index],
    description: f.food.description(),
    servings,
    yield: `${servings} servings`,
    prepTime: `${prep} minutes`,
    performTime: `${cook} minutes`,
    totalTime: `${prep + cook} minutes`,
    sourceUrl: f.datatype.boolean({ probability: 0.3 }) ? `https://recipes.example/${key}` : null,
    photo: f.datatype.boolean({ probability: 0.92 }),
    ingredients,
    steps,
    tags,
    categories: f.helpers.arrayElements(kitchen.categories, { min: 1, max: 2 }).map((category) => category.key),
    tools: f.helpers.arrayElements(kitchen.tools, { min: 0, max: 3 }).map((tool) => tool.key),
    notes: f.helpers.arrayElements(RECIPE_NOTES, { min: 0, max: 2 }).map(([title, text]) => ({ title, text })),
  };
}

function makeRatings(f, recipes) {
  const ratings = [];
  for (const recipe of recipes) {
    for (const [user, probability] of [["owner", 0.5], ["member", 0.3]]) {
      if (!f.datatype.boolean({ probability })) continue;
      const favorite = f.datatype.boolean({ probability: 0.25 });
      const starless = favorite && f.datatype.boolean({ probability: 0.2 });
      ratings.push({ user, recipe: recipe.key, rating: starless ? null : f.number.int({ min: 1, max: 5 }), favorite });
    }
  }
  return ratings;
}

function makeComments(f, recipes) {
  return recipes.flatMap((recipe) =>
    Array.from({ length: f.number.int({ min: 0, max: 3 }) }, (_, position) => ({
      key: `${recipe.key}-comment-${position}`,
      user: f.helpers.arrayElement(["owner", "member"]),
      recipe: recipe.key,
      text: f.helpers.arrayElement(COMMENTS),
    })),
  );
}

function makeTimelineEvents(f, recipes) {
  return recipes.flatMap((recipe) =>
    Array.from({ length: f.number.int({ min: 0, max: 2 }) }, (_, position) => {
      const at = TIMELINE_START + f.number.int({ min: 0, max: 300 }) * DAY_MS
        + f.number.int({ min: 7, max: 21 }) * 60 * 60 * 1000 + f.number.int({ min: 0, max: 59 }) * 60 * 1000;
      return {
        key: `${recipe.key}-event-${position}`,
        user: f.helpers.arrayElement(["owner", "member"]),
        recipe: recipe.key,
        subject: f.helpers.arrayElement(["Made this tonight", "Cooked for friends", "Tried a variation", "Doubled the batch"]),
        message: f.helpers.arrayElement(TIMELINE_MESSAGES),
        timestamp: `${new Date(at).toISOString().slice(0, 16)}:00Z`,
        photo: f.datatype.boolean({ probability: 0.5 }),
      };
    }),
  );
}

function makeMealPlans(f, recipes, weeks) {
  const entries = [];
  for (let day = 0; day < weeks * 7; day += 1) {
    const date = isoDate(MEAL_PLAN_START + day * DAY_MS);
    const user = () => (f.datatype.boolean({ probability: 0.8 }) ? "owner" : "member");
    if (f.datatype.boolean({ probability: 0.4 })) {
      entries.push({ date, entryType: "breakfast", user: user(), recipe: null, title: f.helpers.arrayElement(BREAKFAST_NOTES), text: "Quick morning, nothing to cook." });
    }
    if (f.datatype.boolean({ probability: 0.5 })) {
      entries.push({ date, entryType: "lunch", user: user(), recipe: f.helpers.arrayElement(recipes).key, title: "", text: "" });
    }
    entries.push({ date, entryType: "dinner", user: user(), recipe: f.helpers.arrayElement(recipes).key, title: "", text: "" });
    if (f.datatype.boolean({ probability: 0.2 })) {
      entries.push({ date, entryType: "side", user: user(), recipe: f.helpers.arrayElement(recipes).key, title: "", text: "" });
    }
  }
  return entries;
}

function makeShoppingLists(f, kitchen, config) {
  const foodLabels = new Map(kitchen.foods.map((food) => [food.key, food.label]));
  return SHOPPING_LISTS.slice(0, config.shoppingLists).map((name, listIndex) => {
    const count = f.number.int({ min: config.shoppingItems[0], max: config.shoppingItems[1] });
    const noteCount = Math.min(HOUSEHOLD_NOTES.length, Math.round(count * 0.2));
    const foods = f.helpers.arrayElements(kitchen.foods, count - noteCount);
    const notes = f.helpers.arrayElements(HOUSEHOLD_NOTES, noteCount);
    const randomLabel = (probability) => (f.datatype.boolean({ probability }) ? f.helpers.arrayElement(kitchen.labels).key : null);
    const items = [
      ...foods.map((food) => ({
        food: food.key,
        unit: f.datatype.boolean({ probability: 0.5 }) ? f.helpers.arrayElement(kitchen.units).key : null,
        quantity: f.helpers.arrayElement([1, 1, 2, 3, 0.5]),
        note: "",
        // A source app may fill an item's label from its food, so a food's label always wins.
        label: foodLabels.get(food.key) ?? randomLabel(0.5),
      })),
      ...notes.map((note) => ({ food: null, unit: null, quantity: 1, note, label: randomLabel(0.4) })),
    ].map((item, position) => ({ ...item, position, checked: f.datatype.boolean({ probability: 0.3 }) }));
    return { key: `list-${pad(listIndex)}`, name, items };
  });
}

export function generateKitchen(size, { seed = DEFAULT_SEED } = {}) {
  const config = sizeConfig(size);
  const f = new Faker({ locale: [en, base] });
  f.seed(seed);

  const members = ["owner", "member"].map((key) => {
    const firstName = f.person.firstName();
    const lastName = f.person.lastName();
    return {
      key,
      fullName: `${firstName} ${lastName}`,
      username: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, ""),
      email: `${key}@move-in-proof.example`,
    };
  });

  const labels = LABELS.slice(0, config.labels).map(([name, color], index) => ({ key: `label-${pad(index)}`, name, color }));
  const foods = uniqueNames(config.foods, () => titleCase(f.food.ingredient())).map((name, index) => ({
    key: `food-${pad(index)}`,
    name,
    label: f.datatype.boolean({ probability: 0.6 }) ? f.helpers.arrayElement(labels).key : null,
  }));
  const units = UNITS.slice(0, config.units).map(([name, abbreviation], index) => ({ key: `unit-${pad(index)}`, name, abbreviation }));
  const tags = organizers("tag", TAGS, config.tags);
  const categories = organizers("category", CATEGORIES, config.categories);
  const tools = organizers("tool", TOOLS, config.tools);
  const cookbookTags = tags.slice(0, config.cookbooks).map((tag) => tag.key);

  const recipeNames = uniqueNames(config.recipes, () => titleCase(`${f.food.adjective()} ${f.food.dish()}`));
  const context = { foods, units, tags, categories, tools, labels, cookbookTags };
  const recipes = recipeNames.map((_, index) => makeRecipe(f, index, recipeNames, context));

  const cookbooks = tags.slice(0, config.cookbooks).map((tag, index) => ({
    key: `cookbook-${pad(index)}`,
    name: `${tag.name} Recipes`,
    description: `Every recipe tagged ${tag.name}.`,
    tag: tag.key,
    expectedRecipes: recipes.filter((recipe) => recipe.tags.includes(tag.key)).length,
  }));

  return {
    generatorVersion: GENERATOR_VERSION,
    seed,
    size,
    household: { group: "Juniper Street", name: "Juniper Street Kitchen", members },
    labels,
    foods,
    units,
    tags,
    categories,
    tools,
    recipes,
    ratings: makeRatings(f, recipes),
    comments: makeComments(f, recipes),
    timelineEvents: makeTimelineEvents(f, recipes),
    cookbooks,
    mealPlans: makeMealPlans(f, recipes, config.mealPlanWeeks),
    shoppingLists: makeShoppingLists(f, { foods, units, labels }, config),
  };
}

function sum(items, count) {
  return items.reduce((total, item) => total + count(item), 0);
}

export function expectedCounts(kitchen) {
  const ingredients = kitchen.recipes.flatMap((recipe) => recipe.ingredients);
  const steps = kitchen.recipes.flatMap((recipe) => recipe.steps);
  const items = kitchen.shoppingLists.flatMap((list) => list.items);
  const recipesByMember = Object.fromEntries(
    kitchen.household.members.map((member) => [member.key, kitchen.recipes.filter((recipe) => recipe.owner === member.key).length]),
  );
  return {
    users: kitchen.household.members.length,
    households: 1,
    recipes: kitchen.recipes.length,
    recipesByMember,
    recipesWithPhoto: kitchen.recipes.filter((recipe) => recipe.photo).length,
    recipeNotes: sum(kitchen.recipes, (recipe) => recipe.notes.length),
    ingredients: ingredients.length,
    ingredientsWithFood: ingredients.filter((ingredient) => ingredient.food).length,
    ingredientsWithUnit: ingredients.filter((ingredient) => ingredient.unit).length,
    steps: steps.length,
    stepIngredientReferences: sum(steps, (step) => step.ingredientRefs.length),
    foods: kitchen.foods.length,
    units: kitchen.units.length,
    labels: kitchen.labels.length,
    tags: kitchen.tags.length,
    categories: kitchen.categories.length,
    tools: kitchen.tools.length,
    recipeTags: sum(kitchen.recipes, (recipe) => recipe.tags.length),
    recipeCategories: sum(kitchen.recipes, (recipe) => recipe.categories.length),
    recipeTools: sum(kitchen.recipes, (recipe) => recipe.tools.length),
    ratings: kitchen.ratings.filter((rating) => rating.rating !== null).length,
    favorites: kitchen.ratings.filter((rating) => rating.favorite).length,
    comments: kitchen.comments.length,
    timelineEvents: kitchen.timelineEvents.length,
    timelineEventsWithPhoto: kitchen.timelineEvents.filter((event) => event.photo).length,
    cookbooks: kitchen.cookbooks.length,
    cookbookRecipes: Object.fromEntries(kitchen.cookbooks.map((cookbook) => [cookbook.name, cookbook.expectedRecipes])),
    mealPlanEntries: kitchen.mealPlans.length,
    mealPlanRecipeEntries: kitchen.mealPlans.filter((entry) => entry.recipe).length,
    mealPlanNoteEntries: kitchen.mealPlans.filter((entry) => !entry.recipe).length,
    shoppingLists: kitchen.shoppingLists.length,
    shoppingListItems: items.length,
    shoppingListItemsChecked: items.filter((item) => item.checked).length,
    shoppingListItemsLabeled: items.filter((item) => item.label).length,
  };
}

// JSON with object keys sorted at every depth, so equal data always serializes to equal bytes.
export function stableStringify(value, indent = 0) {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

export function kitchenFingerprint(kitchen) {
  return createHash("sha256").update(stableStringify(kitchen)).digest("hex");
}
