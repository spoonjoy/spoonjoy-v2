import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { action as newRecipeAction } from "~/routes/recipes.new";
import { action as newStepAction } from "~/routes/recipes.$id.steps.new";
import { action as editStepAction, loader as editStepLoader } from "~/routes/recipes.$id.steps.$stepId.edit";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
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
 * E2E Test: Step Deletion Protection
 *
 * Tests the full flow of step deletion protection:
 * 1. Step with dependents cannot be deleted (returns error)
 * 2. Error message displays correctly in UI
 * 3. Step without dependents CAN be deleted
 * 4. Cascade deletion of dependencies when step is deleted
 */
describe("E2E: Step Deletion Protection", () => {
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

  // Helper to delete a step via edit action
  async function deleteStep(recipeId: string, stepId: string): Promise<{ data: any; status: number }> {
    const formData = new UndiciFormData();
    formData.append("intent", "delete");

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

    // For redirect responses (success), extract data directly
    if (response instanceof Response) {
      return { data: null, status: response.status };
    }

    // For data responses (errors), use extractResponseData
    return extractResponseData(response);
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

  describe("Step with dependents cannot be deleted", () => {
    it("should return error when deleting step used by one other step", async () => {
      // Create recipe with two steps, step 2 depends on step 1
      const recipeId = await createRecipe("Delete Dep Test 1 " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // Try to delete step 1
      const { data, status } = await deleteStep(recipeId, step1Id);

      // Should return 400 with error
      expect(status).toBe(400);
      expect(data.errors?.stepDeletion).toBe(
        "Cannot delete Step 1 because it is used by Step 2"
      );

      // Verify step 1 was NOT deleted
      const step = await db.recipeStep.findUnique({ where: { id: step1Id } });
      expect(step).not.toBeNull();
    });

    it("should return error when deleting step used by two other steps", async () => {
      // Create recipe with three steps, steps 2 and 3 depend on step 1
      const recipeId = await createRecipe("Delete Dep Test 2 " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step using first", "Step 2", [1]);
      await addStep(recipeId, "Third step using first", "Step 3", [1]);

      // Try to delete step 1
      const { data, status } = await deleteStep(recipeId, step1Id);

      // Should return 400 with error listing both dependents with 'and'
      expect(status).toBe(400);
      expect(data.errors?.stepDeletion).toBe(
        "Cannot delete Step 1 because it is used by Steps 2 and 3"
      );

      // Verify step 1 was NOT deleted
      const step = await db.recipeStep.findUnique({ where: { id: step1Id } });
      expect(step).not.toBeNull();
    });

    it("should return error when deleting step used by three or more other steps", async () => {
      // Create recipe with four steps, steps 2, 3, and 4 depend on step 1
      const recipeId = await createRecipe("Delete Dep Test 3 " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step using first", "Step 2", [1]);
      await addStep(recipeId, "Third step using first", "Step 3", [1]);
      await addStep(recipeId, "Fourth step using first", "Step 4", [1]);

      // Try to delete step 1
      const { data, status } = await deleteStep(recipeId, step1Id);

      // Should return 400 with error listing all dependents with Oxford comma
      expect(status).toBe(400);
      expect(data.errors?.stepDeletion).toBe(
        "Cannot delete Step 1 because it is used by Steps 2, 3, and 4"
      );

      // Verify step 1 was NOT deleted
      const step = await db.recipeStep.findUnique({ where: { id: step1Id } });
      expect(step).not.toBeNull();
    });

    it("should prevent deletion of middle step in a chain", async () => {
      // Create recipe: step 3 -> step 2 -> step 1
      const recipeId = await createRecipe("Delete Chain Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step using first", "Step 2", [1]);
      await addStep(recipeId, "Third step using second", "Step 3", [2]);

      // Try to delete step 2 (which is used by step 3)
      const { data, status } = await deleteStep(recipeId, step2Id);

      expect(status).toBe(400);
      expect(data.errors?.stepDeletion).toBe(
        "Cannot delete Step 2 because it is used by Step 3"
      );

      // Verify step 2 was NOT deleted
      const step = await db.recipeStep.findUnique({ where: { id: step2Id } });
      expect(step).not.toBeNull();
    });
  });

  describe("Error message displays correctly in UI", () => {
    it("should render error message in step deletion error alert", async () => {
      // Create recipe with dependency
      const recipeId = await createRecipe("UI Error Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // Load step edit data
      const loaderData = await loadStepEdit(recipeId, step1Id);
      const actionResult = {
        errors: {
          stepDeletion: "Cannot delete Step 1 because it is used by Step 2",
        },
      };

      // Render component with deletion error in action data
      const Stub = createTestRoutesStub([
        {
          id: "step-edit",
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => loaderData,
          action: () => actionResult,
        },
      ]);

      render(
        <Stub
          initialEntries={[`/recipes/${recipeId}/steps/${step1Id}/edit`]}
          hydrationData={{
            loaderData: { "step-edit": loaderData },
            actionData: { "step-edit": actionResult },
          }}
        />
      );

      // Wait for the page to render
      await screen.findByRole("heading", { name: /Edit Step/i });

      const errorElement = await screen.findByRole("alert");
      expect(errorElement).toHaveTextContent(
        "Cannot delete Step 1 because it is used by Step 2"
      );
    });

    it("should display error with proper styling", async () => {
      // Create recipe with dependency
      const recipeId = await createRecipe("UI Style Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // Load step edit data
      const loaderData = await loadStepEdit(recipeId, step1Id);
      const actionResult = {
        errors: {
          stepDeletion: "Cannot delete Step 1 because it is used by Steps 2 and 3",
        },
      };

      // Render component with deletion error
      const Stub = createTestRoutesStub([
        {
          id: "step-edit",
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => loaderData,
          action: () => actionResult,
        },
      ]);

      render(
        <Stub
          initialEntries={[`/recipes/${recipeId}/steps/${step1Id}/edit`]}
          hydrationData={{
            loaderData: { "step-edit": loaderData },
            actionData: { "step-edit": actionResult },
          }}
        />
      );

      // Wait for the page to render
      await screen.findByRole("heading", { name: /Edit Step/i });

      const errorElement = await screen.findByRole("alert");
      expect(errorElement).toHaveClass("bg-red-50");
    });

    it("should not show deletion error when no error exists", async () => {
      // Create recipe without dependencies
      const recipeId = await createRecipe("No Error Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");

      // Load step edit data
      const loaderData = await loadStepEdit(recipeId, step1Id);

      // Render component without action data (no errors)
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => loaderData,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}/steps/${step1Id}/edit`]} />);

      // Wait for the page to render
      await screen.findByRole("heading", { name: /Edit Step/i });
      expect(screen.queryByRole("button", { name: "Delete Step" })).not.toBeInTheDocument();

      // No deletion error should be visible
      const alerts = screen.queryAllByRole("alert");
      const deletionAlert = alerts.find((alert) =>
        alert.textContent?.includes("Cannot delete")
      );
      expect(deletionAlert).toBeUndefined();
    });
  });

  describe("Step without dependents CAN be deleted", () => {
    it("should successfully delete step with no dependents", async () => {
      // Create recipe with one step (no dependents)
      const recipeId = await createRecipe("Delete Success Test 1 " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");

      // Delete step 1
      const { status } = await deleteStep(recipeId, step1Id);

      // Should redirect on success
      expect(status).toBe(302);

      // Verify step was deleted
      const step = await db.recipeStep.findUnique({ where: { id: step1Id } });
      expect(step).toBeNull();
    });

    it("should successfully delete last step in chain", async () => {
      // Create recipe: step 2 -> step 1
      const recipeId = await createRecipe("Delete Last Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // Delete step 2 (last in chain, no dependents)
      const { status } = await deleteStep(recipeId, step2Id);

      // Should redirect on success
      expect(status).toBe(302);

      // Verify step was deleted
      const step = await db.recipeStep.findUnique({ where: { id: step2Id } });
      expect(step).toBeNull();
    });

    it("should successfully delete step that uses others but is not used by any", async () => {
      // Create recipe with three steps, step 3 uses both 1 and 2 but no one uses step 3
      const recipeId = await createRecipe("Delete Consumer Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step using 1 and 2", "Step 3", [1, 2]);

      // Delete step 3 (uses others but has no dependents)
      const { status } = await deleteStep(recipeId, step3Id);

      // Should redirect on success
      expect(status).toBe(302);

      // Verify step was deleted
      const step = await db.recipeStep.findUnique({ where: { id: step3Id } });
      expect(step).toBeNull();
    });

    it("should successfully delete independent step in multi-step recipe", async () => {
      // Create recipe with three independent steps
      const recipeId = await createRecipe("Delete Independent Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step", "Step 2");
      await addStep(recipeId, "Third step", "Step 3");

      // Delete step 2 (middle step with no dependencies)
      const { status } = await deleteStep(recipeId, step2Id);

      // Should redirect on success
      expect(status).toBe(302);

      // Verify step was deleted
      const step = await db.recipeStep.findUnique({ where: { id: step2Id } });
      expect(step).toBeNull();

      // Verify other steps still exist
      const remainingSteps = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });
      expect(remainingSteps).toHaveLength(2);
    });
  });

  describe("Cascade deletion of dependencies when step is deleted", () => {
    it("should cascade delete StepOutputUse records when step that uses them is deleted", async () => {
      // Create recipe: step 2 uses step 1
      const recipeId = await createRecipe("Cascade Input Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // Verify StepOutputUse exists
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(1);
      expect(stepOutputUses[0].inputStepNum).toBe(2);

      // Delete step 2 (the consumer)
      const { status } = await deleteStep(recipeId, step2Id);
      expect(status).toBe(302);

      // Verify StepOutputUse was cascade deleted
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
      });
      expect(stepOutputUses).toHaveLength(0);
    });

    it("should cascade delete multiple StepOutputUse records when step with multiple dependencies is deleted", async () => {
      // Create recipe: step 3 uses both step 1 and step 2
      const recipeId = await createRecipe("Cascade Multi Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2");
      const step3Id = await addStep(recipeId, "Third step using 1 and 2", "Step 3", [1, 2]);

      // Verify StepOutputUse records exist
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);

      // Delete step 3 (uses both step 1 and step 2)
      const { status } = await deleteStep(recipeId, step3Id);
      expect(status).toBe(302);

      // Verify all StepOutputUse records were cascade deleted
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
      });
      expect(stepOutputUses).toHaveLength(0);
    });

    it("should only cascade delete related dependencies, not unrelated ones", async () => {
      // Create recipe: step 2 uses step 1, step 4 uses step 3
      const recipeId = await createRecipe("Cascade Isolated Test " + faker.string.alphanumeric(6));
      await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step using first", "Step 2", [1]);
      await addStep(recipeId, "Third step", "Step 3");
      await addStep(recipeId, "Fourth step using third", "Step 4", [3]);

      // Verify StepOutputUse records exist
      let stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
        orderBy: { outputStepNum: "asc" },
      });
      expect(stepOutputUses).toHaveLength(2);

      // Delete step 2 (uses step 1)
      const { status } = await deleteStep(recipeId, step2Id);
      expect(status).toBe(302);

      // Verify only step 2's dependency was deleted, step 4's dependency remains
      stepOutputUses = await db.stepOutputUse.findMany({
        where: { recipeId },
      });
      expect(stepOutputUses).toHaveLength(1);
      expect(stepOutputUses[0].outputStepNum).toBe(3);
      expect(stepOutputUses[0].inputStepNum).toBe(4);
    });

    it("should cascade delete ingredients when step is deleted", async () => {
      // Create recipe with a step that has an ingredient
      const recipeId = await createRecipe("Cascade Ingredient Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");

      // Get the step to get its stepNum
      const step = await db.recipeStep.findUnique({ where: { id: step1Id } });
      expect(step).not.toBeNull();

      // Add an ingredient to the step
      const unit = await db.unit.create({
        data: { name: "test_cup_" + faker.string.alphanumeric(6) },
      });
      const ingredientRef = await db.ingredientRef.create({
        data: { name: "test_flour_" + faker.string.alphanumeric(6) },
      });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: step!.stepNum,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      // Verify ingredient exists
      let ingredients = await db.ingredient.findMany({
        where: { recipeId, stepNum: step!.stepNum },
      });
      expect(ingredients).toHaveLength(1);

      // Delete step 1
      const { status } = await deleteStep(recipeId, step1Id);
      expect(status).toBe(302);

      // Verify ingredient was cascade deleted
      ingredients = await db.ingredient.findMany({
        where: { recipeId },
      });
      expect(ingredients).toHaveLength(0);
    });

    it("should not affect other recipes when step is deleted", async () => {
      // Create two recipes with similar structures
      const recipe1Id = await createRecipe("Recipe 1 " + faker.string.alphanumeric(6));
      await addStep(recipe1Id, "R1 First step", "R1S1");
      const r1Step2Id = await addStep(recipe1Id, "R1 Second step", "R1S2", [1]);

      const recipe2Id = await createRecipe("Recipe 2 " + faker.string.alphanumeric(6));
      await addStep(recipe2Id, "R2 First step", "R2S1");
      await addStep(recipe2Id, "R2 Second step", "R2S2", [1]);

      // Verify both recipes have StepOutputUse records
      let recipe1Uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe1Id } });
      let recipe2Uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe2Id } });
      expect(recipe1Uses).toHaveLength(1);
      expect(recipe2Uses).toHaveLength(1);

      // Delete step 2 from recipe 1
      const { status } = await deleteStep(recipe1Id, r1Step2Id);
      expect(status).toBe(302);

      // Verify recipe 1's dependency was deleted
      recipe1Uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe1Id } });
      expect(recipe1Uses).toHaveLength(0);

      // Verify recipe 2's dependency still exists
      recipe2Uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe2Id } });
      expect(recipe2Uses).toHaveLength(1);
    });
  });

  describe("Complex deletion scenarios", () => {
    it("should allow deletion after dependent step is removed first", async () => {
      // Create recipe: step 2 uses step 1
      const recipeId = await createRecipe("Sequential Delete Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      const step2Id = await addStep(recipeId, "Second step using first", "Step 2", [1]);

      // First try to delete step 1 - should fail
      let result = await deleteStep(recipeId, step1Id);
      expect(result.status).toBe(400);

      // Delete step 2 first
      result = await deleteStep(recipeId, step2Id);
      expect(result.status).toBe(302);

      // Now delete step 1 - should succeed
      result = await deleteStep(recipeId, step1Id);
      expect(result.status).toBe(302);

      // Verify both steps are deleted
      const remainingSteps = await db.recipeStep.findMany({ where: { recipeId } });
      expect(remainingSteps).toHaveLength(0);
    });

    it("should handle deletion in a diamond dependency pattern", async () => {
      // Create diamond: step 4 uses steps 2 and 3, both of which use step 1
      const recipeId = await createRecipe("Diamond Delete Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "Base step", "Step 1");
      const step2Id = await addStep(recipeId, "Left branch", "Step 2", [1]);
      const step3Id = await addStep(recipeId, "Right branch", "Step 3", [1]);
      const step4Id = await addStep(recipeId, "Top step", "Step 4", [2, 3]);

      // Try to delete step 1 - should fail (used by 2 and 3)
      let result = await deleteStep(recipeId, step1Id);
      expect(result.status).toBe(400);
      expect(result.data.errors?.stepDeletion).toBe(
        "Cannot delete Step 1 because it is used by Steps 2 and 3"
      );

      // Try to delete step 2 - should fail (used by 4)
      result = await deleteStep(recipeId, step2Id);
      expect(result.status).toBe(400);
      expect(result.data.errors?.stepDeletion).toBe(
        "Cannot delete Step 2 because it is used by Step 4"
      );

      // Delete step 4 first (no dependents)
      result = await deleteStep(recipeId, step4Id);
      expect(result.status).toBe(302);

      // Now step 2 and 3 can be deleted
      result = await deleteStep(recipeId, step2Id);
      expect(result.status).toBe(302);

      result = await deleteStep(recipeId, step3Id);
      expect(result.status).toBe(302);

      // Finally step 1 can be deleted
      result = await deleteStep(recipeId, step1Id);
      expect(result.status).toBe(302);

      // Verify all steps are deleted
      const remainingSteps = await db.recipeStep.findMany({ where: { recipeId } });
      expect(remainingSteps).toHaveLength(0);
    });

    it("should handle step with null title in dependency error message", async () => {
      // Create recipe where step 1 has no title
      const recipeId = await createRecipe("Null Title Delete Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step without title"); // No stepTitle
      await addStep(recipeId, "Second step", "Step 2", [1]);

      // Try to delete step 1
      const { data, status } = await deleteStep(recipeId, step1Id);

      expect(status).toBe(400);
      // Error message should still work with step number
      expect(data.errors?.stepDeletion).toBe(
        "Cannot delete Step 1 because it is used by Step 2"
      );
    });

    it("should verify database integrity after failed deletion attempt", async () => {
      // Create recipe with dependencies
      const recipeId = await createRecipe("Integrity Test " + faker.string.alphanumeric(6));
      const step1Id = await addStep(recipeId, "First step", "Step 1");
      await addStep(recipeId, "Second step", "Step 2", [1]);

      // Get initial state
      const initialSteps = await db.recipeStep.findMany({ where: { recipeId } });
      const initialUses = await db.stepOutputUse.findMany({ where: { recipeId } });

      // Try to delete step 1 - should fail
      const { status } = await deleteStep(recipeId, step1Id);
      expect(status).toBe(400);

      // Verify database state unchanged
      const afterSteps = await db.recipeStep.findMany({ where: { recipeId } });
      const afterUses = await db.stepOutputUse.findMany({ where: { recipeId } });

      expect(afterSteps).toHaveLength(initialSteps.length);
      expect(afterUses).toHaveLength(initialUses.length);
      expect(afterSteps.map((s) => s.id).sort()).toEqual(initialSteps.map((s) => s.id).sort());
    });
  });
});
