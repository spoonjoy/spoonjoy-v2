import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action, meta } from "~/routes/recipes.$id.steps.$stepId.edit";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";
import { ParsedIngredientList } from "~/components/recipe/ParsedIngredientList";

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

describe("Recipes $id Steps $stepId Edit Route", () => {
  let testUserId: string;
  let otherUserId: string;
  let recipeId: string;
  let stepId: string;

  it("falls back to a generic title when there is no loader data", () => {
    expect(meta({ data: undefined } as any)).toEqual([
      { title: "Edit step - Spoonjoy" },
      { name: "description", content: "Edit a step in a Spoonjoy recipe." },
    ]);
  });

  it("uses the recipe's title in the document title when loader data is present", () => {
    expect(meta({ data: { recipe: { title: "Tomato Soup" } } } as any)).toEqual([
      { title: "Edit step · Tomato Soup - Spoonjoy" },
      { name: "description", content: 'Edit a step in "Tomato Soup" on Spoonjoy.' },
    ]);
  });

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
        chefId: testUserId,
      },
    });
    recipeId = recipe.id;

    // Create a step for testing
    const step = await db.recipeStep.create({
      data: {
        recipeId,
        stepNum: 1,
        description: "Test step description",
        stepTitle: "Test Step Title",
      },
    });
    stepId = step.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should redirect when not logged in", async () => {
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`);

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should return recipe and step data when logged in as owner", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      expect(result.recipe).toBeDefined();
      expect(result.recipe.id).toBe(recipeId);
      expect(result.step).toBeDefined();
      expect(result.step.id).toBe(stepId);
      expect(result.step.description).toBe("Test step description");
    });

    it("should throw 403 when non-owner tries to access", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", otherUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
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

      const request = new UndiciRequest(`http://localhost:3000/recipes/nonexistent-id/steps/${stepId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-id", stepId },
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

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 for non-existent step", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/nonexistent-step/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: "nonexistent-step" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 when step belongs to different recipe", async () => {
      // Create another recipe
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      // Try to access the step using the other recipe's ID
      const request = new UndiciRequest(`http://localhost:3000/recipes/${otherRecipe.id}/steps/${stepId}/edit`, { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: otherRecipe.id, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should include step ingredients with unit and ingredientRef", async () => {
      // Create unit and ingredientRef
      const unit = await db.unit.create({ data: { name: "cup_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.create({ data: { name: "flour_" + faker.string.alphanumeric(6) } });

      // Add ingredient to the step
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 2.5,
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

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      expect(result.step.ingredients).toHaveLength(1);
      expect(result.step.ingredients[0].quantity).toBe(2.5);
      expect(result.step.ingredients[0].unit.name).toBe(unit.name);
      expect(result.step.ingredients[0].ingredientRef.name).toBe(ingredientRef.name);
    });

    it("should return availableSteps for steps that can be referenced", async () => {
      // Create additional steps (step 1 already exists from beforeEach)
      const step2 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          stepTitle: "Step 2 Title",
          description: "Step 2 description",
        },
      });
      const step3 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 3,
          stepTitle: "Step 3 Title",
          description: "Step 3 description",
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      // Request step 3 - should have step 1 and 2 as available
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${step3.id}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId: step3.id },
      } as any);

      expect(result.availableSteps).toBeDefined();
      expect(result.availableSteps).toHaveLength(2);
      expect(result.availableSteps[0].stepNum).toBe(1);
      expect(result.availableSteps[0].stepTitle).toBe("Test Step Title");
      expect(result.availableSteps[1].stepNum).toBe(2);
      expect(result.availableSteps[1].stepTitle).toBe("Step 2 Title");
    });

    it("should return empty availableSteps for step 1", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      // Step 1 has no previous steps
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      expect(result.availableSteps).toBeDefined();
      expect(result.availableSteps).toHaveLength(0);
    });

    it("should return current step's outputUses (dependencies on previous steps)", async () => {
      // Create step 2 that will use step 1's output
      const step2 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          stepTitle: "Second Step",
          description: "Uses output from step 1",
        },
      });

      // Create the step output use relationship
      await db.stepOutputUse.create({
        data: {
          recipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${step2.id}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId: step2.id },
      } as any);

      expect(result.step.usingSteps).toBeDefined();
      expect(result.step.usingSteps).toHaveLength(1);
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);
      expect(result.step.usingSteps[0].outputOfStep.stepNum).toBe(1);
      expect(result.step.usingSteps[0].outputOfStep.stepTitle).toBe("Test Step Title");
    });

    it("should return empty outputUses when step has no dependencies", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      expect(result.step.usingSteps).toBeDefined();
      expect(result.step.usingSteps).toHaveLength(0);
    });

    it("should return multiple outputUses when step uses multiple previous steps", async () => {
      // Create step 2 and 3
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          stepTitle: "Step 2",
          description: "Step 2 description",
        },
      });
      const step3 = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 3,
          stepTitle: "Step 3",
          description: "Uses output from step 1 and 2",
        },
      });

      // Step 3 uses outputs from both step 1 and step 2
      await db.stepOutputUse.create({
        data: {
          recipeId,
          outputStepNum: 1,
          inputStepNum: 3,
        },
      });
      await db.stepOutputUse.create({
        data: {
          recipeId,
          outputStepNum: 2,
          inputStepNum: 3,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${step3.id}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId: step3.id },
      } as any);

      expect(result.step.usingSteps).toHaveLength(2);
      // Should be ordered by outputStepNum
      expect(result.step.usingSteps[0].outputStepNum).toBe(1);
      expect(result.step.usingSteps[1].outputStepNum).toBe(2);
    });

    it("should return availableSteps with only stepNum and stepTitle selected", async () => {
      // Create step 2
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Step 2 with no title",
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      // Request step 2 - should have step 1 as available
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${(await db.recipeStep.findFirst({ where: { recipeId, stepNum: 2 } }))!.id}/edit`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId: (await db.recipeStep.findFirst({ where: { recipeId, stepNum: 2 } }))!.id },
      } as any);

      expect(result.availableSteps).toHaveLength(1);
      expect(result.availableSteps[0].stepNum).toBe(1);
      expect(result.availableSteps[0].stepTitle).toBe("Test Step Title");
      // Should not include other fields like description or id
      expect(Object.keys(result.availableSteps[0])).toEqual(["stepNum", "stepTitle"]);
    });
  });

  describe("action", () => {
    async function createFormRequest(
      formFields: Record<string, string>,
      userId?: string,
      recId?: string,
      stId?: string,
      usesSteps?: number[]
    ): Promise<UndiciRequest> {
      const formData = new UndiciFormData();
      for (const [key, value] of Object.entries(formFields)) {
        formData.append(key, value);
      }

      // Add usesSteps array values if provided
      if (usesSteps) {
        for (const stepNum of usesSteps) {
          formData.append("usesSteps", stepNum.toString());
        }
      }

      const headers = new Headers();

      if (userId) {
        const session = await sessionStorage.getSession();
        session.set("userId", userId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];
        headers.set("Cookie", cookieValue);
      }

      const targetRecipeId = recId || recipeId;
      const targetStepId = stId || stepId;

      return new UndiciRequest(`http://localhost:3000/recipes/${targetRecipeId}/steps/${targetStepId}/edit`, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ description: "Updated step" });

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should throw 403 when non-owner tries to update", async () => {
      const request = await createFormRequest({ description: "Updated step" }, otherUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(403);
        return true;
      });
    });

    it("should throw 404 for non-existent recipe", async () => {
      const request = await createFormRequest({ description: "Updated step" }, testUserId, "nonexistent-id");

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-id", stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 for soft-deleted recipe in action", async () => {
      // Soft delete the recipe
      await db.recipe.update({
        where: { id: recipeId },
        data: { deletedAt: new Date() },
      });

      const request = await createFormRequest({ description: "Updated step" }, testUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 for non-existent step in action", async () => {
      const request = await createFormRequest({ description: "Updated step" }, testUserId, recipeId, "nonexistent-step");

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: "nonexistent-step" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should throw 404 when step belongs to different recipe in action", async () => {
      // Create another recipe
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const request = await createFormRequest({ description: "Updated step" }, testUserId, otherRecipe.id);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: otherRecipe.id, stepId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should return validation error when description is empty", async () => {
      const request = await createFormRequest({ description: "", stepTitle: "Title" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.description).toBe("Step description is required");
    });

    it("should return validation error when description is only whitespace", async () => {
      const request = await createFormRequest({ description: "   " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.description).toBe("Step description is required");
    });

    it("should return validation error when stepTitle exceeds 200 characters", async () => {
      const longTitle = "a".repeat(201);
      const request = await createFormRequest(
        { stepTitle: longTitle, description: "Valid description" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.stepTitle).toBe("Step title must be 200 characters or less");
    });

    it("should return validation error when description exceeds 5000 characters", async () => {
      const longDescription = "a".repeat(5001);
      const request = await createFormRequest(
        { description: longDescription },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.description).toBe("Description must be 5,000 characters or less");
    });

    it("should accept stepTitle at exactly 200 characters", async () => {
      // First, add an ingredient to the step so it passes validation
      const unit = await db.unit.findFirst() || await db.unit.create({ data: { name: "cup_test_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.findFirst() || await db.ingredientRef.create({ data: { name: "flour_test_" + faker.string.alphanumeric(6) } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const exactTitle = "a".repeat(200);
      const request = await createFormRequest(
        { stepTitle: exactTitle, description: "Valid description" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { status } = extractResponseData(response);
      expect(status).toBe(302);
    });

    it("should accept description at exactly 5000 characters", async () => {
      // First, add an ingredient to the step so it passes validation
      const unit = await db.unit.findFirst() || await db.unit.create({ data: { name: "tbsp_test_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.findFirst() || await db.ingredientRef.create({ data: { name: "butter_test_" + faker.string.alphanumeric(6) } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const exactDescription = "a".repeat(5000);
      const request = await createFormRequest(
        { description: exactDescription },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { status } = extractResponseData(response);
      expect(status).toBe(302);
    });

    it("should successfully update step and redirect", async () => {
      // First, add an ingredient to the step so it passes validation
      const unit = await db.unit.findFirst() || await db.unit.create({ data: { name: "oz_test_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.findFirst() || await db.ingredientRef.create({ data: { name: "salt_test_" + faker.string.alphanumeric(6) } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 1.5,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          stepTitle: "Updated Title",
          description: "Updated description content",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      // Handle both Response and DataWithResponseInit from React Router
      let statusCode = 200;
      if (response instanceof Response) {
        statusCode = response.status;
        expect(statusCode).toBe(302);
        expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}/edit`);
      } else if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
        statusCode = response.init?.status || 200;
        expect(statusCode).toBe(302);
        // DataWithResponseInit wraps the init object from redirect response
        const headers = response.init?.headers || {};
        const location = headers instanceof Headers ? headers.get("Location") : headers.Location;
        expect(location).toBe(`/recipes/${recipeId}/edit`);
      }

      // Verify step was updated
      const updatedStep = await db.recipeStep.findUnique({ where: { id: stepId } });
      expect(updatedStep?.stepTitle).toBe("Updated Title");
      expect(updatedStep?.description).toBe("Updated description content");
    });

    it("should update step without optional title (set to null)", async () => {
      // First, add an ingredient to the step so it passes validation
      const unit = await db.unit.findFirst() || await db.unit.create({ data: { name: "tsp_test_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.findFirst() || await db.ingredientRef.create({ data: { name: "pepper_test_" + faker.string.alphanumeric(6) } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 0.5,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          stepTitle: "",
          description: "Just description",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId, stepId },
      } as any);

      const { status } = extractResponseData(response);
      expect(status).toBe(302);

      // Verify step title is null
      const updatedStep = await db.recipeStep.findUnique({ where: { id: stepId } });
      expect(updatedStep?.stepTitle).toBeNull();
      expect(updatedStep?.description).toBe("Just description");
    });

    it("should return generic error for database errors", async () => {
      // First, add an ingredient to the step so it passes validation
      const unit = await db.unit.findFirst() || await db.unit.create({ data: { name: "ml_test_" + faker.string.alphanumeric(6) } });
      const ingredientRef = await db.ingredientRef.findFirst() || await db.ingredientRef.create({ data: { name: "water_test_" + faker.string.alphanumeric(6) } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: 1,
          quantity: 250,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      // Mock db.recipeStep.update to throw a generic error
      const originalUpdate = db.recipeStep.update;
      db.recipeStep.update = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      try {
        const request = await createFormRequest(
          {
            stepTitle: "Updated Title",
            description: "Updated description",
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to update step. Please try again.");
      } finally {
        // Restore original function
        db.recipeStep.update = originalUpdate;
      }
    });

    it("saves the step, its output uses and the recipe's updatedAt together or not at all", async () => {
      const step2 = await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Second", stepTitle: "Second" },
      });
      const old = new Date("2026-01-01T00:00:00.000Z");
      await db.recipe.update({ where: { id: recipeId }, data: { updatedAt: old } });

      const originalCreateMany = db.stepOutputUse.createMany;
      db.stepOutputUse.createMany = vi.fn().mockRejectedValue(new Error("Database connection failed")) as any;
      try {
        const request = await createFormRequest({ stepTitle: "Changed", description: "Changed description" }, testUserId, recipeId, step2.id, [1]);
        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);
        expect(extractResponseData(response).status).toBe(500);
      } finally {
        db.stepOutputUse.createMany = originalCreateMany;
      }

      const unchanged = await db.recipeStep.findUnique({ where: { id: step2.id } });
      expect(unchanged?.description).toBe("Second");

      const request = await createFormRequest({ stepTitle: "Changed", description: "Changed description" }, testUserId, recipeId, step2.id, [1]);
      await action({ request, context: { cloudflare: { env: null } }, params: { id: recipeId, stepId: step2.id } } as any);
      const recipe = await db.recipe.findUnique({ where: { id: recipeId } });
      expect(recipe!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    });

    describe("delete intent", () => {
      it("should delete step and redirect to recipe edit", async () => {
        const request = await createFormRequest({ intent: "delete" }, testUserId);
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
        });

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}/edit`);

        // Verify step was deleted
        const deletedStep = await db.recipeStep.findUnique({ where: { id: stepId } });
        expect(deletedStep).toBeNull();
        const touchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(touchedRecipe!.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime());
      });

      it("should return error when step cannot be deleted due to dependencies", async () => {
        // Create step 2 that uses step 1 (stepId)
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Step that uses step 1 output",
          },
        });

        // Create dependency: step 2 uses output of step 1
        await db.stepOutputUse.create({
          data: {
            recipeId,
            outputStepNum: 1,
            inputStepNum: 2,
          },
        });

        const request = await createFormRequest({ intent: "delete" }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors?.stepDeletion).toBe(
          "Cannot delete Step 1 because it is used by Step 2"
        );

        // Verify step was NOT deleted
        const existingStep = await db.recipeStep.findUnique({ where: { id: stepId } });
        expect(existingStep).not.toBeNull();

        // Cleanup
        await db.stepOutputUse.deleteMany({ where: { recipeId } });
        await db.recipeStep.delete({ where: { id: step2.id } });
      });

      it("should return error listing multiple dependent steps", async () => {
        // Create steps 2 and 3 that use step 1
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Step 2 uses step 1",
          },
        });
        const step3 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 3,
            description: "Step 3 uses step 1",
          },
        });

        // Create dependencies
        await db.stepOutputUse.createMany({
          data: [
            { recipeId, outputStepNum: 1, inputStepNum: 2 },
            { recipeId, outputStepNum: 1, inputStepNum: 3 },
          ],
        });

        const request = await createFormRequest({ intent: "delete" }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors?.stepDeletion).toBe(
          "Cannot delete Step 1 because it is used by Steps 2 and 3"
        );

        // Cleanup
        await db.stepOutputUse.deleteMany({ where: { recipeId } });
        await db.recipeStep.delete({ where: { id: step3.id } });
        await db.recipeStep.delete({ where: { id: step2.id } });
      });
    });

    describe("step output uses update", () => {
      it("should create step output uses when updating step", async () => {
        // Create step 2 for testing
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step that will use step 1",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Uses output from step 1",
          },
          testUserId,
          recipeId,
          step2.id,
          [1] // usesSteps
        );
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
        });

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify step output use was created
        const stepOutputUses = await db.stepOutputUse.findMany({
          where: { recipeId, inputStepNum: 2 },
        });
        expect(stepOutputUses).toHaveLength(1);
        expect(stepOutputUses[0].outputStepNum).toBe(1);
        const touchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(touchedRecipe!.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime());
      });

      it("should create multiple step output uses when updating step", async () => {
        // Create step 2 and 3
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });
        const step3 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 3,
            description: "Third step that will use step 1 and 2",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 3",
            description: "Uses output from step 1 and 2",
          },
          testUserId,
          recipeId,
          step3.id,
          [1, 2] // usesSteps
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step3.id },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify step output uses were created
        const stepOutputUses = await db.stepOutputUse.findMany({
          where: { recipeId, inputStepNum: 3 },
          orderBy: { outputStepNum: "asc" },
        });
        expect(stepOutputUses).toHaveLength(2);
        expect(stepOutputUses[0].outputStepNum).toBe(1);
        expect(stepOutputUses[1].outputStepNum).toBe(2);
      });

      it("should delete existing step output uses and create new ones on update", async () => {
        // Create step 2 and 3
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });
        const step3 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 3,
            description: "Third step",
          },
        });

        // Create existing step output use: step 3 uses step 1
        await db.stepOutputUse.create({
          data: {
            recipeId,
            outputStepNum: 1,
            inputStepNum: 3,
          },
        });

        // Update to use step 2 instead of step 1
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 3",
            description: "Now uses output from step 2 only",
          },
          testUserId,
          recipeId,
          step3.id,
          [2] // usesSteps - changed from [1] to [2]
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step3.id },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify old step output use was deleted and new one created
        const stepOutputUses = await db.stepOutputUse.findMany({
          where: { recipeId, inputStepNum: 3 },
        });
        expect(stepOutputUses).toHaveLength(1);
        expect(stepOutputUses[0].outputStepNum).toBe(2);
      });

      it("should clear all step output uses when none selected", async () => {
        // Create step 2
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        // Create existing step output use
        await db.stepOutputUse.create({
          data: {
            recipeId,
            outputStepNum: 1,
            inputStepNum: 2,
          },
        });

        const unit = await db.unit.create({
          data: { name: "tbsp_clear_uses_" + faker.string.alphanumeric(6) },
        });
        const ingredientRef = await db.ingredientRef.create({
          data: { name: "oil_clear_uses_" + faker.string.alphanumeric(6) },
        });
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 2,
            quantity: 1,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        // Update with no usesSteps (empty selection)
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "No longer uses any previous steps",
          },
          testUserId,
          recipeId,
          step2.id,
          [] // empty usesSteps
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify all step output uses were deleted
        const stepOutputUses = await db.stepOutputUse.findMany({
          where: { recipeId, inputStepNum: 2 },
        });
        expect(stepOutputUses).toHaveLength(0);
      });

      it("should return validation error when mix of valid and invalid step numbers", async () => {
        // Create step 2
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        // Try to use invalid step numbers (0, negative, same as current, greater than current)
        // Even though 1 is valid, the first invalid (0) should cause an error
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "With invalid step references",
          },
          testUserId,
          recipeId,
          step2.id,
          [0, -1, 2, 3, 1] // 0 is checked first and is invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Invalid step number");
      });

      it("should return validation error when step 1 tries to reference itself", async () => {
        // Step 1 exists from beforeEach
        // Try to add usesSteps to step 1 (should return error)
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 1",
            description: "First step cannot use previous steps",
          },
          testUserId,
          recipeId,
          stepId,
          [1] // Self-reference - invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Cannot reference the current step");
      });

      it("should allow step update without usesSteps for step 1", async () => {
        // Step 1 exists from beforeEach; add an ingredient to satisfy validation.
        const unit = await db.unit.create({
          data: { name: "cup_step1_" + faker.string.alphanumeric(6) },
        });
        const ingredientRef = await db.ingredientRef.create({
          data: { name: "water_step1_" + faker.string.alphanumeric(6) },
        });
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 1,
            quantity: 1,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        // Update step 1 without any usesSteps - should succeed
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 1",
            description: "First step description updated",
          },
          testUserId,
          recipeId,
          stepId,
          [] // No step references
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify step was updated
        const updatedStep = await db.recipeStep.findUnique({ where: { id: stepId } });
        expect(updatedStep?.stepTitle).toBe("Updated Step 1");
      });

      it("should return validation error when step has no ingredients and no step output uses", async () => {
        // Step 1 has no ingredients from beforeEach and cannot reference previous steps.
        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 1",
            description: "Still empty",
          },
          testUserId,
          recipeId,
          stepId,
          []
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe(
          "Add at least 1 ingredient or 1 step output use before saving this step."
        );
      });

      it("should return validation error when selecting current step (self-reference)", async () => {
        // Create step 2
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Valid description",
          },
          testUserId,
          recipeId,
          step2.id,
          [2] // Self-reference - invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Cannot reference the current step");
      });

      it("should return validation error when selecting future step (forward reference)", async () => {
        // Create steps 2 and 3
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 3,
            description: "Third step",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Valid description",
          },
          testUserId,
          recipeId,
          step2.id,
          [3] // Forward reference - invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Can only reference previous steps");
      });

      it("should return validation error with multiple invalid step references", async () => {
        // Create steps 2 and 3
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 3,
            description: "Third step",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Valid description",
          },
          testUserId,
          recipeId,
          step2.id,
          [2, 3] // Both self-reference and forward reference - both invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        // Should show the first error encountered
        expect(data.errors.usesSteps).toBeTruthy();
      });

      it("should return validation error for invalid step number (zero)", async () => {
        // Create step 2
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Valid description",
          },
          testUserId,
          recipeId,
          step2.id,
          [0] // Zero is invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Invalid step number");
      });

      it("should return validation error for negative step number", async () => {
        // Create step 2
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        const request = await createFormRequest(
          {
            stepTitle: "Updated Step 2",
            description: "Valid description",
          },
          testUserId,
          recipeId,
          step2.id,
          [-1] // Negative is invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId: step2.id },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Invalid step number");
      });
    });

    describe("addIngredient intent", () => {
      it("should add ingredient with existing unit and ingredientRef", async () => {
        // Create existing unit and ingredientRef with lowercase names (as the action normalizes to lowercase)
        const unitName = "tablespoon_" + faker.string.alphanumeric(6).toLowerCase();
        const ingredientName = "sugar_" + faker.string.alphanumeric(6).toLowerCase();
        const existingUnit = await db.unit.create({ data: { name: unitName } });
        const existingIngredientRef = await db.ingredientRef.create({ data: { name: ingredientName } });

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "3",
            unitName: unitName, // Same case as stored
            ingredientName: ingredientName, // Same case as stored
          },
          testUserId
        );
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
        });

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
          include: { unit: true, ingredientRef: true },
        });
        expect(ingredients).toHaveLength(1);
        expect(ingredients[0].quantity).toBe(3);
        expect(ingredients[0].unitId).toBe(existingUnit.id);
        expect(ingredients[0].ingredientRefId).toBe(existingIngredientRef.id);
        const touchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(touchedRecipe!.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime());
      });

      it("should create new unit and ingredientRef if they do not exist", async () => {
        const unitName = "newunit_" + faker.string.alphanumeric(6);
        const ingredientName = "newingredient_" + faker.string.alphanumeric(6);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "1.5",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify unit was created (normalized to lowercase by the action)
        const unit = await db.unit.findUnique({ where: { name: unitName.toLowerCase() } });
        expect(unit).not.toBeNull();

        // Verify ingredientRef was created (normalized to lowercase by the action)
        const ingredientRef = await db.ingredientRef.findUnique({ where: { name: ingredientName.toLowerCase() } });
        expect(ingredientRef).not.toBeNull();

        // Verify ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(1);
        expect(ingredients[0].quantity).toBe(1.5);
      });

      it("should not add ingredient if quantity is missing or zero", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "0",
            unitName: "cup",
            ingredientName: "flour",
          },
          testUserId
        );

        await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        // Verify no ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(0);
      });

      it("should not add ingredient if unitName is missing", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: "",
            ingredientName: "flour",
          },
          testUserId
        );

        await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        // Verify no ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(0);
      });

      it("should not add ingredient if ingredientName is missing", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: "cup",
            ingredientName: "",
          },
          testUserId
        );

        await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        // Verify no ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(0);
      });

      it("should return validation error when quantity is below minimum (0.001)", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "0.0001",
            unitName: "cup",
            ingredientName: "flour",
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.quantity).toBe("Quantity must be between 0.001 and 99,999");
      });

      it("should return validation error when quantity exceeds maximum (99999)", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "100000",
            unitName: "cup",
            ingredientName: "flour",
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.quantity).toBe("Quantity must be between 0.001 and 99,999");
      });

      it("should return validation error when quantity is not a valid number", async () => {
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "abc",
            unitName: "cup",
            ingredientName: "flour",
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.quantity).toBe("Quantity must be a valid number");
      });

      it("should return validation error when unit name exceeds 50 characters", async () => {
        const longUnitName = "a".repeat(51);
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: longUnitName,
            ingredientName: "flour",
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.unitName).toBe("Unit name must be 50 characters or less");
      });

      it("should return validation error when ingredient name exceeds 100 characters", async () => {
        const longIngredientName = "a".repeat(101);
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: "cup",
            ingredientName: longIngredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe("Ingredient name must be 100 characters or less");
      });

      it("should accept quantity at exactly minimum boundary (0.001)", async () => {
        const unitName = "cup_" + faker.string.alphanumeric(6);
        const ingredientName = "flour_" + faker.string.alphanumeric(6);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "0.001",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(1);
        expect(ingredients[0].quantity).toBe(0.001);
      });

      it("should accept quantity at exactly maximum boundary (99999)", async () => {
        const unitName = "cup_" + faker.string.alphanumeric(6);
        const ingredientName = "flour_" + faker.string.alphanumeric(6);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "99999",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
        });
        expect(ingredients).toHaveLength(1);
        expect(ingredients[0].quantity).toBe(99999);
      });

      it("should accept unit name at exactly 50 characters", async () => {
        const unitName = "a".repeat(50);
        const ingredientName = "flour_" + faker.string.alphanumeric(6);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);
      });

      it("should accept ingredient name at exactly 100 characters", async () => {
        const unitName = "cup_" + faker.string.alphanumeric(6);
        const ingredientName = "a".repeat(100);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);
      });

      it("should return multiple validation errors when multiple fields are invalid", async () => {
        const longUnitName = "a".repeat(51);
        const longIngredientName = "a".repeat(101);

        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "-1",
            unitName: longUnitName,
            ingredientName: longIngredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.quantity).toBe("Quantity must be between 0.001 and 99,999");
        expect(data.errors.unitName).toBe("Unit name must be 50 characters or less");
        expect(data.errors.ingredientName).toBe("Ingredient name must be 100 characters or less");
      });

      it("should return error when adding duplicate ingredient to same step", async () => {
        const unitName = "cup_" + faker.string.alphanumeric(6).toLowerCase();
        const ingredientName = "flour_" + faker.string.alphanumeric(6).toLowerCase();

        // Create unit and ingredientRef
        const unit = await db.unit.create({ data: { name: unitName } });
        const ingredientRef = await db.ingredientRef.create({ data: { name: ingredientName } });

        // Add ingredient to the step
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 1,
            quantity: 2,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        // Try to add the same ingredient again
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "3",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe("This ingredient is already in the recipe");

        // Verify no duplicate ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId },
        });
        expect(ingredients).toHaveLength(1);
      });

      it("should return error when adding duplicate ingredient to different step", async () => {
        const unitName = "tbsp_" + faker.string.alphanumeric(6).toLowerCase();
        const ingredientName = "sugar_" + faker.string.alphanumeric(6).toLowerCase();

        // Create a second step
        const step2 = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Second step",
          },
        });

        // Create unit and ingredientRef
        const unit = await db.unit.create({ data: { name: unitName } });
        const ingredientRef = await db.ingredientRef.create({ data: { name: ingredientName } });

        // Add ingredient to step 2
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 2,
            quantity: 1,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        // Try to add the same ingredient to step 1 (via the step edit route for step 1)
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "2",
            unitName: unitName,
            ingredientName: ingredientName,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId }, // stepId is for step 1
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe("This ingredient is already in the recipe");

        // Verify no duplicate ingredient was created
        const ingredients = await db.ingredient.findMany({
          where: { recipeId },
        });
        expect(ingredients).toHaveLength(1);
      });

      it("should allow adding ingredient with different case (case-insensitive check)", async () => {
        const baseName = "butter_" + faker.string.alphanumeric(6);
        const unitName = "tbsp_" + faker.string.alphanumeric(6).toLowerCase();

        // Create unit and ingredientRef with lowercase name
        const unit = await db.unit.create({ data: { name: unitName } });
        const ingredientRef = await db.ingredientRef.create({ data: { name: baseName.toLowerCase() } });

        // Add ingredient to the step
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 1,
            quantity: 2,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        // Try to add the same ingredient with UPPERCASE (should still be caught)
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "3",
            unitName: unitName.toUpperCase(),
            ingredientName: baseName.toUpperCase(),
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe("This ingredient is already in the recipe");
      });

      it("should allow adding different ingredients to the same recipe", async () => {
        const unitName = "cup_" + faker.string.alphanumeric(6).toLowerCase();
        const ingredientName1 = "flour_" + faker.string.alphanumeric(6).toLowerCase();
        const ingredientName2 = "sugar_" + faker.string.alphanumeric(6).toLowerCase();

        // Create unit and first ingredientRef
        const unit = await db.unit.create({ data: { name: unitName } });
        const ingredientRef1 = await db.ingredientRef.create({ data: { name: ingredientName1 } });

        // Add first ingredient
        await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 1,
            quantity: 2,
            unitId: unit.id,
            ingredientRefId: ingredientRef1.id,
          },
        });

        // Add a different ingredient (should succeed)
        const request = await createFormRequest(
          {
            intent: "addIngredient",
            quantity: "1",
            unitName: unitName,
            ingredientName: ingredientName2,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify both ingredients exist
        const ingredients = await db.ingredient.findMany({
          where: { recipeId },
        });
        expect(ingredients).toHaveLength(2);
      });
    });

    // "Add All" on the step edit page sends every parsed ingredient in one request. It used to
    // call submit() once per ingredient; each navigation submission cancels the one before it,
    // so some ingredients could silently never be added.
    describe("addIngredients intent", () => {
      async function addIngredientsRequest(ingredientsJson: string) {
        return createFormRequest({ intent: "addIngredients", ingredientsJson }, testUserId);
      }

      async function runAction(request: UndiciRequest) {
        return extractResponseData(
          await action({
            request,
            context: { cloudflare: { env: null } },
            params: { id: recipeId, stepId },
          } as any)
        );
      }

      async function stepIngredients() {
        return db.ingredient.findMany({
          where: { recipeId, stepNum: 1 },
          include: { unit: true, ingredientRef: true },
          orderBy: { quantity: "asc" },
        });
      }

      it("adds every ingredient to the step in one request", async () => {
        const suffix = faker.string.alphanumeric(6).toLowerCase();
        const existingUnit = await db.unit.create({ data: { name: `cup_${suffix}` } });
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
        });

        const { data, status } = await runAction(
          await addIngredientsRequest(
            JSON.stringify([
              { quantity: 2, unit: `Cup_${suffix}`, ingredientName: ` Flour_${suffix} ` },
              { quantity: "1.5", unit: `tsp_${suffix}`, ingredientName: `salt_${suffix}` },
            ])
          )
        );

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        const ingredients = await stepIngredients();
        expect(
          ingredients.map((ingredient) => [ingredient.quantity, ingredient.unit.name, ingredient.ingredientRef.name])
        ).toEqual([
          [1.5, `tsp_${suffix}`, `salt_${suffix}`],
          [2, `cup_${suffix}`, `flour_${suffix}`],
        ]);
        expect(ingredients[1].unitId).toBe(existingUnit.id);
        const touchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(touchedRecipe!.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime());
      });

      it.each([
        ["malformed JSON", "{not json"],
        ["a non-array", JSON.stringify({ quantity: 1 })],
        ["an empty list", "[]"],
      ])("rejects %s without adding anything", async (_label, ingredientsJson) => {
        const { data, status } = await runAction(await addIngredientsRequest(ingredientsJson));

        expect(status).toBe(400);
        expect(data.errors.general).toBe("There are no ingredients to add.");
        expect(await stepIngredients()).toHaveLength(0);
      });

      it("rejects a missing ingredients field without adding anything", async () => {
        const { data, status } = await runAction(
          await createFormRequest({ intent: "addIngredients" }, testUserId)
        );

        expect(status).toBe(400);
        expect(data.errors.general).toBe("There are no ingredients to add.");
      });

      // Each error names the offending ingredient (or its position when it has no name), so a
      // rejected batch says which parsed row to fix.
      it.each([
        ["a null entry", [null], "quantity", "Ingredient 2: Quantity must be a valid number"],
        ["a zero quantity", [{ quantity: 0, unit: "cup", ingredientName: "Flour" }], "quantity", "flour: Quantity must be between 0.001 and 99,999"],
        ["a non-numeric quantity", [{ quantity: {}, unit: "cup", ingredientName: "flour" }], "quantity", "flour: Quantity must be a valid number"],
        ["a missing unit", [{ quantity: 1, unit: 3, ingredientName: "flour" }], "unitName", "flour: Unit name is required"],
        ["a missing name", [{ quantity: 1, unit: "cup", ingredientName: null }], "ingredientName", "Ingredient 2: Ingredient name is required"],
      ])("rejects %s, naming it, and adds none of the batch", async (_label, ingredients, field, message) => {
        const { data, status } = await runAction(
          await addIngredientsRequest(
            JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: `sugar_${faker.string.alphanumeric(6)}` }, ...ingredients])
          )
        );

        expect(status).toBe(400);
        expect(data.errors[field]).toBe(message);
        expect(await stepIngredients()).toHaveLength(0);
      });

      it("rejects the same ingredient listed twice", async () => {
        const name = `butter_${faker.string.alphanumeric(6).toLowerCase()}`;
        const { data, status } = await runAction(
          await addIngredientsRequest(
            JSON.stringify([
              { quantity: 1, unit: "tbsp", ingredientName: name },
              { quantity: 2, unit: "tbsp", ingredientName: name.toUpperCase() },
            ])
          )
        );

        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe(`${name} is listed more than once`);
        expect(await stepIngredients()).toHaveLength(0);
      });

      it("rejects an ingredient already in the recipe and adds none of the batch", async () => {
        const suffix = faker.string.alphanumeric(6).toLowerCase();
        const unit = await db.unit.create({ data: { name: `cup_${suffix}` } });
        const existingRef = await db.ingredientRef.create({ data: { name: `rice_${suffix}` } });
        await db.ingredient.create({
          data: { recipeId, stepNum: 1, quantity: 1, unitId: unit.id, ingredientRefId: existingRef.id },
        });

        const { data, status } = await runAction(
          await addIngredientsRequest(
            JSON.stringify([
              { quantity: 1, unit: "tsp", ingredientName: `salt_${suffix}` },
              { quantity: 2, unit: "cup", ingredientName: `rice_${suffix}` },
            ])
          )
        );

        expect(status).toBe(400);
        expect(data.errors.ingredientName).toBe(`rice_${suffix} is already in the recipe`);
        expect(await stepIngredients()).toHaveLength(1);
      });
    });

    describe("deleteIngredient intent", () => {
      it("should delete ingredient successfully", async () => {
        // Create unit, ingredientRef, and ingredient
        const unit = await db.unit.create({ data: { name: "cup_" + faker.string.alphanumeric(6) } });
        const ingredientRef = await db.ingredientRef.create({ data: { name: "flour_" + faker.string.alphanumeric(6) } });
        const ingredient = await db.ingredient.create({
          data: {
            recipeId,
            stepNum: 1,
            quantity: 2,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });

        const request = await createFormRequest(
          {
            intent: "deleteIngredient",
            ingredientId: ingredient.id,
          },
          testUserId
        );
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
        });

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        // Verify ingredient was deleted
        const deletedIngredient = await db.ingredient.findUnique({ where: { id: ingredient.id } });
        expect(deletedIngredient).toBeNull();
        const touchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(touchedRecipe!.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime());
      });

      it("should not touch recipe freshness when ingredient is not on this step", async () => {
        const otherStep = await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Other step description",
            stepTitle: "Other Step",
          },
        });
        const unit = await db.unit.create({ data: { name: "cup_" + faker.string.alphanumeric(6) } });
        const ingredientRef = await db.ingredientRef.create({ data: { name: "salt_" + faker.string.alphanumeric(6) } });
        const otherStepIngredient = await db.ingredient.create({
          data: {
            recipeId,
            stepNum: otherStep.stepNum,
            quantity: 1,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        });
        const oldUpdatedAt = new Date("2000-01-01T00:00:00.000Z");
        await db.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: oldUpdatedAt },
        });

        const request = await createFormRequest(
          {
            intent: "deleteIngredient",
            ingredientId: otherStepIngredient.id,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);

        const { data } = extractResponseData(response);
        expect(data.success).toBe(true);

        const preservedIngredient = await db.ingredient.findUnique({ where: { id: otherStepIngredient.id } });
        expect(preservedIngredient).not.toBeNull();
        const untouchedRecipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { updatedAt: true } });
        expect(untouchedRecipe!.updatedAt.toISOString()).toBe(oldUpdatedAt.toISOString());
      });

      it("should do nothing if ingredientId is not provided", async () => {
        const request = await createFormRequest(
          {
            intent: "deleteIngredient",
          },
          testUserId
        );

        // Should not throw
        await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId, stepId },
        } as any);
      });
    });
  });

  describe("component", () => {
    it("should render step edit form with step data", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: "Prep the Ingredients",
          description: "Chop all vegetables",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      expect(await screen.findByRole("heading", { name: "Edit Step" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "← Back to recipe" })).toHaveAttribute("href", "/recipes/recipe-1/edit");
      expect(screen.getByLabelText(/Step Title/)).toHaveValue("Prep the Ingredients");
      expect(screen.getByLabelText(/Description/)).toHaveValue("Chop all vegetables");
      expect(screen.queryByLabelText(/Duration/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete Step" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/recipes/recipe-1/edit");
    });

    it("should render no ingredients message when step has no ingredients", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "A step with no ingredients",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      expect(await screen.findByText("No ingredients added yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Add Ingredient" })).toBeInTheDocument();
    });

    it("should render step with ingredients", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: "Mix",
          description: "Mix the ingredients",
          ingredients: [
            {
              id: "ing-1",
              quantity: 2,
              unit: { name: "cups" },
              ingredientRef: { name: "flour" },
            },
            {
              id: "ing-2",
              quantity: 0.5,
              unit: { name: "tsp" },
              ingredientRef: { name: "salt" },
            },
          ],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      expect(await screen.findByText("2")).toBeInTheDocument();
      expect(screen.getByText(/cups flour/)).toBeInTheDocument();
      expect(screen.getByText("0.5")).toBeInTheDocument();
      expect(screen.getByText(/tsp salt/)).toBeInTheDocument();
      // One remove button per ingredient, each named for its ingredient.
      expect(screen.getByRole("button", { name: "Remove flour" })).toHaveTextContent("Remove");
      expect(screen.getByRole("button", { name: "Remove salt" })).toHaveTextContent("Remove");
    });

    it("should show add ingredient form when clicking add ingredient button", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "A step",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      // Click add ingredient button
      const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
      fireEvent.click(addButton);

      // Now form should be visible with AI mode (default)
      // AI mode shows the mode toggle switch and AI parse input
      expect(screen.getByRole("switch")).toBeInTheDocument();
      expect(screen.getByText(/AI Parse/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Enter ingredients/)).toBeInTheDocument();
      // Button text should change to Cancel
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("should hide add ingredient form when clicking cancel", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "A step",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      // Show form
      const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
      fireEvent.click(addButton);

      // AI mode is default - check for AI parse input
      expect(screen.getByPlaceholderText(/Enter ingredients/)).toBeInTheDocument();

      // Click cancel (the button with "Cancel" text in the ingredient form section)
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelButton);

      // Form should be hidden
      expect(screen.queryByPlaceholderText(/Enter ingredients/)).not.toBeInTheDocument();
      // Button should be back to "+ Add Ingredient"
      expect(screen.getByRole("button", { name: "+ Add Ingredient" })).toBeInTheDocument();
    });

    it("should render empty step title when null", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "Just a description",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      expect(await screen.findByLabelText(/Step Title/)).toHaveValue("");
    });

    it("should have correct form structure for updating step", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: "Step Title",
          description: "Step description",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      // Check form elements
      const titleInput = await screen.findByLabelText(/Step Title/);
      const descriptionTextarea = screen.getByLabelText(/Description/);

      expect(titleInput).toHaveAttribute("type", "text");
      expect(titleInput).toHaveAttribute("name", "stepTitle");
      expect(descriptionTextarea).toHaveAttribute("name", "description");
      expect(descriptionTextarea).toBeRequired();
    });

    it("should not render a delete step button in focused editor", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "Step description",
          ingredients: [],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      await screen.findByRole("heading", { name: "Edit Step" });
      expect(screen.queryByRole("button", { name: "Delete Step" })).not.toBeInTheDocument();
    });

    it("should render ingredient with remove button", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "Mix flour",
          ingredients: [
            {
              id: "ing-1",
              quantity: 2,
              unit: { name: "cups" },
              ingredientRef: { name: "flour" },
            },
          ],
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

      // Verify ingredient display
      expect(await screen.findByText("2")).toBeInTheDocument();
      expect(screen.getByText(/cups flour/)).toBeInTheDocument();

      // Verify remove button exists
      const removeButton = screen.getByRole("button", { name: /^Remove / });
      expect(removeButton).toBeInTheDocument();
    });

    it("should display general error message when present", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "A step",
          ingredients: [],
          usingSteps: [],
        },
        availableSteps: [],
      };

      const actionResult = {
        errors: { general: "Failed to update step. Please try again." },
      };

      const Stub = createTestRoutesStub([
        {
          id: "step-edit",
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
          action: () => actionResult,
        },
      ]);

      render(
        <Stub
          initialEntries={["/recipes/recipe-1/steps/step-1/edit"]}
          hydrationData={{
            loaderData: { "step-edit": mockData },
            actionData: { "step-edit": actionResult },
          }}
        />
      );

      // Verify the general error is displayed via ValidationError (has role="alert")
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Failed to update step. Please try again.");
    });

    it("should display stepTitle validation error and mark input as invalid", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: "a".repeat(201), // Too long
          description: "A step",
          ingredients: [],
          usingSteps: [],
        },
        availableSteps: [],
      };

      const actionResult = {
        errors: { stepTitle: "Step title must be 200 characters or less" },
      };

      const Stub = createTestRoutesStub([
        {
          id: "step-edit",
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
          action: () => actionResult,
        },
      ]);

      render(
        <Stub
          initialEntries={["/recipes/recipe-1/steps/step-1/edit"]}
          hydrationData={{
            loaderData: { "step-edit": mockData },
            actionData: { "step-edit": actionResult },
          }}
        />
      );

      // Verify the stepTitle input has invalid attribute set (HeadlessUI boolean attr)
      const stepTitleInput = await screen.findByLabelText(/Step Title/i);
      expect(stepTitleInput).toHaveAttribute("data-invalid");
      expect(stepTitleInput).toHaveAttribute("aria-invalid", "true");
      expect(stepTitleInput).toHaveAccessibleDescription("Step title must be 200 characters or less");
    });

    it("should display description validation error and mark textarea as invalid", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        step: {
          id: "step-1",
          stepNum: 1,
          stepTitle: null,
          description: "", // Empty - will trigger validation error
          ingredients: [],
          usingSteps: [],
        },
        availableSteps: [],
      };

      const actionResult = {
        errors: { description: "Step description is required" },
      };

      const Stub = createTestRoutesStub([
        {
          id: "step-edit",
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
          action: () => actionResult,
        },
      ]);

      render(
        <Stub
          initialEntries={["/recipes/recipe-1/steps/step-1/edit"]}
          hydrationData={{
            loaderData: { "step-edit": mockData },
            actionData: { "step-edit": actionResult },
          }}
        />
      );

      // Verify the description textarea has invalid attribute set (HeadlessUI boolean attr)
      const descriptionTextarea = await screen.findByLabelText(/Description/i);
      expect(descriptionTextarea).toHaveAttribute("data-invalid");
      expect(descriptionTextarea).toHaveAttribute("aria-invalid", "true");
      expect(descriptionTextarea).toHaveAccessibleDescription("Step description is required");

      // Verify the error message is displayed
      expect(screen.getByText("Step description is required")).toBeInTheDocument();
    });

    describe("uses output from section", () => {
      it("should show Uses Output From label with disabled state when stepNum is 1", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "First step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Label should be shown but without "(optional)" suffix
        expect(screen.getByText("Uses Output From")).toBeInTheDocument();
        // Should not have the dropdown selector
        expect(screen.queryByRole("button", { name: /Select previous steps/i })).not.toBeInTheDocument();
      });

      it("should show empty state message when editing Step 1", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "First step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        expect(screen.getByText(/No previous steps available/i)).toBeInTheDocument();
      });

      // Step 1 has no "Uses Output From" picker, and the "add at least 1 ingredient" error used
      // to render only inside that picker, so pressing Update on an empty step 1 did nothing
      // visible.
      it.each([
        ["step 1, which has no picker", 1, []],
        ["a later step with no earlier steps to pick", 3, []],
      ])("shows the content requirement error on %s", async (_label, stepNum, availableSteps) => {
        const mockData = {
          recipe: { id: "recipe-1", title: "Test Recipe" },
          step: {
            id: "step-1",
            stepNum,
            stepTitle: null,
            description: "First step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps,
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Add at least 1 ingredient or 1 step output use before saving this step." },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        fireEvent.click(await screen.findByRole("button", { name: "Update" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Add at least 1 ingredient or 1 step output use before saving this step."
        );
      });

      it("should handle editing the only step in a single-step recipe", async () => {
        // This test verifies the edge case where a recipe has only one step
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Single Step Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: "The Only Step",
            description: "This is the only step in this recipe",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [], // No previous steps available
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Should render the edit form correctly
        await screen.findByRole("heading", { name: /Edit Step/i });

        // Step title should be pre-filled
        const titleInput = screen.getByLabelText(/Step Title/i);
        expect(titleInput).toHaveValue("The Only Step");

        // Description should be pre-filled
        const descriptionTextarea = screen.getByLabelText(/Description/i);
        expect(descriptionTextarea).toHaveValue("This is the only step in this recipe");

        // Should show empty state for Uses Output From
        expect(screen.getByText(/No previous steps available/i)).toBeInTheDocument();

        // Should NOT show the step selector dropdown
        expect(screen.queryByRole("button", { name: /Select previous steps/i })).not.toBeInTheDocument();

        // Cancel and Save buttons should be present
        expect(screen.getByRole("link", { name: /Cancel/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Update/i })).toBeInTheDocument();
      });

      it("should show Uses Output From when stepNum > 1 with available steps", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-2",
            stepNum: 2,
            stepTitle: null,
            description: "Second step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-2/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        expect(screen.getByText(/Uses Output From/i)).toBeInTheDocument();
      });

      it("should display available steps in correct format with title", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-3",
            stepNum: 3,
            stepTitle: null,
            description: "Third step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
            { stepNum: 2, stepTitle: "Mix the batter" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-3/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Click to open the listbox
        const listboxButton = screen.getByRole("button", { name: /Select previous steps/i });
        await act(async () => {
          fireEvent.click(listboxButton);
        });

        // Check that options are displayed correctly
        await waitFor(() => {
          expect(screen.getByText("Step 1: Prep the ingredients")).toBeInTheDocument();
          expect(screen.getByText("Step 2: Mix the batter")).toBeInTheDocument();
        });
      });

      it("should submit selected step output uses as hidden form inputs", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-3",
            stepNum: 3,
            stepTitle: null,
            description: "Third step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
            { stepNum: 2, stepTitle: "Mix the batter" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-3/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        const listboxButton = screen.getByRole("button", { name: /Select previous steps/i });
        await act(async () => {
          fireEvent.click(listboxButton);
        });
        await act(async () => {
          fireEvent.click(screen.getByText("Step 1: Prep the ingredients"));
        });
        await act(async () => {
          fireEvent.click(screen.getByText("Step 2: Mix the batter"));
        });

        const hiddenInputs = document.querySelectorAll('input[name="usesSteps"]');
        expect(hiddenInputs).toHaveLength(2);
        expect(Array.from(hiddenInputs).map((input) => (input as HTMLInputElement).value)).toEqual(
          expect.arrayContaining(["1", "2"])
        );
      });

      it("should display available steps without title correctly", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-2",
            stepNum: 2,
            stepTitle: null,
            description: "Second step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: null },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-2/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Click to open the listbox
        const listboxButton = screen.getByRole("button", { name: /Select previous steps/i });
        await act(async () => {
          fireEvent.click(listboxButton);
        });

        // Check that step without title shows just the number
        await waitFor(() => {
          expect(screen.getByText("Step 1")).toBeInTheDocument();
        });
      });

      it("should pre-select existing step output uses", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-3",
            stepNum: 3,
            stepTitle: null,
            description: "Third step",
            ingredients: [],
            usingSteps: [
              {
                id: "sou-1",
                outputStepNum: 1,
                outputOfStep: { stepNum: 1, stepTitle: "First step" },
              },
            ],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
            { stepNum: 2, stepTitle: "Second step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-3/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // The listbox button should show the selected step
        const listboxButton = screen.getByRole("button", { name: /Select previous steps/i });
        expect(listboxButton).toHaveTextContent("Step 1: First step");
      });

      it("should pre-select multiple existing step output uses", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-3",
            stepNum: 3,
            stepTitle: null,
            description: "Third step",
            ingredients: [],
            usingSteps: [
              {
                id: "sou-1",
                outputStepNum: 1,
                outputOfStep: { stepNum: 1, stepTitle: "First step" },
              },
              {
                id: "sou-2",
                outputStepNum: 2,
                outputOfStep: { stepNum: 2, stepTitle: "Second step" },
              },
            ],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
            { stepNum: 2, stepTitle: "Second step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-3/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // The listbox button should show both selected steps
        const listboxButton = screen.getByRole("button", { name: /Select previous steps/i });
        expect(listboxButton).toHaveTextContent("Step 1: First step");
        expect(listboxButton).toHaveTextContent("Step 2: Second step");
      });

      it("should display validation error for usesSteps when present", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-2",
            stepNum: 2,
            stepTitle: null,
            description: "Second step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Cannot reference the current step" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-2/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Submit the form to trigger action
        const saveButton = screen.getByRole("button", { name: "Update" });
        await act(async () => {
          fireEvent.click(saveButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          expect(screen.getByText("Cannot reference the current step")).toBeInTheDocument();
        });
      });

      it("should display multiple validation errors for usesSteps", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-2",
            stepNum: 2,
            stepTitle: null,
            description: "Second step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Invalid step number" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-2/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Submit the form to trigger action
        const saveButton = screen.getByRole("button", { name: "Update" });
        await act(async () => {
          fireEvent.click(saveButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          expect(screen.getByText("Invalid step number")).toBeInTheDocument();
        });
      });

      it("should position usesSteps error near the Uses Output From section", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-2",
            stepNum: 2,
            stepTitle: null,
            description: "Second step",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Can only reference previous steps" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-2/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        // Submit the form to trigger action
        const saveButton = screen.getByRole("button", { name: "Update" });
        await act(async () => {
          fireEvent.click(saveButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          const errorElement = screen.getByText("Can only reference previous steps");
          expect(errorElement).toBeInTheDocument();
          // Error should have the correct error styling (red text)
          expect(errorElement).toHaveClass("text-[var(--sj-tomato)]");
        });
      });
    });

    describe("step deletion error display", () => {
      it("should not display step deletion error when no error exists", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: "Test Step",
            description: "Step description",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            // No action data - no errors
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        await screen.findByRole("heading", { name: /Edit Step/i });

        expect(screen.queryByRole("button", { name: "Delete Step" })).not.toBeInTheDocument();

        // No alert with step deletion error should exist
        const alerts = screen.queryAllByRole("alert");
        const deletionAlert = alerts.find((alert) =>
          alert.textContent?.includes("Cannot delete")
        );
        expect(deletionAlert).toBeUndefined();
      });
    });

    it("should render stepDeletion ValidationError when actionData has stepDeletion error", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: "Test Step",
            description: "Test description",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const actionResult = {
          errors: { stepDeletion: "Cannot delete Step 1 because it is used by Step 2" },
        };

        const Stub = createTestRoutesStub([
          {
            id: "step-edit",
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/recipes/recipe-1/steps/step-1/edit"]}
            hydrationData={{
              loaderData: { "step-edit": mockData },
              actionData: { "step-edit": actionResult },
            }}
          />
        );

        // ValidationError renders with role="alert"
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Cannot delete Step 1 because it is used by Step 2");
      });

    describe("remove ingredient dialog", () => {
      it("should submit deleteIngredient form when confirming ingredient removal", async () => {
        const actionSpy = vi.fn(() => ({ success: true }));
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "Step with ingredient",
            ingredients: [
              {
                id: "ing-1",
                quantity: 2,
                unit: { name: "cups" },
                ingredientRef: { name: "flour" },
              },
            ],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: actionSpy,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click remove button to set ingredientToRemove state
        const removeButton = await screen.findByRole("button", { name: /^Remove / });
        fireEvent.click(removeButton);

        // Dialog should be open
        expect(await screen.findByText("Remove this ingredient?")).toBeInTheDocument();

        // Click "Remove it" to trigger onConfirm (exercises the if (ingredientToRemove) branch)
        const confirmButton = screen.getByRole("button", { name: "Remove it" });
        fireEvent.click(confirmButton);

        // Verify form submission happened via the action spy
        await waitFor(() => {
          expect(actionSpy).toHaveBeenCalled();
        });

        // Dialog should close after submission
        await waitFor(() => {
          expect(screen.queryByText("Remove this ingredient?")).not.toBeInTheDocument();
        });
      });

      it("should close remove ingredient dialog when clicking cancel", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "Step with ingredient",
            ingredients: [
              {
                id: "ing-1",
                quantity: 2,
                unit: { name: "cups" },
                ingredientRef: { name: "flour" },
              },
            ],
            usingSteps: [],
          },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click remove button
        const removeButton = await screen.findByRole("button", { name: /^Remove / });
        fireEvent.click(removeButton);
        expect(await screen.findByRole("alertdialog", { name: "Remove this ingredient?" })).toBeInTheDocument();

        // Click cancel
        const cancelButton = screen.getByRole("button", { name: "Keep it" });
        fireEvent.click(cancelButton);

        // Wait for the actual dialog to leave, including focus restoration.
        await waitFor(() => {
          expect(screen.queryByRole("alertdialog", { name: "Remove this ingredient?" })).not.toBeInTheDocument();
        });
        await act(async () => {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        });
      });
    });

    describe("parsed ingredient interactions", () => {
      it("should update parsed ingredient when edited", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "A step",
            ingredients: [],
          },
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              const intent = formData.get("intent")?.toString();

              if (intent === "parseIngredients") {
                return {
                  parsedIngredients: [
                    { quantity: 2, unit: "cups", ingredientName: "flour" },
                    { quantity: 1, unit: "tsp", ingredientName: "salt" },
                  ],
                };
              }
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click add ingredient button
        const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
        fireEvent.click(addButton);

        // Type in the AI input to trigger parsing
        const textarea = screen.getByPlaceholderText(/Enter ingredients/);
        fireEvent.change(textarea, { target: { value: "2 cups flour, 1 tsp salt" } });

        // Wait for parsed ingredients to appear
        await waitFor(() => {
          expect(screen.getByRole("heading", { name: /Ingredients \(\d+\)/ })).toBeInTheDocument();
        }, { timeout: 3000 });

        // Find and click the Edit button for flour
        const editButtons = await screen.findAllByRole("button", { name: /Edit / });
        expect(editButtons.length).toBeGreaterThan(0);
        fireEvent.click(editButtons[0]);

        // Now we should see edit inputs - change the quantity
        const quantityInput = screen.getByRole("spinbutton", { name: /Quantity/i });
        fireEvent.change(quantityInput, { target: { value: "3" } });

        // Save the edit
        const saveButton = screen.getByRole("button", { name: "Save" });
        fireEvent.click(saveButton);

        // The ingredient should be updated - verify by checking the display shows new value
        await waitFor(() => {
          expect(screen.getByText("3")).toBeInTheDocument();
        });
      });

      it("should switch to manual mode when clicking Add Manually button on parse error", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "A step",
            ingredients: [],
          },
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              const intent = formData.get("intent")?.toString();

              if (intent === "parseIngredients") {
                // Return a parse error
                return {
                  errors: { parse: "Failed to parse ingredients" },
                };
              }
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click add ingredient button
        const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
        fireEvent.click(addButton);

        // Verify we're in AI mode initially
        const toggle = screen.getByRole("switch");
        expect(toggle).toBeChecked();

        // Type in the AI input to trigger parsing (which will fail)
        const textarea = screen.getByPlaceholderText(/Enter ingredients/);
        fireEvent.change(textarea, { target: { value: "some ingredients" } });

        // Wait for error to appear
        await waitFor(() => {
          expect(screen.getByRole("alert")).toBeInTheDocument();
        }, { timeout: 3000 });

        // Click the "Add Manually" button in the error alert
        const addManuallyButton = screen.getByTestId("switch-to-manual-button");
        fireEvent.click(addManuallyButton);

        // Should switch to manual mode - check for manual input fields
        // The ManualIngredientInput shows quantity, unit, and ingredient inputs
        await waitFor(() => {
          expect(screen.getByRole("spinbutton", { name: /Quantity/i })).toBeInTheDocument();
          expect(screen.getByLabelText(/Unit/i)).toBeInTheDocument();
          expect(screen.getByLabelText("Ingredient")).toBeInTheDocument();
        });

        // The AI parse textarea should no longer be visible
        expect(screen.queryByPlaceholderText(/Enter ingredients/)).not.toBeInTheDocument();
      });

      it("should remove parsed ingredient when remove button is clicked", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "A step",
            ingredients: [],
          },
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              const intent = formData.get("intent")?.toString();

              if (intent === "parseIngredients") {
                return {
                  parsedIngredients: [
                    { quantity: 2, unit: "cups", ingredientName: "flour" },
                    { quantity: 1, unit: "tsp", ingredientName: "salt" },
                  ],
                };
              }
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click add ingredient button
        const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
        fireEvent.click(addButton);

        // Type in the AI input to trigger parsing
        const textarea = screen.getByPlaceholderText(/Enter ingredients/);
        fireEvent.change(textarea, { target: { value: "2 cups flour, 1 tsp salt" } });

        // Wait for parsed ingredients to appear
        await waitFor(() => {
          expect(screen.getByRole("heading", { name: /Ingredients \(\d+\)/ })).toBeInTheDocument();
        }, { timeout: 3000 });

        // Find all remove buttons and click the first one
        const removeButtons = await screen.findAllByRole("button", { name: /Remove / });
        expect(removeButtons.length).toBe(2);
        fireEvent.click(removeButtons[0]);

        // Should now have only one remove button
        await waitFor(() => {
          const remainingButtons = screen.queryAllByRole("button", { name: /Remove / });
          expect(remainingButtons.length).toBe(1);
        });
      });

      it("adds every parsed ingredient with one request when Add All is pressed", async () => {
        const addRequests: Array<Record<string, FormDataEntryValue>> = [];
        const mockData = {
          recipe: { id: "recipe-1", title: "Test Recipe" },
          step: { id: "step-1", stepNum: 1, stepTitle: null, description: "A step", ingredients: [] },
          availableSteps: [],
        };
        const parsed = [
          { quantity: 2, unit: "cups", ingredientName: "flour" },
          { quantity: 1, unit: "tsp", ingredientName: "salt" },
          { quantity: 3, unit: "whole", ingredientName: "eggs" },
        ];

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              if (formData.get("intent") === "parseIngredients") {
                return { parsedIngredients: parsed };
              }
              addRequests.push(Object.fromEntries(formData.entries()));
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        fireEvent.click(await screen.findByRole("button", { name: "+ Add Ingredient" }));
        fireEvent.change(screen.getByPlaceholderText(/Enter ingredients/), {
          target: { value: "2 cups flour, 1 tsp salt, 3 eggs" },
        });
        fireEvent.click(await screen.findByRole("button", { name: "Add all 3 ingredients to recipe" }, { timeout: 3000 }));

        await waitFor(() => {
          expect(addRequests).toEqual([
            { intent: "addIngredients", ingredientsJson: JSON.stringify(parsed) },
          ]);
        });
        // The list clears once the request has answered success, not when it is sent.
        await waitFor(() => {
          expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
        });
      });

      it("does not say no ingredients were added while parsed ones are waiting to be added", async () => {
        const mockData = {
          recipe: { id: "recipe-1", title: "Test Recipe" },
          step: { id: "step-1", stepNum: 1, stepTitle: null, description: "A step", ingredients: [] },
          availableSteps: [],
        };
        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async () => ({ parsedIngredients: [{ quantity: 2, unit: "cups", ingredientName: "flour" }] }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        expect(await screen.findByText("No ingredients added yet")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "+ Add Ingredient" }));
        fireEvent.change(screen.getByPlaceholderText(/Enter ingredients/), { target: { value: "2 cups flour" } });
        expect(await screen.findByRole("button", { name: /Add all/ }, { timeout: 3000 })).toBeInTheDocument();
        expect(screen.queryByText("No ingredients added yet")).not.toBeInTheDocument();

        // Closing the form hides the parsed list, so the empty state is true again.
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
        expect(screen.getByText("No ingredients added yet")).toBeInTheDocument();
      });

      // A rejected batch (say, one ingredient is already in the recipe) must leave the parsed
      // list in place so it can be fixed; it used to be cleared before the server answered.
      it("keeps the parsed list when Add All is rejected, and clears it only after success", async () => {
        const mockData = {
          recipe: { id: "recipe-1", title: "Test Recipe" },
          step: { id: "step-1", stepNum: 1, stepTitle: null, description: "A step", ingredients: [] },
          availableSteps: [],
        };
        const parsed = [
          { quantity: 2, unit: "cups", ingredientName: "flour" },
          { quantity: 1, unit: "cup", ingredientName: "rice" },
        ];
        let addAttempts = 0;

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              if (formData.get("intent") === "parseIngredients") {
                return { parsedIngredients: parsed };
              }
              addAttempts += 1;
              return addAttempts === 1
                ? { errors: { ingredientName: "rice is already in the recipe" } }
                : { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        fireEvent.click(await screen.findByRole("button", { name: "+ Add Ingredient" }));
        fireEvent.change(screen.getByPlaceholderText(/Enter ingredients/), {
          target: { value: "2 cups flour, 1 cup rice" },
        });
        fireEvent.click(await screen.findByRole("button", { name: "Add all 2 ingredients to recipe" }, { timeout: 3000 }));

        expect(await screen.findByText("rice is already in the recipe")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add all 2 ingredients to recipe" })).toBeInTheDocument();

        // Fix the batch and try again: this time it is added and the list clears.
        fireEvent.click(screen.getByRole("button", { name: "Remove rice" }));
        fireEvent.click(screen.getByRole("button", { name: "Add all 1 ingredients to recipe" }));
        await waitFor(() => {
          expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
        });
        expect(addAttempts).toBe(2);
      });

      it("shows why an ingredient could not be added", async () => {
        const mockData = {
          recipe: { id: "recipe-1", title: "Test Recipe" },
          step: { id: "step-1", stepNum: 1, stepTitle: null, description: "A step", ingredients: [] },
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: () => ({ errors: { ingredientName: "This ingredient is already in the recipe" } }),
          },
        ]);

        // Start in manual mode (the toggle's remembered preference) rather than depending on the
        // toggle state earlier tests left behind.
        window.localStorage.setItem("ingredient-input-mode", "manual");
        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        try {
          fireEvent.click(await screen.findByRole("button", { name: "+ Add Ingredient" }));
          fireEvent.change(await screen.findByRole("spinbutton", { name: "Quantity" }), { target: { value: "1" } });
          fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "cup" } });
          fireEvent.change(screen.getByLabelText("Ingredient"), { target: { value: "rice" } });
          fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));

          expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
            "This ingredient is already in the recipe"
          );
        } finally {
          // The toggle remembers manual mode in localStorage; later tests expect AI mode first.
          window.localStorage.removeItem("ingredient-input-mode");
        }
      });

      it("should call onAddAll prop when Add All button is clicked", () => {
        // Test the ParsedIngredientList component directly to verify Add All functionality
        // This tests that the button triggers the callback without needing the full async flow
        const mockIngredients = [
          { quantity: 2, unit: "cups", ingredientName: "flour" },
          { quantity: 1, unit: "tsp", ingredientName: "salt" },
        ];

        const handleAddAll = vi.fn();
        const handleEdit = vi.fn();
        const handleRemove = vi.fn();

        render(
          <ParsedIngredientList
            ingredients={mockIngredients}
            onEdit={handleEdit}
            onRemove={handleRemove}
            onAddAll={handleAddAll}
          />
        );

        // Find and click the Add All button
        const addAllButton = screen.getByRole("button", { name: /Add all 2 ingredients/i });
        fireEvent.click(addAllButton);

        // Verify handleAddAll was called with the ingredients
        expect(handleAddAll).toHaveBeenCalledTimes(1);
        expect(handleAddAll).toHaveBeenCalledWith(mockIngredients);
      });

      it("should submit manual ingredient when Add button is clicked in manual mode", async () => {
        const actionSpy = vi.fn();
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          step: {
            id: "step-1",
            stepNum: 1,
            stepTitle: null,
            description: "A step",
            ingredients: [],
          },
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/:stepId/edit",
            Component: EditStep,
            loader: () => mockData,
            action: async ({ request }: { request: Request }) => {
              const formData = await request.formData();
              const intent = formData.get("intent")?.toString();

              if (intent === "addIngredient") {
                actionSpy(Object.fromEntries(formData.entries()));
                return { success: true };
              }
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);

        // Click add ingredient button
        const addButton = await screen.findByRole("button", { name: "+ Add Ingredient" });
        fireEvent.click(addButton);

        // Switch to manual mode by clicking the toggle
        const toggle = screen.getByRole("switch");
        fireEvent.click(toggle);

        // Wait for manual input fields to appear
        await waitFor(() => {
          expect(screen.getByRole("spinbutton", { name: /Quantity/i })).toBeInTheDocument();
        });

        // Fill in the manual input form
        const quantityInput = screen.getByRole("spinbutton", { name: /Quantity/i });
        const unitInput = screen.getByLabelText(/Unit/i);
        const ingredientInput = screen.getByLabelText("Ingredient");

        fireEvent.change(quantityInput, { target: { value: "3" } });
        fireEvent.change(unitInput, { target: { value: "tbsp" } });
        fireEvent.change(ingredientInput, { target: { value: "olive oil" } });

        // Click the Add Ingredient button
        const addIngredientButton = screen.getByRole("button", { name: /Add Ingredient/i });
        fireEvent.click(addIngredientButton);

        // Verify the action was called with correct data
        await waitFor(() => {
          expect(actionSpy).toHaveBeenCalledWith(expect.objectContaining({
            intent: "addIngredient",
            quantity: "3",
            unitName: "tbsp",
            ingredientName: "olive oil",
          }));
        });
      }, 10000);
    });
  });
});
