import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ingredientParse from '~/lib/ingredient-parse.server'
import {
  INGREDIENT_PARSE_RATE_LIMITED_CODE,
  INGREDIENT_PARSE_RATE_LIMITED_MESSAGE,
  INGREDIENT_PARSE_TEXT_TOO_LONG_MESSAGE,
  IngredientParseError,
  MAX_INGREDIENT_PARSE_TEXT_LENGTH,
} from '~/lib/ingredient-parse.server'
import {
  parseIngredientsWithRulesFallback,
  parseIngredientsWithRulesFallbackOnLimit,
} from '~/lib/ingredient-parse-fallback.server'

const POSTHOG = { enabled: true as const, key: 'ph_test', host: 'https://posthog.example' }
const rateLimited = () =>
  new IngredientParseError(INGREDIENT_PARSE_RATE_LIMITED_MESSAGE, undefined, INGREDIENT_PARSE_RATE_LIMITED_CODE)
const overLongText = `${'1 cup flour\n'.repeat(Math.ceil(MAX_INGREDIENT_PARSE_TEXT_LENGTH / 12))}2 eggs`

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

  it('parses by rules when the user is over the AI parse rate limit, and records why', async () => {
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(rateLimited())
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

    await expect(
      parseIngredientsWithRulesFallback('3 large eggs', {}, { postHogConfig: POSTHOG, fetchImpl, distinctId: 'chef-1' })
    ).resolves.toEqual([{ quantity: 3, unit: 'large', ingredientName: 'eggs' }])

    const [[, init]] = vi.mocked(fetchImpl).mock.calls
    expect(JSON.parse((init as RequestInit).body as string).properties).toMatchObject({
      error_code: INGREDIENT_PARSE_RATE_LIMITED_CODE,
      rule_parsed_count: 1,
    })
  })

  it('refuses text over the length cap with its message instead of a silent rules-only parse', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

    await expect(
      parseIngredientsWithRulesFallback(overLongText, { OPENAI_API_KEY: 'key' }, { postHogConfig: POSTHOG, fetchImpl })
    ).rejects.toThrow(INGREDIENT_PARSE_TEXT_TOO_LONG_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('parseIngredientsWithRulesFallbackOnLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers with the AI parse when it succeeds', async () => {
    const ai = [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }]
    const spy = vi.spyOn(ingredientParse, 'parseIngredients').mockResolvedValue(ai)

    await expect(parseIngredientsWithRulesFallbackOnLimit('2 cups flour', 'key', { distinctId: 'chef' })).resolves.toBe(ai)
    expect(spy).toHaveBeenCalledWith('2 cups flour', 'key', { distinctId: 'chef' })
  })

  it('parses over-long text by rules so the import still saves', async () => {
    const parsed = await parseIngredientsWithRulesFallbackOnLimit(overLongText, { OPENAI_API_KEY: 'key' })

    expect(parsed.length).toBeGreaterThan(300)
    expect(parsed.at(-1)).toEqual({ quantity: 2, unit: 'whole', ingredientName: 'eggs' })
  })

  it('parses by rules when the user is over the rate limit, and records why', async () => {
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(rateLimited())
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

    await expect(
      parseIngredientsWithRulesFallbackOnLimit('3 large eggs', {}, { postHogConfig: POSTHOG, fetchImpl, distinctId: 'chef-1' })
    ).resolves.toEqual([{ quantity: 3, unit: 'large', ingredientName: 'eggs' }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rethrows the limit error when the rules find no ingredient either', async () => {
    const error = rateLimited()
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(error)

    await expect(parseIngredientsWithRulesFallbackOnLimit('2 cups')).rejects.toBe(error)
  })

  it('still fails on provider errors, as imports did before the caps', async () => {
    const error = new IngredientParseError('OpenAI rate limit exceeded')
    vi.spyOn(ingredientParse, 'parseIngredients').mockRejectedValue(error)

    await expect(parseIngredientsWithRulesFallbackOnLimit('3 large eggs')).rejects.toBe(error)
  })
})
