import { faker } from "@faker-js/faker";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";

const { parseIngredientsMock } = vi.hoisted(() => ({
  parseIngredientsMock: vi.fn(),
}));

vi.mock("~/lib/ingredient-parse.server", () => {
  class IngredientParseError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
      super(message);
      this.name = "IngredientParseError";
    }
  }

  return {
    IngredientParseError,
    parseIngredients: parseIngredientsMock,
  };
});

const { action } = await import("~/routes/shopping-list");
const { IngredientParseError } = await import("~/lib/ingredient-parse.server");

async function createFormRequest(
  formFields: Record<string, string>,
  userId: string
): Promise<UndiciRequest> {
  const formData = new UndiciFormData();
  for (const [key, value] of Object.entries(formFields)) {
    formData.append(key, value);
  }

  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookieHeader = await sessionStorage.commitSession(session);
  const headers = new Headers({ Cookie: setCookieHeader.split(";")[0] });

  return new UndiciRequest("http://localhost:3000/shopping-list", {
    method: "POST",
    body: formData,
    headers,
  });
}

describe("shopping list OpenAI and add-from-recipe coverage", () => {
  let testUserId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    parseIngredientsMock.mockReset();
    delete process.env.OPENAI_API_KEY;

    const user = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      "testPassword123"
    );
    testUserId = user.id;
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    await cleanupDatabase();
  });

  it("adds a single item parsed by OpenAI", async () => {
    parseIngredientsMock.mockResolvedValueOnce([
      { quantity: 1.5, unit: "cup", ingredientName: "rolled oats" },
    ]);

    const request = await createFormRequest(
      { intent: "addItem", ingredientText: "one and a half cups oats" },
      testUserId
    );

    await action({
      request,
      context: { cloudflare: { env: { OPENAI_API_KEY: "test-key" } } },
      params: {},
    } as any);

    expect(parseIngredientsMock).toHaveBeenCalledWith(
      "one and a half cups oats",
      expect.objectContaining({ OPENAI_API_KEY: "test-key" })
    );

    const shoppingList = await db.shoppingList.findUnique({
      where: { authorId: testUserId },
      include: { items: { include: { ingredientRef: true, unit: true } } },
    });

    expect(shoppingList?.items).toHaveLength(1);
    expect(shoppingList?.items[0].quantity).toBe(1.5);
    expect(shoppingList?.items[0].unit?.name).toBe("cup");
    expect(shoppingList?.items[0].ingredientRef.name).toBe("rolled oats");
  });

  it("returns a review draft when OpenAI parses multiple items", async () => {
    parseIngredientsMock.mockResolvedValueOnce([
      { quantity: 1, unit: "whole", ingredientName: "apple" },
      { quantity: 1, unit: "whole", ingredientName: "pear" },
    ]);

    const request = await createFormRequest(
      { intent: "addItem", ingredientText: "2 apples" },
      testUserId
    );

    const result = await action({
      request,
      context: { cloudflare: { env: { OPENAI_API_KEY: "test-key" } } },
      params: {},
    } as any);

    expect(result).toMatchObject({
      init: { status: 400 },
      data: {
        errors: {
          parse: "Couldn't confidently parse one item. Review and correct before adding.",
        },
        parseDraft: {
          quantity: "2",
          unitName: "whole",
          ingredientName: "apples",
          isAmbiguous: false,
        },
      },
    });
  });

  it("returns the parser error message when OpenAI parsing throws IngredientParseError", async () => {
    parseIngredientsMock.mockRejectedValueOnce(new IngredientParseError("Parser says nope"));

    const request = await createFormRequest(
      { intent: "addItem", ingredientText: "1 cup mystery" },
      testUserId
    );

    const result = await action({
      request,
      context: { cloudflare: { env: { OPENAI_API_KEY: "test-key" } } },
      params: {},
    } as any);

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { errors: { parse: "Parser says nope" } },
    });
  });

  it("returns a generic parser error when OpenAI parsing throws an unknown error", async () => {
    parseIngredientsMock.mockRejectedValueOnce(new Error("network down"));

    const request = await createFormRequest(
      { intent: "addItem", ingredientText: "1 cup mystery" },
      testUserId
    );

    const result = await action({
      request,
      context: { cloudflare: { env: { OPENAI_API_KEY: "test-key" } } },
      params: {},
    } as any);

    expect(result).toMatchObject({
      init: { status: 400 },
      data: {
        errors: {
          parse: "Unable to parse item right now. Review and correct before adding.",
        },
      },
    });
  });

  it("defaults invalid recipe scale factors and preserves zero ingredient quantities as no quantity", async () => {
    const recipe = await db.recipe.create({
      data: { title: "Null Quantity Recipe", chefId: testUserId },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Gather" },
    });
    const unit = await db.unit.create({ data: { name: `pinch_${faker.string.alphanumeric(6)}` } });
    const ingredientRef = await db.ingredientRef.create({
      data: { name: `saffron_${faker.string.alphanumeric(6)}` },
    });
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 0,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });

    const request = await createFormRequest(
      { intent: "addFromRecipe", recipeId: recipe.id, scaleFactor: "not-a-number" },
      testUserId
    );

    await action({ request, context: { cloudflare: { env: null } }, params: {} } as any);

    const shoppingList = await db.shoppingList.findUnique({
      where: { authorId: testUserId },
      include: { items: true },
    });
    expect(shoppingList?.items).toHaveLength(1);
    expect(shoppingList?.items[0].quantity).toBeNull();
  });

  it("adds scaled recipe quantity onto an existing item with null quantity", async () => {
    const shoppingList = await db.shoppingList.create({ data: { authorId: testUserId } });
    const recipe = await db.recipe.create({
      data: { title: "Existing Null Quantity Recipe", chefId: testUserId },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Gather" },
    });
    const unit = await db.unit.create({ data: { name: `bunch_${faker.string.alphanumeric(6)}` } });
    const ingredientRef = await db.ingredientRef.create({
      data: { name: `cilantro_${faker.string.alphanumeric(6)}` },
    });
    await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        quantity: null,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
        categoryKey: null,
      },
    });
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 2,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });

    const request = await createFormRequest(
      { intent: "addFromRecipe", recipeId: recipe.id, scaleFactor: "-2" },
      testUserId
    );

    await action({ request, context: { cloudflare: { env: null } }, params: {} } as any);

    const updatedItem = await db.shoppingListItem.findFirst({
      where: { shoppingListId: shoppingList.id, ingredientRefId: ingredientRef.id },
    });
    expect(updatedItem?.quantity).toBe(2);
    expect(updatedItem?.categoryKey).not.toBeNull();
  });

  it("keeps an existing quantity when a recipe ingredient has zero quantity", async () => {
    const shoppingList = await db.shoppingList.create({ data: { authorId: testUserId } });
    const recipe = await db.recipe.create({
      data: { title: "Existing Quantity Zero Recipe", chefId: testUserId },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Gather" },
    });
    const unit = await db.unit.create({ data: { name: `dash_${faker.string.alphanumeric(6)}` } });
    const ingredientRef = await db.ingredientRef.create({
      data: { name: `vanilla_${faker.string.alphanumeric(6)}` },
    });
    await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        quantity: 5,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
        categoryKey: "baking",
      },
    });
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 0,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });

    const request = await createFormRequest(
      { intent: "addFromRecipe", recipeId: recipe.id, scaleFactor: "3" },
      testUserId
    );

    await action({ request, context: { cloudflare: { env: null } }, params: {} } as any);

    const updatedItem = await db.shoppingListItem.findFirst({
      where: { shoppingListId: shoppingList.id, ingredientRefId: ingredientRef.id },
    });
    expect(updatedItem?.quantity).toBe(5);
    expect(updatedItem?.categoryKey).toBe("baking");
  });
});
