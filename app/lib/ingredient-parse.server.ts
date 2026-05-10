/**
 * Ingredient parsing with OpenAI structured outputs.
 *
 * This module provides LLM-powered parsing of natural language ingredient text
 * (e.g., "2 cups flour") into structured data (quantity, unit, ingredient name).
 */

import OpenAI from 'openai'
import { z } from 'zod'

export const DEFAULT_INGREDIENT_PARSE_PROVIDER = 'openai'
export const DEFAULT_INGREDIENT_PARSE_MODEL = 'gpt-4o-mini'
export const DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS = 8_000
export const DEFAULT_INGREDIENT_PARSE_MAX_RETRIES = 1

export type IngredientParseProvider = typeof DEFAULT_INGREDIENT_PARSE_PROVIDER

export interface IngredientParserEnv {
  OPENAI_API_KEY?: string
  INGREDIENT_PARSE_PROVIDER?: string
  INGREDIENT_PARSE_MODEL?: string
  INGREDIENT_PARSE_TIMEOUT_MS?: string
  INGREDIENT_PARSE_MAX_RETRIES?: string
}

export interface IngredientParserConfig {
  provider: IngredientParseProvider
  apiKey: string
  model: string
  timeoutMs: number
  maxRetries: number
}

export type IngredientParserConfigInput = string | IngredientParserEnv | undefined

/**
 * Schema for a single parsed ingredient.
 */
export const ParsedIngredientSchema = z.object({
  quantity: z.number().positive(),
  unit: z.string().min(1),
  ingredientName: z.string().min(1),
})

export type ParsedIngredient = z.infer<typeof ParsedIngredientSchema>

/**
 * Schema for the LLM response containing parsed ingredients.
 */
export const ParsedIngredientsResponseSchema = z.object({
  ingredients: z.array(ParsedIngredientSchema),
})

export type ParsedIngredientsResponse = z.infer<typeof ParsedIngredientsResponseSchema>

/**
 * Error thrown when ingredient parsing fails.
 */
export class IngredientParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'IngredientParseError'
  }
}

/**
 * JSON Schema for OpenAI structured outputs.
 * This defines the expected response format for the LLM.
 */
const INGREDIENT_RESPONSE_JSON_SCHEMA = {
  name: 'ingredient_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quantity: {
              type: 'number',
              description: 'The numeric quantity of the ingredient (must be positive)',
            },
            unit: {
              type: 'string',
              description:
                'The unit of measurement (e.g., cup, tbsp, tsp, oz, lb, whole, piece, pinch, dash). Use singular form.',
            },
            ingredientName: {
              type: 'string',
              description:
                'The name of the ingredient, including any modifiers or prep notes (e.g., "extra virgin olive oil", "flour, sifted")',
            },
          },
          required: ['quantity', 'unit', 'ingredientName'],
          additionalProperties: false,
        },
      },
    },
    required: ['ingredients'],
    additionalProperties: false,
  },
} as const

/**
 * System prompt for the ingredient parsing LLM.
 */
const SYSTEM_PROMPT = `You are an expert recipe ingredient parser. Parse natural language ingredient descriptions into structured data.

Rules:
1. Convert fractions to decimals (1/2 → 0.5, 1/4 → 0.25, 3/4 → 0.75, 1 1/2 → 1.5)
2. Convert unicode fractions to decimals (½ → 0.5, ¼ → 0.25, ¾ → 0.75)
3. Use singular unit forms (cups → cup, tablespoons → tbsp, teaspoons → tsp)
4. Standard abbreviations: tbsp, tsp, oz, lb, g, kg, ml, l
5. For countable items without units (e.g., "2 eggs"), use "whole" as the unit
6. For "cloves of garlic", use "clove" as unit and "garlic" as ingredient
7. For "pinch of X" or "dash of X", use quantity=1 with "pinch" or "dash" as unit
8. For ranges like "2-3 cups", use the lower number
9. Ignore approximate words like "about", "approximately"
10. Keep prep notes with the ingredient name (e.g., "flour, sifted", "onion, diced")
11. Keep modifiers with ingredient name (e.g., "extra virgin olive oil", "kosher salt", "dark brown sugar")
12. If input is empty or whitespace-only, return an empty ingredients array

Parse each line or comma-separated ingredient independently.`

function getConfigSource(input: IngredientParserConfigInput): IngredientParserEnv {
  if (typeof input === 'string') {
    return { OPENAI_API_KEY: input }
  }

  return input ?? {}
}

function resolveProvider(provider: string | undefined): IngredientParseProvider {
  const normalized = (provider || DEFAULT_INGREDIENT_PARSE_PROVIDER).trim().toLowerCase()

  if (normalized === DEFAULT_INGREDIENT_PARSE_PROVIDER) {
    return DEFAULT_INGREDIENT_PARSE_PROVIDER
  }

  throw new IngredientParseError(`Unsupported ingredient parser provider: ${provider}`)
}

function resolveNonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

function resolveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    return fallback
  }

  return parsed
}

export function resolveIngredientParserConfig(input?: IngredientParserConfigInput): IngredientParserConfig {
  const source = getConfigSource(input)

  return {
    provider: resolveProvider(source.INGREDIENT_PARSE_PROVIDER),
    apiKey: resolveNonEmpty(source.OPENAI_API_KEY, ''),
    model: resolveNonEmpty(source.INGREDIENT_PARSE_MODEL, DEFAULT_INGREDIENT_PARSE_MODEL),
    timeoutMs: resolveInteger(
      source.INGREDIENT_PARSE_TIMEOUT_MS,
      DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
      1
    ),
    maxRetries: resolveInteger(
      source.INGREDIENT_PARSE_MAX_RETRIES,
      DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
      0
    ),
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined
  }

  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function mapOpenAIError(error: unknown): IngredientParseError {
  const status = getErrorStatus(error)

  if (status === 401 || status === 403) {
    return new IngredientParseError('OpenAI authentication failed', error)
  }

  if (status === 429) {
    return new IngredientParseError('OpenAI rate limit exceeded', error)
  }

  if (status === 408 || (status !== undefined && status >= 500)) {
    return new IngredientParseError('OpenAI request timeout or temporary service failure', error)
  }

  const message = getErrorMessage(error).toLowerCase()
  if (message.includes('timeout') || message.includes('timed out')) {
    return new IngredientParseError('OpenAI request timeout', error)
  }

  if (message.includes('network') || message.includes('connection')) {
    return new IngredientParseError('OpenAI connection failed', error)
  }

  return new IngredientParseError('Failed to parse ingredients', error)
}

/**
 * Parse natural language ingredient text into structured data using the configured provider.
 *
 * @param text - The ingredient text to parse (e.g., "2 cups flour" or multiple lines)
 * @param configInput - The OpenAI API key string or ingredient parser env/config values
 * @returns Array of parsed ingredients
 * @throws IngredientParseError if parsing fails
 *
 * @example
 * ```typescript
 * const ingredients = await parseIngredients("2 cups flour\n1/2 tsp salt", env)
 * // Returns: [
 * //   { quantity: 2, unit: "cup", ingredientName: "flour" },
 * //   { quantity: 0.5, unit: "tsp", ingredientName: "salt" }
 * // ]
 * ```
 */
export async function parseIngredients(
  text: string,
  configInput?: IngredientParserConfigInput
): Promise<ParsedIngredient[]> {
  const config = resolveIngredientParserConfig(configInput)

  if (!config.apiKey) {
    throw new IngredientParseError('OpenAI API key is required')
  }

  const openai = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  })

  try {
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: INGREDIENT_RESPONSE_JSON_SCHEMA,
      },
    })

    const choice = response.choices[0]
    if (!choice) {
      throw new IngredientParseError('No response from OpenAI API')
    }

    const refusal = choice.message.refusal
    if (refusal) {
      throw new IngredientParseError('OpenAI refused to parse this ingredient text')
    }

    const content = choice.message.content
    if (!content) {
      throw new IngredientParseError('Empty response content from OpenAI API')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (jsonError) {
      throw new IngredientParseError('Invalid JSON in OpenAI response', jsonError)
    }

    const result = ParsedIngredientsResponseSchema.safeParse(parsed)
    if (!result.success) {
      throw new IngredientParseError(
        `Response does not match expected schema: ${result.error.message}`,
        result.error
      )
    }

    return result.data.ingredients
  } catch (error) {
    if (error instanceof IngredientParseError) {
      throw error
    }

    throw mapOpenAIError(error)
  }
}
