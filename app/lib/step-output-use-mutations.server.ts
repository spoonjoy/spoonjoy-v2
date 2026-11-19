import type { PrismaClient } from "@prisma/client";

/**
 * Delete all existing StepOutputUse records for a step when updating it.
 * Uses recipeId + inputStepNum as key (where inputStepNum = current step being edited).
 *
 * @param db - The Prisma client instance
 * @param recipeId - The ID of the recipe containing the step
 * @param inputStepNum - The step number being edited (the consumer step)
 * @returns Object with count of deleted records
 */
export async function deleteExistingStepOutputUses(
  db: PrismaClient,
  recipeId: string,
  inputStepNum: number
): Promise<{ count: number }> {
  const result = await db.stepOutputUse.deleteMany({
    where: {
      recipeId,
      inputStepNum,
    },
  });

  return { count: result.count };
}

/**
 * Create StepOutputUse records for a step when updating it.
 * Creates one record for each outputStepNum that the current step uses.
 *
 * @param db - The Prisma client instance
 * @param recipeId - The ID of the recipe containing the step
 * @param inputStepNum - The step number being edited (the consumer step)
 * @param outputStepNums - Array of step numbers whose outputs this step uses
 * @returns Object with count of created records
 */
export async function createStepOutputUses(
  db: PrismaClient,
  recipeId: string,
  inputStepNum: number,
  outputStepNums: number[]
): Promise<{ count: number }> {
  const uniqueOutputStepNums = [...new Set(outputStepNums)];

  if (uniqueOutputStepNums.length === 0) {
    return { count: 0 };
  }

  const result = await db.stepOutputUse.createMany({
    data: uniqueOutputStepNums.map((outputStepNum) => ({
      recipeId,
      inputStepNum,
      outputStepNum,
    })),
  });

  return { count: result.count };
}
