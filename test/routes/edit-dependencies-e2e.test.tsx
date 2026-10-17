import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { action as newRecipeAction } from "~/routes/recipes.new";
import { action as newStepAction } from "~/routes/recipes.$id.steps.new";
import { action as editStepAction, loader as editStepLoader } from "~/routes/recipes.$id.steps.$stepId.edit";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import { loader as recipeDetailLoader } from "~/routes/recipes.$id";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

/**
 * E2E Test: Edit Step Dependencies
 *
 * Tests the full flow of editing step dependencies:
 * 1. Creating a recipe with steps
 * 2. Editing existing dependencies (add/remove)
 * 3. Verifying changes persist after save
 * 4. Clearing all dependencies
 * 5. Adding dependencies to steps that had none
 */
describe("E2E: Edit Step Dependencies", () => {
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

    const location = response.headers.get("Location");
    expect(location).toBeTruthy();
    // Location format: /recipes/{recipeId}/steps/{stepId}/edit
    const parts = location!.split("/");
    const stepId = parts[4];
    expect(stepId).toBeTruthy();

    return stepId;
  }

  // Helper to update a step via edit action
  async function updateStep(
    recipeId: string,
    stepId: string,
    updates: { stepTitle?: string; description?: string },
    usesSteps?: number[]
  ): Promise<Response> {
    const formData = new UndiciFormData();
    if (updates.stepTitle !== undefined) {
      formData.append("stepTitle", updates.stepTitle);
    }
    if (updates.description !== undefined) {
      formData.append("description", updates.description);
    }
    if (usesSteps) {
      for (const stepNum of usesSteps) {
        formData.append("usesSteps", stepNum.toString());
      }
    }

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, {
      method: "POST",
      body: formData,
      headers,
    });

    const response = await editStepAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId, stepId },
    } as any);

    return response;
  }

  // Helper to load step edit data via loader
  async function loadStepEdit(recipeId: string, stepId: string) {
    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

    const result = await editStepLoader({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId, stepId },
    } as any);

    return result;
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

    const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, {
      method: "POST",
      body: formData,
      headers,
    });

    const response = await editStepAction({
      request,
      context: { cloudflare: { env: null } },
      params: { id: recipeId, stepId },
    } as any);

    // Check if response is successful
    if (response instanceof Response && response.status === 302) {
      return { success: true };
    }

    return { success: false, errors: response };
  }

  describe("Edit existing dependencies", () => {
    it("should add a new dependency to an existing step", async () => {
      // Create recipe with 3 steps, step 3 initially depends on step 1 only
      const recipeId = await createRecipe("Add Dependency Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1]);

      // Verify initial state: step 3 depends on step 1 only
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);

      // Edit step 3 to also depend on step 2
      const response = await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1, 2] // Add step 2 as dependency
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify step 3 now depends on both step 1 and step 2
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
      expect(stepOutputUses[1].outputStepNum).toBe(2);
    });

    it("should remove a dependency from an existing step", async () => {
      // Create recipe with 3 steps, step 3 initially depends on step 1 and 2
      const recipeId = await createRecipe("Remove Dependency Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1, 2]);

      // Verify initial state: step 3 depends on steps 1 and 2
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);

      // Edit step 3 to only depend on step 1 (remove step 2)
      const response = await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1] // Only step 1 now
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify step 3 now only depends on step 1
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
    });

    it("should replace all dependencies with new ones", async () => {
      // Create recipe with 4 steps, step 4 initially depends on steps 1 and 2
      const recipeId = await createRecipe("Replace Dependencies Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      await addStep(recipeId, "Third step", "Step 3");
      const step4Id = await addStep(recipeId, "Fourth step", "Step 4", [1, 2]);

      // Verify initial state
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 4 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
      expect(stepOutputUses[1].outputStepNum).toBe(2);

      // Replace with step 2 and step 3 (remove step 1, keep step 2, add step 3)
      const response = await updateStep(
        recipeId,
        step4Id,
        { stepTitle: "Step 4", description: "Fourth step" },
        [2, 3] // New dependencies
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify new dependencies
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 4 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);
      expect(stepOutputUses[0].outputStepNum).toBe(2);
      expect(stepOutputUses[1].outputStepNum).toBe(3);
    });
  });

  describe("Verify changes persist after save", () => {
    it("should persist added dependencies when reloading via loader", async () => {
      // Create recipe with 3 steps, step 3 has no dependencies initially
      const recipeId = await createRecipe("Persist Add Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3");

      // Add dependencies to step 3
      await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1, 2]
      );

      // Load step edit page to verify dependencies persisted
      const result = await loadStepEdit(recipeId, step3Id);

      expect(result.step.usingSteps).toHaveLength(2);
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);
      expect(result.step.usingSteps[0].outputOfStep.stepTitle).toBe("Step 1");
      expect(result.step.usingSteps[1].outputStepNum).toBe(2);
      expect(result.step.usingSteps[1].outputOfStep.stepTitle).toBe("Step 2");
    });

    it("should persist removed dependencies when reloading via loader", async () => {
      // Create recipe with step 3 depending on steps 1 and 2
      const recipeId = await createRecipe("Persist Remove Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1, 2]);

      // Remove step 2 dependency
      await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1]
      );

      // Load step edit page to verify change persisted
      const result = await loadStepEdit(recipeId, step3Id);

      expect(result.step.usingSteps).toHaveLength(1);
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);
    });

    it("should persist dependencies on recipe detail page", async () => {
      // Create recipe with dependencies
      const recipeId = await createRecipe("Persist Detail Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3");

      // Add dependencies via edit
      await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1, 2]
      );

      // Load recipe detail
      const result = await loadRecipeDetail(recipeId);

      // Verify dependencies show on recipe detail
      expect(result.recipe.steps[2].usingSteps).toHaveLength(2);
      expect(result.recipe.steps[2].usingSteps[0].outputStepNum).toBe(1);
      expect(result.recipe.steps[2].usingSteps[1].outputStepNum).toBe(2);
    });
  });

  describe("Clear all dependencies", () => {
    it("should clear all dependencies when none selected", async () => {
      // Create recipe with step 3 depending on steps 1 and 2
      const recipeId = await createRecipe("Clear All Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1, 2]);

      // Add ingredient to step 3 so it has content (ingredient OR dependency)
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step3Id, 2, "cup_" + uniqueSuffix, "flour_" + uniqueSuffix);

      // Verify initial state
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(stepOutputUses).toHaveLength(2);

      // Clear all dependencies (empty array)
      const response = await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [] // Empty - clear all
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify all dependencies cleared
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(stepOutputUses).toHaveLength(0);
    });

    it("should verify cleared dependencies persist via loader", async () => {
      // Create recipe with dependencies
      const recipeId = await createRecipe("Clear Persist Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2", [1]);

      // Add ingredient to step 2 so it has content (ingredient OR dependency)
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step2Id, 1, "tsp_" + uniqueSuffix, "salt_" + uniqueSuffix);

      // Clear dependencies
      await updateStep(
        recipeId,
        step2Id,
        { stepTitle: "Step 2", description: "Second step" },
        []
      );

      // Load step edit to verify
      const result = await loadStepEdit(recipeId, step2Id);
      expect(result.step.usingSteps).toHaveLength(0);
    });

    it("should verify cleared dependencies do not show on recipe detail", async () => {
      // Create recipe with dependencies
      const recipeId = await createRecipe("Clear Detail Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2", [1]);

      // Add ingredient to step 2 so it has content (ingredient OR dependency)
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step2Id, 0.5, "cup_" + uniqueSuffix, "sugar_" + uniqueSuffix);

      // Clear dependencies
      await updateStep(
        recipeId,
        step2Id,
        { stepTitle: "Step 2", description: "Second step" },
        []
      );

      // Load recipe detail
      const result = await loadRecipeDetail(recipeId);
      expect(result.recipe.steps[1].usingSteps).toHaveLength(0);
    });
  });

  describe("Add dependencies to step that had none", () => {
    it("should add dependencies to a step that initially had none", async () => {
      // Create recipe with 3 independent steps
      const recipeId = await createRecipe("Add To Empty Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3");

      // Verify initial state: step 3 has no dependencies
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(stepOutputUses).toHaveLength(0);

      // Add dependencies to step 3
      const response = await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1, 2]
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify dependencies added
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
      expect(stepOutputUses[1].outputStepNum).toBe(2);
    });

    it("should add single dependency to step that had none", async () => {
      // Create recipe with 2 independent steps
      const recipeId = await createRecipe("Add Single Empty Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2");

      // Verify initial state
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(stepOutputUses).toHaveLength(0);

      // Add single dependency
      const response = await updateStep(
        recipeId,
        step2Id,
        { stepTitle: "Step 2", description: "Second step" },
        [1]
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify dependency added
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
    });

    it("should add dependencies to step with null title", async () => {
      // Create recipe with step 2 having no title
      const recipeId = await createRecipe("Add To Null Title Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step without title"); // No title

      // Add dependency
      const response = await updateStep(
        recipeId,
        step2Id,
        { description: "Second step without title" }, // Keep no title
        [1]
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify dependency added
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);

      // Verify step still has null title
      const step = await db.recipeStep.findUnique({
        where: { id: step2Id },
      });
      expect(step?.stepTitle).toBeNull();
    });
  });

  describe("Component rendering with edited dependencies", () => {
    it("should render edit form with existing dependencies pre-selected", async () => {
      // Create recipe with dependencies
      const recipeId = await createRecipe("Render Existing Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1, 2]);

      // Load step edit data
      const result = await loadStepEdit(recipeId, step3Id);

      // Render component
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}/steps/${step3Id}/edit`]} />);

      // Verify step title rendered
      expect(await screen.findByDisplayValue("Step 3")).toBeInTheDocument();

      // Verify available steps shown
      expect(result.availableSteps).toHaveLength(2);
      expect(result.availableSteps[0].stepNum).toBe(1);
      expect(result.availableSteps[1].stepNum).toBe(2);

      // Verify usingSteps data in loader result
      expect(result.step.usingSteps).toHaveLength(2);
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);
      expect(result.step.usingSteps[1].outputStepNum).toBe(2);
    });

    it("should render edit form with no dependencies for step 1", async () => {
      // Create recipe
      const recipeId = await createRecipe("Render Step 1 Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");

      // Load step edit data
      const result = await loadStepEdit(recipeId, step1Id);

      // Render component
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}/steps/${step1Id}/edit`]} />);

      // Verify step title rendered
      expect(await screen.findByDisplayValue("Step 1")).toBeInTheDocument();

      // Step 1 should have no available steps to depend on
      expect(result.availableSteps).toHaveLength(0);
      expect(result.step.usingSteps).toHaveLength(0);

      // Should show "No previous steps available"
      expect(screen.getByText("No previous steps available")).toBeInTheDocument();
    });

    it("should render edit form after clearing dependencies", async () => {
      // Create recipe with dependencies, then clear them
      const recipeId = await createRecipe("Render Clear Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2", [1]);

      // Add ingredient to step 2 so it has content (ingredient OR dependency)
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step2Id, 2, "tbsp_" + uniqueSuffix, "butter_" + uniqueSuffix);

      // Clear dependencies
      await updateStep(
        recipeId,
        step2Id,
        { stepTitle: "Step 2", description: "Second step" },
        []
      );

      // Load step edit data
      const result = await loadStepEdit(recipeId, step2Id);

      // Render component
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => result,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}/steps/${step2Id}/edit`]} />);

      // Verify step title rendered
      expect(await screen.findByDisplayValue("Step 2")).toBeInTheDocument();

      // Should have available steps but no selected dependencies
      expect(result.availableSteps).toHaveLength(1);
      expect(result.step.usingSteps).toHaveLength(0);
    });

    it("should render edit form with non-consecutive dependency", async () => {
      // Create recipe where step 4 depends only on step 1 (skipping 2 and 3)
      const recipeId = await createRecipe("Render Non-Consecutive Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      await addStep(recipeId, "Third step", "Step 3");
      const step4Id = await addStep(recipeId, "Fourth step", "Step 4", [1]);

      // Load step edit data
      const result = await loadStepEdit(recipeId, step4Id);

      // Verify step 4 only depends on step 1
      expect(result.step.usingSteps).toHaveLength(1);
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);

      // Verify all previous steps are available
      expect(result.availableSteps).toHaveLength(3);
      expect(result.availableSteps[0].stepNum).toBe(1);
      expect(result.availableSteps[1].stepNum).toBe(2);
      expect(result.availableSteps[2].stepNum).toBe(3);
    });
  });

  describe("Database integrity for edited dependencies", () => {
    it("should not affect other steps dependencies when editing one step", async () => {
      // Create recipe with multiple steps with dependencies
      const recipeId = await createRecipe("Integrity Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2", [1]);
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [1, 2]);
      await addStep(recipeId, "Fourth step", "Step 4", [3]);

      // Edit step 3 to only depend on step 2
      await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [2]
      );

      // Verify step 2 still depends on step 1
      const step2Uses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(step2Uses).toHaveLength(1);
      expect(step2Uses[0].outputStepNum).toBe(1);

      // Verify step 3 now only depends on step 2
      const step3Uses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(step3Uses).toHaveLength(1);
      expect(step3Uses[0].outputStepNum).toBe(2);

      // Verify step 4 still depends on step 3
      const step4Uses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 4 },
      });
      expect(step4Uses).toHaveLength(1);
      expect(step4Uses[0].outputStepNum).toBe(3);
    });

    it("should not affect other recipe dependencies when editing", async () => {
      // Create two recipes with dependencies
      const recipe1Id = await createRecipe("Recipe 1 " + faker.string.alphanumeric(6));
      await addStep(recipe1Id, "R1 First step", "R1S1");
      const r1Step2Id = await addStep(recipe1Id, "R1 Second step", "R1S2", [1]);

      const recipe2Id = await createRecipe("Recipe 2 " + faker.string.alphanumeric(6));
      await addStep(recipe2Id, "R2 First step", "R2S1");
      const r2Step2Id = await addStep(recipe2Id, "R2 Second step", "R2S2", [1]);

      // Add ingredients to both steps that will have dependencies cleared
      const uniqueSuffix1 = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipe1Id, r1Step2Id, 1, "tsp_" + uniqueSuffix1, "pepper_" + uniqueSuffix1);

      const uniqueSuffix2 = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipe2Id, r2Step2Id, 1, "tsp_" + uniqueSuffix2, "salt_" + uniqueSuffix2);

      // Edit recipe 2 step 2 to clear dependencies
      await updateStep(
        recipe2Id,
        r2Step2Id,
        { stepTitle: "R2S2", description: "R2 Second step" },
        []
      );

      // Verify recipe 1 dependencies unchanged
      const recipe1Uses = await db.stepOutputUse.findMany({
        where: { recipeId: recipe1Id },
      });
      expect(recipe1Uses).toHaveLength(1);
      expect(recipe1Uses[0].inputStepNum).toBe(2);
      expect(recipe1Uses[0].outputStepNum).toBe(1);

      // Verify recipe 2 dependencies cleared
      const recipe2Uses = await db.stepOutputUse.findMany({
        where: { recipeId: recipe2Id },
      });
      expect(recipe2Uses).toHaveLength(0);
    });

    it("should handle rapid consecutive edits correctly", async () => {
      // Create recipe
      const recipeId = await createRecipe("Rapid Edit Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step", "Step 3");

      // Multiple rapid edits
      await updateStep(recipeId, step3Id, { description: "Third step" }, [1]);
      await updateStep(recipeId, step3Id, { description: "Third step" }, [1, 2]);
      await updateStep(recipeId, step3Id, { description: "Third step" }, [2]);
      await updateStep(recipeId, step3Id, { description: "Third step" }, []);
      await updateStep(recipeId, step3Id, { description: "Third step" }, [1]);

      // Verify final state
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle editing step with dependency on step with null title", async () => {
      // Create recipe with first step having no title
      const recipeId = await createRecipe("Null Title Dep Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step without title"); // No stepTitle
      const step2Id = await addStep(recipeId, "Second step", "Step 2", [1]);

      // Load step edit data
      const result = await loadStepEdit(recipeId, step2Id);

      // Verify dependency includes null title step
      expect(result.step.usingSteps).toHaveLength(1);
      expect(result.step.usingSteps[0].outputOfStep.stepTitle).toBeNull();
      expect(result.step.usingSteps[0].outputOfStep.stepNum).toBe(1);
    });

    it("should preserve other step data when editing dependencies only", async () => {
      // Create recipe with step that has title and description
      const recipeId = await createRecipe("Preserve Data Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Detailed second step description", "Detailed Step 2");

      // Add dependency without changing title or description
      await updateStep(
        recipeId,
        step2Id,
        { stepTitle: "Detailed Step 2", description: "Detailed second step description" },
        [1]
      );

      // Verify step data preserved
      const step = await db.recipeStep.findUnique({
        where: { id: step2Id },
      });
      expect(step?.stepTitle).toBe("Detailed Step 2");
      expect(step?.description).toBe("Detailed second step description");

      // Verify dependency added
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(stepOutputUses).toHaveLength(1);
    });

    it("should handle chained dependency edits correctly", async () => {
      // Create chain: step 3 -> step 2 -> step 1
      const recipeId = await createRecipe("Chain Edit Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2", [1]);
      const step3Id = await addStep(recipeId, "Third step", "Step 3", [2]);

      // Modify chain: step 3 now depends on both step 1 and step 2
      await updateStep(
        recipeId,
        step3Id,
        { stepTitle: "Step 3", description: "Third step" },
        [1, 2]
      );

      // Verify new chain state
      const step2Uses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(step2Uses).toHaveLength(1);
      expect(step2Uses[0].outputStepNum).toBe(1);

      const step3Uses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(step3Uses).toHaveLength(2);
      expect(step3Uses[0].outputStepNum).toBe(1);
      expect(step3Uses[1].outputStepNum).toBe(2);
    });

    it("should keep step 2 dependency unchanged when step 2 edits step 1", async () => {
      // Ensure editing step 1 doesn't affect step 2's dependencies
      const recipeId = await createRecipe("Step 1 Edit Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2", [1]);

      // Add ingredient to step 1 so it has content (ingredient OR dependency)
      const uniqueSuffix = faker.string.alphanumeric(6).toLowerCase();
      await addIngredientManual(recipeId, step1Id, 1, "tsp_" + uniqueSuffix, "garlic_" + uniqueSuffix);

      // Edit step 1 (which cannot have dependencies)
      await updateStep(
        recipeId,
        step1Id,
        { stepTitle: "Updated Step 1", description: "Updated first step" },
        []
      );

      // Verify step 2 still depends on step 1
      const stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);

      // Verify step 1 was updated
      const step1 = await db.recipeStep.findUnique({
        where: { id: step1Id },
      });
      expect(step1?.stepTitle).toBe("Updated Step 1");
    });
  });
});
