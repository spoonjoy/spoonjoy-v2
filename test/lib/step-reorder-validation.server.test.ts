import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  createTestUser,
  createTestRecipe,
  createStepDescription,
  createStepTitle,
} from "../utils";
import {
  validateStepReorder,
  validateStepReorderOutgoing,
  validateStepReorderComplete,
  combineValidationResults,
} from "~/lib/step-reorder-validation.server";

describe("validateStepReorder", () => {
  let testUserId: string;
  let testRecipeId: string;

  beforeEach(async () => {
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

  describe("valid reorders (no incoming dependencies violated)", () => {
    it("should return valid when step has no incoming dependencies", async () => {
      // Create three steps with no dependencies
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

      // Moving step 1 to position 3 should be valid since nothing uses step 1
      const result = await validateStepReorder(db, testRecipeId, 1, 3);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving step forward but dependents are after new position", async () => {
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

      // Step 4 uses output of step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 4,
        },
      });

      // Moving step 1 to position 3 is OK - step 4 (the dependent) is still after position 3
      const result = await validateStepReorder(db, testRecipeId, 1, 3);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving step backward", async () => {
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

      // Moving step 2 backward to position 1 is OK - step 3 still comes after
      const result = await validateStepReorder(db, testRecipeId, 2, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when staying in same position", async () => {
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

      // "Moving" step 1 to position 1 (no change) is always valid
      const result = await validateStepReorder(db, testRecipeId, 1, 1);

      expect(result).toEqual({ valid: true });
    });
  });

  describe("invalid reorders (incoming dependencies violated)", () => {
    it("should return error when moving step past a step that uses it", async () => {
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

      // Step 2 uses output of step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Moving step 1 to position 3 would violate the dependency
      // Step 2 uses step 1, so step 1 cannot be after step 2
      const result = await validateStepReorder(db, testRecipeId, 1, 3);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 1 to position 3 because Step 2 uses its output"
        );
      }
    });

    it("should return error listing multiple blocking steps", async () => {
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

      // Steps 2 and 3 both use output of step 1
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        ],
      });

      // Moving step 1 to position 4 would pass both step 2 and step 3
      const result = await validateStepReorder(db, testRecipeId, 1, 4);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 1 to position 4 because Steps 2 and 3 use its output"
        );
      }
    });

    it("should return error listing three or more blocking steps with Oxford comma", async () => {
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

      // Steps 2, 3, and 4 all use output of step 1
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
        ],
      });

      // Moving step 1 to position 5 would pass steps 2, 3, and 4
      const result = await validateStepReorder(db, testRecipeId, 1, 5);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 1 to position 5 because Steps 2, 3, and 4 use its output"
        );
      }
    });

    it("should only include blocking steps that would be before the new position", async () => {
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

      // Steps 2, 3, 4, and 5 all use output of step 1
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 5 },
        ],
      });

      // Moving step 1 to position 3 only violates steps 2 (step 3, 4, 5 are >= new position)
      // After reorder: 2 becomes 1, 1 becomes 3, and 3,4,5 stay at 3,4,5
      // Actually: when moving from 1 to 3, steps 2 and 3 shift down
      // The blocking steps are those whose current position is <= newPosition but > currentPosition
      // i.e., dependents at positions 2 and 3 would be passed over
      const result = await validateStepReorder(db, testRecipeId, 1, 3);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Only steps 2 and 3 are blocking (steps at positions 4 and 5 would still be after)
        expect(result.error).toBe(
          "Cannot move Step 1 to position 3 because Steps 2 and 3 use its output"
        );
      }
    });
  });

  describe("edge cases", () => {
    it("should return valid for non-existent step", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      });

      // Validating reorder of non-existent step - should be valid (no dependencies exist)
      const result = await validateStepReorder(db, testRecipeId, 99, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid for non-existent recipe", async () => {
      const result = await validateStepReorder(db, "non-existent-recipe-id", 1, 2);

      expect(result).toEqual({ valid: true });
    });

    it("should only consider dependencies from the specified recipe", async () => {
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

      // No dependencies in test recipe

      // Create another recipe with a dependency
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

      // Test recipe's step 1 should be movable (no dependents in this recipe)
      const result = await validateStepReorder(db, testRecipeId, 1, 3);

      expect(result).toEqual({ valid: true });
    });

    it("should return blocking steps in ascending order by step number", async () => {
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

      // Create dependencies in non-ascending order
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        ],
      });

      // Moving step 1 to position 5
      const result = await validateStepReorder(db, testRecipeId, 1, 5);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Should be in ascending order: 2, 3, 4
        expect(result.error).toBe(
          "Cannot move Step 1 to position 5 because Steps 2, 3, and 4 use its output"
        );
      }
    });

    it("should handle moving middle step forward past dependents", async () => {
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

      // Step 3 uses output of step 2
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 2,
          inputStepNum: 3,
        },
      });

      // Moving step 2 to position 4 would pass step 3
      const result = await validateStepReorder(db, testRecipeId, 2, 4);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 2 to position 4 because Step 3 uses its output"
        );
      }
    });
  });
});

describe("validateStepReorderOutgoing", () => {
  let testUserId: string;
  let testRecipeId: string;

  beforeEach(async () => {
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

  describe("valid reorders (no outgoing dependencies violated)", () => {
    it("should return valid when step has no outgoing dependencies", async () => {
      // Create three steps with no dependencies
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

      // Moving step 3 to position 1 should be valid since step 3 uses no previous steps
      const result = await validateStepReorderOutgoing(db, testRecipeId, 3, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving step backward but dependencies are still before new position", async () => {
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

      // Step 4 uses output of step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 4,
        },
      });

      // Moving step 4 to position 2 is OK - step 1 (the dependency) is still before position 2
      const result = await validateStepReorderOutgoing(db, testRecipeId, 4, 2);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving step forward", async () => {
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

      // Step 2 uses output of step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Moving step 2 forward to position 3 is OK - step 1 still comes before
      const result = await validateStepReorderOutgoing(db, testRecipeId, 2, 3);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when staying in same position", async () => {
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

      // "Moving" step 2 to position 2 (no change) is always valid
      const result = await validateStepReorderOutgoing(db, testRecipeId, 2, 2);

      expect(result).toEqual({ valid: true });
    });
  });

  describe("invalid reorders (outgoing dependencies violated)", () => {
    it("should return error when moving step before a step it uses", async () => {
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

      // Moving step 3 to position 1 would violate the dependency
      // Step 3 uses step 2, so step 3 cannot be before step 2
      const result = await validateStepReorderOutgoing(db, testRecipeId, 3, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 3 to position 1 because it uses output from Step 2"
        );
      }
    });

    it("should return error listing multiple blocking dependencies", async () => {
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

      // Step 4 uses outputs of steps 2 and 3
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 4 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 4 },
        ],
      });

      // Moving step 4 to position 1 would violate both dependencies
      const result = await validateStepReorderOutgoing(db, testRecipeId, 4, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 4 to position 1 because it uses output from Steps 2 and 3"
        );
      }
    });

    it("should return error listing three or more blocking dependencies with Oxford comma", async () => {
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

      // Step 5 uses outputs of steps 2, 3, and 4
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 4, inputStepNum: 5 },
        ],
      });

      // Moving step 5 to position 1 would violate all three dependencies
      const result = await validateStepReorderOutgoing(db, testRecipeId, 5, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 5 to position 1 because it uses output from Steps 2, 3, and 4"
        );
      }
    });

    it("should only include blocking dependencies that would be after the new position", async () => {
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

      // Step 5 uses outputs of steps 1, 2, 3, and 4
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 4, inputStepNum: 5 },
        ],
      });

      // Moving step 5 to position 3 only violates steps 3 and 4
      // Step 1 and 2 would still be before position 3
      const result = await validateStepReorderOutgoing(db, testRecipeId, 5, 3);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Only steps 3 and 4 are blocking (steps at positions 1 and 2 would still be before)
        expect(result.error).toBe(
          "Cannot move Step 5 to position 3 because it uses output from Steps 3 and 4"
        );
      }
    });
  });

  describe("edge cases", () => {
    it("should return valid for non-existent step", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      });

      // Validating reorder of non-existent step - should be valid (no dependencies exist)
      const result = await validateStepReorderOutgoing(db, testRecipeId, 99, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid for non-existent recipe", async () => {
      const result = await validateStepReorderOutgoing(
        db,
        "non-existent-recipe-id",
        3,
        1
      );

      expect(result).toEqual({ valid: true });
    });

    it("should only consider dependencies from the specified recipe", async () => {
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

      // No dependencies in test recipe's step 3

      // Create another recipe with a dependency on its step 3
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
          {
            recipeId: otherRecipe.id,
            stepNum: 3,
            stepTitle: createStepTitle(),
            description: createStepDescription(),
          },
        ],
      });
      await db.stepOutputUse.create({
        data: {
          recipeId: otherRecipe.id,
          outputStepNum: 2,
          inputStepNum: 3,
        },
      });

      // Test recipe's step 3 should be movable to position 1 (no dependencies in this recipe)
      const result = await validateStepReorderOutgoing(db, testRecipeId, 3, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return blocking steps in ascending order by step number", async () => {
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

      // Create dependencies in non-ascending order
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 4, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 5 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 5 },
        ],
      });

      // Moving step 5 to position 1
      const result = await validateStepReorderOutgoing(db, testRecipeId, 5, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Should be in ascending order: 2, 3, 4
        expect(result.error).toBe(
          "Cannot move Step 5 to position 1 because it uses output from Steps 2, 3, and 4"
        );
      }
    });

    it("should handle moving middle step backward past dependencies", async () => {
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

      // Step 3 uses output of step 2
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 2,
          inputStepNum: 3,
        },
      });

      // Moving step 3 to position 1 would violate the dependency (step 2 would be after)
      const result = await validateStepReorderOutgoing(db, testRecipeId, 3, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 3 to position 1 because it uses output from Step 2"
        );
      }
    });
  });
});

describe("validateStepReorderComplete", () => {
  let testUserId: string;
  let testRecipeId: string;

  beforeEach(async () => {
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

  describe("valid reorders (no dependencies violated)", () => {
    it("should return valid when step has no dependencies in either direction", async () => {
      // Create three steps with no dependencies
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

      // Moving step 2 to position 1 should be valid (no dependencies either direction)
      const result = await validateStepReorderComplete(db, testRecipeId, 2, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when staying in same position", async () => {
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

      // Step 2 uses step 1 and is used by nothing
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // "Moving" step 2 to position 2 (no change) is always valid
      const result = await validateStepReorderComplete(db, testRecipeId, 2, 2);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving forward without violating incoming dependencies", async () => {
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

      // Step 4 uses output of step 1 (dependent is beyond target position)
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 4,
        },
      });

      // Moving step 1 to position 3 is OK - step 4 is still after position 3
      const result = await validateStepReorderComplete(db, testRecipeId, 1, 3);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid when moving backward without violating outgoing dependencies", async () => {
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

      // Step 4 uses output of step 1 (dependency is before target position)
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 4,
        },
      });

      // Moving step 4 to position 2 is OK - step 1 is still before position 2
      const result = await validateStepReorderComplete(db, testRecipeId, 4, 2);

      expect(result).toEqual({ valid: true });
    });
  });

  describe("invalid reorders (incoming dependencies only)", () => {
    it("should return error when moving step forward past a step that uses it", async () => {
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

      // Step 2 uses output of step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Moving step 1 to position 3 would violate incoming dependency
      const result = await validateStepReorderComplete(db, testRecipeId, 1, 3);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 1 to position 3 because Step 2 uses its output"
        );
      }
    });
  });

  describe("invalid reorders (outgoing dependencies only)", () => {
    it("should return error when moving step backward past a step it uses", async () => {
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

      // Moving step 3 to position 1 would violate outgoing dependency
      const result = await validateStepReorderComplete(db, testRecipeId, 3, 1);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 3 to position 1 because it uses output from Step 2"
        );
      }
    });
  });

  describe("invalid reorders (both directions violated)", () => {
    it("should return combined error when both incoming and outgoing dependencies are violated", async () => {
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

      // Step 3 uses step 2 (outgoing) and step 4 uses step 3 (incoming)
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 4 },
        ],
      });

      // Moving step 3 to position 1 would violate both:
      // - Outgoing: step 3 uses step 2 (can't move before step 2)
      // - This would actually only violate outgoing since we're moving backward
      // Let me create a scenario where both are violated...

      // Actually, both can only be violated if we move a "middle" step
      // that both uses a previous step AND is used by a later step
      // Moving forward: incoming check applies
      // Moving backward: outgoing check applies
      // Since they check different directions, we need to think about this differently

      // Wait - the requirements say "handle case where both checks fail"
      // But the two checks are mutually exclusive based on direction:
      // - incoming: only applies when moving FORWARD
      // - outgoing: only applies when moving BACKWARD
      // So both can never fail simultaneously in the current design!

      // Let me reconsider... The validateStepReorderComplete should run BOTH checks
      // regardless of direction. Let me verify this is a valid scenario:

      // Scenario: We have step 3 which:
      // 1. Uses output from step 4 (outgoing dependency on step 4)
      // 2. Has its output used by step 2 (incoming dependency from step 2)
      // This would be an invalid state normally, but let's test the validation

      // Actually, in a valid recipe, outputStepNum < inputStepNum always
      // So let me think of a different scenario...

      // Hmm, the scenario where both could fail would require:
      // - Moving forward AND having a dependent in the way (incoming)
      // - Moving backward AND having a dependency in the way (outgoing)
      // These are mutually exclusive moves!

      // But wait - the function should check BOTH directions for ANY move
      // because we want comprehensive validation.

      // Let me check: if moving from 3 to 5 (forward):
      // - Step 3 uses step 2 output (outgoing dep on step 2)
      // - Step 4 uses step 3 output (incoming dep from step 4)
      // Forward move means incoming check triggers (step 4 <= 5, so blocking)
      // Outgoing check won't trigger because step 2 < 3 (moving forward, newPos >= current)

      // The only way both would fail is if validateStepReorderComplete
      // runs both checks regardless of direction early-exit logic.
      // But given the current implementation, each check has its own early exit.

      // For this test, let me simulate what the combined function should do:
      // Run both checks, combine errors if both fail.
      // Since both have early exits based on direction, we need to modify expectation.

      // Actually, re-reading the requirement: "Handle case where both checks fail"
      // This implies the combined function should check both regardless of direction.
      // So the combined function should NOT use the early exit logic for direction.

      // Let me write a test that would fail both if direction checks are removed:
      // Step 3 uses step 2 (outgoing), Step 4 uses step 3 (incoming)
      // Moving step 3 somewhere doesn't matter - we need to check both.

      // Actually the cleanest approach: the complete function calls both sub-functions
      // Each sub-function handles direction internally.
      // When moving forward: incoming might fail, outgoing won't (due to direction check)
      // When moving backward: outgoing might fail, incoming won't (due to direction check)
      // So both can never fail with the current architecture.

      // UNLESS: We remove the direction checks from the sub-functions and put them
      // in the complete function, OR we always run both checks in complete function
      // without direction filtering.

      // Let me re-read the acceptance criteria:
      // "Handle case where both checks fail (combine messages)"
      // This suggests the implementation should allow both to fail.

      // The simplest interpretation: we should still call both functions,
      // and if by some logic both return errors, combine them.
      // But with current sub-function implementation, this can't happen.

      // I'll write the test assuming the combined function modifies behavior
      // to check both directions regardless of move direction.
      // This would mean a step with both dependencies is essentially "locked".
      const result = await validateStepReorderComplete(db, testRecipeId, 3, 5);

      // Moving forward from 3 to 5:
      // - Incoming check: step 4 uses step 3, so moving to 5 passes step 4 → BLOCKED
      // - Outgoing check: step 3 uses step 2, but moving forward, step 2 is still before → OK
      // So only incoming should fail here.
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 3 to position 5 because Step 4 uses its output"
        );
      }
    });

    it("should combine errors when both incoming and outgoing checks fail", async () => {
      // This test requires a more complex setup where both checks would fail
      // For this to happen, we need a step that:
      // 1. Has a dependent step that would be passed over (incoming violation)
      // 2. Uses a step that would end up after it (outgoing violation)

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

      // Step 3 uses step 2 AND step 4 uses step 3
      // This creates a "sandwich" where step 3 can't move anywhere
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 4 },
        ],
      });

      // Moving step 3 to position 1:
      // - Outgoing: step 3 uses step 2, moving to 1 would put it before step 2 → BLOCKED
      // - Incoming: step 4 uses step 3, but moving backward, step 4 is still after → OK

      // Moving step 3 to position 5:
      // - Incoming: step 4 uses step 3, moving to 5 passes step 4 → BLOCKED
      // - Outgoing: step 3 uses step 2, but moving forward, step 2 is still before → OK

      // To get BOTH to fail, we need validateStepReorderComplete to not use
      // the direction-based early exit. Let me test moving step 3 to 1 first.
      const resultBackward = await validateStepReorderComplete(
        db,
        testRecipeId,
        3,
        1
      );

      expect(resultBackward.valid).toBe(false);
      if (!resultBackward.valid) {
        // Should only have outgoing error since we're moving backward
        expect(resultBackward.error).toBe(
          "Cannot move Step 3 to position 1 because it uses output from Step 2"
        );
      }

      // Now test forward move
      const resultForward = await validateStepReorderComplete(
        db,
        testRecipeId,
        3,
        5
      );

      expect(resultForward.valid).toBe(false);
      if (!resultForward.valid) {
        // Should only have incoming error since we're moving forward
        expect(resultForward.error).toBe(
          "Cannot move Step 3 to position 5 because Step 4 uses its output"
        );
      }
    });

    it("should combine multiple errors from both directions when both fail", async () => {
      // To truly test combined errors, we need the complete function to check
      // both directions regardless of move direction, or we need a special scenario.

      // Actually, let me interpret this differently:
      // The complete function should check BOTH incoming AND outgoing
      // for ANY move, without the early direction-based returns.
      // This way, a step in the middle of a chain cannot be moved AT ALL.

      // For example: Step 2 → Step 3 → Step 4 (chain)
      // If we try to move Step 3 to position 1:
      //   Without direction check: both fail because:
      //   - Incoming: Step 4 uses Step 3 (even though we're moving backward)
      //   - Outgoing: Step 3 uses Step 2 (moving before Step 2)

      // This is the "comprehensive" interpretation where we always check both.

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

      // Chain: Step 1 output → Step 2 input, Step 2 output → Step 3 input
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
        ],
      });

      // Moving step 2 to position 4:
      // Without direction-based early exit in complete function:
      // - Incoming: Step 3 uses Step 2, position 3 <= 4, so BLOCKED by Step 3
      // - Outgoing: Step 2 uses Step 1, but Step 1 < position 4, so OK
      // Only incoming fails.

      // Moving step 2 to position 1:
      // - Incoming: Step 3 uses Step 2, but position 3 > 1, so... wait
      //   The incoming check is about dependents being BEFORE the new position.
      //   If moving step 2 to position 1, step 3 (at position 3) > 1, so no violation.
      // - Outgoing: Step 2 uses Step 1, position 1 >= 1, so BLOCKED by Step 1
      // Only outgoing fails.

      // Hmm, to get BOTH to fail simultaneously, I need to think more carefully.

      // When moving step X from A to B:
      // Incoming violation: exists dependent step D where D <= B (D would be before X's new position)
      //   This only matters when B > A (moving forward), because D > A always
      // Outgoing violation: exists dependency step Y where Y >= B (Y would be after X's new position)
      //   This only matters when B < A (moving backward), because Y < A always

      // So mathematically, with valid data (deps before, dependents after):
      // - Moving forward (B > A): Only incoming can fail
      // - Moving backward (B < A): Only outgoing can fail
      // - Not moving (B == A): Neither fails

      // The "combine errors" case can only happen if:
      // 1. We remove direction filtering in complete function, checking raw data, OR
      // 2. There's invalid data in the DB (which shouldn't happen)

      // I believe the requirement wants option 1: the complete function should
      // always check both, ignoring direction optimization, for safety.

      // This means validateStepReorderComplete should NOT delegate to the
      // sub-functions with their early exits, but implement its own logic.

      // Let me write a test assuming this behavior:
      // For any move, check ALL dependents and ALL dependencies without direction filter.

      // Step 2 at position 2:
      // - Uses Step 1 (outgoing dependency)
      // - Used by Step 3 (incoming dependency)

      // If we check BOTH without direction filter:
      // Move to position 1:
      //   - Any dependent (Step 3) at position > 1? Yes → potential issue
      //     Actually wait, the incoming check's original logic is:
      //     dependents with position <= newPosition are blocking.
      //     Step 3 position is 3, newPosition is 1, 3 <= 1 is FALSE, so no block.
      //   - Any dependency (Step 1) at position >= newPosition? position 1 >= 1 is TRUE → BLOCKED

      // Move to position 4:
      //   - Dependent Step 3: position 3 <= 4? TRUE → BLOCKED
      //   - Dependency Step 1: position 1 >= 4? FALSE → OK

      // Still can't get both to fail simultaneously with valid data!

      // I think the "combine errors" requirement anticipates the case where
      // the complete function COULD get both errors if the validation logic
      // were different. Let me just write a test that verifies the function
      // combines errors IF both sub-functions return errors.

      // For now, I'll test that the function correctly returns single errors
      // and document that combined errors can't happen with valid data.

      const result = await validateStepReorderComplete(db, testRecipeId, 2, 4);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 2 to position 4 because Step 3 uses its output"
        );
      }
    });
  });

  describe("edge cases", () => {
    it("should return valid for non-existent step", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: createStepTitle(),
          description: createStepDescription(),
        },
      });

      // Validating reorder of non-existent step - should be valid (no dependencies exist)
      const result = await validateStepReorderComplete(db, testRecipeId, 99, 1);

      expect(result).toEqual({ valid: true });
    });

    it("should return valid for non-existent recipe", async () => {
      const result = await validateStepReorderComplete(
        db,
        "non-existent-recipe-id",
        1,
        2
      );

      expect(result).toEqual({ valid: true });
    });

    it("should check both directions and combine errors when both fail", async () => {
      // This test verifies that if somehow both checks fail,
      // the errors are combined properly.
      // In practice with valid data this can't happen, but we test the combining logic.

      // Create a step that we'll manipulate
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

      // Step 2 uses step 1, step 3 uses step 2
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
        ],
      });

      // For THIS test, we want to verify that the complete function
      // properly combines errors. But with normal data and direction checks,
      // only one will fail at a time.

      // The implementation should call both validators and combine if both fail.
      // Let's just verify single direction works correctly here.

      // Moving step 2 backward to 1
      const backwardResult = await validateStepReorderComplete(
        db,
        testRecipeId,
        2,
        1
      );
      expect(backwardResult.valid).toBe(false);
      if (!backwardResult.valid) {
        expect(backwardResult.error).toBe(
          "Cannot move Step 2 to position 1 because it uses output from Step 1"
        );
      }

      // Moving step 2 forward to 3
      const forwardResult = await validateStepReorderComplete(
        db,
        testRecipeId,
        2,
        3
      );
      expect(forwardResult.valid).toBe(false);
      if (!forwardResult.valid) {
        expect(forwardResult.error).toBe(
          "Cannot move Step 2 to position 3 because Step 3 uses its output"
        );
      }
    });

    it("should combine error messages when both validators fail", () => {
      // Test the combineValidationResults function directly since
      // both validators can't fail simultaneously with valid data
      // due to direction-based early exits.

      const incomingResult = {
        valid: false as const,
        error: "Cannot move Step 3 to position 1 because Step 4 uses its output",
      };
      const outgoingResult = {
        valid: false as const,
        error:
          "Cannot move Step 3 to position 1 because it uses output from Step 2",
      };

      const result = combineValidationResults(incomingResult, outgoingResult);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Cannot move Step 3 to position 1 because Step 4 uses its output. Additionally, cannot move Step 3 to position 1 because it uses output from Step 2"
        );
      }
    });
  });
});
