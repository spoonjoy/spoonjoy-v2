import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { faker } from "@faker-js/faker";
import { createRecipeDraft, parseRecipeStepsJson } from "~/lib/recipe-create.server";
import { createUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

function expectInvalidSteps(payload: unknown, expectedError: string) {
  const result = parseRecipeStepsJson(typeof payload === "string" ? payload : JSON.stringify(payload));
  expect(result).toEqual({ valid: false, error: expectedError });
}

describe("recipe create helpers", () => {
  let testUserId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const user = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      "testPassword123"
    );
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("parseRecipeStepsJson", () => {
    it("returns an empty step list for an empty submitted array", () => {
      expect(parseRecipeStepsJson("[]")).toEqual({ valid: true, steps: [] });
    });

    it("normalizes valid steps, optional fields, durations, and ingredients", () => {
      const result = parseRecipeStepsJson(JSON.stringify([
        {
          stepTitle: " Prep ",
          description: " Mix batter ",
          duration: "12",
          ingredients: [{ quantity: "2.5", unit: " Cup ", ingredientName: " Flour " }],
        },
        {
          stepTitle: "",
          description: "Bake",
          duration: "",
          ingredients: [],
        },
        {
          description: "Rest",
        },
        {
          stepTitle: "   ",
          description: "Whisk",
        },
        {
          stepTitle: null,
          description: "Cool",
          duration: null,
          ingredients: null,
        },
        {
          description: "Serve",
          duration: 3,
          ingredients: [{ quantity: 1, unit: "plate", ingredientName: "cake" }],
        },
      ]));

      expect(result).toEqual({
        valid: true,
        steps: [
          {
            stepTitle: "Prep",
            description: "Mix batter",
            duration: 12,
            ingredients: [{ quantity: 2.5, unit: "Cup", ingredientName: "Flour" }],
          },
          {
            stepTitle: null,
            description: "Bake",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Rest",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Whisk",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Cool",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Serve",
            duration: 3,
            ingredients: [{ quantity: 1, unit: "plate", ingredientName: "cake" }],
          },
        ],
      });
    });

    it("rejects invalid step payload containers", () => {
      expectInvalidSteps("not-json", "Recipe steps must be valid JSON");
      expectInvalidSteps({ description: "Mix" }, "Recipe steps must be an array");
      expectInvalidSteps([null], "Step 1: Step must be an object");
    });

    it("rejects invalid step title fields", () => {
      expectInvalidSteps([{ stepTitle: 42, description: "Mix" }], "Step 1: Step title must be text");
      expectInvalidSteps(
        [{ stepTitle: "a".repeat(201), description: "Mix" }],
        "Step 1: Step title must be 200 characters or less"
      );
    });

    it("rejects invalid step descriptions", () => {
      expectInvalidSteps([{ description: "" }], "Step 1: Step description is required");
      expectInvalidSteps([{}], "Step 1: Step description is required");
      expectInvalidSteps(
        [{ description: "a".repeat(5001) }],
        "Step 1: Description must be 5,000 characters or less"
      );
    });

    it("rejects invalid durations", () => {
      expectInvalidSteps([{ description: "Mix", duration: 0 }], "Step 1: Duration must be a positive whole number");
      expectInvalidSteps([{ description: "Mix", duration: 1.5 }], "Step 1: Duration must be a positive whole number");
      expectInvalidSteps([{ description: "Mix", duration: {} }], "Step 1: Duration must be a positive whole number");
    });

    it("rejects invalid ingredient containers", () => {
      expectInvalidSteps([{ description: "Mix", ingredients: {} }], "Step 1: Ingredients must be an array");
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [null] }],
        "Step 1, ingredient 1: Ingredient must be an object"
      );
    });

    it("rejects invalid ingredient quantities", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: {}, unit: "cup", ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Quantity must be a valid number"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 0, unit: "cup", ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Quantity must be between 0.001 and 99,999"
      );
    });

    it("rejects invalid ingredient units", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Unit name is required"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "a".repeat(51), ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Unit name must be 50 characters or less"
      );
    });

    it("rejects invalid ingredient names", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "cup" }] }],
        "Step 1, ingredient 1: Ingredient name is required"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "cup", ingredientName: "a".repeat(101) }] }],
        "Step 1, ingredient 1: Ingredient name must be 100 characters or less"
      );
    });
  });

  describe("createRecipeDraft", () => {
    it("creates recipes, steps, units, ingredient refs, and ingredients in one durable graph", async () => {
      await db.unit.create({ data: { name: "cup" } });
      await db.ingredientRef.create({ data: { name: "flour" } });

      const recipe = await createRecipeDraft(db, {
        id: "recipe-transaction-pancakes",
        title: "Transaction Pancakes",
        description: "Breakfast for agents",
        servings: "4",
        imageUrl: "",
        chefId: testUserId,
        steps: [
          {
            stepTitle: "Mix",
            description: "Mix dry ingredients",
            duration: 5,
            ingredients: [
              { quantity: 2, unit: "Cup", ingredientName: "Flour" },
              { quantity: 1, unit: "cup", ingredientName: "Milk" },
            ],
          },
          {
            stepTitle: null,
            description: "Cook until golden",
            duration: null,
            ingredients: [{ quantity: 1, unit: "Tbsp", ingredientName: "Butter" }],
          },
        ],
      });

      const persisted = await db.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        include: {
          steps: {
            orderBy: { stepNum: "asc" },
            include: {
              ingredients: {
                include: { unit: true, ingredientRef: true },
                orderBy: { ingredientRef: { name: "asc" } },
              },
            },
          },
        },
      });

      expect(persisted).toMatchObject({
        id: "recipe-transaction-pancakes",
        title: "Transaction Pancakes",
        description: "Breakfast for agents",
        servings: "4",
        imageUrl: "",
        chefId: testUserId,
      });
      expect(persisted.steps).toHaveLength(2);
      expect(persisted.steps[0]).toMatchObject({
        stepNum: 1,
        stepTitle: "Mix",
        description: "Mix dry ingredients",
        duration: 5,
      });
      expect(persisted.steps[1]).toMatchObject({
        stepNum: 2,
        stepTitle: null,
        description: "Cook until golden",
        duration: null,
      });
      expect(persisted.steps[0].ingredients.map((ingredient) => ({
        quantity: ingredient.quantity,
        unit: ingredient.unit.name,
        name: ingredient.ingredientRef.name,
      }))).toEqual([
        { quantity: 2, unit: "cup", name: "flour" },
        { quantity: 1, unit: "cup", name: "milk" },
      ]);
      expect(persisted.steps[1].ingredients.map((ingredient) => ({
        quantity: ingredient.quantity,
        unit: ingredient.unit.name,
        name: ingredient.ingredientRef.name,
      }))).toEqual([{ quantity: 1, unit: "tbsp", name: "butter" }]);
      await expect(db.unit.count({ where: { name: "cup" } })).resolves.toBe(1);
      await expect(db.ingredientRef.count({ where: { name: "flour" } })).resolves.toBe(1);
    });
  });
});
