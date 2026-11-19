import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { getOrCreateUnit, getOrCreateIngredientRef, createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("RecipeStep Model", () => {
  let testUserId: string;
  let testRecipeId: string;

  beforeEach(async () => {
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

  describe("create", () => {
    it("should create a step with required fields", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Mix ingredients",
        },
      });

      expect(step).toBeDefined();
      expect(step.stepNum).toBe(1);
      expect(step.description).toBe("Mix ingredients");
      expect(step.stepTitle).toBeNull();
    });

    it("should create a step with optional title", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: "Preparation",
          description: "Prepare ingredients",
        },
      });

      expect(step.stepTitle).toBe("Preparation");
    });

    it("should enforce unique stepNum per recipe", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });

      await expect(
        db.recipeStep.create({
          data: {
            recipeId: testRecipeId,
            stepNum: 1,
            description: "Duplicate Step 1",
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("read", () => {
    it("should find steps by recipe ordered by stepNum", async () => {
      await db.recipeStep.createMany({
        data: [
          { recipeId: testRecipeId, stepNum: 2, description: "Second" },
          { recipeId: testRecipeId, stepNum: 1, description: "First" },
          { recipeId: testRecipeId, stepNum: 3, description: "Third" },
        ],
      });

      const steps = await db.recipeStep.findMany({
        where: { recipeId: testRecipeId },
        orderBy: { stepNum: "asc" },
      });

      expect(steps).toHaveLength(3);
      expect(steps[0].description).toBe("First");
      expect(steps[1].description).toBe("Second");
      expect(steps[2].description).toBe("Third");
    });

    it("should include ingredients in step query", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Mix",
        },
      });

      const unit = await getOrCreateUnit(db, "cup");

      const ingredientRef = await getOrCreateIngredientRef(db, "flour");

      await db.ingredient.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const foundStep = await db.recipeStep.findUnique({
        where: { id: step.id },
        include: { ingredients: true },
      });

      expect(foundStep?.ingredients).toHaveLength(1);
      expect(foundStep?.ingredients[0].quantity).toBe(2);
    });
  });

  describe("update", () => {
    it("should update step fields", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Original",
        },
      });

      const updated = await db.recipeStep.update({
        where: { id: step.id },
        data: {
          stepTitle: "New Title",
          description: "Updated description",
        },
      });

      expect(updated.stepTitle).toBe("New Title");
      expect(updated.description).toBe("Updated description");
    });

    it("should update stepNum for reordering", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step",
        },
      });

      const updated = await db.recipeStep.update({
        where: { id: step.id },
        data: { stepNum: 2 },
      });

      expect(updated.stepNum).toBe(2);
    });
  });

  describe("delete", () => {
    it("should delete step", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "To delete",
        },
      });

      await db.recipeStep.delete({
        where: { id: step.id },
      });

      const found = await db.recipeStep.findUnique({
        where: { id: step.id },
      });

      expect(found).toBeNull();
    });

    it("should cascade delete ingredients when step is deleted", async () => {
      const step = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step with ingredients",
        },
      });

      const unit = await getOrCreateUnit(db, "cup");

      const ingredientRef = await getOrCreateIngredientRef(db, "flour");

      await db.ingredient.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      await db.recipeStep.delete({
        where: { id: step.id },
      });

      const ingredients = await db.ingredient.findMany({
        where: { recipeId: testRecipeId, stepNum: 1 },
      });

      expect(ingredients).toHaveLength(0);
    });

    it("should cascade delete StepOutputUse records where step is outputStepNum", async () => {
      const step1 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1 - outputs used by step 2",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2 - uses step 1's output",
        },
      });

      // Step 2 uses output from step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Verify record exists
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(beforeCount).toBe(1);

      // Delete step 1 (the output step)
      await db.recipeStep.delete({
        where: { id: step1.id },
      });

      // StepOutputUse record should be cascade deleted
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(afterCount).toBe(0);
    });

    it("should cascade delete StepOutputUse records where step is inputStepNum", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1 - its output is used",
        },
      });
      const step2 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2 - consumer of step 1's output",
        },
      });

      // Step 2 uses output from step 1
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Verify record exists
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(beforeCount).toBe(1);

      // Delete step 2 (the input step)
      await db.recipeStep.delete({
        where: { id: step2.id },
      });

      // StepOutputUse record should be cascade deleted
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(afterCount).toBe(0);
    });

    it("should cascade delete multiple StepOutputUse records when step is deleted", async () => {
      const step1 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1 - used by steps 2, 3, and 4",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 3,
          description: "Step 3",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 4,
          description: "Step 4",
        },
      });

      // Steps 2, 3, and 4 all use output from step 1
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
        ],
      });

      // Verify records exist
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(beforeCount).toBe(3);

      // Delete step 1 (the output step)
      await db.recipeStep.delete({
        where: { id: step1.id },
      });

      // All StepOutputUse records should be cascade deleted
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(afterCount).toBe(0);
    });

    it("should cascade delete only related StepOutputUse records when step is deleted", async () => {
      const step1 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 3,
          description: "Step 3",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 4,
          description: "Step 4",
        },
      });

      // Step 2 uses step 1, step 4 uses step 3
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 4 },
        ],
      });

      // Verify records exist
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(beforeCount).toBe(2);

      // Delete step 1 (should only affect step 2's dependency)
      await db.recipeStep.delete({
        where: { id: step1.id },
      });

      // Only the step 1->2 record should be deleted; step 3->4 should remain
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(afterCount).toBe(1);

      // Verify the remaining record is the step 3->4 dependency
      const remaining = await db.stepOutputUse.findFirst({
        where: { recipeId: testRecipeId },
      });
      expect(remaining?.outputStepNum).toBe(3);
      expect(remaining?.inputStepNum).toBe(4);
    });

    it("should cascade delete StepOutputUse records in both directions when step is deleted", async () => {
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1",
        },
      });
      const step2 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2 - uses step 1, used by step 3",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 3,
          description: "Step 3",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 4,
          description: "Step 4",
        },
      });

      // Step 2 uses step 1 (step 2 is inputStepNum)
      // Step 3 uses step 2 (step 2 is outputStepNum)
      // Step 4 uses step 1 (unrelated, should not be affected)
      await db.stepOutputUse.createMany({
        data: [
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
          { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
          { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
        ],
      });

      // Verify records exist
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(beforeCount).toBe(3);

      // Delete step 2 (the middle step - both consumer and producer)
      await db.recipeStep.delete({
        where: { id: step2.id },
      });

      // Step 2's relationships should be deleted (1->2 and 2->3)
      // Only 1->4 should remain
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(afterCount).toBe(1);

      const remaining = await db.stepOutputUse.findFirst({
        where: { recipeId: testRecipeId },
      });
      expect(remaining?.outputStepNum).toBe(1);
      expect(remaining?.inputStepNum).toBe(4);
    });

    it("should not affect StepOutputUse records in other recipes when step is deleted", async () => {
      const otherRecipe = await db.recipe.create({
        data: createTestRecipe(testUserId),
      });

      // Create steps in both recipes
      const step1 = await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 1,
          description: "Step 1 in test recipe",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: testRecipeId,
          stepNum: 2,
          description: "Step 2 in test recipe",
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId: otherRecipe.id,
          stepNum: 1,
          description: "Step 1 in other recipe",
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: otherRecipe.id,
          stepNum: 2,
          description: "Step 2 in other recipe",
        },
      });

      // Create StepOutputUse in both recipes
      await db.stepOutputUse.create({
        data: {
          recipeId: testRecipeId,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });
      await db.stepOutputUse.create({
        data: {
          recipeId: otherRecipe.id,
          outputStepNum: 1,
          inputStepNum: 2,
        },
      });

      // Verify records exist in both recipes
      const testRecipeBeforeCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      const otherRecipeBeforeCount = await db.stepOutputUse.count({
        where: { recipeId: otherRecipe.id },
      });
      expect(testRecipeBeforeCount).toBe(1);
      expect(otherRecipeBeforeCount).toBe(1);

      // Delete step 1 in test recipe
      await db.recipeStep.delete({
        where: { id: step1.id },
      });

      // Test recipe's StepOutputUse should be deleted
      const testRecipeAfterCount = await db.stepOutputUse.count({
        where: { recipeId: testRecipeId },
      });
      expect(testRecipeAfterCount).toBe(0);

      // Other recipe's StepOutputUse should still exist
      const otherRecipeAfterCount = await db.stepOutputUse.count({
        where: { recipeId: otherRecipe.id },
      });
      expect(otherRecipeAfterCount).toBe(1);
    });
  });
});
