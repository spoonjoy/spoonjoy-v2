/**
 * Validation constants and utility functions for recipe CRUD operations.
 * These can be used on both client and server.
 */

// Field length limits
export const TITLE_MAX_LENGTH = 200
export const DESCRIPTION_MAX_LENGTH = 2000
export const STEP_DESCRIPTION_MAX_LENGTH = 5000
export const STEP_TITLE_MAX_LENGTH = 200
export const SERVINGS_MAX_LENGTH = 100
export const UNIT_NAME_MAX_LENGTH = 50
export const INGREDIENT_NAME_MAX_LENGTH = 100

// Quantity range limits
export const QUANTITY_MIN = 0.001
export const QUANTITY_MAX = 99999

import { containsObjectionableContent, OBJECTIONABLE_CONTENT_MESSAGE } from './objectionable-terms'

// Validation result type
export type ValidationResult = { valid: true } | { valid: false; error: string }

/**
 * Validates a recipe title.
 * - Required (non-empty after trimming)
 * - Max 200 characters
 */
export function validateTitle(title: string): ValidationResult {
  const trimmed = title.trim()
  if (!trimmed) {
    return { valid: false, error: 'Title is required' }
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { valid: false, error: 'Title must be 200 characters or less' }
  }
  if (containsObjectionableContent(trimmed)) {
    return { valid: false, error: OBJECTIONABLE_CONTENT_MESSAGE }
  }
  return { valid: true }
}

/**
 * Validates a recipe description.
 * - Optional (null/empty allowed)
 * - Max 2000 characters
 */
export function validateDescription(description: string | null): ValidationResult {
  if (!description) {
    return { valid: true }
  }
  const trimmed = description.trim()
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    return { valid: false, error: 'Description must be 2,000 characters or less' }
  }
  if (containsObjectionableContent(trimmed)) {
    return { valid: false, error: OBJECTIONABLE_CONTENT_MESSAGE }
  }
  return { valid: true }
}

/**
 * Validates a step title.
 * - Optional (null/empty allowed)
 * - Max 200 characters
 */
export function validateStepTitle(stepTitle: string | null): ValidationResult {
  if (!stepTitle) {
    return { valid: true }
  }
  const trimmed = stepTitle.trim()
  if (trimmed.length > STEP_TITLE_MAX_LENGTH) {
    return { valid: false, error: 'Step title must be 200 characters or less' }
  }
  if (containsObjectionableContent(trimmed)) {
    return { valid: false, error: OBJECTIONABLE_CONTENT_MESSAGE }
  }
  return { valid: true }
}

/**
 * Validates a step description.
 * - Required (non-empty after trimming)
 * - Max 5000 characters
 */
export function validateStepDescription(description: string): ValidationResult {
  const trimmed = description.trim()
  if (!trimmed) {
    return { valid: false, error: 'Step description is required' }
  }
  if (trimmed.length > STEP_DESCRIPTION_MAX_LENGTH) {
    return { valid: false, error: 'Description must be 5,000 characters or less' }
  }
  if (containsObjectionableContent(trimmed)) {
    return { valid: false, error: OBJECTIONABLE_CONTENT_MESSAGE }
  }
  return { valid: true }
}

/**
 * Validates a servings field.
 * - Optional (null/empty allowed)
 * - Max 100 characters
 */
export function validateServings(servings: string | null): ValidationResult {
  if (!servings) {
    return { valid: true }
  }
  const trimmed = servings.trim()
  if (trimmed.length > SERVINGS_MAX_LENGTH) {
    return { valid: false, error: 'Servings must be 100 characters or less' }
  }
  return { valid: true }
}

/**
 * Validates an ingredient quantity.
 * - Required
 * - Must be a valid finite number
 * - Min 0.001, Max 99999
 */
export function validateQuantity(quantity: number): ValidationResult {
  if (!Number.isFinite(quantity)) {
    return { valid: false, error: 'Quantity must be a valid number' }
  }
  if (quantity < QUANTITY_MIN || quantity > QUANTITY_MAX) {
    return { valid: false, error: 'Quantity must be between 0.001 and 99,999' }
  }
  return { valid: true }
}

/**
 * Validates a unit name.
 * - Required (non-empty after trimming)
 * - Max 50 characters
 */
export function validateUnitName(unitName: string): ValidationResult {
  const trimmed = unitName.trim()
  if (!trimmed) {
    return { valid: false, error: 'Unit name is required' }
  }
  if (trimmed.length > UNIT_NAME_MAX_LENGTH) {
    return { valid: false, error: 'Unit name must be 50 characters or less' }
  }
  return { valid: true }
}

/**
 * Validates an ingredient name.
 * - Required (non-empty after trimming)
 * - Max 100 characters
 */
export function validateIngredientName(ingredientName: string): ValidationResult {
  const trimmed = ingredientName.trim()
  if (!trimmed) {
    return { valid: false, error: 'Ingredient name is required' }
  }
  if (trimmed.length > INGREDIENT_NAME_MAX_LENGTH) {
    return { valid: false, error: 'Ingredient name must be 100 characters or less' }
  }
  return { valid: true }
}

/**
 * Validates an image URL.
 * - Optional (null/empty allowed)
 * - Must be a valid HTTP or HTTPS URL if provided
 */
export function validateImageUrl(url: string | null): ValidationResult {
  if (!url) {
    return { valid: true }
  }
  const trimmed = url.trim()
  if (!trimmed) {
    return { valid: true }
  }
  try {
    const parsed = new URL(trimmed)
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Please enter a valid URL' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Please enter a valid URL' }
  }
}

/**
 * Validates a step reference (step output use).
 * Enforces that steps can only reference previous steps.
 * - outputStepNum: the step producing the output (must be a previous step)
 * - inputStepNum: the step using the output (current step)
 * - Both must be positive integers
 * - outputStepNum must be less than inputStepNum (previous steps only)
 */
export function validateStepReference(
  outputStepNum: number,
  inputStepNum: number
): ValidationResult {
  // Validate both step numbers are positive integers
  if (
    !Number.isInteger(outputStepNum) ||
    !Number.isInteger(inputStepNum) ||
    outputStepNum < 1 ||
    inputStepNum < 1
  ) {
    return { valid: false, error: 'Invalid step number' }
  }

  // Check for self-reference
  if (outputStepNum === inputStepNum) {
    return { valid: false, error: 'Cannot reference the current step' }
  }

  // Check for forward reference (can only reference previous steps)
  if (outputStepNum > inputStepNum) {
    return { valid: false, error: 'Can only reference previous steps' }
  }

  return { valid: true }
}
