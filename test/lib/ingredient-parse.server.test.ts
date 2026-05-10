import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_INGREDIENT_PARSE_MAX_RETRIES,
  DEFAULT_INGREDIENT_PARSE_MODEL,
  DEFAULT_INGREDIENT_PARSE_PROVIDER,
  DEFAULT_INGREDIENT_PARSE_TIMEOUT_MS,
  parseIngredients,
  ParsedIngredientSchema,
  ParsedIngredientsResponseSchema,
  IngredientParseError,
  resolveIngredientParserConfig,
  type ParsedIngredient,
} from '~/lib/ingredient-parse.server'

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
})
