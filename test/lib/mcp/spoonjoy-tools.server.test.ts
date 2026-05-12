import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { authenticateApiToken } from "~/lib/api-auth.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools, type SpoonjoyMcpContext } from "~/lib/mcp/spoonjoy-tools.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../../helpers/cleanup";

function parseJson(text: string) {
  return JSON.parse(text) as Record<string, any>;
}

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function withD1TransactionGuard(db: SpoonjoyMcpContext["db"]): SpoonjoyMcpContext["db"] {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "$transaction") {
        return Reflect.get(target, property, receiver);
      }

      return (input: unknown, ...rest: unknown[]) => {
        if (typeof input === "function") {
          throw new Error("D1 interactive transactions are not supported");
        }

        const transaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
        return transaction.apply(target, [input, ...rest]);
      };
    },
  });
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
      "create_api_token",
      "list_api_tokens",
      "revoke_api_token",
      "search_spoonjoy",
      "search_recipes",
      "search_shopping_list",
      "get_recipe",
      "create_recipe",
      "import_recipe_from_url",
      "fork_recipe",
      "add_recipe_to_shopping_list",
      "list_cookbooks",
      "get_cookbook",
      "create_cookbook",
      "add_recipe_to_cookbook",
      "remove_recipe_from_cookbook",
      "add_shopping_list_item",
      "set_shopping_list_item_checked",
      "remove_shopping_list_item",
      "get_shopping_list",
      "create_spoon",
      "update_spoon",
      "delete_spoon",
      "list_spoons_for_recipe",
      "list_spoons_by_chef",
    ]);
  });

  it("reports health and writable state", async () => {
    expect(parseJson(await callSpoonjoyMcpTool("health", {}, context))).toMatchObject({
      ok: true,
      app: "spoonjoy-v2",
      authenticated: false,
      defaultOwnerEmail: context.defaultOwnerEmail,
      writable: true,
    });

    expect(parseJson(await callSpoonjoyMcpTool("health", {}, { db: context.db }))).toMatchObject({
      authenticated: false,
      defaultOwnerEmail: null,
      writable: false,
    });
  });

  it("creates, lists, revokes, and authorizes owner-scoped API tokens", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_api_token", {
      name: "Ouro vault token",
    }, context));
    expect(created.token).toMatch(/^sj_/);
    expect(created.credential).toMatchObject({
      name: "Ouro vault token",
      tokenPrefix: created.token.slice(0, 12),
      lastUsedAt: null,
      revokedAt: null,
    });

    const stored = await context.db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } });
    expect(stored.tokenHash).not.toBe(created.token);

    const defaultNamed = parseJson(await callSpoonjoyMcpTool("create_api_token", {}, context));
    expect(defaultNamed.credential).toMatchObject({ name: "Spoonjoy API token" });

    const principal = await authenticateApiToken(context.db, created.token as string);
    expect(principal).toMatchObject({
      email: context.defaultOwnerEmail,
      source: "bearer",
      credentialId: created.credential.id,
    });

    const authedContext: SpoonjoyMcpContext = { db: context.db, principal };
    const health = parseJson(await callSpoonjoyMcpTool("health", {}, authedContext));
    expect(health).toMatchObject({ authenticated: true, authSource: "bearer", writable: true });

    const listed = parseJson(await callSpoonjoyMcpTool("list_api_tokens", {}, authedContext));
    expect(listed.credentials).toHaveLength(2);
    expect(listed.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.credential.id, name: "Ouro vault token" }),
      expect.objectContaining({ id: defaultNamed.credential.id, name: "Spoonjoy API token" }),
    ]));
    expect(listed.credentials[0].token).toBeUndefined();

    await expect(callSpoonjoyMcpTool("add_shopping_list_item", {
      ownerEmail: uniqueEmail("token-attacker"),
      name: "Milk",
    }, authedContext)).rejects.toThrow("different owner");

    const revoked = parseJson(await callSpoonjoyMcpTool("revoke_api_token", {
      credentialId: created.credential.id,
    }, authedContext));
    expect(revoked).toMatchObject({ revoked: true, credential: { id: created.credential.id } });
    expect(revoked.credential.revokedAt).toEqual(expect.any(String));

    const revokedAgain = parseJson(await callSpoonjoyMcpTool("revoke_api_token", {
      credentialId: created.credential.id,
    }, authedContext));
    expect(revokedAgain.revoked).toBe(false);
    await expect(authenticateApiToken(context.db, created.token as string)).rejects.toThrow("Invalid API token");
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

    const ingredientSearch = parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "Butter" }, context));
    expect(ingredientSearch.recipes[0]).toMatchObject({ id: first.recipe.id, title: "Agent Pancakes" });

    const missingChefSearch = parseJson(await callSpoonjoyMcpTool("search_recipes", {
      query: "Pancakes",
      chefEmail: uniqueEmail("missing-chef"),
    }, context));
    expect(missingChefSearch.recipes).toEqual([]);
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

  it("creates, lists, and fetches cookbooks idempotently for the configured owner", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Agent Dinner Plans",
    }, context));
    expect(first).toMatchObject({
      created: true,
      cookbook: {
        title: "Agent Dinner Plans",
        recipeCount: 0,
        recipes: [],
      },
    });

    const duplicate = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Agent Dinner Plans",
    }, context));
    expect(duplicate).toMatchObject({
      created: false,
      cookbook: { id: first.cookbook.id, title: "Agent Dinner Plans" },
    });

    const explicitOwner = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      ownerEmail: uniqueEmail("cookbook-owner"),
      title: "Agent Dinner Plans",
    }, context));
    expect(explicitOwner).toMatchObject({
      created: true,
      cookbook: { title: "Agent Dinner Plans" },
    });
    expect(explicitOwner.cookbook.id).not.toBe(first.cookbook.id);

    const list = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {
      query: "Dinner",
      limit: 3,
    }, context));
    expect(list.cookbooks).toHaveLength(1);
    expect(list.cookbooks[0]).toMatchObject({
      id: first.cookbook.id,
      title: "Agent Dinner Plans",
      recipeCount: 0,
      recipes: [],
    });

    const byId = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: first.cookbook.id,
    }, context));
    expect(byId.cookbook).toMatchObject({
      id: first.cookbook.id,
      title: "Agent Dinner Plans",
      recipeCount: 0,
      recipes: [],
    });

    const byTitle = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookTitle: "Agent Dinner Plans",
    }, context));
    expect(byTitle.cookbook.id).toBe(first.cookbook.id);
  });

  it("adds and removes recipes from owner-scoped cookbooks idempotently", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Harness Menus",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Organized Soup",
      description: "Soup for MCP memory",
      steps: [{ description: "Simmer", ingredients: [{ name: "Carrot", quantity: 2, unit: "Each" }] }],
    }, context));

    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context));
    expect(added.added).toBe(true);
    expect(added.cookbook).toMatchObject({
      id: cookbook.cookbook.id,
      recipeCount: 1,
      recipes: [
        {
          addedById: recipe.recipe.chef.id,
          recipe: {
            id: recipe.recipe.id,
            title: "Organized Soup",
            ingredientNames: ["carrot"],
          },
        },
      ],
    });
    expect(typeof added.cookbook.recipes[0].relationId).toBe("string");
    expect(typeof added.cookbook.recipes[0].addedAt).toBe("string");

    const duplicate = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      title: "Harness Menus",
      recipeId: recipe.recipe.id,
    }, context));
    expect(duplicate.added).toBe(false);
    expect(duplicate.cookbook.recipeCount).toBe(1);

    const listed = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, context));
    expect(listed.cookbooks[0]).toMatchObject({
      id: cookbook.cookbook.id,
      recipeCount: 1,
      recipes: [{ id: recipe.recipe.id, title: "Organized Soup" }],
    });

    const removed = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookTitle: "Harness Menus",
      recipeId: recipe.recipe.id,
    }, context));
    expect(removed).toMatchObject({
      removed: true,
      cookbook: { recipeCount: 0, recipes: [] },
    });

    const removedAgain = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context));
    expect(removedAgain).toMatchObject({
      removed: false,
      cookbook: { recipeCount: 0, recipes: [] },
    });
  });

  it("runs owner-scoped write tools without callback-style transactions", async () => {
    const guardedContext = {
      ...context,
      db: withD1TransactionGuard(context.db),
    };

    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "D1 Safe Menus",
    }, guardedContext));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "D1 Safe Soup",
      description: "Soup for D1 runtime parity",
      steps: [{ description: "Simmer", ingredients: [{ name: "Carrot", quantity: 2, unit: "Each" }] }],
    }, guardedContext));
    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, guardedContext));
    const fromRecipe = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", {
      recipeId: recipe.recipe.id,
    }, guardedContext));
    const manualItem = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
    }, guardedContext));
    const milkItem = manualItem.shoppingList.items.find((item: { name: string }) => item.name === "milk");
    if (!milkItem) throw new Error("Expected milk item");
    const checked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId: milkItem.id,
      checked: true,
    }, guardedContext));
    const removedItem = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", {
      itemId: milkItem.id,
    }, guardedContext));
    const removedRecipe = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, guardedContext));

    expect(added).toMatchObject({
      added: true,
      cookbook: {
        id: cookbook.cookbook.id,
        recipeCount: 1,
        recipes: [{ recipe: { id: recipe.recipe.id, title: "D1 Safe Soup" } }],
      },
    });
    expect(fromRecipe).toMatchObject({ created: 1, updated: 0 });
    expect(checked.shoppingList.items).toContainEqual(expect.objectContaining({ name: "milk", checked: true }));
    expect(removedItem.shoppingList.items).not.toContainEqual(expect.objectContaining({ name: "milk" }));
    expect(removedRecipe).toMatchObject({ removed: true, cookbook: { recipeCount: 0, recipes: [] } });
  });

  it("keeps cookbook MCP reads and writes scoped to the owning agent", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Private Agent Book",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Private Agent Recipe",
    }, context));
    const otherEmail = uniqueEmail("other-cookbook-agent");

    expect(parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
    }, context))).toEqual({ cookbook: null });

    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Cookbook not found");

    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Cookbook not found");

    const stillEmpty = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: cookbook.cookbook.id,
    }, context));
    expect(stillEmpty.cookbook).toMatchObject({ recipeCount: 0, recipes: [] });
  });

  it("excludes deleted recipes from cookbook MCP payloads", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Active Only",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Soon Deleted Recipe",
    }, context));
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context);

    await context.db.recipe.update({
      where: { id: recipe.recipe.id },
      data: { deletedAt: new Date() },
    });

    const fetched = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: cookbook.cookbook.id,
    }, context));
    expect(fetched.cookbook).toMatchObject({ recipeCount: 0, recipes: [] });

    const listed = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, context));
    expect(listed.cookbooks[0]).toMatchObject({ recipeCount: 0, recipes: [] });

    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Recipe not found");
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

  it("manages direct shopping-list item adds, checks, removes, and restores", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
      categoryKey: "dairy",
      iconKey: "milk",
    }, context));
    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(first.shoppingList.items[0]).toMatchObject({
      name: "milk",
      quantity: 1,
      unit: "gallon",
      checked: false,
      categoryKey: "dairy",
      iconKey: "milk",
    });

    const itemId = first.shoppingList.items[0].id;
    const merged = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 2,
      unit: "Gallon",
    }, context));
    expect(merged).toMatchObject({ created: 0, updated: 1 });
    expect(merged.shoppingList.items[0]).toMatchObject({
      id: itemId,
      quantity: 3,
      categoryKey: "dairy",
      iconKey: "milk",
    });

    const unchangedQuantity = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      unit: "Gallon",
    }, context));
    expect(unchangedQuantity).toMatchObject({ created: 0, updated: 1 });
    expect(unchangedQuantity.shoppingList.items[0]).toMatchObject({ id: itemId, quantity: 3 });

    const checked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId,
      checked: true,
    }, context));
    expect(checked.shoppingList.items[0]).toMatchObject({ id: itemId, checked: true });

    const unchecked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId,
      checked: false,
    }, context));
    expect(unchecked.shoppingList.items[0]).toMatchObject({ id: itemId, checked: false });

    const removed = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", { itemId }, context));
    expect(removed.shoppingList.items).toEqual([]);

    const removedAgain = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", { itemId }, context));
    expect(removedAgain.shoppingList.items).toEqual([]);

    const restored = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
    }, context));
    expect(restored).toMatchObject({ created: 0, updated: 1 });
    expect(restored.shoppingList.items[0]).toMatchObject({ id: itemId, quantity: 4, checked: false });
  });

  it("exposes unified full-text search and private shopping-list search to Ouroboros agents", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Harness Tomato Toast",
      description: "Agent-searchable brunch",
      steps: [{ description: "Toast and top", ingredients: [{ name: "Tomato", quantity: 1, unit: "Each" }] }],
    }, context));
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Harness Brunch Plans",
    }, context));
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context);
    const shopping = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Harness Tomatoes",
      quantity: 2,
      unit: "Each",
      categoryKey: "produce",
      iconKey: "tomato",
    }, context));

    const unified = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "Harness",
      scope: "all",
    }, context));
    expect(unified.scope).toBe("all");
    expect(unified.results.map((result: { id: string }) => result.id)).toEqual(
      expect.arrayContaining([recipe.recipe.id, cookbook.cookbook.id, shopping.shoppingList.items[0].id])
    );
    expect(unified.results.find((result: { id: string }) => result.id === shopping.shoppingList.items[0].id)).toMatchObject({
      type: "shopping-list-item",
      title: "harness tomatoes",
      metadata: { quantity: 2, unit: "each", checked: false },
    });

    const shoppingSearch = parseJson(await callSpoonjoyMcpTool("search_shopping_list", {
      query: "produce",
      limit: 1,
    }, context));
    expect(shoppingSearch).toMatchObject({
      query: "produce",
      items: [
        {
          id: shopping.shoppingList.items[0].id,
          type: "shopping-list-item",
          href: "/shopping-list",
        },
      ],
    });

    const aliasScope = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "tomatoes",
      scope: "shopping",
    }, context));
    expect(aliasScope.scope).toBe("shopping-list");
    expect(aliasScope.results).toHaveLength(1);

    const noOwnerSearch = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "Harness",
    }, { db: context.db }));
    expect(noOwnerSearch.results.some((result: { type: string }) => result.type === "shopping-list-item")).toBe(false);

    const recents = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {}, context));
    expect(recents).toMatchObject({ query: "", scope: "all" });
    expect(recents.results.length).toBeGreaterThan(0);

    const allShopping = parseJson(await callSpoonjoyMcpTool("search_shopping_list", {}, context));
    expect(allShopping.query).toBe("");
    expect(allShopping.items.length).toBeGreaterThan(0);
  });

  it("supports unitless direct shopping-list items", async () => {
    const result = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Bananas",
    }, context));

    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(result.shoppingList.items[0]).toMatchObject({
      name: "bananas",
      quantity: null,
      unit: null,
    });

    const merged = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Bananas",
      quantity: 6,
    }, context));
    expect(merged).toMatchObject({ created: 0, updated: 1 });
    expect(merged.shoppingList.items[0]).toMatchObject({
      name: "bananas",
      quantity: 6,
      unit: null,
    });
  });

  it("scopes direct shopping-list item mutations to the owner", async () => {
    const otherEmail = uniqueEmail("other-agent");
    const added = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Apples",
      quantity: 3,
    }, context));
    const itemId = added.shoppingList.items[0].id;

    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      ownerEmail: otherEmail,
      itemId,
      checked: true,
    }, context)).rejects.toThrow("Shopping list item not found");
    await expect(callSpoonjoyMcpTool("remove_shopping_list_item", {
      ownerEmail: otherEmail,
      itemId,
    }, context)).rejects.toThrow("Shopping list item not found");

    const unchanged = parseJson(await callSpoonjoyMcpTool("get_shopping_list", {}, context));
    expect(unchanged.shoppingList.items[0]).toMatchObject({
      id: itemId,
      name: "apples",
      checked: false,
    });
  });

  it("normalizes search limits", async () => {
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit One" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Two" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Three" }, context);

    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 0 }, context)).recipes).toHaveLength(1);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 2.7 }, context)).recipes).toHaveLength(2);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 999 }, context)).recipes.length).toBeGreaterThanOrEqual(3);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: "bad" }, context)).recipes).toHaveLength(3);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "absent-match" }, context)).recipes).toEqual([]);
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
    await expect(callSpoonjoyMcpTool("missing", {}, context)).rejects.toThrow("Unknown Spoonjoy operation");
    await expect(callSpoonjoyMcpTool("add_recipe_to_shopping_list", {}, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("create_cookbook", { title: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("create_cookbook", { title: "" }, context)).rejects.toThrow("title is required");
    await expect(callSpoonjoyMcpTool("get_cookbook", {}, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("list_cookbooks", { limit: 0 }, context)).resolves.toContain('"cookbooks"');
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: "book" }, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { recipeId: "recipe" }, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: "book", recipeId: "recipe" }, context)).rejects.toThrow("Cookbook not found");
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", { title: "Validation Cookbook" }, context));
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: cookbook.cookbook.id, recipeId: "missing-recipe" }, context)).rejects.toThrow("Recipe not found");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { cookbookId: "book" }, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { recipeId: "recipe" }, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { cookbookId: "book", recipeId: "recipe" }, context)).rejects.toThrow("Cookbook not found");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { name: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("search_shopping_list", { query: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { name: "Bad quantity", quantity: 0 }, context)).rejects.toThrow("quantity must be a positive number");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { quantity: 1 }, context)).rejects.toThrow("name is required");
    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", { itemId: "item", checked: "yes" }, context)).rejects.toThrow("checked must be a boolean");
    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", { checked: true }, context)).rejects.toThrow("itemId is required");
    await expect(callSpoonjoyMcpTool("remove_shopping_list_item", {}, context)).rejects.toThrow("itemId is required");
    await expect(callSpoonjoyMcpTool("create_api_token", { name: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("revoke_api_token", {}, context)).rejects.toThrow("credentialId is required");
    await expect(callSpoonjoyMcpTool("revoke_api_token", { credentialId: "missing" }, context)).rejects.toThrow("API token not found");
  });
});
