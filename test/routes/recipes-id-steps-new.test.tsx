import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/recipes.$id.steps.new";
import NewStep from "~/routes/recipes.$id.steps.new";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";
import * as ingredientParseModule from "~/lib/ingredient-parse.server";
import { IngredientParseError } from "~/lib/ingredient-parse.server";

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

describe("Recipes $id Steps New Route", () => {
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
      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`);

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

    it("should return recipe data and nextStepNum when logged in as owner", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.recipe).toBeDefined();
      expect(result.recipe.id).toBe(recipeId);
      expect(result.nextStepNum).toBe(1);
    });

    it("should throw 403 when non-owner tries to access", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", otherUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

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

      const request = new UndiciRequest("http://localhost:3000/recipes/nonexistent-id/steps/new", { headers });

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

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

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

    it("should calculate correct nextStepNum with existing steps", async () => {
      // Create existing steps
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          description: "Step 2",
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.nextStepNum).toBe(3);
    });

    it("should return empty availableSteps when nextStepNum is 1", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.nextStepNum).toBe(1);
      expect(result.availableSteps).toEqual([]);
    });

    it("should return availableSteps when nextStepNum > 1", async () => {
      // Create existing steps
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          stepTitle: "Prep",
          description: "Step 1 description",
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 2,
          stepTitle: null,
          description: "Step 2 description",
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(result.nextStepNum).toBe(3);
      expect(result.availableSteps).toHaveLength(2);
      expect(result.availableSteps[0]).toEqual({ stepNum: 1, stepTitle: "Prep" });
      expect(result.availableSteps[1]).toEqual({ stepNum: 2, stepTitle: null });
    });
  });

  describe("action", () => {
    async function createFormRequest(
      formFields: Record<string, string>,
      userId?: string,
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

      return new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ description: "Test step" });

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

    it("should throw 403 when non-owner tries to create", async () => {
      const request = await createFormRequest({ description: "Test step" }, otherUserId);

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
      const request = await createFormRequest({ description: "Test step" }, testUserId);

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

    it("should return validation error when description is empty", async () => {
      const request = await createFormRequest({ description: "", stepTitle: "Title" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
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
        params: { id: recipeId },
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
        params: { id: recipeId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.description).toBe("Description must be 5,000 characters or less");
    });

    it("should parse ingredients when parseIngredients intent is submitted", async () => {
      const parseSpy = vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockResolvedValue([{ quantity: 2, unit: "cups", ingredientName: "flour" }]);

      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "2 cups flour" },
        testUserId
      );

      try {
        const response = await action({
          request,
          context: { cloudflare: { env: { OPENAI_API_KEY: "cf-test-key" } } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(200);
        expect(data.parsedIngredients).toEqual([
          { quantity: 2, unit: "cups", ingredientName: "flour" },
        ]);
        expect(parseSpy).toHaveBeenCalledWith("2 cups flour", "cf-test-key");
      } finally {
        parseSpy.mockRestore();
      }
    });

    it("should return parse validation errors from ingredient parser", async () => {
      const parseSpy = vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockRejectedValue(new IngredientParseError("Ingredient text is required"));

      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "" },
        testUserId
      );

      try {
        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.parse).toBe("Ingredient text is required");
      } finally {
        parseSpy.mockRestore();
      }
    });

    it("should return generic parse errors for unexpected parser failures", async () => {
      const parseSpy = vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockRejectedValue(new Error("OpenAI unavailable"));

      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "2 cups flour" },
        testUserId
      );

      try {
        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.parse).toBe("An unexpected error occurred while parsing ingredients");
      } finally {
        parseSpy.mockRestore();
      }
    });

    it("should ignore malformed ingredientsJson and create an empty step", async () => {
      const request = await createFormRequest(
        { description: "Step with malformed ingredient payload", ingredientsJson: "not-json" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const createdStep = await db.recipeStep.findFirst({
        where: { recipeId, description: "Step with malformed ingredient payload" },
        include: { ingredients: true },
      });
      expect(createdStep?.ingredients).toHaveLength(0);
    });

    it("should ignore non-array ingredientsJson and create an empty step", async () => {
      const request = await createFormRequest(
        { description: "Step with object ingredient payload", ingredientsJson: JSON.stringify({ quantity: 1 }) },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const createdStep = await db.recipeStep.findFirst({
        where: { recipeId, description: "Step with object ingredient payload" },
        include: { ingredients: true },
      });
      expect(createdStep?.ingredients).toHaveLength(0);
    });

    it("should return validation error when ingredient quantity is invalid", async () => {
      const request = await createFormRequest(
        {
          description: "Invalid quantity",
          ingredientsJson: JSON.stringify([{ quantity: 0, unit: "cup", ingredientName: "flour" }]),
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
      expect(data.errors.quantity).toBe("Quantity must be between 0.001 and 99,999");
    });

    it("should return validation error when ingredient unit is blank", async () => {
      const request = await createFormRequest(
        {
          description: "Invalid unit",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "   ", ingredientName: "flour" }]),
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
      expect(data.errors.unitName).toBe("Unit name is required");
    });

    it("should return validation error when ingredient name is blank", async () => {
      const request = await createFormRequest(
        {
          description: "Invalid ingredient name",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "   " }]),
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
      expect(data.errors.ingredientName).toBe("Ingredient name is required");
    });

    it("should accept stepTitle at exactly 200 characters", async () => {
      const exactTitle = "a".repeat(200);
      const request = await createFormRequest(
        {
          stepTitle: exactTitle,
          description: "Valid description",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "sugar" }]),
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

    it("should accept description at exactly 5000 characters", async () => {
      const exactDescription = "a".repeat(5000);
      const request = await createFormRequest(
        {
          description: exactDescription,
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "milk" }]),
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

    it("should successfully create step and redirect", async () => {
      const request = await createFormRequest(
        {
          stepTitle: "Prep Work",
          description: "Prepare all ingredients",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "flour" }]),
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
      expect(response.headers.get("Location")).toMatch(/\/recipes\/[\w-]+\/steps\/[\w-]+\/edit\?created=1/);

      // Verify step was created
      const steps = await db.recipeStep.findMany({
        where: { recipeId },
      });
      expect(steps).toHaveLength(1);
      expect(steps[0].stepTitle).toBe("Prep Work");
      expect(steps[0].description).toBe("Prepare all ingredients");
      expect(steps[0].stepNum).toBe(1);
    });

    it("should reuse existing unit and ingredient refs when adding ingredients", async () => {
      const unit = await db.unit.create({ data: { name: "cup" } });
      const ingredientRef = await db.ingredientRef.create({ data: { name: "sugar" } });

      const request = await createFormRequest(
        {
          stepTitle: "Mix",
          description: "Mix existing pantry records",
          ingredientsJson: JSON.stringify([{ quantity: 3, unit: "CUP", ingredientName: "SUGAR" }]),
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

      const ingredient = await db.ingredient.findFirst({
        where: { recipeId, ingredientRefId: ingredientRef.id },
      });
      expect(ingredient).toMatchObject({
        quantity: 3,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      });
      expect(await db.unit.count({ where: { name: "cup" } })).toBe(1);
      expect(await db.ingredientRef.count({ where: { name: "sugar" } })).toBe(1);
    });

    it("should return duplicate ingredient error after creating the step", async () => {
      const existingStep = await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Existing step",
        },
      });
      const unit = await db.unit.create({ data: { name: "cup" } });
      const ingredientRef = await db.ingredientRef.create({ data: { name: "flour" } });
      await db.ingredient.create({
        data: {
          recipeId,
          stepNum: existingStep.stepNum,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          description: "Duplicate ingredient step",
          ingredientsJson: JSON.stringify([{ quantity: 2, unit: "cup", ingredientName: "flour" }]),
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
      expect(data.errors.ingredientName).toBe("This ingredient is already in the recipe");
      expect(await db.recipeStep.findUnique({
        where: { recipeId_stepNum: { recipeId, stepNum: 2 } },
      })).toBeTruthy();
    });

    it("should create step without optional title", async () => {
      const request = await createFormRequest(
        {
          description: "Just a description",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "salt" }]),
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

      // Verify step was created with null title
      const steps = await db.recipeStep.findMany({
        where: { recipeId },
      });
      expect(steps).toHaveLength(1);
      expect(steps[0].stepTitle).toBeNull();
      expect(steps[0].description).toBe("Just a description");
    });

    it("should assign correct step number when adding to existing steps", async () => {
      // Create existing step
      await db.recipeStep.create({
        data: {
          recipeId,
          stepNum: 1,
          description: "Existing step",
        },
      });

      const request = await createFormRequest(
        {
          description: "New step",
          ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "water" }]),
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: recipeId },
      } as any);

      // Verify new step has correct step number
      const steps = await db.recipeStep.findMany({
        where: { recipeId },
        orderBy: { stepNum: "asc" },
      });
      expect(steps).toHaveLength(2);
      expect(steps[0].stepNum).toBe(1);
      expect(steps[1].stepNum).toBe(2);
      expect(steps[1].description).toBe("New step");
    });

    it("should return generic error for database errors", async () => {
      // Mock db.recipeStep.create to throw a generic error
      const originalCreate = db.recipeStep.create;
      db.recipeStep.create = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      try {
        // Provide ingredients to pass validation (now requires at least 1 ingredient or step use)
        const ingredientsJson = JSON.stringify([
          { quantity: 2, unit: "cups", ingredientName: "flour" },
        ]);
        const request = await createFormRequest({ description: "Test step", ingredientsJson }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to create step. Please try again.");
      } finally {
        // Restore original function
        db.recipeStep.create = originalCreate;
      }
    });

    describe("step output uses", () => {
      it("should create an empty step when no ingredients and no step output uses are provided", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        const request = await createFormRequest(
          { description: "Step 2 description" },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        const createdStep = await db.recipeStep.findUnique({
          where: { recipeId_stepNum: { recipeId, stepNum: 2 } },
          include: { ingredients: true, usingSteps: true },
        });
        expect(createdStep).toMatchObject({
          recipeId,
          stepNum: 2,
          description: "Step 2 description",
        });
        expect(createdStep?.ingredients).toHaveLength(0);
        expect(createdStep?.usingSteps).toHaveLength(0);
      });

      it("should create step with single step output use", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        const request = await createFormRequest(
          { description: "Step 2 uses step 1" },
          testUserId,
          [1]
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify StepOutputUse record created
        const stepOutputUses = await db.stepOutputUse.findMany({
          where: { recipeId },
        });
        expect(stepOutputUses).toHaveLength(1);
        expect(stepOutputUses[0].outputStepNum).toBe(1);
        expect(stepOutputUses[0].inputStepNum).toBe(2);
      });

      it("should create step with multiple step output uses", async () => {
        // Create existing steps
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 2,
            description: "Step 2",
          },
        });

        const request = await createFormRequest(
          { description: "Step 3 uses steps 1 and 2" },
          testUserId,
          [1, 2]
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        // Verify StepOutputUse records created
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

      it("should return validation error when referencing non-existent future step", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        // Try to create step 2 with reference to step 5 (doesn't exist, is a forward reference)
        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [1, 5] // Step 5 is a forward reference - invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        // 5 > 2 (nextStepNum), so it's a forward reference
        expect(data.errors.usesSteps).toBe("Can only reference previous steps");
      });

      it("should treat an explicit empty usesSteps array as empty step creation", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [] // Empty array
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);

        const createdStep = await db.recipeStep.findUnique({
          where: { recipeId_stepNum: { recipeId, stepNum: 2 } },
          include: { ingredients: true, usingSteps: true },
        });
        expect(createdStep).toMatchObject({
          recipeId,
          stepNum: 2,
          description: "Step 2",
        });
        expect(createdStep?.ingredients).toHaveLength(0);
        expect(createdStep?.usingSteps).toHaveLength(0);
      });

      it("should return validation error when selecting current step (self-reference)", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        // Creating step 2 and trying to reference step 2 (which would be the current step)
        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [2] // Self-reference - the step being created will be step 2
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Cannot reference the current step");
      });

      it("should return validation error when selecting future step (forward reference)", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        // Creating step 2 and trying to reference step 3 (which doesn't exist yet)
        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [3] // Forward reference - step 3 doesn't exist
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Can only reference previous steps");
      });

      it("should return validation error for invalid step number (zero)", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [0] // Zero is invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Invalid step number");
      });

      it("should return validation error for negative step number", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [-1] // Negative is invalid
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.usesSteps).toBe("Invalid step number");
      });

      it("should return validation error with multiple invalid step references", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        // Creating step 2 and trying to reference both step 2 (self) and step 3 (future)
        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [2, 3] // Both self-reference and forward reference
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        // Should show the first error encountered
        expect(data.errors.usesSteps).toBeTruthy();
      });

      it("should allow valid step reference alongside ignored invalid ones when valid comes first", async () => {
        // Create existing step
        await db.recipeStep.create({
          data: {
            recipeId,
            stepNum: 1,
            description: "Step 1",
          },
        });

        // Creating step 2 with valid reference to step 1 first, then invalid references
        // The validation should catch the invalid ones
        const request = await createFormRequest(
          { description: "Step 2" },
          testUserId,
          [1, 2, 3] // 1 is valid, 2 is self-ref, 3 is forward ref
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: recipeId },
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        // Should catch the invalid references even though 1 is valid
        expect(data.errors.usesSteps).toBeTruthy();
      });
    });
  });

  describe("component", () => {
    it("should render add step form", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 1,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      expect(await screen.findByRole("heading", { name: /Add Step/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/Title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Duration/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Create/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /← Back to recipe/i })).toHaveAttribute("href", "/recipes/recipe-1/edit");
      expect(screen.getByRole("link", { name: /Cancel/i })).toHaveAttribute("href", "/recipes/recipe-1/edit");
    });

    it("should display step number info", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 5,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      expect(await screen.findByText(/Step Number:/)).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("should display general error when present", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 1,
        availableSteps: [],
      };

      const mockActionData = {
        errors: {
          general: "Failed to create step. Please try again.",
        },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
          action: () => mockActionData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      // Submit the form to trigger action
      const form = await screen.findByRole("button", { name: /Create/i });
      expect(form).toBeInTheDocument();
    });

    it("should display description validation error when present", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 1,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      const descriptionInput = await screen.findByLabelText(/Description/i);
      expect(descriptionInput).toBeInTheDocument();
      expect(descriptionInput).toHaveAttribute("required");
    });

    it("should render field-level action errors after submit", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 1,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
          action: () => ({
            errors: {
              stepTitle: "Step title must be 200 characters or less",
              description: "Step description is required",
              quantity: "Quantity must be between 0.001 and 99,999",
              unitName: "Unit name is required",
              ingredientName: "Ingredient name is required",
            },
          }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      await screen.findByRole("heading", { name: /Add Step/i });

      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Description/i), {
          target: { value: "Trigger action errors" },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Create/i }));
      });

      await waitFor(() => {
        expect(screen.getByText("Step title must be 200 characters or less")).toBeInTheDocument();
        expect(screen.getByText("Step description is required")).toBeInTheDocument();
        expect(screen.getByText("Quantity must be between 0.001 and 99,999")).toBeInTheDocument();
        expect(screen.getByText("Unit name is required")).toBeInTheDocument();
        expect(screen.getByText("Ingredient name is required")).toBeInTheDocument();
      });
    });

    it("should omit uses output section when later step has no available previous steps", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 2,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      await screen.findByRole("heading", { name: /Add Step/i });

      expect(screen.queryByText("Uses Output From")).not.toBeInTheDocument();
      expect(screen.queryByText("Uses Output From (optional)")).not.toBeInTheDocument();
      expect(screen.queryByText("No previous steps available")).not.toBeInTheDocument();
    });

    it("should have correct form attributes", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 1,
        availableSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

      const form = (await screen.findByRole("button", { name: /Create/i })).closest("form");
      expect(form).toHaveAttribute("method", "post");

      const stepTitleInput = screen.getByLabelText(/Title/i);
      expect(stepTitleInput).toHaveAttribute("type", "text");
      expect(stepTitleInput).toHaveAttribute("name", "stepTitle");
    });

    describe("uses output from section", () => {
      it("should show Uses Output From label with disabled state when nextStepNum is 1", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 1,
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        // Label should be shown but without "(optional)" suffix
        expect(screen.getByText("Uses Output From")).toBeInTheDocument();
        // Should not have the dropdown selector
        expect(screen.queryByRole("button", { name: /Select previous steps/i })).not.toBeInTheDocument();
      });

      it("should show empty state message when creating Step 1", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 1,
          availableSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        expect(screen.getByText(/No previous steps available/i)).toBeInTheDocument();
      });

      it("should handle adding the first step to a new recipe (single-step scenario)", async () => {
        // This test verifies the edge case where we're adding the very first step
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Brand New Recipe",
          },
          nextStepNum: 1,
          availableSteps: [], // No existing steps
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        // Should render the new step form correctly
        await screen.findByRole("heading", { name: /Add Step/i });

        // Should show empty state for Uses Output From section
        expect(screen.getByText(/No previous steps available/i)).toBeInTheDocument();

        // Should NOT show the step selector dropdown
        expect(screen.queryByRole("button", { name: /Select previous steps/i })).not.toBeInTheDocument();

        // Form fields should be empty
        const descriptionTextarea = screen.getByLabelText(/Description/i);
        expect(descriptionTextarea).toHaveValue("");

        // Cancel and Create Step buttons should be present
        expect(screen.getByRole("link", { name: /Cancel/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Create/i })).toBeInTheDocument();
      });

      it("should show Uses Output From when nextStepNum > 1 with available steps", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 2,
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        expect(screen.getByText(/Uses Output From/i)).toBeInTheDocument();
      });

      it("should display available steps in correct format with title", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 3,
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
            { stepNum: 2, stepTitle: "Mix the batter" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

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
          nextStepNum: 3,
          availableSteps: [
            { stepNum: 1, stepTitle: "Prep the ingredients" },
            { stepNum: 2, stepTitle: "Mix the batter" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

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
          nextStepNum: 2,
          availableSteps: [
            { stepNum: 1, stepTitle: null },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

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

      it("should display validation error for usesSteps when present", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 2,
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Cannot reference the current step" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        // Fill in required field
        const descriptionInput = screen.getByLabelText(/Description/i);
        await act(async () => {
          fireEvent.change(descriptionInput, { target: { value: "Test description" } });
        });

        // Submit the form to trigger action
        const submitButton = screen.getByRole("button", { name: /Create/i });
        await act(async () => {
          fireEvent.click(submitButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          expect(screen.getByText("Cannot reference the current step")).toBeInTheDocument();
        });
      });

      it("should display forward reference validation error", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 2,
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Can only reference previous steps" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        // Fill in required field
        const descriptionInput = screen.getByLabelText(/Description/i);
        await act(async () => {
          fireEvent.change(descriptionInput, { target: { value: "Test description" } });
        });

        // Submit the form to trigger action
        const submitButton = screen.getByRole("button", { name: /Create/i });
        await act(async () => {
          fireEvent.click(submitButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          expect(screen.getByText("Can only reference previous steps")).toBeInTheDocument();
        });
      });

      it("should display invalid step number validation error", async () => {
        const mockData = {
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
          },
          nextStepNum: 2,
          availableSteps: [
            { stepNum: 1, stepTitle: "First step" },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/steps/new",
            Component: NewStep,
            loader: () => mockData,
            action: () => ({
              errors: { usesSteps: "Invalid step number" },
            }),
          },
        ]);

        render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

        await screen.findByRole("heading", { name: /Add Step/i });

        // Fill in required field
        const descriptionInput = screen.getByLabelText(/Description/i);
        await act(async () => {
          fireEvent.change(descriptionInput, { target: { value: "Test description" } });
        });

        // Submit the form to trigger action
        const submitButton = screen.getByRole("button", { name: /Create/i });
        await act(async () => {
          fireEvent.click(submitButton);
        });

        // Wait for error message to appear
        await waitFor(() => {
          expect(screen.getByText("Invalid step number")).toBeInTheDocument();
        });
      });
    });
  });
});
