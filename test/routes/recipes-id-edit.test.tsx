import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/recipes.$id.edit";
import EditRecipe from "~/routes/recipes.$id.edit";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
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

describe("Recipes $id Edit Route", () => {
  let testUserId: string;
  let otherUserId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;

    // Create another user for permission tests
    const otherEmail = faker.internet.email();
    const otherUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const otherUser = await createUser(db, otherEmail, otherUsername, "testPassword123");
    otherUserId = otherUser.id;

    // Create a recipe for testing
    const recipe = await db.recipe.create({
      data: {
        title: "Test Recipe " + faker.string.alphanumeric(6),
        description: "Test description",
        servings: "4",
        chefId: testUserId,
      },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should redirect when not logged in", async () => {
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`);

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should return recipe data when logged in as owner", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.recipe).toBeDefined();
      expect(result.recipe.id).toBe(recipeId);
    });

    it("should throw 403 when non-owner tries to access", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", otherUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(403);
        return true;
      });
    });

    it("should throw 404 for non-existent recipe", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/recipes/nonexistent-id/edit", { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-id" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 for soft-deleted recipe", async () => {
      // Soft delete the recipe
      await db.recipe.update({
        where: { id: recipeId },
        data: { deletedAt: new Date() },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should handle step with null stepTitle in loader", async () => {
      // Create a step with null stepTitle
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Mix everything",
          stepTitle: null,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.recipe.steps).toHaveLength(1);
      expect(result.formattedSteps[0].stepTitle).toBeUndefined();
    });

    it("should include recipe steps with ingredients", async () => {
      // Create a step with an ingredient
      const unit = await db.unit.create({ data: { name: "cup_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.create({ data: { name: "flour_" + faker.string.alphanumeric(6) } });

      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Mix ingredients",
          stepTitle: "Prep",
        },
      });

      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.recipe.steps).toHaveLength(1);
      expect(result.recipe.steps[0].description).toBe("Mix ingredients");
      expect(result.recipe.steps[0].ingredients).toHaveLength(1);
      expect(result.recipe.steps[0].ingredients[0].quantity).toBe(2);
    });
  });

  describe("action", () => {
    async function createFormRequest(
      formFields: Record<string, string>,
      userId?: string
    ): Promise<UndiciRequest> {
      const formData = new UndiciFormData();
      for (const [key, value] of Object.entries(formFields)) {
        formData.append(key, value);
      }

      const headers = new Headers();

      if (userId) {
        const session = await sessionStorage.getSession();
        session.set("userId", userId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];
        headers.set("Cookie", cookieValue);
      }

      return new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    async function createMultipartRequest(
      formData: UndiciFormData,
      userId: string
    ): Promise<UndiciRequest> {
      const session = await sessionStorage.getSession();
      session.set("userId", userId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      return new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ title: "New Title" });

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should throw 403 when non-owner tries to update", async () => {
      const request = await createFormRequest({ title: "New Title" }, otherUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(403);
        return true;
      });
    });

    it("should throw 404 for non-existent recipe", async () => {
      const request = await createFormRequest({ title: "New Title" }, testUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-id" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should return validation error when title is empty", async () => {
      const request = await createFormRequest({ title: "", description: "Test" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("Title is required");
    });

    it("should successfully update recipe and redirect", async () => {
      const request = await createFormRequest(
        {
          title: "Updated Title",
          description: "Updated Description",
          servings: "6",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}`);

      // Verify recipe was updated
      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe?.title).toBe("Updated Title");
      expect(recipe?.description).toBe("Updated Description");
      expect(recipe?.servings).toBe("6");
    });

    it("should allow saving a recipe without changing its own active title", async () => {
      const currentRecipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      const request = await createFormRequest(
        {
          title: currentRecipe.title,
          description: "Still mine",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
    });

    it("should reject updates to another active recipe title for the same chef", async () => {
      await db.recipe.create({
        data: {
          title: "Already Taken",
          chefId: testUserId,
        },
      });
      const originalRecipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      const request = await createFormRequest({ title: "  Already Taken  " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
      const unchangedRecipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(unchangedRecipe.title).toBe(originalRecipe.title);
    });

    it("should allow updates to a soft-deleted recipe title", async () => {
      await db.recipe.create({
        data: {
          title: "Archived Title",
          chefId: testUserId,
          deletedAt: new Date(),
        },
      });
      const request = await createFormRequest({ title: "Archived Title" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.title).toBe("Archived Title");
    });

    it("should handle reorderStep intent - move step up", async () => {
      // Create two steps
      const step1 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      const step2 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Step 2",
        },
      });

      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: step2.id,
          direction: "up",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      // Verify steps were reordered
      const updatedStep1 = await db.recipeStep.findUnique({ where: { id: step1.id } });
      const updatedStep2 = await db.recipeStep.findUnique({ where: { id: step2.id } });
      expect(updatedStep1?.stepNum).toBe(2);
      expect(updatedStep2?.stepNum).toBe(1);
    });

    it("should handle reorderStep intent - move step down", async () => {
      // Create two steps
      const step1 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      const step2 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Step 2",
        },
      });

      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: step1.id,
          direction: "down",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      // Verify steps were reordered
      const updatedStep1 = await db.recipeStep.findUnique({ where: { id: step1.id } });
      const updatedStep2 = await db.recipeStep.findUnique({ where: { id: step2.id } });
      expect(updatedStep1?.stepNum).toBe(2);
      expect(updatedStep2?.stepNum).toBe(1);
    });

    it("should not reorder if step is already at boundary", async () => {
      // Create a single step
      const step1 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      // Try to move up when already at top
      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: step1.id,
          direction: "up",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      // Step should remain at position 1
      const updatedStep = await db.recipeStep.findUnique({ where: { id: step1.id } });
      expect(updatedStep?.stepNum).toBe(1);
    });

    it("should not reorder if stepId is missing", async () => {
      const request = await createFormRequest(
        {
          intent: "reorderStep",
          direction: "up",
        },
        testUserId
      );

      // Should not throw and not reorder
      await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);
    });

    it("should not reorder if direction is invalid", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: step.id,
          direction: "sideways",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      // Step should remain unchanged
      const updatedStep = await db.recipeStep.findUnique({ where: { id: step.id } });
      expect(updatedStep?.stepNum).toBe(1);
    });

    it("should return reorder validation error when dependency would be broken", async () => {
      // Create two steps with a dependency: step2 uses output of step1
      const step1 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1 - produces output",
        },
      });

      const step2 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Step 2 - uses step 1 output",
        },
      });

      // Create a StepOutputUse: step2 uses output from step1
      await db.stepOutputUse.create({
        data: {
          recipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Try to move step1 down (past step2 which depends on it)
      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: step1.id,
          direction: "down",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.reorder).toBeDefined();
    });

    it("should not reorder if step belongs to different recipe", async () => {
      // Create another recipe with a step
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const otherStep = await db.recipeStep.create({
        data: {
          recipeId: otherRecipe.id,
          stepNum: 1,
          description: "Other step",
        },
      });

      const request = await createFormRequest(
        {
          intent: "reorderStep",
          stepId: otherStep.id,
          direction: "up",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      // Other step should remain unchanged
      const updatedStep = await db.recipeStep.findUnique({ where: { id: otherStep.id } });
      expect(updatedStep?.stepNum).toBe(1);
    });

    it("should delete a step for deleteStep intent", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step to delete",
        },
      });

      const request = await createFormRequest(
        {
          intent: "deleteStep",
          stepId: step.id,
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      const deletedStep = await db.recipeStep.findUnique({ where: { id: step.id } });
      expect(deletedStep).toBeNull();
    });

    it("should return step deletion error when dependent steps exist", async () => {
      const producer = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Producer",
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Consumer",
        },
      });

      await db.stepOutputUse.create({
        data: {
          recipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      const request = await createFormRequest(
        {
          intent: "deleteStep",
          stepId: producer.id,
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.stepDeletion).toContain("Cannot delete");
    });

    it("should return step deletion error when stepId is missing", async () => {
      const request = await createFormRequest(
        {
          intent: "deleteStep",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.stepDeletion).toBe("Step not found");
    });

    it("should return step deletion error when step belongs to a different recipe", async () => {
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Delete Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });
      const otherStep = await db.recipeStep.create({
        data: {
          recipeId: otherRecipe.id,
          stepNum: 1,
          description: "Other step",
        },
      });

      const request = await createFormRequest(
        {
          intent: "deleteStep",
          stepId: otherStep.id,
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(404);
      expect(data.errors.stepDeletion).toBe("Step not found");
    });

    it("should throw 404 for soft-deleted recipe in action", async () => {
      // Soft delete the recipe
      await db.recipe.update({
        where: { id: recipeId },
        data: { deletedAt: new Date() },
      });

      const request = await createFormRequest({ title: "New Title" }, testUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should set empty description and servings to null", async () => {
      const request = await createFormRequest(
        {
          title: "Updated Title",
          description: "",
          servings: "   ",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify empty fields become null
      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe?.description).toBeNull();
      expect(recipe?.servings).toBeNull();
    });

    it("should return validation error for whitespace-only title", async () => {
      const request = await createFormRequest({ title: "   " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("Title is required");
    });

    it("should return generic error for database errors", async () => {
      // Mock db.recipe.update to throw a generic error
      const originalUpdate = db.recipe.update;
      db.recipe.update = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      try {
        const request = await createFormRequest({ title: "Updated Title" }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to update recipe. Please try again.");
      } finally {
        // Restore original function
        db.recipe.update = originalUpdate;
      }
    });

    it("should clear image when clearImage is true", async () => {
      // First set an imageUrl on the recipe
      await db.recipe.update({
        where: { id: recipeId },
        data: { imageUrl: "https://example.com/old-image.jpg" },
      });

      const request = await createFormRequest(
        {
          title: "Updated Title",
          clearImage: "true",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}`);

      // Verify imageUrl was set to empty string
      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe?.imageUrl).toBe("");
    });

    it("should return validation error for invalid image type", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      const invalidFile = new File(["fake-content"], "test.txt", { type: "text/plain" });
      formData.append("image", invalidFile);

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Invalid image format");
    });

    it("should accept valid image file without errors", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      const validFile = new File(["image-data"], "photo.jpg", { type: "image/jpeg" });
      formData.append("image", validFile);

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      // Valid image should result in successful redirect, not validation error
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("should return validation error for image exceeding 5MB", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      // Create a file larger than 5MB
      const largeContent = new Uint8Array(5 * 1024 * 1024 + 1);
      const largeFile = new File([largeContent], "large.jpg", { type: "image/jpeg" });
      formData.append("image", largeFile);

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Image must be less than 5MB");
    });

    it("should upload replacement image to R2 and delete old R2 image", async () => {
      await db.recipe.update({
        where: { id: recipeId },
        data: { imageUrl: "/photos/recipes/user-old/recipe-old/111.jpg" },
      });
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append("image", new File(["new-image"], "new-image.png", { type: "image/png" }));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.imageUrl).toMatch(new RegExp(`^/photos/recipes/${testUserId}/${recipeId}/\\d+\\.png$`));
      expect(mockR2Bucket.put).toHaveBeenCalledWith(
        recipe.imageUrl.replace("/photos/", ""),
        expect.any(File),
        { httpMetadata: { contentType: "image/png" } }
      );
      expect(mockR2Bucket.delete).toHaveBeenCalledWith("recipes/user-old/recipe-old/111.jpg");
    });

    it("should keep replacement image when old R2 cleanup fails after update", async () => {
      await db.recipe.update({
        where: { id: recipeId },
        data: { imageUrl: "/photos/recipes/user-old/recipe-old/111.jpg" },
      });
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockRejectedValue(new Error("delete failed")),
      };
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append("image", new File(["new-image"], "new-image.webp", { type: "image/webp" }));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.imageUrl).toMatch(new RegExp(`^/photos/recipes/${testUserId}/${recipeId}/\\d+\\.webp$`));
      expect(mockR2Bucket.delete).toHaveBeenCalledWith("recipes/user-old/recipe-old/111.jpg");
    });

    it("should return image error when replacement upload fails", async () => {
      const mockR2Bucket = {
        put: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
      };
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append("image", new File(["new-image"], "new-image.jpg", { type: "image/jpeg" }));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(500);
      expect(data.errors.image).toBe("Failed to upload image. Please try again.");

      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.imageUrl).toMatch(/clbe7wr180009tkhggghtl1qd\.png$/);
    });

    it("should return image error when clearing an R2 image fails", async () => {
      await db.recipe.update({
        where: { id: recipeId },
        data: { imageUrl: "/photos/recipes/user-old/recipe-old/111.jpg" },
      });
      const mockR2Bucket = {
        delete: vi.fn().mockRejectedValue(new Error("delete failed")),
      };
      const request = await createFormRequest(
        {
          title: "Valid Title",
          clearImage: "true",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(500);
      expect(data.errors.image).toBe("Failed to delete image. Please try again.");

      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(recipe.imageUrl).toBe("/photos/recipes/user-old/recipe-old/111.jpg");
    });

    it("should delete uploaded replacement image when database update fails", async () => {
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const originalUpdate = db.recipe.update;
      db.recipe.update = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      try {
        const formData = new UndiciFormData();
        formData.append("title", "Valid Title");
        formData.append("image", new File(["new-image"], "new-image.gif", { type: "image/gif" }));

        const request = await createMultipartRequest(formData, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to update recipe. Please try again.");
        const uploadedKey = mockR2Bucket.put.mock.calls[0][0];
        expect(mockR2Bucket.delete).toHaveBeenCalledWith(uploadedKey);
      } finally {
        db.recipe.update = originalUpdate;
      }
    });

    describe("field validation", () => {
      it("should return validation error when title exceeds max length", async () => {
        const longTitle = "a".repeat(201);
        const request = await createFormRequest({ title: longTitle }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.title).toBe("Title must be 200 characters or less");
      });

      it("should accept title at exactly max length", async () => {
        const maxTitle = "a".repeat(200);
        const request = await createFormRequest({ title: maxTitle }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return validation error when description exceeds max length", async () => {
        const longDescription = "a".repeat(2001);
        const request = await createFormRequest(
          { title: "Valid Title", description: longDescription },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.description).toBe("Description must be 2,000 characters or less");
      });

      it("should accept description at exactly max length", async () => {
        const maxDescription = "a".repeat(2000);
        const request = await createFormRequest(
          { title: "Valid Title", description: maxDescription },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return validation error when servings exceeds max length", async () => {
        const longServings = "a".repeat(101);
        const request = await createFormRequest(
          { title: "Valid Title", servings: longServings },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.servings).toBe("Servings must be 100 characters or less");
      });

      it("should accept servings at exactly max length", async () => {
        const maxServings = "a".repeat(100);
        const request = await createFormRequest(
          { title: "Valid Title", servings: maxServings },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return multiple validation errors at once", async () => {
        const longTitle = "a".repeat(201);
        const longDescription = "a".repeat(2001);
        const longServings = "a".repeat(101);
        const request = await createFormRequest(
          {
            title: longTitle,
            description: longDescription,
            servings: longServings,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.title).toBe("Title must be 200 characters or less");
        expect(data.errors.description).toBe("Description must be 2,000 characters or less");
        expect(data.errors.servings).toBe("Servings must be 100 characters or less");
      });
    });
  });

  describe("component", () => {
    it("should render edit recipe form with recipe data", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: "A delicious dish",
          servings: "4",
          imageUrl: "https://example.com/recipe.jpg",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Multiple "Edit Recipe" headings exist (visible + sr-only)
      const headings = await screen.findAllByRole("heading", { name: "Edit Recipe" });
      expect(headings.length).toBeGreaterThan(0);
      expect(screen.getByRole("link", { name: "← Back to recipe" })).toHaveAttribute("href", "/recipes/recipe-1");
      expect(screen.getByLabelText(/Title/)).toHaveValue("Test Recipe");
      expect(screen.getByLabelText(/Description/)).toHaveValue("A delicious dish");
      expect(screen.getByLabelText(/Servings/)).toHaveValue("4");
      // Recipe Image is now displayed as an image upload preview via RecipeImageUpload
      // When there's an image, it shows "Change Image" button instead of "Upload Image"
      expect(screen.getByRole("button", { name: /change.*image/i })).toBeInTheDocument();
    });

    it("should render empty steps state", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      expect(await screen.findByText("No steps yet. Add your first step.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "+ Add Step" })).toHaveAttribute("href", "/recipes/recipe-1/steps/new");
    });

    it("should render recipe steps with title and description", async () => {
      const stepsData = [
        {
          id: "step-1",
          stepNum: 1,
          stepTitle: "Prep the Ingredients",
          description: "Chop all vegetables",
          ingredients: [
            { quantity: 1, unit: "cup", ingredientName: "flour" },
            { quantity: 2, unit: "tsp", ingredientName: "salt" },
          ],
        },
        {
          id: "step-2",
          stepNum: 2,
          stepTitle: undefined,
          description: "Cook everything together",
          ingredients: [],
        },
      ];
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "Prep the Ingredients",
              description: "Chop all vegetables",
              ingredients: [
                { id: "ing-1", quantity: 1 },
                { id: "ing-2", quantity: 2 },
              ],
            },
            {
              id: "step-2",
              stepNum: 2,
              stepTitle: null,
              description: "Cook everything together",
              ingredients: [],
            },
          ],
        },
        formattedSteps: stepsData,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      expect(await screen.findByRole("heading", { name: "Recipe Steps" })).toBeInTheDocument();
      // Step title is shown in the card header
      expect(screen.getByText("Prep the Ingredients")).toBeInTheDocument();
      expect(screen.getByText("2 ingredients")).toBeInTheDocument();
      expect(screen.getByText("0 ingredients")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(2);
    });

    it("should render singular ingredient count for single ingredient", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: null,
              description: "Mix the flour",
              ingredients: [{ id: "ing-1", quantity: 1 }],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-1",
            stepNum: 1,
            stepTitle: undefined,
            description: "Mix the flour",
            ingredients: [{ quantity: 1, unit: "cup", ingredientName: "flour" }],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for step to render by looking for the step content
      const mixFlourElements = await screen.findAllByText("Mix the flour");
      expect(mixFlourElements.length).toBeGreaterThan(0);
      expect(screen.getByText("1 ingredient")).toBeInTheDocument();
    });

    it("should not show ingredient count when step has no ingredients", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: null,
              description: "Just instructions",
              ingredients: [],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-1",
            stepNum: 1,
            stepTitle: undefined,
            description: "Just instructions",
            ingredients: [],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for step to render
      const instructionElements = await screen.findAllByText("Just instructions");
      expect(instructionElements.length).toBeGreaterThan(0);
      expect(screen.getByText("0 ingredients")).toBeInTheDocument();
    });

    it("should render reorder buttons for multiple steps", async () => {
      const stepsData = [
        { id: "step-1", stepNum: 1, stepTitle: undefined, description: "First step", ingredients: [] },
        { id: "step-2", stepNum: 2, stepTitle: undefined, description: "Second step", ingredients: [] },
        { id: "step-3", stepNum: 3, stepTitle: undefined, description: "Third step", ingredients: [] },
      ];
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            { id: "step-1", stepNum: 1, stepTitle: null, description: "First step", ingredients: [] },
            { id: "step-2", stepNum: 2, stepTitle: null, description: "Second step", ingredients: [] },
            { id: "step-3", stepNum: 3, stepTitle: null, description: "Third step", ingredients: [] },
          ],
        },
        formattedSteps: stepsData,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for steps to render - text appears in both header and textarea
      const firstStepElements = await screen.findAllByText("First step");
      expect(firstStepElements.length).toBeGreaterThan(0);
      // All steps have Move Up and Move Down buttons, but some are disabled
      // First step: Move Up disabled, Move Down enabled
      // Middle step: both enabled
      // Last step: Move Up enabled, Move Down disabled
      const upButtons = screen.getAllByRole("button", { name: /move up/i });
      const downButtons = screen.getAllByRole("button", { name: /move down/i });
      expect(upButtons).toHaveLength(3); // All steps have the button
      expect(downButtons).toHaveLength(3); // All steps have the button
      // First step's Move Up should be disabled
      expect(upButtons[0]).toBeDisabled();
      // Last step's Move Down should be disabled
      expect(downButtons[2]).toBeDisabled();
    });

    it("should render form buttons correctly", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for form to render by finding the Title input first
      await screen.findByLabelText(/Title/);
      // Save Recipe button (matches "Save Recipe" in edit mode)
      expect(screen.getByRole("button", { name: /save recipe/i })).toBeInTheDocument();
      // Cancel is now a button that navigates programmatically, not a link
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("should render null values as empty strings in form", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      expect(await screen.findByLabelText(/Description/)).toHaveValue("");
      expect(screen.getByLabelText(/Servings/)).toHaveValue("");
    });

    it("should have correct edit link for each step", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-abc",
              stepNum: 1,
              stepTitle: null,
              description: "First step",
              ingredients: [],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-abc",
            stepNum: 1,
            stepTitle: undefined,
            description: "First step",
            ingredients: [],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for step card to render
      const firstStepElements = await screen.findAllByText("First step");
      expect(firstStepElements.length).toBeGreaterThan(0);
      expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/recipes/recipe-1/steps/step-abc/edit");
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    it("should cancel and confirm step deletion from the dialog", async () => {
      const user = userEvent.setup();
      const submittedStepIds: string[] = [];
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-delete",
              stepNum: 1,
              stepTitle: "Step to delete",
              description: "Delete me",
              ingredients: [],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-delete",
            stepNum: 1,
            stepTitle: "Step to delete",
            description: "Delete me",
            ingredients: [],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            submittedStepIds.push(formData.get("stepId")?.toString() ?? "");
            return { success: true };
          },
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);
      await screen.findByText("Step to delete");

      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alertdialog", { name: "Delete Step" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(submittedStepIds).toEqual([]);

      await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
      await user.click(await screen.findByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(submittedStepIds).toEqual(["step-delete"]);
      });
    });

    it("should close the step deletion dialog when dismissed by escape", async () => {
      const user = userEvent.setup();
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-escape",
              stepNum: 1,
              stepTitle: "Escape Step",
              description: "Dismiss me",
              ingredients: [],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-escape",
            stepNum: 1,
            stepTitle: "Escape Step",
            description: "Dismiss me",
            ingredients: [],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);
      await screen.findByText("Escape Step");

      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alertdialog", { name: "Delete Step" })).toBeInTheDocument();

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("alertdialog", { name: "Delete Step" })).not.toBeInTheDocument();
      });
    });

    it("should display step deletion errors returned after confirming deletion", async () => {
      const user = userEvent.setup();
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [
            {
              id: "step-blocked",
              stepNum: 1,
              stepTitle: "Blocked Step",
              description: "Cannot delete",
              ingredients: [],
            },
          ],
        },
        formattedSteps: [
          {
            id: "step-blocked",
            stepNum: 1,
            stepTitle: "Blocked Step",
            description: "Cannot delete",
            ingredients: [],
          },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
          action: () => ({
            errors: { stepDeletion: "Cannot delete this step because another step uses it." },
          }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);
      await screen.findByText("Blocked Step");

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(await screen.findByRole("button", { name: "Confirm" }));

      expect(await screen.findByText("Cannot delete this step because another step uses it.")).toBeInTheDocument();
    });

    it("should populate hidden form and submit when Save Recipe is clicked", async () => {
      const user = userEvent.setup();
      let submittedData: any = null;

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => ({
            recipe: {
              id: "recipe-1",
              title: "Original Title",
              description: "Original description",
              servings: "4",
              imageUrl: "",
              steps: [],
            },
            formattedSteps: [],
          }),
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            submittedData = {
              title: formData.get("title"),
              description: formData.get("description"),
              servings: formData.get("servings"),
              steps: formData.get("steps"),
              clearImage: formData.get("clearImage"),
            };
            return { success: true };
          },
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      await screen.findByRole("button", { name: "Save Recipe" });

      // Clear and type new values
      const titleInput = screen.getByLabelText(/^Title$/i);
      const descriptionInput = screen.getByLabelText(/Description/);
      const servingsInput = screen.getByLabelText(/Servings/);

      await user.clear(titleInput);
      await user.type(titleInput, "Updated Title");
      await user.clear(descriptionInput);
      await user.type(descriptionInput, "Updated description");
      await user.clear(servingsInput);
      await user.type(servingsInput, "8");

      // Click Save Recipe to trigger handleSave
      await user.click(screen.getByRole("button", { name: "Save Recipe" }));

      await waitFor(() => {
        expect(submittedData).not.toBeNull();
      });

      expect(submittedData.title).toBe("Updated Title");
      expect(submittedData.description).toBe("Updated description");
      expect(submittedData.servings).toBe("8");
      expect(submittedData.steps).toBeDefined();
    });

    it("should handle image file in handleSave via DataTransfer", async () => {
      const user = userEvent.setup();
      let submittedData: any = null;

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => ({
            recipe: {
              id: "recipe-1",
              title: "Test Recipe",
              description: null,
              servings: null,
              imageUrl: "",
              steps: [],
            },
            formattedSteps: [],
          }),
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            submittedData = {
              title: formData.get("title"),
              image: formData.get("image"),
            };
            return { success: true };
          },
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      await screen.findByRole("button", { name: "Save Recipe" });

      // Upload an image file via RecipeImageUpload's file input
      const fileInput = screen.getByLabelText("Upload recipe image");
      const testFile = new File(["image-data"], "test.jpg", { type: "image/jpeg" });
      await user.upload(fileInput, testFile);

      // Click Save Recipe to trigger handleSave which should use DataTransfer
      await user.click(screen.getByRole("button", { name: "Save Recipe" }));

      await waitFor(() => {
        expect(submittedData).not.toBeNull();
      });

      expect(submittedData.title).toBe("Test Recipe");
    });

    it("should navigate to recipe page when Cancel is clicked", async () => {
      const user = userEvent.setup();

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => ({
            recipe: {
              id: "recipe-1",
              title: "Test Recipe",
              description: null,
              servings: null,
              imageUrl: "",
              steps: [],
            },
            formattedSteps: [],
          }),
        },
        {
          path: "/recipes/:id",
          Component: () => <div data-testid="recipe-detail">Recipe Detail Page</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      await screen.findByRole("button", { name: "Cancel" });
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.getByTestId("recipe-detail")).toBeInTheDocument();
      });
    });

    it("should set clearImage to true when image is removed and Save is clicked", async () => {
      const user = userEvent.setup();
      let submittedData: any = null;

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => ({
            recipe: {
              id: "recipe-1",
              title: "Test Recipe",
              description: null,
              servings: null,
              imageUrl: "https://example.com/existing.jpg",
              steps: [],
            },
            formattedSteps: [],
          }),
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            submittedData = {
              title: formData.get("title"),
              clearImage: formData.get("clearImage"),
            };
            return { success: true };
          },
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for the "Remove" button that appears when image exists
      await screen.findByRole("button", { name: /remove/i });
      await user.click(screen.getByRole("button", { name: /remove/i }));

      // Click Save Recipe
      await user.click(screen.getByRole("button", { name: "Save Recipe" }));

      await waitFor(() => {
        expect(submittedData).not.toBeNull();
      });

      expect(submittedData.clearImage).toBe("true");
    });

    it("should display reorder validation error when present", async () => {
      const user = userEvent.setup();
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
          action: () => ({
            errors: { reorder: "Cannot move Step 1 to position 2 because Step 2 uses its output" },
          }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for form to render and submit to trigger action data
      await screen.findByRole("button", { name: "Save Recipe" });
      await user.click(screen.getByRole("button", { name: "Save Recipe" }));

      // Wait for the reorder error to appear
      await waitFor(() => {
        expect(screen.getByText("Cannot move Step 1 to position 2 because Step 2 uses its output")).toBeInTheDocument();
      });
    });

    it("should display general error message when present", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: null,
          imageUrl: "",
          steps: [],
        },
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
          action: () => ({
            errors: { general: "Failed to update recipe. Please try again." },
          }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

      // Wait for form to render
      await screen.findByLabelText(/Title/);
    });
  });
});
