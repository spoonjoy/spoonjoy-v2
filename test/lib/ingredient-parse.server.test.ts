import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
  DEFAULT_INGREDIENT_PARSE_MODEL,
  DEFAULT_INGREDIENT_PARSE_PROVIDER,
  DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
  isRetryableForFallback,
  parseIngredients,
  ParsedIngredientSchema,
  ParsedIngredientsResponseSchema,
  IngredientParseError,
  resolveIngredientParserConfig,
  type ParsedIngredient,
} from '~/lib/ingredient-parse.server'
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
} from '~/lib/gemini-text.server'

/**
 * Tests for OpenAI ingredient parsing integration using gpt-4o-mini with structured outputs.
 *
 * These tests verify:
 * - Basic ingredient parsing (quantity, unit, ingredient name)
 * - Edge cases: fractions, no unit, compound ingredients, prep notes
 * - Multiple ingredient parsing
 * - Error handling for LLM failures and malformed responses
 */

// Mock the OpenAI SDK
const mockCreate = vi.fn()
const mockConstructorOptions = vi.fn()
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(options: unknown) {
        mockConstructorOptions(options)
      }

      chat = {
        completions: {
          create: mockCreate,
        },
      }
    },
  }
})

describe('Ingredient Parsing', () => {
  const TEST_API_KEY = 'test-openai-api-key'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('ParsedIngredientSchema', () => {
    it('validates a correct parsed ingredient', () => {
      const ingredient = {
        quantity: 2,
        unit: 'cup',
        ingredientName: 'flour',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(ingredient)
      }
    })

    it('rejects ingredient with zero quantity', () => {
      const ingredient = {
        quantity: 0,
        unit: 'cup',
        ingredientName: 'flour',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(false)
    })

    it('rejects ingredient with negative quantity', () => {
      const ingredient = {
        quantity: -1,
        unit: 'cup',
        ingredientName: 'flour',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(false)
    })

    it('rejects ingredient with empty unit', () => {
      const ingredient = {
        quantity: 2,
        unit: '',
        ingredientName: 'flour',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(false)
    })

    it('rejects ingredient with empty ingredient name', () => {
      const ingredient = {
        quantity: 2,
        unit: 'cup',
        ingredientName: '',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(false)
    })

    it('rejects ingredient with non-numeric quantity', () => {
      const ingredient = {
        quantity: 'two',
        unit: 'cup',
        ingredientName: 'flour',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(false)
    })

    it('accepts decimal quantities', () => {
      const ingredient = {
        quantity: 0.5,
        unit: 'cup',
        ingredientName: 'sugar',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(true)
    })

    it('accepts very small quantities', () => {
      const ingredient = {
        quantity: 0.125,
        unit: 'tsp',
        ingredientName: 'salt',
      }

      const result = ParsedIngredientSchema.safeParse(ingredient)
      expect(result.success).toBe(true)
    })
  })

  describe('ParsedIngredientsResponseSchema', () => {
    it('validates a correct response with multiple ingredients', () => {
      const response = {
        ingredients: [
          { quantity: 2, unit: 'cup', ingredientName: 'flour' },
          { quantity: 0.5, unit: 'tsp', ingredientName: 'salt' },
        ],
      }

      const result = ParsedIngredientsResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
    })

    it('validates an empty ingredients array', () => {
      const response = {
        ingredients: [],
      }

      const result = ParsedIngredientsResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
    })

    it('rejects response without ingredients array', () => {
      const response = {}

      const result = ParsedIngredientsResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })

    it('rejects response with invalid ingredient in array', () => {
      const response = {
        ingredients: [
          { quantity: 2, unit: 'cup', ingredientName: 'flour' },
          { quantity: -1, unit: 'cup', ingredientName: 'sugar' },
        ],
      }

      const result = ParsedIngredientsResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })
  })

  describe('IngredientParseError', () => {
    it('creates error with message', () => {
      const error = new IngredientParseError('Parsing failed')
      expect(error.message).toBe('Parsing failed')
      expect(error.name).toBe('IngredientParseError')
    })

    it('creates error with message and cause', () => {
      const cause = new Error('API error')
      const error = new IngredientParseError('Parsing failed', cause)
      expect(error.message).toBe('Parsing failed')
      expect(error.cause).toBe(cause)
    })
  })

  describe('resolveIngredientParserConfig', () => {
    it('uses safe defaults when env values are missing', () => {
      expect(resolveIngredientParserConfig()).toEqual({
        provider: DEFAULT_INGREDIENT_PARSE_PROVIDER,
        apiKey: '',
        model: DEFAULT_INGREDIENT_PARSE_MODEL,
        timeoutMs: DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
        maxRetries: DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
        googleApiKey: '',
        geminiModel: DEFAULT_GEMINI_TEXT_MODEL,
        geminiTimeoutMs: DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
      })
    })

    it('treats a string config as the OpenAI API key', () => {
      expect(resolveIngredientParserConfig(TEST_API_KEY)).toMatchObject({
        provider: DEFAULT_INGREDIENT_PARSE_PROVIDER,
        apiKey: TEST_API_KEY,
        model: DEFAULT_INGREDIENT_PARSE_MODEL,
      })
    })

    it('uses configured provider, model, timeout, and retry env values', () => {
      expect(
        resolveIngredientParserConfig({
          OPENAI_API_KEY: 'env-key',
          INGREDIENT_PARSE_PROVIDER: ' OpenAI ',
          INGREDIENT_PARSE_MODEL: ' gpt-5.5 ',
          INGREDIENT_PARSE_TIMEOUT_MS: '12000',
          INGREDIENT_PARSE_MAX_RETRIES: '3',
        })
      ).toEqual({
        provider: DEFAULT_INGREDIENT_PARSE_PROVIDER,
        apiKey: 'env-key',
        model: 'gpt-5.5',
        timeoutMs: 12000,
        maxRetries: 3,
        googleApiKey: '',
        geminiModel: DEFAULT_GEMINI_TEXT_MODEL,
        geminiTimeoutMs: DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
      })
    })

    it('falls back to numeric defaults for blank, non-integer, and out-of-range controls', () => {
      expect(
        resolveIngredientParserConfig({
          OPENAI_API_KEY: '   ',
          INGREDIENT_PARSE_MODEL: '   ',
          INGREDIENT_PARSE_TIMEOUT_MS: '0',
          INGREDIENT_PARSE_MAX_RETRIES: '-1',
        })
      ).toMatchObject({
        apiKey: '',
        model: DEFAULT_INGREDIENT_PARSE_MODEL,
        timeoutMs: DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
        maxRetries: DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
      })

      expect(
        resolveIngredientParserConfig({
          INGREDIENT_PARSE_TIMEOUT_MS: '1.5',
          INGREDIENT_PARSE_MAX_RETRIES: 'nope',
        })
      ).toMatchObject({
        timeoutMs: DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
        maxRetries: DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
      })
    })

    it('rejects unsupported providers instead of silently switching vendors', () => {
      expect(() =>
        resolveIngredientParserConfig({
          INGREDIENT_PARSE_PROVIDER: 'anthropic',
        })
      ).toThrow(IngredientParseError)
    })

    it('resolves the Gemini fallback controls from env', () => {
      expect(
        resolveIngredientParserConfig({
          GOOGLE_API_KEY: ' google-key ',
          GEMINI_TEXT_MODEL: ' gemini-2.5-pro ',
          GEMINI_TEXT_TIMEOUT_MS: '15000',
        })
      ).toMatchObject({
        googleApiKey: 'google-key',
        geminiModel: 'gemini-2.5-pro',
        geminiTimeoutMs: 15000,
      })
    })

    it('falls back to Gemini defaults for blank/invalid fallback controls', () => {
      expect(
        resolveIngredientParserConfig({
          GOOGLE_API_KEY: '   ',
          GEMINI_TEXT_MODEL: '   ',
          GEMINI_TEXT_TIMEOUT_MS: '0',
        })
      ).toMatchObject({
        googleApiKey: '',
        geminiModel: DEFAULT_GEMINI_TEXT_MODEL,
        geminiTimeoutMs: DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
      })
    })
  })

  describe('isRetryableForFallback', () => {
    function errorWithStatus(status: number): IngredientParseError {
      return new IngredientParseError('mapped', Object.assign(new Error('x'), { status }))
    }

    it('retries on rate-limit (429), request-timeout (408), and 5xx statuses', () => {
      expect(isRetryableForFallback(errorWithStatus(429))).toBe(true)
      expect(isRetryableForFallback(errorWithStatus(408))).toBe(true)
      expect(isRetryableForFallback(errorWithStatus(500))).toBe(true)
      expect(isRetryableForFallback(errorWithStatus(503))).toBe(true)
    })

    it('does NOT retry on auth statuses (401/403) or other 4xx', () => {
      expect(isRetryableForFallback(errorWithStatus(401))).toBe(false)
      expect(isRetryableForFallback(errorWithStatus(403))).toBe(false)
      expect(isRetryableForFallback(errorWithStatus(404))).toBe(false)
    })

    it('retries statusless transport failures named in the message', () => {
      expect(isRetryableForFallback(new IngredientParseError('Request timeout'))).toBe(true)
      expect(isRetryableForFallback(new IngredientParseError('timed out while waiting'))).toBe(true)
      expect(isRetryableForFallback(new IngredientParseError('connection refused'))).toBe(true)
      expect(isRetryableForFallback(new IngredientParseError('network is down'))).toBe(true)
      expect(
        isRetryableForFallback(
          new IngredientParseError('OpenAI request timeout or temporary service failure')
        )
      ).toBe(true)
    })

    it('does NOT retry statusless generic/parse failures', () => {
      expect(isRetryableForFallback(new IngredientParseError('Failed to parse ingredients'))).toBe(
        false
      )
      expect(
        isRetryableForFallback(new IngredientParseError('OpenAI refused to parse this ingredient text'))
      ).toBe(false)
    })
  })

  describe('parseIngredients', () => {
    describe('basic parsing', () => {
      it('parses a simple ingredient with quantity, unit, and name', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'cup', ingredientName: 'flour' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 cups flour', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 2, unit: 'cup', ingredientName: 'flour' },
        ])
      })

      it('parses ingredient with singular unit', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'cup', ingredientName: 'water' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 cup water', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'cup', ingredientName: 'water' },
        ])
      })
    })

    describe('fractions', () => {
      it('parses fractional quantity (1/2)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.5, unit: 'cup', ingredientName: 'sugar' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1/2 cup sugar', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 0.5, unit: 'cup', ingredientName: 'sugar' },
        ])
      })

      it('parses mixed number fraction (1 1/2)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1.5, unit: 'tbsp', ingredientName: 'butter' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 1/2 tbsp butter', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1.5, unit: 'tbsp', ingredientName: 'butter' },
        ])
      })

      it('parses unicode fraction (½)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.5, unit: 'cup', ingredientName: 'milk' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('½ cup milk', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 0.5, unit: 'cup', ingredientName: 'milk' },
        ])
      })

      it('parses unicode fraction (¼)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.25, unit: 'tsp', ingredientName: 'cinnamon' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('¼ tsp cinnamon', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 0.25, unit: 'tsp', ingredientName: 'cinnamon' },
        ])
      })

      it('parses unicode fraction (¾)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.75, unit: 'cup', ingredientName: 'cream' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('¾ cup cream', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 0.75, unit: 'cup', ingredientName: 'cream' },
        ])
      })
    })

    describe('no unit (countable items)', () => {
      it('parses ingredient without unit (eggs)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'whole', ingredientName: 'eggs' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 eggs', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 2, unit: 'whole', ingredientName: 'eggs' },
        ])
      })

      it('parses ingredient without unit (garlic cloves)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 3, unit: 'clove', ingredientName: 'garlic' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('3 cloves garlic', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 3, unit: 'clove', ingredientName: 'garlic' },
        ])
      })

      it('parses ingredient with "piece" unit', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'piece', ingredientName: 'ginger' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 piece ginger', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'piece', ingredientName: 'ginger' },
        ])
      })
    })

    describe('compound ingredients', () => {
      it('parses compound ingredient (extra virgin olive oil)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'tbsp', ingredientName: 'extra virgin olive oil' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 tbsp extra virgin olive oil', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 2, unit: 'tbsp', ingredientName: 'extra virgin olive oil' },
        ])
      })

      it('parses compound ingredient (kosher salt)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'tsp', ingredientName: 'kosher salt' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 tsp kosher salt', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'tsp', ingredientName: 'kosher salt' },
        ])
      })

      it('parses compound ingredient (dark brown sugar)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.5, unit: 'cup', ingredientName: 'dark brown sugar' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1/2 cup dark brown sugar', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 0.5, unit: 'cup', ingredientName: 'dark brown sugar' },
        ])
      })
    })

    describe('prep notes', () => {
      it('parses ingredient with prep note (flour, sifted)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'cup', ingredientName: 'flour, sifted' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 cup flour, sifted', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'cup', ingredientName: 'flour, sifted' },
        ])
      })

      it('parses ingredient with prep note (onion, diced)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'whole', ingredientName: 'onion, diced' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 onion, diced', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'whole', ingredientName: 'onion, diced' },
        ])
      })

      it('parses ingredient with parenthetical note', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'cup', ingredientName: 'chicken broth (low sodium)' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 cups chicken broth (low sodium)', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 2, unit: 'cup', ingredientName: 'chicken broth (low sodium)' },
        ])
      })
    })

    describe('ranges and approximations', () => {
      it('parses ingredient with range (2-3 cups)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'cup', ingredientName: 'water' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2-3 cups water', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 2, unit: 'cup', ingredientName: 'water' },
        ])
      })

      it('parses ingredient with "about" prefix', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'cup', ingredientName: 'broth' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('about 1 cup broth', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'cup', ingredientName: 'broth' },
        ])
      })

      it('parses ingredient with "pinch of"', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'pinch', ingredientName: 'salt' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('pinch of salt', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'pinch', ingredientName: 'salt' },
        ])
      })

      it('parses ingredient with "dash of"', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'dash', ingredientName: 'pepper' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('dash of pepper', TEST_API_KEY)

        expect(result).toEqual([
          { quantity: 1, unit: 'dash', ingredientName: 'pepper' },
        ])
      })
    })

    describe('multiple ingredients', () => {
      it('parses multiple ingredients from multi-line input', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'cup', ingredientName: 'flour' },
                    { quantity: 0.5, unit: 'tsp', ingredientName: 'salt' },
                    { quantity: 3, unit: 'whole', ingredientName: 'eggs' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 cups flour\n1/2 tsp salt\n3 eggs', TEST_API_KEY)

        expect(result).toHaveLength(3)
        expect(result[0]).toEqual({ quantity: 2, unit: 'cup', ingredientName: 'flour' })
        expect(result[1]).toEqual({ quantity: 0.5, unit: 'tsp', ingredientName: 'salt' })
        expect(result[2]).toEqual({ quantity: 3, unit: 'whole', ingredientName: 'eggs' })
      })

      it('parses multiple ingredients from comma-separated input', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'cup', ingredientName: 'sugar' },
                    { quantity: 1, unit: 'tsp', ingredientName: 'vanilla extract' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 cup sugar, 1 tsp vanilla extract', TEST_API_KEY)

        expect(result).toHaveLength(2)
      })

      it('returns empty array for empty input', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('', TEST_API_KEY)

        expect(result).toEqual([])
      })

      it('returns empty array for whitespace-only input', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('   \n\t  ', TEST_API_KEY)

        expect(result).toEqual([])
      })
    })

    describe('unit variations', () => {
      it('normalizes plural units to singular', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 2, unit: 'cup', ingredientName: 'flour' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('2 cups flour', TEST_API_KEY)

        expect(result[0].unit).toBe('cup')
      })

      it('handles tablespoon abbreviations (tbsp)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'tbsp', ingredientName: 'oil' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 tbsp oil', TEST_API_KEY)

        expect(result[0].unit).toBe('tbsp')
      })

      it('handles teaspoon abbreviations (tsp)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 0.5, unit: 'tsp', ingredientName: 'baking soda' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1/2 tsp baking soda', TEST_API_KEY)

        expect(result[0].unit).toBe('tsp')
      })

      it('handles ounce variations (oz)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 8, unit: 'oz', ingredientName: 'cream cheese' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('8 oz cream cheese', TEST_API_KEY)

        expect(result[0].unit).toBe('oz')
      })

      it('handles pound variations (lb)', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [
                    { quantity: 1, unit: 'lb', ingredientName: 'ground beef' },
                  ],
                }),
              },
            },
          ],
        })

        const result = await parseIngredients('1 lb ground beef', TEST_API_KEY)

        expect(result[0].unit).toBe('lb')
      })
    })

    describe('error handling', () => {
      it('throws IngredientParseError when API request fails', async () => {
        mockCreate.mockRejectedValueOnce(new Error('API request failed'))

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError with original error as cause', async () => {
        const apiError = new Error('Network error')
        mockCreate.mockRejectedValueOnce(apiError)

        try {
          await parseIngredients('2 cups flour', TEST_API_KEY)
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(IngredientParseError)
          expect((error as IngredientParseError).cause).toBe(apiError)
        }
      })

      it('throws IngredientParseError when response is not valid JSON', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: 'not valid json',
              },
            },
          ],
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError when response does not match schema', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  wrong: 'schema',
                }),
              },
            },
          ],
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError when response has empty choices', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [],
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError when response has null content', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: null,
              },
            },
          ],
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError when API key is missing', async () => {
        await expect(parseIngredients('2 cups flour', '')).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError before provider calls when provider is unsupported', async () => {
        await expect(
          parseIngredients('2 cups flour', {
            OPENAI_API_KEY: TEST_API_KEY,
            INGREDIENT_PARSE_PROVIDER: 'gemini',
          })
        ).rejects.toThrow(IngredientParseError)

        expect(mockCreate).not.toHaveBeenCalled()
      })

      it('throws IngredientParseError for rate limit errors', async () => {
        const rateLimitError = new Error('Rate limit exceeded')
        ;(rateLimitError as any).status = 429
        mockCreate.mockRejectedValueOnce(rateLimitError)

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError for authentication errors', async () => {
        const authError = new Error('Invalid API key')
        ;(authError as any).status = 401
        mockCreate.mockRejectedValueOnce(authError)

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError for forbidden authentication errors', async () => {
        const authError = new Error('Forbidden API key')
        ;(authError as any).status = 403
        mockCreate.mockRejectedValueOnce(authError)

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError for timeout statuses', async () => {
        const timeoutError = new Error('Request timeout')
        ;(timeoutError as any).status = 408
        mockCreate.mockRejectedValueOnce(timeoutError)

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError for provider service failures', async () => {
        const serviceError = new Error('Server unavailable')
        ;(serviceError as any).status = 503
        mockCreate.mockRejectedValueOnce(serviceError)

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('maps timeout and connection messages to retryable parser errors', async () => {
        mockCreate.mockRejectedValueOnce(new Error('timed out while waiting'))

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )

        mockCreate.mockRejectedValueOnce(new Error('connection refused'))

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('maps non-Error provider failures with non-numeric statuses', async () => {
        mockCreate.mockRejectedValueOnce({
          status: 'unknown',
          toString: () => 'plain provider failure',
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })

      it('throws IngredientParseError when OpenAI returns a refusal', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                refusal: 'Cannot parse this request',
                content: null,
              },
            },
          ],
        })

        await expect(parseIngredients('2 cups flour', TEST_API_KEY)).rejects.toThrow(
          IngredientParseError
        )
      })
    })

    describe('preserved OpenAI error fields', () => {
      it('preserves the original code/type/status for an out-of-credit failure', async () => {
        const quotaError = Object.assign(new Error('You exceeded your quota'), {
          status: 429,
          code: 'insufficient_quota',
          type: 'insufficient_quota',
        })
        mockCreate.mockRejectedValueOnce(quotaError)

        try {
          await parseIngredients('2 cups flour', TEST_API_KEY)
          expect.fail('Should have thrown')
        } catch (error) {
          const parseError = error as IngredientParseError
          // The mapped, user-facing message is the generic rate-limit string...
          expect(parseError.message).toBe('OpenAI rate limit exceeded')
          // ...but the original code/type/status survive so insufficient_quota
          // stays distinguishable from rate_limit_exceeded.
          expect(parseError.code).toBe('insufficient_quota')
          expect(parseError.type).toBe('insufficient_quota')
          expect(parseError.status).toBe(429)
        }
      })

      it('preserves a nested error.code (raw JSON body shape)', async () => {
        mockCreate.mockRejectedValueOnce({
          status: 404,
          error: { code: 'model_not_found', type: 'invalid_request_error' },
        })

        try {
          await parseIngredients('2 cups flour', TEST_API_KEY)
          expect.fail('Should have thrown')
        } catch (error) {
          const parseError = error as IngredientParseError
          expect(parseError.code).toBe('model_not_found')
          expect(parseError.type).toBe('invalid_request_error')
          expect(parseError.status).toBe(404)
        }
      })

      it('leaves code/type/status null when the failure is not OpenAI-shaped', async () => {
        const error = new IngredientParseError('OpenAI API key is required')
        expect(error.code).toBeNull()
        expect(error.type).toBeNull()
        expect(error.status).toBeNull()
      })
    })

    describe('success telemetry capture', () => {
      const POSTHOG_CONFIG = {
        enabled: true as const,
        key: 'ph_test',
        host: 'https://posthog.example',
      }

      function mockSuccessfulParse() {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
                }),
              },
            },
          ],
        })
      }

      it('captures an LLM-call success with privacy-safe props (no .failed) when PostHog is configured', async () => {
        const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        mockSuccessfulParse()

        const ingredients = await parseIngredients(
          '2 cups flour',
          { OPENAI_API_KEY: TEST_API_KEY, INGREDIENT_PARSE_MODEL: 'gpt-4o-mini' },
          {
            postHogConfig: POSTHOG_CONFIG,
            fetchImpl: analyticsFetch as unknown as typeof fetch,
            distinctId: 'chef_7',
          }
        )

        expect(ingredients).toEqual([{ quantity: 2, unit: 'cup', ingredientName: 'flour' }])
        expect(analyticsFetch).toHaveBeenCalledTimes(1)
        const body = JSON.parse(analyticsFetch.mock.calls[0][1].body as string)
        expect(body.event).toBe('spoonjoy.llm_call.succeeded')
        expect(body.distinct_id).toBe('chef_7')
        expect(body.properties).toMatchObject({
          feature: 'llm_call',
          operation: 'ingredient_parse',
          provider: 'openai',
          model: 'gpt-4o-mini',
        })
        expect(typeof body.properties.durationMs).toBe('number')
        expect(body.properties.durationMs).toBeGreaterThanOrEqual(0)
      })

      it('does not call analytics on success when PostHog is unconfigured', async () => {
        const analyticsFetch = vi.fn()
        mockSuccessfulParse()

        await parseIngredients('2 cups flour', TEST_API_KEY, {
          fetchImpl: analyticsFetch as unknown as typeof fetch,
        })

        expect(analyticsFetch).not.toHaveBeenCalled()
      })
    })

    describe('failure telemetry capture', () => {
      const POSTHOG_CONFIG = {
        enabled: true as const,
        key: 'ph_test',
        host: 'https://posthog.example',
      }

      it('emits .failed and NOT .succeeded when the call fails', async () => {
        const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        mockCreate.mockRejectedValueOnce(new Error('network down'))

        await expect(
          parseIngredients('2 cups flour', TEST_API_KEY, {
            postHogConfig: POSTHOG_CONFIG,
            fetchImpl: analyticsFetch as unknown as typeof fetch,
          })
        ).rejects.toThrow(IngredientParseError)

        expect(analyticsFetch).toHaveBeenCalledTimes(1)
        const events = analyticsFetch.mock.calls.map(
          (call) => JSON.parse(call[1].body as string).event
        )
        expect(events).toContain('spoonjoy.llm_call.failed')
        expect(events).not.toContain('spoonjoy.llm_call.succeeded')
      })

      it('captures an LLM-call failure with the preserved code when PostHog is configured', async () => {
        const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        const quotaError = Object.assign(new Error('quota'), {
          status: 429,
          code: 'insufficient_quota',
          type: 'insufficient_quota',
        })
        mockCreate.mockRejectedValueOnce(quotaError)

        await expect(
          parseIngredients(
            '2 cups flour',
            { OPENAI_API_KEY: TEST_API_KEY, INGREDIENT_PARSE_MODEL: 'gpt-4o-mini' },
            {
              postHogConfig: POSTHOG_CONFIG,
              fetchImpl: analyticsFetch as unknown as typeof fetch,
              distinctId: 'chef_7',
            }
          )
        ).rejects.toThrow(IngredientParseError)

        expect(analyticsFetch).toHaveBeenCalledTimes(1)
        const body = JSON.parse(analyticsFetch.mock.calls[0][1].body as string)
        expect(body.event).toBe('spoonjoy.llm_call.failed')
        expect(body.distinct_id).toBe('chef_7')
        expect(body.properties).toMatchObject({
          operation: 'ingredient_parse',
          provider: 'openai',
          model: 'gpt-4o-mini',
          errorCode: 'insufficient_quota',
          errorStatus: 429,
        })
      })

      it('captures non-OpenAI parse failures (refusal) as LLM-call failures', async () => {
        const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        mockCreate.mockResolvedValueOnce({
          choices: [{ message: { refusal: 'no', content: null } }],
        })

        await expect(
          parseIngredients('2 cups flour', TEST_API_KEY, {
            postHogConfig: POSTHOG_CONFIG,
            fetchImpl: analyticsFetch as unknown as typeof fetch,
          })
        ).rejects.toThrow(IngredientParseError)

        expect(analyticsFetch).toHaveBeenCalledTimes(1)
        const body = JSON.parse(analyticsFetch.mock.calls[0][1].body as string)
        expect(body.properties.operation).toBe('ingredient_parse')
        expect(body.distinct_id).toBe('anon')
      })

      it('does not call analytics when PostHog is unconfigured', async () => {
        const analyticsFetch = vi.fn()
        mockCreate.mockRejectedValueOnce(new Error('network down'))

        await expect(
          parseIngredients('2 cups flour', TEST_API_KEY, {
            fetchImpl: analyticsFetch as unknown as typeof fetch,
          })
        ).rejects.toThrow(IngredientParseError)

        expect(analyticsFetch).not.toHaveBeenCalled()
      })
    })

    describe('API call verification', () => {
      it('calls OpenAI API with correct model', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
                }),
              },
            },
          ],
        })

        await parseIngredients('2 cups flour', TEST_API_KEY)

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: DEFAULT_INGREDIENT_PARSE_MODEL,
          })
        )
      })

      it('calls OpenAI API with configured model and runtime controls', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
                }),
              },
            },
          ],
        })

        await parseIngredients('2 cups flour', {
          OPENAI_API_KEY: TEST_API_KEY,
          INGREDIENT_PARSE_MODEL: 'gpt-5.5',
          INGREDIENT_PARSE_TIMEOUT_MS: '12000',
          INGREDIENT_PARSE_MAX_RETRIES: '0',
        })

        expect(mockConstructorOptions).toHaveBeenCalledWith({
          apiKey: TEST_API_KEY,
          timeout: 12000,
          maxRetries: 0,
          dangerouslyAllowBrowser: true,
        })
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'gpt-5.5',
          })
        )
      })

      it('calls OpenAI API with structured output configuration', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
                }),
              },
            },
          ],
        })

        await parseIngredients('2 cups flour', TEST_API_KEY)

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            response_format: expect.objectContaining({
              type: 'json_schema',
            }),
          })
        )
      })

      it('passes ingredient text in the prompt', async () => {
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
                }),
              },
            },
          ],
        })

        await parseIngredients('2 cups flour', TEST_API_KEY)

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                content: expect.stringContaining('2 cups flour'),
              }),
            ]),
          })
        )
      })
    })
  })

  describe('Gemini fallback', () => {
    const POSTHOG_CONFIG = {
      enabled: true as const,
      key: 'ph_test',
      host: 'https://posthog.example',
    }

    const GEMINI_INGREDIENTS = [{ quantity: 3, unit: 'whole', ingredientName: 'eggs' }]

    /** A 200 response whose Gemini candidate text is `text`. */
    function geminiOk(text: string): Response {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    /** Reject the OpenAI call with an Error carrying an HTTP `status`. */
    function openAIRejectsWithStatus(status: number) {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error('boom'), { status }))
    }

    /**
     * Drive a full fallback: OpenAI fails, Gemini's HTTP fetch resolves to
     * `geminiResponse`. Returns the stubbed global fetch (which the Gemini
     * adapter uses when no fetchImpl is injected) plus the PostHog analytics
     * fetch so callers can assert on emitted telemetry.
     */
    function wireFallback(geminiResponse: Response | Promise<Response>) {
      const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      const geminiFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(geminiResponse as Response)
      return { analyticsFetch, geminiFetch }
    }

    const FALLBACK_ENV = {
      OPENAI_API_KEY: 'test-openai-api-key',
      GOOGLE_API_KEY: 'test-google-api-key',
    }

    it('falls back to Gemini when OpenAI returns a 429 and returns the Gemini result', async () => {
      openAIRejectsWithStatus(429)
      const { analyticsFetch, geminiFetch } = wireFallback(
        geminiOk(JSON.stringify({ ingredients: GEMINI_INGREDIENTS }))
      )

      try {
        const result = await parseIngredients('3 eggs', FALLBACK_ENV, {
          postHogConfig: POSTHOG_CONFIG,
          fetchImpl: analyticsFetch as unknown as typeof fetch,
          distinctId: 'chef_9',
        })

        expect(result).toEqual(GEMINI_INGREDIENTS)
        // The OpenAI client was constructed/called once; Gemini's HTTP fetch fired once.
        expect(mockCreate).toHaveBeenCalledTimes(1)
        expect(geminiFetch).toHaveBeenCalledTimes(1)
        const [geminiUrl, geminiInit] = geminiFetch.mock.calls[0]
        expect(String(geminiUrl)).toContain(
          `/models/${DEFAULT_GEMINI_TEXT_MODEL}:generateContent`
        )
        expect((geminiInit as RequestInit).method).toBe('POST')

        // Telemetry: an OpenAI failure THEN a Gemini success, both for ingredient_parse.
        const events = analyticsFetch.mock.calls.map((call) => {
          const body = JSON.parse((call[1] as RequestInit).body as string)
          return { event: body.event, provider: body.properties.provider }
        })
        expect(events).toEqual([
          { event: 'spoonjoy.llm_call.failed', provider: 'openai' },
          { event: 'spoonjoy.llm_call.succeeded', provider: 'gemini' },
        ])
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('throws the ORIGINAL mapped OpenAI error when the Gemini fallback also fails', async () => {
      // OpenAI 500 -> retryable; Gemini returns a non-2xx so the fallback throws.
      openAIRejectsWithStatus(500)
      const { analyticsFetch, geminiFetch } = wireFallback(
        new Response(JSON.stringify({ error: { message: 'nope', status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      )

      try {
        await parseIngredients('3 eggs', FALLBACK_ENV, {
          postHogConfig: POSTHOG_CONFIG,
          fetchImpl: analyticsFetch as unknown as typeof fetch,
        }).then(
          () => expect.fail('Should have thrown'),
          (error: unknown) => {
            // The surfaced error is the ORIGINAL OpenAI failure, not the Gemini one.
            const parseError = error as IngredientParseError
            expect(parseError).toBeInstanceOf(IngredientParseError)
            expect(parseError.message).toBe('OpenAI request timeout or temporary service failure')
            expect(parseError.status).toBe(500)
          }
        )

        // Two failures captured: openai then gemini. No success.
        const events = analyticsFetch.mock.calls.map((call) => {
          const body = JSON.parse((call[1] as RequestInit).body as string)
          return { event: body.event, provider: body.properties.provider }
        })
        expect(events).toEqual([
          { event: 'spoonjoy.llm_call.failed', provider: 'openai' },
          { event: 'spoonjoy.llm_call.failed', provider: 'gemini' },
        ])
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('wraps a non-IngredientParseError Gemini failure as "Gemini fallback failed"', async () => {
      // OpenAI 429 -> retryable; the Gemini HTTP fetch throws a transport error,
      // which the adapter surfaces as a GeminiTextError (already an Error, not an
      // IngredientParseError) -> wrapped into "Gemini fallback failed" telemetry.
      openAIRejectsWithStatus(429)
      const analyticsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      const geminiFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('socket hang up'))

      try {
        await expect(
          parseIngredients('3 eggs', FALLBACK_ENV, {
            postHogConfig: POSTHOG_CONFIG,
            fetchImpl: analyticsFetch as unknown as typeof fetch,
          })
        ).rejects.toThrow(IngredientParseError)

        const failureBodies = analyticsFetch.mock.calls
          .map((call) => JSON.parse((call[1] as RequestInit).body as string))
          .filter((body) => body.event === 'spoonjoy.llm_call.failed')
        const geminiFailure = failureBodies.find((body) => body.properties.provider === 'gemini')
        expect(geminiFailure?.properties.errorMessage).toBe('Gemini fallback failed')
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('does NOT fall back on a 401 auth error (and never calls Gemini)', async () => {
      openAIRejectsWithStatus(401)
      const geminiFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk('{}'))

      try {
        await expect(parseIngredients('3 eggs', FALLBACK_ENV)).rejects.toThrow(
          IngredientParseError
        )
        expect(geminiFetch).not.toHaveBeenCalled()
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('does NOT fall back when GOOGLE_API_KEY is absent, even on a retryable 429', async () => {
      openAIRejectsWithStatus(429)
      const geminiFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk('{}'))

      try {
        await expect(
          // No GOOGLE_API_KEY -> fallback is disabled.
          parseIngredients('3 eggs', { OPENAI_API_KEY: 'test-openai-api-key' })
        ).rejects.toThrow(IngredientParseError)
        expect(geminiFetch).not.toHaveBeenCalled()
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('throws "Invalid JSON in Gemini response" when Gemini returns non-JSON text', async () => {
      openAIRejectsWithStatus(429)
      const { analyticsFetch, geminiFetch } = wireFallback(geminiOk('this is not json'))

      try {
        await parseIngredients('3 eggs', FALLBACK_ENV, {
          postHogConfig: POSTHOG_CONFIG,
          fetchImpl: analyticsFetch as unknown as typeof fetch,
        }).then(
          () => expect.fail('Should have thrown'),
          () => {
            /* original OpenAI error is rethrown; asserted elsewhere */
          }
        )

        const geminiFailure = analyticsFetch.mock.calls
          .map((call) => JSON.parse((call[1] as RequestInit).body as string))
          .find(
            (body) =>
              body.event === 'spoonjoy.llm_call.failed' && body.properties.provider === 'gemini'
          )
        expect(geminiFailure?.properties.errorMessage).toBe('Invalid JSON in Gemini response')
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('throws a schema-mismatch error when Gemini JSON does not match the ingredient schema', async () => {
      openAIRejectsWithStatus(429)
      const { analyticsFetch, geminiFetch } = wireFallback(
        geminiOk(JSON.stringify({ ingredients: [{ quantity: -1, unit: '', ingredientName: '' }] }))
      )

      try {
        await parseIngredients('3 eggs', FALLBACK_ENV, {
          postHogConfig: POSTHOG_CONFIG,
          fetchImpl: analyticsFetch as unknown as typeof fetch,
        }).then(
          () => expect.fail('Should have thrown'),
          () => {
            /* original OpenAI error is rethrown */
          }
        )

        const geminiFailure = analyticsFetch.mock.calls
          .map((call) => JSON.parse((call[1] as RequestInit).body as string))
          .find(
            (body) =>
              body.event === 'spoonjoy.llm_call.failed' && body.properties.provider === 'gemini'
          )
        expect(geminiFailure?.properties.errorMessage).toBe(
          'Gemini response does not match expected schema'
        )
      } finally {
        geminiFetch.mockRestore()
      }
    })

    it('passes the configured Gemini model and timeout through to the adapter', async () => {
      openAIRejectsWithStatus(429)
      const geminiFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(geminiOk(JSON.stringify({ ingredients: GEMINI_INGREDIENTS })))

      try {
        const result = await parseIngredients('3 eggs', {
          ...FALLBACK_ENV,
          GEMINI_TEXT_MODEL: 'gemini-2.5-pro',
          GEMINI_TEXT_TIMEOUT_MS: String(DEFAULT_GEMINI_TEXT_TIMEOUT_MS),
        })

        expect(result).toEqual(GEMINI_INGREDIENTS)
        const [geminiUrl] = geminiFetch.mock.calls[0]
        expect(String(geminiUrl)).toContain('/models/gemini-2.5-pro:generateContent')
      } finally {
        geminiFetch.mockRestore()
      }
    })
  })
})
