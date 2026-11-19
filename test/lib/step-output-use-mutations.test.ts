import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";
import { createUser } from "~/lib/auth.server";
import {
  deleteExistingStepOutputUses,
  createStepOutputUses,
} from "~/lib/step-output-use-mutations.server";

describe("step-output-use-mutations", () => {
  let testUserId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;

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

  describe("deleteExistingStepOutputUses", () => {
    it("should delete all StepOutputUse records for a specific step (inputStepNum)", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 3, description: "Step 3" },
      });

      // Step 3 uses outputs from step 1 and step 2
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 3 },
      });
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 2, inputStepNum: 3 },
      });

      // Verify records exist
      const beforeCount = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(beforeCount).toBe(2);

      await deleteExistingStepOutputUses(db, recipeId, 3);

      // Verify all records were deleted
      const afterCount = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(afterCount).toBe(0);
    });

    it("should return the count of deleted records", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 3, description: "Step 3" },
      });

      // Step 3 uses outputs from step 1 and step 2
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 3 },
      });
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 2, inputStepNum: 3 },
      });

      // Delete and verify count returned
      const result = await deleteExistingStepOutputUses(db, recipeId, 3);

      expect(result.count).toBe(2);
    });

    it("should handle case where no records exist gracefully", async () => {
      // Create step 1 (no step output uses)
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });

      // Delete should work without errors and return count of 0
      const result = await deleteExistingStepOutputUses(db, recipeId, 1);

      expect(result.count).toBe(0);
    });

    it("should not delete StepOutputUse records for other steps", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 3, description: "Step 3" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 4, description: "Step 4" },
      });

      // Step 2 uses output from step 1
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 2 },
      });

      // Step 3 uses output from step 1
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 3 },
      });

      // Step 4 uses output from step 2
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 2, inputStepNum: 4 },
      });

      // Delete only step 3's uses
      await deleteExistingStepOutputUses(db, recipeId, 3);

      // Verify step 2 still has its record
      const step2Uses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(step2Uses).toBe(1);

      // Verify step 4 still has its record
      const step4Uses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 4 },
      });
      expect(step4Uses).toBe(1);

      // Verify step 3's record is gone
      const step3Uses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 3 },
      });
      expect(step3Uses).toBe(0);
    });

    it("should not delete StepOutputUse records from other recipes", async () => {
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      // Create steps in both recipes
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });

      await db.recipeStep.create({
        data: { recipeId: otherRecipe.id, stepNum: 1, description: "Other Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId: otherRecipe.id, stepNum: 2, description: "Other Step 2" },
      });

      // Step 2 in first recipe uses step 1's output
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 2 },
      });

      // Step 2 in other recipe uses step 1's output
      await db.stepOutputUse.create({
        data: { recipeId: otherRecipe.id, outputStepNum: 1, inputStepNum: 2 },
      });

      // Delete step 2's uses in first recipe only
      await deleteExistingStepOutputUses(db, recipeId, 2);

      // Verify first recipe's record is gone
      const firstRecipeUses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(firstRecipeUses).toBe(0);

      // Verify other recipe's record still exists
      const otherRecipeUses = await db.stepOutputUse.count({
        where: { recipeId: otherRecipe.id, inputStepNum: 2 },
      });
      expect(otherRecipeUses).toBe(1);
    });

    it("should delete single StepOutputUse record when step uses only one previous step", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });

      // Step 2 uses only step 1's output
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 2 },
      });

      const result = await deleteExistingStepOutputUses(db, recipeId, 2);

      expect(result.count).toBe(1);

      const remaining = await db.stepOutputUse.count({ where: { recipeId } });
      expect(remaining).toBe(0);
    });

    it("should delete multiple StepOutputUse records when step uses many previous steps", async () => {
      // Create steps 1 through 5
      for (let i = 1; i <= 5; i++) {
        await db.recipeStep.create({
          data: { recipeId, stepNum: i, description: `Step ${i}` },
        });
      }

      // Step 5 uses outputs from steps 1, 2, 3, and 4
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 5 },
      });
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 2, inputStepNum: 5 },
      });
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 3, inputStepNum: 5 },
      });
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 4, inputStepNum: 5 },
      });

      const result = await deleteExistingStepOutputUses(db, recipeId, 5);

      expect(result.count).toBe(4);

      const remaining = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 5 },
      });
      expect(remaining).toBe(0);
    });
  });

  describe("createStepOutputUses", () => {
    it("should create StepOutputUse records for each outputStepNum in array", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 3, description: "Step 3" },
      });

      // Step 3 uses outputs from step 1 and step 2
      const result = await createStepOutputUses(db, recipeId, 3, [1, 2]);

      expect(result.count).toBe(2);

      // Verify records were created
      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });

      expect(records.length).toBe(2);
      expect(records[0].outputStepNum).toBe(1);
      expect(records[1].outputStepNum).toBe(2);
    });

    it("should return count of 0 when outputStepNums array is empty", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });

      // Create with empty array (no dependencies)
      const result = await createStepOutputUses(db, recipeId, 1, []);

      expect(result.count).toBe(0);

      // Verify no records were created
      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 1 },
      });
      expect(records.length).toBe(0);
    });

    it("should create single StepOutputUse record when array has one element", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });

      // Step 2 uses only step 1's output
      const result = await createStepOutputUses(db, recipeId, 2, [1]);

      expect(result.count).toBe(1);

      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 2 },
      });

      expect(records.length).toBe(1);
      expect(records[0].outputStepNum).toBe(1);
      expect(records[0].recipeId).toBe(recipeId);
    });

    it("should deduplicate outputStepNums before creating records", async () => {
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 3, description: "Step 3" },
      });

      const result = await createStepOutputUses(db, recipeId, 3, [1, 1, 2, 2]);
      expect(result.count).toBe(2);

      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 3 },
        orderBy: { outputStepNum: "asc" },
      });
      expect(records.map((record) => record.outputStepNum)).toEqual([1, 2]);
    });

    it("should create records with correct recipeId and inputStepNum", async () => {
      for (let i = 1; i <= 4; i++) {
        await db.recipeStep.create({
          data: { recipeId, stepNum: i, description: `Step ${i}` },
        });
      }

      // Step 4 uses outputs from steps 1 and 3
      await createStepOutputUses(db, recipeId, 4, [1, 3]);

      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 4 },
      });

      // Verify all records have correct recipeId and inputStepNum
      for (const record of records) {
        expect(record.recipeId).toBe(recipeId);
        expect(record.inputStepNum).toBe(4);
      }
    });

    it("should create multiple records for step using many previous steps", async () => {
      // Create steps 1 through 5
      for (let i = 1; i <= 5; i++) {
        await db.recipeStep.create({
          data: { recipeId, stepNum: i, description: `Step ${i}` },
        });
      }

      // Step 5 uses outputs from steps 1, 2, 3, and 4
      const result = await createStepOutputUses(db, recipeId, 5, [1, 2, 3, 4]);

      expect(result.count).toBe(4);

      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 5 },
        orderBy: { outputStepNum: "asc" },
      });

      expect(records.length).toBe(4);
      expect(records.map((r) => r.outputStepNum)).toEqual([1, 2, 3, 4]);
    });

    it("should not affect StepOutputUse records for other steps", async () => {
      for (let i = 1; i <= 4; i++) {
        await db.recipeStep.create({
          data: { recipeId, stepNum: i, description: `Step ${i}` },
        });
      }

      // Step 2 already uses step 1
      await db.stepOutputUse.create({
        data: { recipeId, outputStepNum: 1, inputStepNum: 2 },
      });

      await createStepOutputUses(db, recipeId, 4, [1, 3]);

      // Verify step 2's record is still there
      const step2Uses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(step2Uses).toBe(1);

      // Verify step 4 has its records
      const step4Uses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 4 },
      });
      expect(step4Uses).toBe(2);
    });

    it("should not affect StepOutputUse records for other recipes", async () => {
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      // Create steps in both recipes
      await db.recipeStep.create({
        data: { recipeId, stepNum: 1, description: "Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId, stepNum: 2, description: "Step 2" },
      });

      await db.recipeStep.create({
        data: { recipeId: otherRecipe.id, stepNum: 1, description: "Other Step 1" },
      });
      await db.recipeStep.create({
        data: { recipeId: otherRecipe.id, stepNum: 2, description: "Other Step 2" },
      });

      // Other recipe step 2 uses step 1
      await db.stepOutputUse.create({
        data: { recipeId: otherRecipe.id, outputStepNum: 1, inputStepNum: 2 },
      });

      await createStepOutputUses(db, recipeId, 2, [1]);

      // Verify other recipe's record is still there
      const otherRecipeUses = await db.stepOutputUse.count({
        where: { recipeId: otherRecipe.id, inputStepNum: 2 },
      });
      expect(otherRecipeUses).toBe(1);

      // Verify first recipe has its record
      const firstRecipeUses = await db.stepOutputUse.count({
        where: { recipeId, inputStepNum: 2 },
      });
      expect(firstRecipeUses).toBe(1);
    });

    it("should handle non-consecutive outputStepNums correctly", async () => {
      // Create steps 1 through 6
      for (let i = 1; i <= 6; i++) {
        await db.recipeStep.create({
          data: { recipeId, stepNum: i, description: `Step ${i}` },
        });
      }

      // Step 6 uses outputs from steps 1, 3, and 5 (non-consecutive)
      const result = await createStepOutputUses(db, recipeId, 6, [1, 3, 5]);

      expect(result.count).toBe(3);

      const records = await db.stepOutputUse.findMany({
        where: { recipeId, inputStepNum: 6 },
        orderBy: { outputStepNum: "asc" },
      });

      expect(records.map((r) => r.outputStepNum)).toEqual([1, 3, 5]);
    });
  });
});
