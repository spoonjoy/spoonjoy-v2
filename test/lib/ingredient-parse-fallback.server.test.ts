import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ingredientParse from '~/lib/ingredient-parse.server'
import { IngredientParseError } from '~/lib/ingredient-parse.server'
import { parseIngredientsWithRulesFallback } from '~/lib/ingredient-parse-fallback.server'

describe('parseIngredientsWithRulesFallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers with the AI parse when it succeeds', async () => {
    const ai = [{ quantity: 2, unit: 'cup', ingredientName: 'all-purpose flour' }]
    const spy = vi.spyOn(ingredientParse, 'parseIngredients').mockResolvedValue(ai)

    await expect(parseIngredientsWithRulesFallback('2 cups flour', { OPENAI_API_KEY: 'key' }, { distinctId: 'chef' }))
      .resolves.toBe(ai)
    expect(spy).toHaveBeenCalledWith('2 cups flour', { OPENAI_API_KEY: 'key' }, { distinctId: 'chef' })
  })

  it('parses by rules when AI parsing is unavailable, keeping every typed line', async () => {
    // No API key: the real parser refuses before calling any provider, as on QA.
    await expect(parseIngredientsWithRulesFallback('1 lb spaghetti\n2 tbsp kosher salt\n1/2 cup pasta water', {}))
      .resolves.toEqual([
        { quantity: 1, unit: 'lb', ingredientName: 'spaghetti' },
        { quantity: 2, unit: 'tbsp', ingredientName: 'kosher salt' },
        { quantity: 0.5, unit: 'cup', ingredientName: 'pasta water' },
      ])
  })

  it('parses by rules when the provider fails with an unexpected error', async () => {
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(new Error('socket hang up'))

    await expect(parseIngredientsWithRulesFallback('3 large eggs')).resolves.toEqual([
      { quantity: 3, unit: 'large', ingredientName: 'eggs' },
    ])
  })

  it("rethrows the AI parser's error when the rules find no ingredient either", async () => {
    const error = new IngredientParseError('Ingredient text is required')
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(error)

    await expect(parseIngredientsWithRulesFallback('2 cups')).rejects.toBe(error)
  })
})
