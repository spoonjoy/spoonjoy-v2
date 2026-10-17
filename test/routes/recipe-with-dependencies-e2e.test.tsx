import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { action as newRecipeAction } from "~/routes/recipes.new";
import { action as newStepAction } from "~/routes/recipes.$id.steps.new";
import { loader as recipeDetailLoader } from "~/routes/recipes.$id";
import RecipeDetail from "~/routes/recipes.$id";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

/**
 * E2E Test: Create Recipe with Step Dependencies
 *
 * Tests the full flow of:
 * 1. Creating a new recipe
 * 2. Adding multiple steps to the recipe
 * 3. Adding dependencies between steps (step output uses)
 * 4. Verifying dependencies are saved correctly in the database
 * 5. Verifying dependencies display correctly on the recipe detail page
 */
describe("E2E: Create Recipe with Step Dependencies", () => {
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
    cleanup();
    await cleanupDatabase();
  });

  // Helper to create a recipe via action
  async function createRecipe(title: string, description?: string): Promise<string> {
    const formData = new UndiciFormData();
    formData.append("title", title);
    if (description) {
      formData.append("description", description);
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

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);

    // Extract recipe ID from redirect location
    const location = response.headers.get("Location");
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
    if (usesSteps) {
      for (const stepNum of usesSteps) {
        formData.append("usesSteps", stepNum.toString());
      }
    }

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

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);

    // Extract step ID from redirect location
    const location = response.headers.get("Location");
    expect(location).toBeTruthy();
    // Location format: /recipes/{recipeId}/steps/{stepId}/edit
    const parts = location!.split("/");
    const stepId = parts[4];
    expect(stepId).toBeTruthy();

    return stepId;
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

  describe("Full flow: create recipe → add steps → add dependencies", () => {
    it("should create recipe with multiple steps and dependencies between them", async () => {
      // Step 1: Create a new recipe
      const recipeId = await createRecipe(
        "Pasta with Sauce " + faker.string.alphanumeric(6),
        "A delicious pasta dish with homemade sauce"
      );

      // Step 2: Add first step (no dependencies possible)
      await addStep(recipeId, "Boil water and cook pasta until al dente", "Cook Pasta");

      // Verify first step was created
      const stepsAfterFirst = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });
      expect(stepsAfterFirst).toHaveLength(1);
      expect(stepsAfterFirst[0].stepNum).toBe(1);
      expect(stepsAfterFirst[0].stepTitle).toBe("Cook Pasta");

      // Step 3: Add second step with no dependencies
      await addStep(recipeId, "Sauté garlic in olive oil until fragrant", "Prepare Sauce Base");

      // Verify second step was created
      const stepsAfterSecond = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });
      expect(stepsAfterSecond).toHaveLength(2);
      expect(stepsAfterSecond[1].stepNum).toBe(2);

      // Step 4: Add third step that depends on step 1 (cooked pasta)
      await addStep(
        recipeId,
        "Drain pasta and add to sauce, toss to combine",
        "Combine",
        [1, 2] // Uses output from step 1 (pasta) and step 2 (sauce)
      );

      // Verify third step was created with dependencies
      const stepsAfterThird = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });
      expect(stepsAfterThird).toHaveLength(3);
      expect(stepsAfterThird[2].stepNum).toBe(3);

      // Verify step output uses were created correctly
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
      expect(stepOutputUses[0].inputStepNum).toBe(3);
      expect(stepOutputUses[1].outputStepNum).toBe(2);
      expect(stepOutputUses[1].inputStepNum).toBe(3);
    });

    it("should verify dependencies display correctly on recipe detail page", async () => {
      // Create recipe with steps and dependencies
      const recipeId = await createRecipe("Rice Bowl " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Cook rice in rice cooker", "Cook Rice");
      await addStep(recipeId, "Prepare vegetables and protein", "Prep Toppings");
      await addStep(recipeId, "Assemble bowl with rice and toppings", "Assemble", [1, 2]);

      // Load recipe detail via loader
      const result = await loadRecipeDetail(recipeId);

      // Verify recipe data structure
      expect(result.recipe).toBeDefined();
      expect(result.recipe.steps).toHaveLength(3);

      // Verify step 1 has no dependencies
      expect(result.recipe.steps[0].usingSteps).toHaveLength(0);

      // Verify step 2 has no dependencies
      expect(result.recipe.steps[1].usingSteps).toHaveLength(0);

      // Verify step 3 has dependencies on step 1 and 2
      expect(result.recipe.steps[2].usingSteps).toHaveLength(2);
      expect(result.recipe.steps[2].usingSteps[0].outputStepNum).toBe(1);
      expect(result.recipe.steps[2].usingSteps[0].outputOfStep.stepTitle).toBe("Cook Rice");
      expect(result.recipe.steps[2].usingSteps[1].outputStepNum).toBe(2);
      expect(result.recipe.steps[2].usingSteps[1].outputOfStep.stepTitle).toBe("Prep Toppings");
    });

    it("should render dependencies correctly in component", async () => {
      // Create recipe with steps and dependencies
      const recipeId = await createRecipe("Stir Fry " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Prepare and marinate protein", "Prep Protein");
      await addStep(recipeId, "Chop all vegetables", "Prep Vegetables");
      await addStep(recipeId, "Stir fry protein until cooked", "Cook Protein", [1]);
      await addStep(recipeId, "Add vegetables and sauce", "Final Assembly", [2, 3]);

      // Load recipe detail
      const result = await loadRecipeDetail(recipeId);

      // Render the component with the loaded data
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}`]} />);

      // Wait for recipe to render
      expect(await screen.findByText(/Stir Fry/)).toBeInTheDocument();

      // Verify step output uses sections appear (inline with ingredients)
      const stepOutputSections = screen.getAllByTestId("step-output-uses-section");
      expect(stepOutputSections).toHaveLength(2);

      // Verify step references are shown in the sections
      // The step titles appear both in the step card and in the sections
      expect(stepOutputSections[0]).toHaveTextContent("Prep Protein");
      expect(stepOutputSections[1]).toHaveTextContent("Prep Vegetables");
      expect(stepOutputSections[1]).toHaveTextContent("Cook Protein");
    });
  });

  describe("Edge cases: dependencies", () => {
    it("should handle a step with single dependency", async () => {
      const recipeId = await createRecipe("Simple Dish " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Cook the main ingredient", "Main Prep");
      await addStep(recipeId, "Finish and serve", "Serve", [1]);

      const result = await loadRecipeDetail(recipeId);

      expect(result.recipe.steps[1].usingSteps).toHaveLength(1);
      expect(result.recipe.steps[1].usingSteps[0].outputStepNum).toBe(1);
    });

    it("should handle multiple steps depending on the same earlier step", async () => {
      const recipeId = await createRecipe("Complex Dish " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Make base sauce", "Base Sauce");
      await addStep(recipeId, "Use sauce for component A", "Component A", [1]);
      await addStep(recipeId, "Use sauce for component B", "Component B", [1]);
      await addStep(recipeId, "Combine all components", "Final", [2, 3]);

      // Verify database state
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
        orderBy: [{ inputStepNum: "asc" }, { outputStepNum: "asc" }],
      });

      // Step 2 uses step 1, Step 3 uses step 1, Step 4 uses steps 2 and 3
      expect(stepOutputUses).toHaveLength(4);

      // Step 2 uses step 1
      expect(stepOutputUses[0].inputStepNum).toBe(2);
      expect(stepOutputUses[0].outputStepNum).toBe(1);

      // Step 3 uses step 1
      expect(stepOutputUses[1].inputStepNum).toBe(3);
      expect(stepOutputUses[1].outputStepNum).toBe(1);

      // Step 4 uses steps 2 and 3
      expect(stepOutputUses[2].inputStepNum).toBe(4);
      expect(stepOutputUses[2].outputStepNum).toBe(2);
      expect(stepOutputUses[3].inputStepNum).toBe(4);
      expect(stepOutputUses[3].outputStepNum).toBe(3);

      // Verify via loader
      const result = await loadRecipeDetail(recipeId);
      expect(result.recipe.steps[3].usingSteps).toHaveLength(2);
    });

    it("should handle a chain of dependencies (step 3 uses step 2, step 2 uses step 1)", async () => {
      const recipeId = await createRecipe("Chained Recipe " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step in chain", "Step 1");
      await addStep(recipeId, "Second step uses first", "Step 2", [1]);
      await addStep(recipeId, "Third step uses second", "Step 3", [2]);

      const result = await loadRecipeDetail(recipeId);

      // Step 2 depends on step 1
      expect(result.recipe.steps[1].usingSteps).toHaveLength(1);
      expect(result.recipe.steps[1].usingSteps[0].outputStepNum).toBe(1);

      // Step 3 depends on step 2
      expect(result.recipe.steps[2].usingSteps).toHaveLength(1);
      expect(result.recipe.steps[2].usingSteps[0].outputStepNum).toBe(2);
    });

    it("should handle step with dependency on step that has null title", async () => {
      const recipeId = await createRecipe("Untitled Step Recipe " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step with no title"); // No stepTitle
      await addStep(recipeId, "Second step uses first", "Step 2", [1]);

      const result = await loadRecipeDetail(recipeId);

      expect(result.recipe.steps[1].usingSteps).toHaveLength(1);
      expect(result.recipe.steps[1].usingSteps[0].outputOfStep.stepTitle).toBeNull();
      expect(result.recipe.steps[1].usingSteps[0].outputOfStep.stepNum).toBe(1);

      // Render component to verify display of null title
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}`]} />);

      await screen.findByText(/Untitled Step Recipe/);
      // Should display "Step 1" in the step output uses section
      const stepOutputSection = screen.getByTestId("step-output-uses-section");
      expect(stepOutputSection).toHaveTextContent("Step 1");
    });

    it("should handle recipe with no dependencies (all independent steps)", async () => {
      const recipeId = await createRecipe("Independent Steps " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Do task A independently", "Task A");
      await addStep(recipeId, "Do task B independently", "Task B");
      await addStep(recipeId, "Do task C independently", "Task C");

      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
      });
      expect(stepOutputUses).toHaveLength(0);

      const result = await loadRecipeDetail(recipeId);
      expect(result.recipe.steps[0].usingSteps).toHaveLength(0);
      expect(result.recipe.steps[1].usingSteps).toHaveLength(0);
      expect(result.recipe.steps[2].usingSteps).toHaveLength(0);
    });

    it("should handle recipe with single step (no dependencies possible)", async () => {
      const recipeId = await createRecipe("Single Step Recipe " + faker.string.alphanumeric(6));
      await addStep(recipeId, "The only step in this recipe", "Solo Step");

      const result = await loadRecipeDetail(recipeId);
      expect(result.recipe.steps).toHaveLength(1);
      expect(result.recipe.steps[0].usingSteps).toHaveLength(0);
    });

    it("should render component correctly when steps have no dependencies", async () => {
      const recipeId = await createRecipe("No Deps Recipe " + faker.string.alphanumeric(6));
      await addStep(recipeId, "Independent step 1", "Step 1");
      await addStep(recipeId, "Independent step 2", "Step 2");

      const result = await loadRecipeDetail(recipeId);

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}`]} />);

      await screen.findByText(/No Deps Recipe/);
      // "Using outputs from" should NOT appear
      expect(screen.queryByText("Using outputs from")).not.toBeInTheDocument();
    });
  });

  describe("Database integrity", () => {
    it("should correctly associate dependencies with the right recipe", async () => {
      // Create two recipes
      const recipe1Id = await createRecipe("Recipe One " + faker.string.alphanumeric(6));
      const recipe2Id = await createRecipe("Recipe Two " + faker.string.alphanumeric(6));

      // Add steps with dependencies to recipe 1
      await addStep(recipe1Id, "Recipe 1 Step 1", "R1S1");
      await addStep(recipe1Id, "Recipe 1 Step 2", "R1S2", [1]);

      // Add steps with dependencies to recipe 2
      await addStep(recipe2Id, "Recipe 2 Step 1", "R2S1");
      await addStep(recipe2Id, "Recipe 2 Step 2", "R2S2", [1]);

      // Verify each recipe has its own dependencies
      const recipe1Uses = await db.stepOutputUse.findMany({
        where: { recipeId: recipe1Id },
      });
      const recipe2Uses = await db.stepOutputUse.findMany({
        where: { recipeId: recipe2Id },
      });

      expect(recipe1Uses).toHaveLength(1);
      expect(recipe1Uses[0].recipeId).toBe(recipe1Id);
      expect(recipe2Uses).toHaveLength(1);
      expect(recipe2Uses[0].recipeId).toBe(recipe2Id);
    });

    it("should persist all step data correctly alongside dependencies", async () => {
      const recipeTitle = "Full Data Recipe " + faker.string.alphanumeric(6);
      const recipeId = await createRecipe(recipeTitle, "Full recipe description");

      await addStep(recipeId, "Detailed description for step 1", "Detailed Step 1");
      await addStep(recipeId, "Detailed description for step 2 that uses step 1", "Detailed Step 2", [1]);

      // Verify complete data integrity
      const recipe = await db.recipe.findUnique({
        where: { id: recipeId },
        include: {
          steps: {
            orderBy: { stepNum: "asc" },
            include: {
              usingSteps: true,
            },
          },
        },
      });

      expect(recipe).not.toBeNull();
      expect(recipe!.title).toBe(recipeTitle);
      expect(recipe!.description).toBe("Full recipe description");
      expect(recipe!.steps).toHaveLength(2);

      // Step 1 details
      expect(recipe!.steps[0].stepNum).toBe(1);
      expect(recipe!.steps[0].stepTitle).toBe("Detailed Step 1");
      expect(recipe!.steps[0].description).toBe("Detailed description for step 1");
      expect(recipe!.steps[0].usingSteps).toHaveLength(0);

      // Step 2 details with dependency
      expect(recipe!.steps[1].stepNum).toBe(2);
      expect(recipe!.steps[1].stepTitle).toBe("Detailed Step 2");
      expect(recipe!.steps[1].description).toBe("Detailed description for step 2 that uses step 1");
      expect(recipe!.steps[1].usingSteps).toHaveLength(1);
      expect(recipe!.steps[1].usingSteps[0].outputStepNum).toBe(1);
      expect(recipe!.steps[1].usingSteps[0].inputStepNum).toBe(2);
    });
  });
});
