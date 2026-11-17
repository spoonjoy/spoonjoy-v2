import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import type { PrismaClient } from "@prisma/client";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, createTestRecipe, createStepDescription, createStepTitle } from "../utils";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";

describe("validateStepDeletion", () => {
  let testUserId: string;
  let testRecipeId: string;
  let db: PrismaClient;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();

    const user = await db.user.create({
      data: createTestUser(),
    });
    testUserId = user.id;

    const recipe = await db.recipe.create({
      data: createTestRecipe(testUserId),
    });
    testRecipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("should return valid when step has no dependents", async () => {
    // Create a single step with no dependents
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result).toEqual({ valid: true });
  });

  it("should return valid when step has no dependents but other steps exist", async () => {
    // Create three steps, where step 2 uses step 1 but step 3 has no dependents
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Step 2 uses step 1
    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    // Step 3 has no dependents, so it can be deleted
    const result = await validateStepDeletion(db, testRecipeId, 3);

    expect(result).toEqual({ valid: true });
  });

  it("should return error when step is used by one other step", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Step 2 uses output of step 1
    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Cannot delete Step 1 because it is used by Step 2");
    }
  });

  it("should return error listing multiple dependent steps in order", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 4,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Steps 2, 3, and 4 all use output of step 1
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
      ],
    });

    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Cannot delete Step 1 because it is used by Steps 2, 3, and 4");
    }
  });

  it("should return error with two dependent steps using 'and' format", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Steps 2 and 3 use output of step 1
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
      ],
    });

    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Cannot delete Step 1 because it is used by Steps 2 and 3");
    }
  });

  it("should return valid for non-existent step", async () => {
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    // Query for a step that doesn't exist - should return valid since no dependents
    const result = await validateStepDeletion(db, testRecipeId, 99);

    expect(result).toEqual({ valid: true });
  });

  it("should return valid for non-existent recipe", async () => {
    const result = await validateStepDeletion(db, "non-existent-recipe-id", 1);

    expect(result).toEqual({ valid: true });
  });

  it("should only consider dependents from the specified recipe", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // No step output use in test recipe

    // Create another recipe with the same step structure and a dependency
    const otherRecipe = await db.recipe.create({
      data: createTestRecipe(testUserId),
    });
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: otherRecipe.id,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: otherRecipe.id,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });
    await db.stepOutputUse.create({
      data: {
        recipeId: otherRecipe.id,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    // Test recipe's step 1 should be deletable (no dependents in this recipe)
    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result).toEqual({ valid: true });
  });

  it("should handle step in the middle being used by later steps", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Step 3 uses output of step 2
    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 2,
        inputStepNum: 3,
      },
    });

    const result = await validateStepDeletion(db, testRecipeId, 2);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Cannot delete Step 2 because it is used by Step 3");
    }
  });

  it("should return dependents in ascending order by step number", async () => {
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 4,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 5,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      ],
    });

    // Steps 5, 3, and 4 use step 1 (created in non-ascending order)
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 5 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
      ],
    });

    const result = await validateStepDeletion(db, testRecipeId, 1);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should be ordered by step number: 3, 4, 5
      expect(result.error).toBe("Cannot delete Step 1 because it is used by Steps 3, 4, and 5");
    }
  });
});
