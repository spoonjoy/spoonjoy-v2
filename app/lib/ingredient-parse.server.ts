/**
 * Ingredient parsing with OpenAI structured outputs.
 *
 * This module provides LLM-powered parsing of natural language ingredient text
 * (e.g., "2 cups flour") into structured data (quantity, unit, ingredient name).
 */

import { z } from 'zod'
import { createOpenAIClient } from '~/lib/openai-client.server'
import { extractOpenAIErrorFields } from '~/lib/openai-error.server'
import { captureLlmCallFailure, captureLlmCallSucceeded } from '~/lib/llm-telemetry.server'
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
  geminiGenerateJson,
} from '~/lib/gemini-text.server'
import type { PostHogServerConfig, PostHogServerEnv } from '~/lib/analytics-server'

export const DEFAULT_INGREDIENT_PARSE_PROVIDER = 'openai'
export const DEFAULT_INGREDIENT_PARSE_MODEL = 'gpt-4o-mini'
export const DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS = 8_000
export const DEFAULT_INGREDIENT_PARSE_MAX_RETRIES = 1

export type IngredientParseProvider = typeof DEFAULT_INGREDIENT_PARSE_PROVIDER

export interface IngredientParserEnv extends PostHogServerEnv {
  OPENAI_API_KEY?: string
  INGREDIENT_PARSE_PROVIDER?: string
  INGREDIENT_PARSE_MODEL?: string
  INGREDIENT_PARSE_TIMEOUT_MS?: string
  INGREDIENT_PARSE_MAX_RETRIES?: string
  GOOGLE_API_KEY?: string
  GEMINI_TEXT_MODEL?: string
  GEMINI_TEXT_TIMEOUT_MS?: string
}

/**
 * Optional telemetry context for {@link parseIngredients}. When supplied (and
 * PostHog is configured), LLM-call failures are captured to PostHog with the
 * preserved OpenAI error code/type/status. Callers without analytics wiring can
 * omit it entirely — capture then no-ops.
 */
export interface IngredientParseTelemetry {
  postHogConfig?: PostHogServerConfig
  fetchImpl?: typeof fetch
  distinctId?: string
}

export interface IngredientParserConfig {
  provider: IngredientParseProvider
  apiKey: string
  model: string
  timeoutMs: number
  maxRetries: number
  googleApiKey: string
  geminiModel: string
  geminiTimeoutMs: number
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
 *
 * When the failure originates from OpenAI, the original machine-readable error
 * `code`/`type` and HTTP `status` are preserved (rather than collapsed into the
 * mapped, user-facing message) so out-of-credit (`insufficient_quota`) failures
 * can be told apart from `rate_limit_exceeded` or `model_not_found`.
 */
export class IngredientParseError extends Error {
  readonly code: string | null
  readonly type: string | null
  readonly status: number | null

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'IngredientParseError'
    const fields = extractOpenAIErrorFields(cause)
    this.code = fields.code
    this.type = fields.type
    this.status = fields.status
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
 * Gemini structured-output response schema (OpenAPI subset). Mirrors
 * {@link INGREDIENT_RESPONSE_JSON_SCHEMA} so the Gemini fallback is constrained
 * to the same `{ ingredients: [{ quantity, unit, ingredientName }] }` shape.
 */
const GEMINI_INGREDIENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quantity: { type: 'number' },
          unit: { type: 'string' },
          ingredientName: { type: 'string' },
        },
        required: ['quantity', 'unit', 'ingredientName'],
      },
    },
  },
  required: ['ingredients'],
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
    googleApiKey: resolveNonEmpty(source.GOOGLE_API_KEY, ''),
    geminiModel: resolveNonEmpty(source.GEMINI_TEXT_MODEL, DEFAULT_GEMINI_TEXT_MODEL),
    geminiTimeoutMs: resolveInteger(
      source.GEMINI_TEXT_TIMEOUT_MS,
      DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
      1
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
 * Decide whether a (mapped) OpenAI failure is transient enough to warrant
 * falling through to the Gemini fallback.
 *
 * Retryable: rate limit (429), request timeout (408), and 5xx service failures.
 * NOT retryable: auth failures (401/403) — a bad/absent OpenAI key won't be
 * fixed by re-asking; and parse/refusal/empty/schema/generic errors (which carry
 * no `status`) — those are not provider outages, so the fallback can't help.
 *
 * For transport-level failures the OpenAI SDK reports without an HTTP status
 * (timeouts, dropped connections), we fall back when the mapped message names a
 * known transient transport condition.
 */
export function isRetryableForFallback(error: IngredientParseError): boolean {
  if (error.status !== null) {
    return error.status === 429 || error.status === 408 || error.status >= 500
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection') ||
    message.includes('network') ||
    message.includes('temporary service failure')
  )
}

/**
 * Parse natural language ingredient text into structured data using the configured provider.
 *
 * @param text - The ingredient text to parse (e.g., "2 cups flour" or multiple lines)
 * @param configInput - The OpenAI API key string or ingredient parser env/config values
 * @param telemetry - Optional analytics context; when supplied, LLM-call
 *   failures are captured to PostHog with the preserved OpenAI error code.
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
  configInput?: IngredientParserConfigInput,
  telemetry?: IngredientParseTelemetry
): Promise<ParsedIngredient[]> {
  const config = resolveIngredientParserConfig(configInput)

  if (!config.apiKey) {
    throw new IngredientParseError('OpenAI API key is required')
  }

  const env = getConfigSource(configInput)

  const startedAt = Date.now()
  try {
    const ingredients = await parseWithOpenAI(text, config)
    await reportIngredientParseSuccess(env, config, 'openai', Date.now() - startedAt, telemetry)
    return ingredients
  } catch (error) {
    const mapped = error instanceof IngredientParseError ? error : mapOpenAIError(error)

    await reportIngredientParseFailure(env, config, 'openai', mapped, telemetry)

    if (config.googleApiKey && isRetryableForFallback(mapped)) {
      const geminiStartedAt = Date.now()
      try {
        const ingredients = await parseWithGemini(text, config)
        await reportIngredientParseSuccess(
          env,
          config,
          'gemini',
          Date.now() - geminiStartedAt,
          telemetry
        )
        return ingredients
      } catch (geminiError) {
        const geminiMapped =
          geminiError instanceof IngredientParseError
            ? geminiError
            : new IngredientParseError('Gemini fallback failed', geminiError)

        await reportIngredientParseFailure(env, config, 'gemini', geminiMapped, telemetry)
      }
    }

    throw mapped
  }
}

/**
 * Call the primary provider (OpenAI structured outputs), parse, and validate the
 * response. Throws {@link IngredientParseError} for an empty/refused/malformed
 * response and lets raw provider errors propagate (the caller maps them).
 */
async function parseWithOpenAI(
  text: string,
  config: IngredientParserConfig
): Promise<ParsedIngredient[]> {
  const openai = createOpenAIClient({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  })

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
}

/**
 * Call the Gemini fallback provider, parse, and validate the response against
 * the same {@link ParsedIngredientsResponseSchema} as the primary path. Throws
 * {@link IngredientParseError} on invalid JSON or a schema mismatch; the raw
 * {@link import('~/lib/gemini-text.server').GeminiTextError} for transport /
 * API / empty-content failures propagates to the caller.
 */
async function parseWithGemini(
  text: string,
  config: IngredientParserConfig
): Promise<ParsedIngredient[]> {
  const raw = await geminiGenerateJson({
    config: {
      apiKey: config.googleApiKey,
      model: config.geminiModel,
      timeoutMs: config.geminiTimeoutMs,
    },
    systemPrompt: SYSTEM_PROMPT,
    userText: text,
    responseSchema: GEMINI_INGREDIENT_RESPONSE_SCHEMA,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (jsonError) {
    throw new IngredientParseError('Invalid JSON in Gemini response', jsonError)
  }

  const result = ParsedIngredientsResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new IngredientParseError(
      'Gemini response does not match expected schema',
      result.error
    )
  }

  return result.data.ingredients
}

/**
 * Capture a successful ingredient-parse LLM call to PostHog with privacy-safe
 * metadata only (operation/provider/model/durationMs — never the parsed text or
 * response). Never throws — telemetry must not turn a successful parse into a
 * failure.
 */
async function reportIngredientParseSuccess(
  env: IngredientParserEnv,
  config: IngredientParserConfig,
  provider: string,
  durationMs: number,
  telemetry: IngredientParseTelemetry | undefined
): Promise<void> {
  await captureLlmCallSucceeded({
    env,
    postHogConfig: telemetry?.postHogConfig,
    fetchImpl: telemetry?.fetchImpl,
    distinctId: telemetry?.distinctId,
    operation: 'ingredient_parse',
    provider,
    model: provider === 'gemini' ? config.geminiModel : config.model,
    durationMs,
  })
}

/**
 * Capture an ingredient-parse failure to PostHog with the preserved OpenAI
 * error code/type/status. Never throws — telemetry must not mask the original
 * parse failure (which is re-thrown by the caller).
 */
async function reportIngredientParseFailure(
  env: IngredientParserEnv,
  config: IngredientParserConfig,
  provider: string,
  error: IngredientParseError,
  telemetry: IngredientParseTelemetry | undefined
): Promise<void> {
  await captureLlmCallFailure({
    env,
    postHogConfig: telemetry?.postHogConfig,
    fetchImpl: telemetry?.fetchImpl,
    distinctId: telemetry?.distinctId,
    operation: 'ingredient_parse',
    provider,
    model: provider === 'gemini' ? config.geminiModel : config.model,
    errorCode: error.code,
    errorType: error.type,
    errorStatus: error.status,
    errorMessage: error.message,
  })
}
