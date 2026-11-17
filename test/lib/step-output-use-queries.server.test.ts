import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, createTestRecipe, createStepDescription, createStepTitle } from "../utils";
import { loadRecipeStepOutputUses, loadStepDependencies, checkStepUsage } from "~/lib/step-output-use-queries.server";

describe("loadRecipeStepOutputUses", () => {
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

  it("should return empty array when recipe has no steps", async () => {
    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toEqual([]);
  });

  it("should return empty array when recipe has steps but no step output uses", async () => {
    // Create two steps without any step output uses
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

    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toEqual([]);
  });

  it("should return step output uses with step details", async () => {
    const step1Title = createStepTitle();
    const step2Title = createStepTitle();
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: step1Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: step2Title,
          description: createStepDescription(),
        },
      ],
    });

    // Create a step output use: step 2 uses output of step 1
    const stepOutputUse = await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(stepOutputUse.id);
    expect(result[0].recipeId).toBe(testRecipeId);
    expect(result[0].outputStepNum).toBe(1);
    expect(result[0].inputStepNum).toBe(2);
    expect(result[0].outputOfStep).toEqual({
      stepNum: 1,
      stepTitle: step1Title,
    });
  });

  it("should include outputOfStep with null stepTitle when step has no title", async () => {
    // Create steps (step 1 has no title)
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: null,
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

    // Create step output use: step 2 uses output of step 1
    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toHaveLength(1);
    expect(result[0].outputOfStep).toEqual({
      stepNum: 1,
      stepTitle: null,
    });
  });

  it("should return multiple step output uses ordered by inputStepNum then outputStepNum", async () => {
    const step1Title = createStepTitle();
    const step2Title = createStepTitle();
    const step3Title = createStepTitle();
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: step1Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: step2Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: step3Title,
          description: createStepDescription(),
        },
      ],
    });

    // Create step output uses:
    // - Step 3 uses output of step 1
    // - Step 3 uses output of step 2
    // - Step 2 uses output of step 1
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
      ],
    });

    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toHaveLength(3);
    // Ordered by inputStepNum ascending, then outputStepNum ascending
    expect(result[0].inputStepNum).toBe(2);
    expect(result[0].outputStepNum).toBe(1);
    expect(result[1].inputStepNum).toBe(3);
    expect(result[1].outputStepNum).toBe(1);
    expect(result[2].inputStepNum).toBe(3);
    expect(result[2].outputStepNum).toBe(2);
  });

  it("should only return step output uses for the specified recipe", async () => {
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

    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    // Create another recipe with steps and step output use
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

    const result = await loadRecipeStepOutputUses(db, testRecipeId);

    expect(result).toHaveLength(1);
    expect(result[0].recipeId).toBe(testRecipeId);
  });

  it("should return empty array for non-existent recipe", async () => {
    const result = await loadRecipeStepOutputUses(db, "non-existent-recipe-id");

    expect(result).toEqual([]);
  });
});

describe("loadStepDependencies", () => {
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

  it("should return empty array when step has no dependencies", async () => {
    // Create a single step with no dependencies
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    const result = await loadStepDependencies(db, testRecipeId, 1);

    expect(result).toEqual([]);
  });

  it("should return dependencies for a step that uses other steps", async () => {
    const step1Title = createStepTitle();
    const step2Title = createStepTitle();
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: step1Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: step2Title,
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

    // Step 3 uses outputs of step 1 and step 2
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
      ],
    });

    const result = await loadStepDependencies(db, testRecipeId, 3);

    expect(result).toHaveLength(2);
    // Should be ordered by outputStepNum ascending
    expect(result[0].outputStepNum).toBe(1);
    expect(result[0].stepTitle).toBe(step1Title);
    expect(result[1].outputStepNum).toBe(2);
    expect(result[1].stepTitle).toBe(step2Title);
  });

  it("should return dependency with null stepTitle when source step has no title", async () => {
    // Create two steps (step 1 has no title)
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: null,
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

    const result = await loadStepDependencies(db, testRecipeId, 2);

    expect(result).toHaveLength(1);
    expect(result[0].outputStepNum).toBe(1);
    expect(result[0].stepTitle).toBeNull();
  });

  it("should only return dependencies for the specified step, not other steps", async () => {
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

    // Step 2 uses step 1, Step 3 uses step 1 and step 2
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
      ],
    });

    // Query for step 2's dependencies (should only get step 1)
    const result = await loadStepDependencies(db, testRecipeId, 2);

    expect(result).toHaveLength(1);
    expect(result[0].outputStepNum).toBe(1);
  });

  it("should return empty array for non-existent step", async () => {
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    // Query for a step that doesn't exist
    const result = await loadStepDependencies(db, testRecipeId, 99);

    expect(result).toEqual([]);
  });

  it("should return empty array for non-existent recipe", async () => {
    const result = await loadStepDependencies(db, "non-existent-recipe-id", 1);

    expect(result).toEqual([]);
  });

  it("should only return dependencies from the specified recipe", async () => {
    const step1Title = createStepTitle();
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: step1Title,
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

    // Step 2 uses step 1
    await db.stepOutputUse.create({
      data: {
        recipeId: testRecipeId,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    // Create another recipe with the same step structure
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

    // Query for test recipe's step 2
    const result = await loadStepDependencies(db, testRecipeId, 2);

    expect(result).toHaveLength(1);
    expect(result[0].stepTitle).toBe(step1Title);
  });

  it("should return dependencies ordered by outputStepNum ascending", async () => {
    const step1Title = createStepTitle();
    const step2Title = createStepTitle();
    const step3Title = createStepTitle();
    await db.recipeStep.createMany({
      data: [
        {
          recipeId: testRecipeId,
          stepNum: 1,
          stepTitle: step1Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 2,
          stepTitle: step2Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: step3Title,
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

    // Step 4 uses step 3, then step 1, then step 2 (created in non-ascending order)
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 3, inputStepNum: 4 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
        { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 4 },
      ],
    });

    const result = await loadStepDependencies(db, testRecipeId, 4);

    expect(result).toHaveLength(3);
    // Should be ordered by outputStepNum ascending regardless of creation order
    expect(result[0].outputStepNum).toBe(1);
    expect(result[0].stepTitle).toBe(step1Title);
    expect(result[1].outputStepNum).toBe(2);
    expect(result[1].stepTitle).toBe(step2Title);
    expect(result[2].outputStepNum).toBe(3);
    expect(result[2].stepTitle).toBe(step3Title);
  });
});

describe("checkStepUsage", () => {
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

  it("should return empty array when step is not used by any other steps", async () => {
    // Create a single step with no dependents
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    const result = await checkStepUsage(db, testRecipeId, 1);

    expect(result).toEqual([]);
  });

  it("should return steps that depend on this step", async () => {
    const step2Title = createStepTitle();
    const step3Title = createStepTitle();
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
          stepTitle: step2Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: step3Title,
          description: createStepDescription(),
        },
      ],
    });

    // Step 2 and step 3 both use output of step 1
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
      ],
    });

    const result = await checkStepUsage(db, testRecipeId, 1);

    expect(result).toHaveLength(2);
    // Should be ordered by inputStepNum ascending
    expect(result[0].inputStepNum).toBe(2);
    expect(result[0].stepTitle).toBe(step2Title);
    expect(result[1].inputStepNum).toBe(3);
    expect(result[1].stepTitle).toBe(step3Title);
  });

  it("should return dependent step with null stepTitle when dependent step has no title", async () => {
    // Create two steps (step 2 has no title)
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
          stepTitle: null,
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

    const result = await checkStepUsage(db, testRecipeId, 1);

    expect(result).toHaveLength(1);
    expect(result[0].inputStepNum).toBe(2);
    expect(result[0].stepTitle).toBeNull();
  });

  it("should only return steps that use the specified step, not other dependencies", async () => {
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

    // Step 2 uses step 1, Step 3 uses step 1 and step 2
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
        { recipeId: testRecipeId, outputStepNum: 2, inputStepNum: 3 },
      ],
    });

    // Query for step 2's dependents (should only get step 3)
    const result = await checkStepUsage(db, testRecipeId, 2);

    expect(result).toHaveLength(1);
    expect(result[0].inputStepNum).toBe(3);
  });

  it("should return empty array for non-existent step", async () => {
    await db.recipeStep.create({
      data: {
        recipeId: testRecipeId,
        stepNum: 1,
        stepTitle: createStepTitle(),
        description: createStepDescription(),
      },
    });

    // Query for a step that doesn't exist
    const result = await checkStepUsage(db, testRecipeId, 99);

    expect(result).toEqual([]);
  });

  it("should return empty array for non-existent recipe", async () => {
    const result = await checkStepUsage(db, "non-existent-recipe-id", 1);

    expect(result).toEqual([]);
  });

  it("should only return dependents from the specified recipe", async () => {
    const step2Title = createStepTitle();
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
          stepTitle: step2Title,
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

    // Create another recipe with the same step structure
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

    // Query for test recipe's step 1 dependents
    const result = await checkStepUsage(db, testRecipeId, 1);

    expect(result).toHaveLength(1);
    expect(result[0].stepTitle).toBe(step2Title);
  });

  it("should return dependents ordered by inputStepNum ascending", async () => {
    const step2Title = createStepTitle();
    const step3Title = createStepTitle();
    const step4Title = createStepTitle();
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
          stepTitle: step2Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 3,
          stepTitle: step3Title,
          description: createStepDescription(),
        },
        {
          recipeId: testRecipeId,
          stepNum: 4,
          stepTitle: step4Title,
          description: createStepDescription(),
        },
      ],
    });

    // Step 4, step 2, step 3 all use step 1 (created in non-ascending order)
    await db.stepOutputUse.createMany({
      data: [
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 4 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 2 },
        { recipeId: testRecipeId, outputStepNum: 1, inputStepNum: 3 },
      ],
    });

    const result = await checkStepUsage(db, testRecipeId, 1);

    expect(result).toHaveLength(3);
    // Should be ordered by inputStepNum ascending regardless of creation order
    expect(result[0].inputStepNum).toBe(2);
    expect(result[0].stepTitle).toBe(step2Title);
    expect(result[1].inputStepNum).toBe(3);
    expect(result[1].stepTitle).toBe(step3Title);
    expect(result[2].inputStepNum).toBe(4);
    expect(result[2].stepTitle).toBe(step4Title);
  });
});
