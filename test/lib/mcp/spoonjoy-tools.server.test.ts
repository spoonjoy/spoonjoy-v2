import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools, type SpoonjoyMcpContext } from "~/lib/mcp/spoonjoy-tools.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../../helpers/cleanup";

function parseJson(text: string) {
  return JSON.parse(text) as Record<string, any>;
}

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

describe("spoonjoy MCP tools", () => {
  let context: SpoonjoyMcpContext;

  beforeEach(async () => {
    await cleanupDatabase();
    context = { db: await getLocalDb(), defaultOwnerEmail: uniqueEmail("agent") };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists stable MCP tool metadata", () => {
    expect(listSpoonjoyMcpTools().map((tool) => tool.name)).toEqual([
      "health",
      "search_recipes",
      "get_recipe",
      "create_recipe",
      "add_recipe_to_shopping_list",
      "get_shopping_list",
    ]);
  });

  it("reports health and writable state", async () => {
    expect(parseJson(await callSpoonjoyMcpTool("health", {}, context))).toMatchObject({
      ok: true,
      app: "spoonjoy-v2",
      defaultOwnerEmail: context.defaultOwnerEmail,
      writable: true,
    });

    expect(parseJson(await callSpoonjoyMcpTool("health", {}, { db: context.db }))).toMatchObject({
      defaultOwnerEmail: null,
      writable: false,
    });
  });

  it("creates, searches, and fetches recipes with steps and ingredients", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Agent Pancakes",
      description: "Breakfast fit for drones",
      servings: "2",
      sourceUrl: "https://spoonjoy.app/agent-pancakes",
      steps: [
        {
          title: "Mix",
          description: "Mix the batter",
          duration: 5,
          ingredients: [
            { name: "Flour", quantity: 2, unit: "Cup" },
            { name: "Milk", quantity: 1.5, unit: "Cup" },
          ],
        },
        { description: "Cook until golden", ingredients: [{ name: "Butter", quantity: 1, unit: "Tbsp" }] },
      ],
    }, context));

    expect(first.recipe).toMatchObject({
      title: "Agent Pancakes",
      description: "Breakfast fit for drones",
      servings: "2",
      sourceUrl: "https://spoonjoy.app/agent-pancakes",
      ingredientCount: 3,
      steps: [
        { stepNum: 1, title: "Mix", duration: 5 },
        { stepNum: 2, title: null, duration: null },
      ],
    });
    expect(first.recipe.steps[0].ingredients.map((ingredient: { name: string }) => ingredient.name)).toEqual(["flour", "milk"]);

    const byId = parseJson(await callSpoonjoyMcpTool("get_recipe", { id: first.recipe.id }, context));
    expect(byId.recipe.title).toBe("Agent Pancakes");

    const byTitle = parseJson(await callSpoonjoyMcpTool("get_recipe", { title: "Agent Pancakes" }, context));
    expect(byTitle.recipe.id).toBe(first.recipe.id);

    const search = parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "Pancakes", chefEmail: context.defaultOwnerEmail, limit: 25 }, context));
    expect(search.recipes).toHaveLength(1);
    expect(search.recipes[0]).toMatchObject({ title: "Agent Pancakes", stepCount: 2, ingredientNames: ["butter", "flour", "milk"] });
  });

  it("creates minimal recipes and finds null for missing recipes", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: uniqueEmail("explicit"),
      title: "No Step Snack",
    }, { db: context.db }));

    expect(recipe.recipe.steps).toEqual([]);
    await expect(callSpoonjoyMcpTool("get_recipe", {}, context)).rejects.toThrow("id or title is required");
    expect(parseJson(await callSpoonjoyMcpTool("get_recipe", { id: "missing" }, context))).toEqual({ recipe: null });
  });

  it("handles unusual owner emails and ingredient-free steps", async () => {
    const emptyLocal = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: "@example.com",
      title: "Empty Local Owner",
      steps: [{ description: "Rest with no ingredients" }],
    }, context));
    const symbolLocal = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: "!!!@example.com",
      title: "Symbol Local Owner",
    }, context));

    expect(emptyLocal.recipe.chef.username).toBe("agent");
    expect(emptyLocal.recipe.steps[0]).toMatchObject({ description: "Rest with no ingredients", ingredients: [] });
    expect(symbolLocal.recipe.chef.username).toBe("agent-2");
  });

  it("reuses existing owner usernames, units, and ingredient refs", async () => {
    const email = uniqueEmail("same-local");
    const baseUsername = email.split("@")[0];
    await context.db.user.create({ data: { email: uniqueEmail("other"), username: baseUsername } });

    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: email,
      title: "Reuse Soup",
      steps: [{ description: "Stir", ingredients: [{ name: "Salt", quantity: 1, unit: "Tsp" }] }],
    }, context));
    const second = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: email,
      title: "Reuse Stew",
      steps: [{ description: "Stir more", ingredients: [{ name: "Salt", quantity: 2, unit: "Tsp" }] }],
    }, context));

    expect(created.recipe.chef.username).toBe(`${baseUsername}-2`);
    expect(second.recipe.steps[0].ingredients[0]).toMatchObject({ name: "salt", unit: "tsp" });
    await expect(context.db.unit.count()).resolves.toBe(1);
    await expect(context.db.ingredientRef.count()).resolves.toBe(1);
  });

  it("adds recipe ingredients to a shopping list and merges duplicates", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Shopping Cake",
      steps: [{ description: "Mix", ingredients: [{ name: "Sugar", quantity: 1, unit: "Cup" }] }],
    }, context));

    const first = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(first.shoppingList.items[0]).toMatchObject({ name: "sugar", quantity: 1, checked: false });

    const second = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(second.shoppingList.items[0]).toMatchObject({ name: "sugar", quantity: 2, checked: false });
  });

  it("treats an existing null shopping-list quantity as zero when merging", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Null Quantity Beans",
      steps: [{ description: "Open", ingredients: [{ name: "Beans", quantity: 3, unit: "Can" }] }],
    }, context));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail } });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredient = await context.db.ingredient.findFirstOrThrow({ where: { recipeId: recipe.recipe.id } });
    await context.db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredient.ingredientRefId,
        unitId: ingredient.unitId,
        quantity: null,
      },
    });

    const result = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(result.shoppingList.items[0]).toMatchObject({ name: "beans", quantity: 3 });
  });

  it("gets shopping lists and filters deleted items including unitless items", async () => {
    const owner = await context.db.user.create({ data: { email: uniqueEmail("shopper"), username: faker.internet.username() } });
    const list = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredientRef = await context.db.ingredientRef.create({ data: { name: `beans-${faker.string.alphanumeric(5).toLowerCase()}` } });
    const secondRef = await context.db.ingredientRef.create({ data: { name: `apples-${faker.string.alphanumeric(5).toLowerCase()}` } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id, sortIndex: 1 } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: secondRef.id, sortIndex: 1 } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id, sortIndex: 2, deletedAt: new Date() } });

    const result = parseJson(await callSpoonjoyMcpTool("get_shopping_list", { ownerEmail: owner.email }, context));
    expect(result.shoppingList.items.map((item: { name: string }) => item.name)).toEqual([secondRef.name, ingredientRef.name].sort());
    expect(result.shoppingList.items[0]).toEqual(expect.objectContaining({ quantity: null, unit: null, sortIndex: 1 }));
  });

  it("normalizes search limits", async () => {
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit One" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Two" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Three" }, context);

    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 0 }, context)).recipes).toHaveLength(1);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 2.7 }, context)).recipes).toHaveLength(2);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 999 }, context)).recipes.length).toBeGreaterThanOrEqual(3);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: "bad" }, context)).recipes).toHaveLength(3);
  });

  it("validates write tool inputs", async () => {
    await callSpoonjoyMcpTool("create_recipe", { title: "Duplicate MCP Recipe" }, context);
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Duplicate MCP Recipe" }, context)).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad steps", steps: {} }, context)).rejects.toThrow("steps must be an array");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad step", steps: [null] }, context)).rejects.toThrow("steps[0] must be an object");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad ingredient", steps: [{ description: "x", ingredients: [null] }] }, context)).rejects.toThrow("steps.ingredients[0] must be an object");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad quantity", steps: [{ description: "x", ingredients: [{ name: "x", quantity: 0, unit: "cup" }] }] }, context)).rejects.toThrow("quantity must be a positive number");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad unit", steps: [{ description: "x", ingredients: [{ name: "x", quantity: 1, unit: "" }] }] }, context)).rejects.toThrow("unit is required");
    await expect(callSpoonjoyMcpTool("missing", {}, context)).rejects.toThrow("Unknown Spoonjoy MCP tool");
    await expect(callSpoonjoyMcpTool("add_recipe_to_shopping_list", {}, context)).rejects.toThrow("recipeId is required");
  });
});
