import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { act, render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { action as newRecipeAction } from "~/routes/recipes.new";
import { action as newStepAction } from "~/routes/recipes.$id.steps.new";
import { action as editStepAction } from "~/routes/recipes.$id.steps.$stepId.edit";
import { action as editRecipeAction } from "~/routes/recipes.$id.edit";
import { loader as recipeDetailLoader } from "~/routes/recipes.$id";
import RecipeDetail from "~/routes/recipes.$id";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

// Helper to extract data from React Router's data() response
function extractResponseData(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

/**
 * E2E Test: Complete Recipe Creation Flow
 *
 * Tests the full flow of:
 * 1. Creating a new recipe with title, description, and servings
 * 2. Adding steps to the recipe
 * 3. Adding ingredients via AI parsing mode
 * 4. Adding ingredients via manual mode
 * 5. Editing recipe metadata (title, description, servings)
 * 6. Error handling for LLM parse failures with fallback to manual mode
 */
describe("E2E: Complete Recipe Creation Flow", () => {
  let testUserId: string;
  let cookieValue: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;

    // Setup session cookie for all requests
    const session = await sessionStorage.getSession();
    session.set("userId", testUserId);
    const setCookieHeader = await sessionStorage.commitSession(session);
    cookieValue = setCookieHeader.split(";")[0];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  // Helper to create a recipe via action
  async function createRecipe(
    title: string,
    description?: string,
    servings?: string
  ): Promise<string> {
    const formData = new UndiciFormData();
    formData.append("title", title);
    if (description) {
      formData.append("description", description);
    }
    if (servings) {
      formData.append("servings", servings);
    }

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest("http://localhost:3000/recipes/new", {
      method: "POST",
      body: formData,
      headers,
    });

    const response = await newRecipeAction({
      request,
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    // Handle both Response and DataWithResponseInit types
    let location: string | null = null;
    if (response instanceof Response) {
      expect(response.status).toBe(302);
      location = response.headers.get("Location");
    } else if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
      expect(response.init?.status).toBe(302);
      location = response.init?.headers?.get?.("Location") || null;
    } else {
      throw new Error("Unexpected response type from newRecipeAction");
    }

    expect(location).toBeTruthy();
    const recipeId = location!.split("/recipes/")[1];
    expect(recipeId).toBeTruthy();

    return recipeId;
  }

  // Helper to add a step to a recipe via action
  async function addStep(
    recipeId: string,
    description: string,
    stepTitle?: string,
    usesSteps?: number[]
  ): Promise<string> {
    const formData = new UndiciFormData();
    formData.append("description", description);
    if (stepTitle) {
      formData.append("stepTitle", stepTitle);
    }
    // Add empty ingredients JSON - steps can be created empty and ingredients added later
    formData.append("ingredientsJson", JSON.stringify([]));

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, {
      method: "POST",
      body: formData,
      headers,
    });

    const response = await newStepAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId },
    } as any);

    // Handle both Response and DataWithResponseInit types
    let location: string | null = null;
    let status = 200;
    
    if (response instanceof Response) {
      status = response.status;
      location = response.headers.get("Location");
    } else if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
      status = response.init?.status || 200;
      location = response.init?.headers?.get?.("Location") || null;
    } else {
      throw new Error("Unexpected response type from newStepAction");
    }

    if (status !== 302) {
      throw new Error(`Failed to create step. Status: ${status}, Response: ${JSON.stringify(response)}`);
    }

    expect(location).toBeTruthy();
    // Location format: /recipes/{recipeId}/steps/{stepId}/edit
    const parts = location!.split("/");
    const stepId = parts[4];
    expect(stepId).toBeTruthy();

    // If this step has dependencies (usesSteps), add them after creation
    if (usesSteps && usesSteps.length > 0) {
      // Get the step number for this step
      const recipeWithSteps = await db.recipe.findUnique({
        where: { id: recipeId },
        select: {
          steps: {
            select: { id: true, stepNum: true },
            orderBy: { stepNum: "asc" },
          },
        },
      });

      const newStep = recipeWithSteps?.steps.find((s) => s.id === stepId);
      if (newStep) {
        // Create the StepOutputUse records directly in the database
        await db.stepOutputUse.createMany({
          data: usesSteps.map((outputStepNum) => ({
            recipeId,
            inputStepNum: newStep.stepNum,
            outputStepNum,
          })),
        });
      }
    }

    return stepId;
  }

  // Helper to add ingredient manually via action
  async function addIngredientManual(
    recipeId: string,
    stepId: string,
    quantity: number,
    unitName: string,
    ingredientName: string
  ): Promise<{ success?: boolean; errors?: any }> {
    const formData = new UndiciFormData();
    formData.append("intent", "addIngredient");
    formData.append("quantity", quantity.toString());
    formData.append("unitName", unitName);
    formData.append("ingredientName", ingredientName);

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(
      `http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    const response = await editStepAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId, stepId },
    } as any);

    // Extract data from React Router's data() response
    const { data } = extractResponseData(response);
    return data || {};
  }

  // Helper to parse ingredients via AI action
  async function parseIngredientsAction(
    recipeId: string,
    stepId: string,
    ingredientText: string
  ): Promise<{ parsedIngredients?: any[]; errors?: any }> {
    const formData = new UndiciFormData();
    formData.append("intent", "parseIngredients");
    formData.append("ingredientText", ingredientText);

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(
      `http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    const response = await editStepAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId, stepId },
    } as any);

    // Extract data from React Router's data() response
    const { data } = extractResponseData(response);
    return data || {};
  }

  // Helper to edit recipe metadata via action
  async function editRecipe(
    recipeId: string,
    title: string,
    description?: string,
    servings?: string
  ): Promise<Response> {
    const formData = new UndiciFormData();
    formData.append("title", title);
    if (description !== undefined) {
      formData.append("description", description);
    }
    if (servings !== undefined) {
      formData.append("servings", servings);
    }

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
      method: "POST",
      body: formData,
      headers,
    });

    const response = await editRecipeAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId },
    } as any);

    return response;
  }

  // Helper to load recipe detail via loader
  async function loadRecipeDetail(recipeId: string) {
    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}`, { headers });

    const result = await recipeDetailLoader({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId },
    } as any);

    return result;
  }

  describe("Full flow: create recipe → add step → add ingredients (manual) → verify", () => {
    it("should create recipe, add step, and add ingredients manually", async () => {
      // Step 1: Create a new recipe
      const recipeTitle = "Manual Ingredient Test Recipe " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(
        recipeTitle,
        "A recipe to test manual ingredient addition",
        "4"
      );

      // Verify recipe was created
      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe).not.toBeNull();
      expect(recipe!.title).toBe(recipeTitle);
      expect(recipe!.description).toBe("A recipe to test manual ingredient addition");
      expect(recipe!.servings).toBe("4");

      // Step 2: Add a step
      const stepId = await addStep(recipeId, "Mix all ingredients together", "Mix Ingredients");

      // Verify step was created
      const step = await db.recipeStep.findUnique({ where: { id: stepId } });
      expect(step).not.toBeNull();
      expect(step!.stepTitle).toBe("Mix Ingredients");
      expect(step!.description).toBe("Mix all ingredients together");

      // Step 3: Add ingredients manually
      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      const result1 = await addIngredientManual(
        recipeId,
        stepId,
        2,
        "cup_" + uniqueSuffix,
        "flour_" + uniqueSuffix
      );
      expect(result1.success).toBe(true);

      const result2 = await addIngredientManual(
        recipeId,
        stepId,
        1,
        "tsp_" + uniqueSuffix,
        "salt_" + uniqueSuffix
      );
      expect(result2.success).toBe(true);

      const result3 = await addIngredientManual(
        recipeId,
        stepId,
        0.5,
        "cup_" + uniqueSuffix,
        "sugar_" + uniqueSuffix
      );
      expect(result3.success).toBe(true);

      // Step 4: Verify ingredients in database
      const ingredients = await db.ingredient.findMany({
        where: { recipeId },
        include: {
          unit: true,
          ingredientRef: true,
        },
      });

      expect(ingredients).toHaveLength(3);

      // Verify each ingredient
      const flourIng = ingredients.find((i) => i.ingredientRef.name.includes("flour"));
      expect(flourIng).toBeDefined();
      expect(flourIng!.quantity).toBe(2);
      expect(flourIng!.unit.name).toBe("cup_" + uniqueSuffix);

      const saltIng = ingredients.find((i) => i.ingredientRef.name.includes("salt"));
      expect(saltIng).toBeDefined();
      expect(saltIng!.quantity).toBe(1);
      expect(saltIng!.unit.name).toBe("tsp_" + uniqueSuffix);

      const sugarIng = ingredients.find((i) => i.ingredientRef.name.includes("sugar"));
      expect(sugarIng).toBeDefined();
      expect(sugarIng!.quantity).toBe(0.5);
    });

    it("should display manually added ingredients on recipe detail page", async () => {
      // Create recipe with step and ingredients
      const recipeTitle = "Display Test Recipe " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(recipeTitle);
      const stepId = await addStep(recipeId, "Test step", "Test Step");

      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, stepId, 3, "tbsp_" + uniqueSuffix, "butter_" + uniqueSuffix);

      // Load recipe detail
      const result = await loadRecipeDetail(recipeId);

      // Verify data structure
      expect(result.recipe).toBeDefined();
      expect(result.recipe.steps).toHaveLength(1);
      expect(result.recipe.steps[0].ingredients).toHaveLength(1);
      expect(result.recipe.steps[0].ingredients[0].quantity).toBe(3);
      expect(result.recipe.steps[0].ingredients[0].unit.name).toBe("tbsp_" + uniqueSuffix);
      expect(result.recipe.steps[0].ingredients[0].ingredientRef.name).toBe("butter_" + uniqueSuffix);

      // Render component and verify UI
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}`]} />);

      await screen.findByText(new RegExp(recipeTitle));
      expect(screen.getByText(/Test Step/)).toBeInTheDocument();
    });

    it("should validate manual ingredient input", async () => {
      const recipeId = await createRecipe("Validation Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Test step");

      // Test invalid quantity (0)
      const result1 = await addIngredientManual(recipeId, stepId, 0, "cup", "flour");
      expect(result1.errors?.quantity).toBeDefined();

      // Test negative quantity
      const result2 = await addIngredientManual(recipeId, stepId, -1, "cup", "flour");
      expect(result2.errors?.quantity).toBeDefined();

      // Test empty unit name
      const result3 = await addIngredientManual(recipeId, stepId, 1, "", "flour");
      expect(result3.errors?.unitName).toBeDefined();

      // Test empty ingredient name
      const result4 = await addIngredientManual(recipeId, stepId, 1, "cup", "");
      expect(result4.errors?.ingredientName).toBeDefined();
    });

    it("should prevent duplicate ingredients in the same recipe", async () => {
      const recipeId = await createRecipe("Duplicate Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Test step");

      const uniqueSuffix = faker.string.alphanumeric(6);
      const ingredientName = "test_ingredient_" + uniqueSuffix;

      // Add ingredient first time
      const result1 = await addIngredientManual(recipeId, stepId, 1, "cup_" + uniqueSuffix, ingredientName);
      expect(result1.success).toBe(true);

      // Try to add same ingredient again
      const result2 = await addIngredientManual(recipeId, stepId, 2, "cup_" + uniqueSuffix, ingredientName);
      expect(result2.errors?.ingredientName).toBe("This ingredient is already in the recipe");
    });
  });

  describe("Full flow: create recipe → add step → add ingredients (AI-parsed) → verify", () => {
    it("should parse ingredients via AI and return parsed results", async () => {
      const recipeId = await createRecipe("AI Parse Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      const parsedIngredients = [
        { quantity: 2, unit: "cup", ingredientName: "flour" },
        { quantity: 1, unit: "tsp", ingredientName: "salt" },
      ];
      const originalKey = process.env.OPENAI_API_KEY;
      const originalFetch = globalThis.fetch;
      process.env.OPENAI_API_KEY = "test-api-key";
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 0,
            model: "gpt-4o-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({ ingredients: parsedIngredients }),
                  refusal: null,
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      ) as unknown as typeof fetch;

      try {
        const result = await parseIngredientsAction(
          recipeId,
          stepId,
          "2 cups flour\n1 tsp salt"
        );

        expect(result.errors?.parse).toBeUndefined();
        expect(result.parsedIngredients).toEqual(parsedIngredients);
        expect(globalThis.fetch).toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it("should return parse error when API key is missing", async () => {
      const recipeId = await createRecipe("No API Key Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Ensure no API key is set
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const result = await parseIngredientsAction(recipeId, stepId, "2 cups flour");

      expect(result.errors?.parse).toBe("OpenAI API key is required");

      // Restore original key if it existed
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should save parsed ingredients to DB after manual confirmation", async () => {
      // This test simulates the flow where parsed ingredients are shown to user,
      // then saved via addIngredient intent
      const recipeId = await createRecipe("Save Parsed Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Simulate parsed ingredients being saved one by one (as the UI does)
      const uniqueSuffix = faker.string.alphanumeric(6);
      const parsedIngredients = [
        { quantity: 2, unit: "cup_" + uniqueSuffix, ingredientName: "flour_" + uniqueSuffix },
        { quantity: 0.5, unit: "tsp_" + uniqueSuffix, ingredientName: "baking_powder_" + uniqueSuffix },
      ];

      for (const ing of parsedIngredients) {
        const result = await addIngredientManual(
          recipeId,
          stepId,
          ing.quantity,
          ing.unit,
          ing.ingredientName
        );
        expect(result.success).toBe(true);
      }

      // Verify all ingredients are in DB
      const ingredients = await db.ingredient.findMany({
        where: { recipeId },
        include: {
          unit: true,
          ingredientRef: true,
        },
      });

      expect(ingredients).toHaveLength(2);
      expect(ingredients[0].quantity).toBe(2);
      expect(ingredients[1].quantity).toBe(0.5);
    });
  });

  describe("Edit recipe flow: create recipe → edit title/description/servings → verify", () => {
    it("should edit recipe title", async () => {
      const originalTitle = "Original Title " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(originalTitle, "Original description", "4");

      // Verify original
      let recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.title).toBe(originalTitle);

      // Edit title
      const newTitle = "Updated Title " + faker.string.alphanumeric(6);
      const response = await editRecipe(recipeId, newTitle, "Original description", "4");

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}`);

      // Verify update
      recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.title).toBe(newTitle);
    });

    it("should edit recipe description", async () => {
      const title = "Description Edit Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title, "Original description", "4");

      // Edit description
      const newDescription = "Updated description " + faker.string.alphanumeric(6);
      const response = await editRecipe(recipeId, title, newDescription, "4");

      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.description).toBe(newDescription);
    });

    it("should edit recipe servings", async () => {
      const title = "Servings Edit Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title, "Test description", "4");

      // Edit servings
      const response = await editRecipe(recipeId, title, "Test description", "8");

      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.servings).toBe("8");
    });

    it("should edit multiple fields at once", async () => {
      const originalTitle = "Multi Edit Original " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(originalTitle, "Original desc", "2");

      // Edit all fields
      const newTitle = "Multi Edit Updated " + faker.string.alphanumeric(6);
      const newDescription = "Updated description " + faker.string.alphanumeric(6);
      const newServings = "6";

      const response = await editRecipe(recipeId, newTitle, newDescription, newServings);

      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.title).toBe(newTitle);
      expect(recipe!.description).toBe(newDescription);
      expect(recipe!.servings).toBe(newServings);
    });

    it("should clear description when empty string provided", async () => {
      const title = "Clear Desc Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title, "Some description", "4");

      // Clear description
      const response = await editRecipe(recipeId, title, "", "4");

      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.description).toBeNull();
    });

    it("should clear servings when empty string provided", async () => {
      const title = "Clear Servings Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title, "Test desc", "4");

      // Clear servings
      const response = await editRecipe(recipeId, title, "Test desc", "");

      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.servings).toBeNull();
    });

    it("should validate title is not empty on edit", async () => {
      const originalTitle = "Title Validation Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(originalTitle);

      // Try to edit with empty title
      const formData = new UndiciFormData();
      formData.append("title", "");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await editRecipeAction({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors?.title).toBeDefined();
    });

    it("should verify edited recipe displays correctly", async () => {
      const title = "Display Edit Test " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title, "Original desc", "4");

      // Edit recipe
      const newTitle = "Edited Display Test " + faker.string.alphanumeric(6);
      const newDescription = "Edited description for display test";
      await editRecipe(recipeId, newTitle, newDescription, "8");

      // Load and render
      const result = await loadRecipeDetail(recipeId);

      expect(result.recipe.title).toBe(newTitle);
      expect(result.recipe.description).toBe(newDescription);
      expect(result.recipe.servings).toBe("8");

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => result,
        },
      ]);

      await act(async () => {
        render(<Stub initialEntries={[`/recipes/${recipeId}`]} />);
      });

      await screen.findByText(new RegExp(newTitle));
    });
  });

  describe("Error handling: LLM parse failure → fallback to manual mode", () => {
    it("should return parse error when API key is missing and allow manual fallback", async () => {
      const recipeId = await createRecipe("LLM Fallback Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Ensure no API key is set
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Attempt AI parse - should fail
      const parseResult = await parseIngredientsAction(recipeId, stepId, "2 cups flour");
      expect(parseResult.errors?.parse).toBe("OpenAI API key is required");

      // User falls back to manual mode and adds ingredient
      const uniqueSuffix = faker.string.alphanumeric(6);
      const manualResult = await addIngredientManual(
        recipeId,
        stepId,
        2,
        "cup_" + uniqueSuffix,
        "flour_" + uniqueSuffix
      );
      expect(manualResult.success).toBe(true);

      // Verify ingredient was added
      const ingredients = await db.ingredient.findMany({
        where: { recipeId },
        include: {
          unit: true,
          ingredientRef: true,
        },
      });
      expect(ingredients).toHaveLength(1);
      expect(ingredients[0].quantity).toBe(2);

      // Restore original key if it existed
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should handle API connection failure gracefully", async () => {
      const recipeId = await createRecipe("API Failure Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Set a fake API key and stub fetch to trigger the API-failure branch
      // without reaching the real OpenAI service.
      const originalKey = process.env.OPENAI_API_KEY;
      const originalFetch = globalThis.fetch;
      process.env.OPENAI_API_KEY = "fake-key-that-will-fail";
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "stubbed OpenAI failure" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        })
      ) as unknown as typeof fetch;

      let parseResult: Awaited<ReturnType<typeof parseIngredientsAction>>;
      try {
        // Attempt AI parse - should fail with API error
        parseResult = await parseIngredientsAction(recipeId, stepId, "2 cups flour");
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Should get a parse error (could be various types of API errors)
      expect(parseResult.errors?.parse).toBeDefined();

      // User can still add ingredients manually
      const uniqueSuffix = faker.string.alphanumeric(6);
      const manualResult = await addIngredientManual(
        recipeId,
        stepId,
        2,
        "cup_" + uniqueSuffix,
        "flour_" + uniqueSuffix
      );
      expect(manualResult.success).toBe(true);

      // Restore original key
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("should verify error is in response.errors.parse", async () => {
      const recipeId = await createRecipe("Error Format Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Remove API key to trigger error
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const parseResult = await parseIngredientsAction(recipeId, stepId, "2 cups flour");

      // Verify error is in the correct location
      expect(parseResult).toHaveProperty("errors");
      expect(parseResult.errors).toHaveProperty("parse");
      expect(typeof parseResult.errors.parse).toBe("string");

      // Restore
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should allow multiple manual ingredients after LLM failure", async () => {
      const recipeId = await createRecipe("Multi Manual After LLM Fail " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Mix ingredients");

      // Remove API key to trigger LLM failure
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Attempt AI parse - fails
      const parseResult = await parseIngredientsAction(recipeId, stepId, "2 cups flour\n1 tsp salt");
      expect(parseResult.errors?.parse).toBeDefined();

      // Add multiple ingredients manually
      const uniqueSuffix = faker.string.alphanumeric(6);
      await addIngredientManual(recipeId, stepId, 2, "cup_" + uniqueSuffix, "flour_" + uniqueSuffix);
      await addIngredientManual(recipeId, stepId, 1, "tsp_" + uniqueSuffix, "salt_" + uniqueSuffix);
      await addIngredientManual(recipeId, stepId, 0.5, "cup_" + uniqueSuffix, "sugar_" + uniqueSuffix);

      // Verify all were added
      const ingredients = await db.ingredient.findMany({
        where: { recipeId },
        include: {
          unit: true,
          ingredientRef: true,
        },
      });
      expect(ingredients).toHaveLength(3);

      // Restore
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe("Edge cases: Recipe creation", () => {
    it("should create recipe with only required fields (title)", async () => {
      const title = "Minimal Recipe " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(title);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe).not.toBeNull();
      expect(recipe!.title).toBe(title);
      expect(recipe!.description).toBeNull();
      expect(recipe!.servings).toBeNull();
    });

    it("should create recipe with all fields", async () => {
      const title = "Full Recipe " + faker.string.alphanumeric(6);
      const description = "Full description " + faker.string.alphanumeric(8);
      const servings = "12";

      const recipeId = await createRecipe(title, description, servings);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.title).toBe(title);
      expect(recipe!.description).toBe(description);
      expect(recipe!.servings).toBe(servings);
    });

    it("should trim whitespace from recipe fields", async () => {
      const title = "  Whitespace Title  " + faker.string.alphanumeric(6) + "  ";
      const description = "  Whitespace desc  ";

      const recipeId = await createRecipe(title, description);

      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.title).toBe(title.trim());
      expect(recipe!.description).toBe(description.trim());
    });
  });

  describe("Edge cases: Step creation", () => {
    it("should create step without title", async () => {
      const recipeId = await createRecipe("Step No Title Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Step description without title");

      const step = await db.recipeStep.findUnique({ where: { id: stepId } });
      expect(step!.stepTitle).toBeNull();
      expect(step!.description).toBe("Step description without title");
    });

    it("should auto-increment step numbers", async () => {
      const recipeId = await createRecipe("Step Numbering Test " + faker.string.alphanumeric(6));

      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      await addStep(recipeId, "Third step", "Step 3");

      const steps = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });

      expect(steps).toHaveLength(3);
      expect(steps[0].stepNum).toBe(1);
      expect(steps[1].stepNum).toBe(2);
      expect(steps[2].stepNum).toBe(3);
    });
  });

  describe("Database integrity", () => {
    it("should maintain referential integrity between recipe, steps, and ingredients", async () => {
      const recipeId = await createRecipe("Integrity Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Test step");

      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, stepId, 1, "cup_" + uniqueSuffix, "flour_" + uniqueSuffix);

      // Verify relationships
      const recipe = await db.recipe.findUnique({
        where: { id: recipeId },
        include: {
          steps: {
            include: {
              ingredients: {
                include: {
                  unit: true,
                  ingredientRef: true,
                },
              },
            },
          },
        },
      });

      expect(recipe).not.toBeNull();
      expect(recipe!.steps).toHaveLength(1);
      expect(recipe!.steps[0].ingredients).toHaveLength(1);
      expect(recipe!.steps[0].ingredients[0].unit.name).toBe("cup_" + uniqueSuffix);
      expect(recipe!.steps[0].ingredients[0].ingredientRef.name).toBe("flour_" + uniqueSuffix);
    });

    it("should correctly associate ingredients with the right step", async () => {
      const recipeId = await createRecipe("Step Association Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2");

      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step1Id, 1, "cup_" + uniqueSuffix, "flour_" + uniqueSuffix);
      await addIngredientManual(recipeId, step2Id, 2, "tbsp_" + uniqueSuffix, "butter_" + uniqueSuffix);

      // Get step data
      const step1 = await db.recipeStep.findUnique({ where: { id: step1Id } });
      const step2 = await db.recipeStep.findUnique({ where: { id: step2Id } });

      // Verify ingredients are associated with correct steps
      const step1Ingredients = await db.ingredient.findMany({
        where: { recipeId, stepNum: step1!.stepNum },
        include: { ingredientRef: true },
      });
      const step2Ingredients = await db.ingredient.findMany({
        where: { recipeId, stepNum: step2!.stepNum },
        include: { ingredientRef: true },
      });

      expect(step1Ingredients).toHaveLength(1);
      expect(step1Ingredients[0].ingredientRef.name).toBe("flour_" + uniqueSuffix);

      expect(step2Ingredients).toHaveLength(1);
      expect(step2Ingredients[0].ingredientRef.name).toBe("butter_" + uniqueSuffix);
    });

    it("should correctly associate units and ingredient refs", async () => {
      const recipeId = await createRecipe("Unit/Ref Test " + faker.string.alphanumeric(6));
      const stepId = await addStep(recipeId, "Test step");

      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      const unitName = "unique_unit_" + uniqueSuffix;
      const ingredientName = "unique_ingredient_" + uniqueSuffix;

      await addIngredientManual(recipeId, stepId, 5, unitName, ingredientName);

      // Verify unit was created (names are stored lowercase)
      const unit = await db.unit.findUnique({ where: { name: unitName.toLowerCase() } });
      expect(unit).not.toBeNull();

      // Verify ingredient ref was created (names are stored lowercase)
      const ingredientRef = await db.ingredientRef.findUnique({ where: { name: ingredientName.toLowerCase() } });
      expect(ingredientRef).not.toBeNull();

      // Verify ingredient links to both
      const ingredient = await db.ingredient.findFirst({
        where: { recipeId },
        include: { unit: true, ingredientRef: true },
      });
      expect(ingredient!.unit.id).toBe(unit!.id);
      expect(ingredient!.ingredientRef.id).toBe(ingredientRef!.id);
    });

    it("should reuse existing units and ingredient refs", async () => {
      const recipe1Id = await createRecipe("Reuse Test 1 " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipe1Id, "Test step");

      const recipe2Id = await createRecipe("Reuse Test 2 " + faker.string.alphanumeric(6));
      const step2Id = await addStep(recipe2Id, "Test step");

      // Note: Unit names and ingredient names are lowercased by the action
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      const unitName = "shared_unit_" + uniqueSuffix;
      const ingredientName = "shared_ingredient_" + uniqueSuffix;

      // Add same unit/ingredient to both recipes
      await addIngredientManual(recipe1Id, step1Id, 1, unitName, ingredientName);
      await addIngredientManual(recipe2Id, step2Id, 2, unitName, ingredientName);

      // Verify only one unit and one ingredient ref exist (names are stored lowercase)
      const units = await db.unit.findMany({ where: { name: unitName.toLowerCase() } });
      expect(units).toHaveLength(1);

      const ingredientRefs = await db.ingredientRef.findMany({ where: { name: ingredientName.toLowerCase() } });
      expect(ingredientRefs).toHaveLength(1);
    });
  });
});
