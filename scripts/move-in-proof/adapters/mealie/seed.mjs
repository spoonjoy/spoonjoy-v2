// Seeds a synthetic kitchen (kitchen.mjs) into a fresh source app server through its REST API, as
// the people in it: the admin makes the group, household and two members, then each member creates
// their own recipes, ratings, comments, timeline events and meal plan entries. Returns the ids the
// server gave each kitchen key, which observe.mjs and export.mjs read back.
import { renderPhoto } from "../../photo.mjs";
import { eachLimited, stableUuid } from "./client.mjs";

export const DEFAULT_ADMIN = Object.freeze({ email: "changeme@example.com", password: "MyPassword" });
const CONCURRENCY = 4;

async function createAll(items, create) {
  const created = new Map();
  for (const item of items) created.set(item.key, await create(item));
  return created;
}

function recipeUpdate(current, recipe, { profile, foods, units, tags, categories, tools }) {
  const pick = (map, key) => (key ? map.get(key) : null);
  const ingredients = recipe.ingredients.map((ingredient) => ({
    referenceId: stableUuid(ingredient.key),
    quantity: ingredient.quantity ?? 0,
    unit: pick(units, ingredient.unit),
    food: pick(foods, ingredient.food),
    note: ingredient.note,
    display: "",
    title: null,
    originalText: null,
    ...(profile.disableAmountSetting ? { disableAmount: false, isFood: Boolean(ingredient.food) } : {}),
  }));
  return {
    ...current,
    description: recipe.description,
    recipeYield: recipe.yield,
    recipeServings: recipe.servings,
    prepTime: recipe.prepTime,
    performTime: recipe.performTime,
    totalTime: recipe.totalTime,
    orgURL: recipe.sourceUrl,
    recipeIngredient: ingredients,
    recipeInstructions: recipe.steps.map((step) => ({
      id: stableUuid(step.key),
      title: "",
      summary: "",
      text: step.text,
      ingredientReferences: step.ingredientRefs.map((reference) => ({ referenceId: stableUuid(reference) })),
    })),
    tags: recipe.tags.map((key) => tags.get(key)),
    recipeCategory: recipe.categories.map((key) => categories.get(key)),
    tools: recipe.tools.map((key) => tools.get(key)),
    notes: recipe.notes,
    settings: {
      ...current.settings,
      public: false,
      disableComments: false,
      ...(profile.disableAmountSetting ? { disableAmount: false } : {}),
    },
  };
}

function cookbookBody(cookbook, profile, tag) {
  const base = { name: cookbook.name, description: cookbook.description, public: false };
  if (profile.cookbookFilter === "organizers") {
    return { ...base, tags: [tag], categories: [], tools: [], requireAllTags: true, requireAllCategories: true, requireAllTools: true };
  }
  return { ...base, queryFilterString: `tags.id IN ["${tag.id}"]` };
}

export async function seedKitchen({ client, profile, kitchen, password, admin = DEFAULT_ADMIN, log = () => {} }) {
  const adminSession = await client.signIn(admin.email, admin.password);

  const group = await adminSession.post("/api/admin/groups", { name: kitchen.household.group });
  const household = profile.households
    ? await adminSession.post("/api/admin/households", { name: kitchen.household.name, groupId: group.id })
    : null;
  log(`group ${group.name}${household ? `, household ${household.name}` : ""}`);

  const sessions = {};
  const users = {};
  for (const member of kitchen.household.members) {
    await adminSession.post("/api/admin/users", {
      username: member.username,
      fullName: member.fullName,
      email: member.email,
      password,
      admin: false,
      group: group.name,
      ...(household ? { household: household.name, canManageHousehold: true } : {}),
      advanced: true,
      canInvite: true,
      canManage: true,
      canOrganize: true,
    });
    sessions[member.key] = await client.signIn(member.email, password);
    users[member.key] = await sessions[member.key].get("/api/users/self");
  }
  const owner = sessions.owner;

  const labels = await createAll(kitchen.labels, (label) => owner.post(profile.paths.labels, { name: label.name, color: label.color }));
  const foods = await createAll(kitchen.foods, (food) =>
    owner.post("/api/foods", { name: food.name, description: "", labelId: food.label ? labels.get(food.label).id : null }),
  );
  const units = await createAll(kitchen.units, (unit) =>
    owner.post("/api/units", { name: unit.name, abbreviation: unit.abbreviation, useAbbreviation: Boolean(unit.abbreviation), fraction: true, description: "" }),
  );
  const tags = await createAll(kitchen.tags, (tag) => owner.post("/api/organizers/tags", { name: tag.name }));
  const categories = await createAll(kitchen.categories, (category) => owner.post("/api/organizers/categories", { name: category.name }));
  const tools = await createAll(kitchen.tools, (tool) => owner.post("/api/organizers/tools", { name: tool.name, onHand: false }));
  log(`${labels.size} labels, ${foods.size} foods, ${units.size} units, ${tags.size} tags, ${categories.size} categories, ${tools.size} tools`);

  const recipes = new Map();
  const lookups = { profile, foods, units, tags, categories, tools };
  await eachLimited(kitchen.recipes, CONCURRENCY, async (recipe, index) => {
    const session = sessions[recipe.owner];
    const slug = await session.post("/api/recipes", { name: recipe.name });
    const current = await session.get(`/api/recipes/${slug}`);
    const saved = await session.put(`/api/recipes/${slug}`, recipeUpdate(current, recipe, lookups));
    const finalSlug = saved?.slug ?? slug;
    if (recipe.photo) await session.uploadImage(`/api/recipes/${finalSlug}/image`, renderPhoto(recipe.key));
    recipes.set(recipe.key, { id: current.id, slug: finalSlug });
    if ((index + 1) % 50 === 0) log(`${index + 1} recipes`);
  });
  log(`${recipes.size} recipes`);

  await eachLimited(kitchen.ratings, CONCURRENCY, (rating) =>
    sessions[rating.user].post(`/api/users/${users[rating.user].id}/ratings/${recipes.get(rating.recipe).slug}`, {
      rating: rating.rating,
      isFavorite: rating.favorite,
    }),
  );
  await eachLimited(kitchen.comments, CONCURRENCY, (comment) =>
    sessions[comment.user].post("/api/comments", { recipeId: recipes.get(comment.recipe).id, text: comment.text }),
  );
  await eachLimited(kitchen.timelineEvents, CONCURRENCY, async (event) => {
    const session = sessions[event.user];
    const created = await session.post("/api/recipes/timeline/events", {
      recipeId: recipes.get(event.recipe).id,
      subject: event.subject,
      eventType: "info",
      eventMessage: event.message,
      timestamp: event.timestamp,
    });
    if (event.photo) await session.uploadImage(`/api/recipes/timeline/events/${created.id}/image`, renderPhoto(event.key));
  });
  log(`${kitchen.ratings.length} ratings, ${kitchen.comments.length} comments, ${kitchen.timelineEvents.length} timeline events`);

  const cookbooks = await createAll(kitchen.cookbooks, (cookbook) =>
    owner.post(profile.paths.cookbooks, cookbookBody(cookbook, profile, tags.get(cookbook.tag))),
  );
  for (const entry of kitchen.mealPlans) {
    await sessions[entry.user].post(profile.paths.mealPlans, {
      date: entry.date,
      entryType: entry.entryType,
      title: entry.title,
      text: entry.text,
      recipeId: entry.recipe ? recipes.get(entry.recipe).id : null,
    });
  }
  const shoppingLists = new Map();
  for (const list of kitchen.shoppingLists) {
    const created = await owner.post(profile.paths.shoppingLists, { name: list.name });
    shoppingLists.set(list.key, created);
    for (const item of list.items) {
      await owner.post(profile.paths.shoppingItems, {
        shoppingListId: created.id,
        note: item.note,
        quantity: item.quantity,
        foodId: item.food ? foods.get(item.food).id : null,
        unitId: item.unit ? units.get(item.unit).id : null,
        labelId: item.label ? labels.get(item.label).id : null,
        checked: item.checked,
        position: item.position,
        ...(profile.disableAmountSetting ? { isFood: Boolean(item.food) } : {}),
      });
    }
  }
  log(`${cookbooks.size} cookbooks, ${kitchen.mealPlans.length} meal plan entries, ${shoppingLists.size} shopping lists`);

  return { adminSession, sessions, users, group, household, recipes, cookbooks, shoppingLists };
}
