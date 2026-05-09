import type { PrismaClient } from "@prisma/client";
import {
  checkStepUsage,
  loadStepDependencies,
} from "~/lib/step-output-use-queries.server";
import type { ValidationResult } from "~/lib/validation";

/**
 * Validates whether a step can be safely reordered to a new position.
 * A step cannot be moved past steps that depend on its output (incoming dependencies).
 *
 * When moving a step from currentStepNum to newPosition:
 * - If moving forward (newPosition > currentStepNum), check if any dependents
 *   would end up before the step's new position
 * - If moving backward or staying in place, always valid (for incoming dependencies)
 *
 * @param recipeId - The ID of the recipe containing the step
 * @param currentStepNum - The current step number being moved
 * @param newPosition - The target position for the step
 * @returns ValidationResult - { valid: true } if reorder is allowed, { valid: false, error: string } if not
 */
export async function validateStepReorder(
  db: PrismaClient,
  recipeId: string,
  currentStepNum: number,
  newPosition: number
): Promise<ValidationResult> {
  // If not moving forward, no incoming dependency violations are possible
  if (newPosition <= currentStepNum) {
    return { valid: true };
  }

  // Get all steps that use this step's output (incoming dependencies)
  const dependentSteps = await checkStepUsage(db, recipeId, currentStepNum);

  if (dependentSteps.length === 0) {
    return { valid: true };
  }

  // Find dependents that would be "passed over" by the move
  // These are dependents whose current position is between the current position and new position
  // i.e., currentStepNum < dependentStepNum <= newPosition
  const blockingSteps = dependentSteps
    .filter((dep) => dep.inputStepNum <= newPosition)
    .map((dep) => dep.inputStepNum)
    .sort((a, b) => a - b);

  if (blockingSteps.length === 0) {
    return { valid: true };
  }

  const error = formatBlockingStepsError(
    currentStepNum,
    newPosition,
    blockingSteps
  );

  return { valid: false, error };
}

/**
 * Formats an error message for blocking steps (incoming dependencies).
 * - 1 blocking: "Cannot move Step X to position Y because Step Z uses its output"
 * - 2 blocking: "Cannot move Step X to position Y because Steps Z and W use its output"
 * - 3+ blocking: "Cannot move Step X to position Y because Steps Z, W, and V use its output"
 */
function formatBlockingStepsError(
  stepNum: number,
  newPosition: number,
  blockingStepNums: number[]
): string {
  const prefix = `Cannot move Step ${stepNum} to position ${newPosition} because`;

  if (blockingStepNums.length === 1) {
    return `${prefix} Step ${blockingStepNums[0]} uses its output`;
  }

  if (blockingStepNums.length === 2) {
    return `${prefix} Steps ${blockingStepNums[0]} and ${blockingStepNums[1]} use its output`;
  }

  // 3 or more: use Oxford comma format
  const allButLast = blockingStepNums.slice(0, -1).join(", ");
  const last = blockingStepNums[blockingStepNums.length - 1];
  return `${prefix} Steps ${allButLast}, and ${last} use its output`;
}

/**
 * Validates whether a step can be safely reordered to a new position
 * based on outgoing dependencies (steps that THIS step uses).
 *
 * A step cannot be moved before the steps whose output it uses.
 *
 * When moving a step from currentStepNum to newPosition:
 * - If moving backward (newPosition < currentStepNum), check if any dependencies
 *   would end up after the step's new position
 * - If moving forward or staying in place, always valid (for outgoing dependencies)
 *
 * @param recipeId - The ID of the recipe containing the step
 * @param currentStepNum - The current step number being moved
 * @param newPosition - The target position for the step
 * @returns ValidationResult - { valid: true } if reorder is allowed, { valid: false, error: string } if not
 */
export async function validateStepReorderOutgoing(
  db: PrismaClient,
  recipeId: string,
  currentStepNum: number,
  newPosition: number
): Promise<ValidationResult> {
  // If not moving backward, no outgoing dependency violations are possible
  if (newPosition >= currentStepNum) {
    return { valid: true };
  }

  // Get all steps that this step uses (outgoing dependencies)
  const dependencies = await loadStepDependencies(db, recipeId, currentStepNum);

  if (dependencies.length === 0) {
    return { valid: true };
  }

  // Find dependencies that would be "passed over" by the move
  // These are dependencies whose current position is >= newPosition
  // i.e., newPosition <= dependencyStepNum < currentStepNum
  const blockingSteps = dependencies
    .filter((dep) => dep.outputStepNum >= newPosition)
    .map((dep) => dep.outputStepNum)
    .sort((a, b) => a - b);

  if (blockingSteps.length === 0) {
    return { valid: true };
  }

  const error = formatBlockingDependenciesError(
    currentStepNum,
    newPosition,
    blockingSteps
  );

  return { valid: false, error };
}

/**
 * Formats an error message for blocking dependencies (outgoing dependencies).
 * - 1 blocking: "Cannot move Step X to position Y because it uses output from Step Z"
 * - 2 blocking: "Cannot move Step X to position Y because it uses output from Steps Z and W"
 * - 3+ blocking: "Cannot move Step X to position Y because it uses output from Steps Z, W, and V"
 */
function formatBlockingDependenciesError(
  stepNum: number,
  newPosition: number,
  blockingStepNums: number[]
): string {
  const prefix = `Cannot move Step ${stepNum} to position ${newPosition} because it uses output from`;

  if (blockingStepNums.length === 1) {
    return `${prefix} Step ${blockingStepNums[0]}`;
  }

  if (blockingStepNums.length === 2) {
    return `${prefix} Steps ${blockingStepNums[0]} and ${blockingStepNums[1]}`;
  }

  // 3 or more: use Oxford comma format
  const allButLast = blockingStepNums.slice(0, -1).join(", ");
  const last = blockingStepNums[blockingStepNums.length - 1];
  return `${prefix} Steps ${allButLast}, and ${last}`;
}

/**
 * Combines two validation results into a single result.
 * - If both valid, returns valid
 * - If one invalid, returns that one
 * - If both invalid, combines error messages
 */
export function combineValidationResults(
  incomingResult: ValidationResult,
  outgoingResult: ValidationResult
): ValidationResult {
  // If both are valid, return valid
  if (incomingResult.valid && outgoingResult.valid) {
    return { valid: true };
  }

  // If only incoming failed
  if (!incomingResult.valid && outgoingResult.valid) {
    return incomingResult;
  }

  // If only outgoing failed
  if (incomingResult.valid && !outgoingResult.valid) {
    return outgoingResult;
  }

  const incomingError = incomingResult as { valid: false; error: string };
  const outgoingError = outgoingResult as { valid: false; error: string };
  const formattedOutgoingError = `${outgoingError.error.charAt(0).toLowerCase()}${outgoingError.error.slice(1)}`;
  return {
    valid: false,
    error: `${incomingError.error}. Additionally, ${formattedOutgoingError}`,
  };
}

/**
 * Validates whether a step can be safely reordered to a new position.
 * This is the complete validation that checks both directions:
 * - Incoming dependencies (steps that use this step's output)
 * - Outgoing dependencies (steps whose output this step uses)
 *
 * @param recipeId - The ID of the recipe containing the step
 * @param currentStepNum - The current step number being moved
 * @param newPosition - The target position for the step
 * @returns ValidationResult - { valid: true } if reorder is allowed, { valid: false, error: string } if not
 */
export async function validateStepReorderComplete(
  db: PrismaClient,
  recipeId: string,
  currentStepNum: number,
  newPosition: number
): Promise<ValidationResult> {
  // Run both validations
  const [incomingResult, outgoingResult] = await Promise.all([
    validateStepReorder(db, recipeId, currentStepNum, newPosition),
    validateStepReorderOutgoing(db, recipeId, currentStepNum, newPosition),
  ]);

  return combineValidationResults(incomingResult, outgoingResult);
}
