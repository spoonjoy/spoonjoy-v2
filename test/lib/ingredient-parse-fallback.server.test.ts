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

  it('records each fallback, and whether the rules found anything, when telemetry is configured', async () => {
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(new IngredientParseError('OpenAI API key is required'))
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const telemetry = { postHogConfig: { enabled: true, key: 'ph_test', host: 'https://posthog.example' }, fetchImpl, distinctId: 'chef-1' }

    await parseIngredientsWithRulesFallback('3 large eggs', {}, telemetry)
    await expect(parseIngredientsWithRulesFallback('2 cups', {}, { ...telemetry, distinctId: undefined })).rejects.toThrow()

    const bodies = vi.mocked(fetchImpl).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(bodies).toEqual([
      expect.objectContaining({ event: 'spoonjoy.ingredient_parse.rules_fallback', distinct_id: 'chef-1', properties: expect.objectContaining({ error_name: 'IngredientParseError', rule_parsed_count: 1 }) }),
      expect.objectContaining({ distinct_id: 'anon', properties: expect.objectContaining({ rule_parsed_count: 0 }) }),
    ])
  })

  it('names a non-Error failure by its type', async () => {
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue('timeout')
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

    await parseIngredientsWithRulesFallback('3 large eggs', {}, { postHogConfig: { enabled: true, key: 'ph_test', host: 'https://posthog.example' }, fetchImpl })

    const [[, init]] = vi.mocked(fetchImpl).mock.calls
    expect(JSON.parse((init as RequestInit).body as string).properties).toMatchObject({ error_name: 'string' })
  })
})
