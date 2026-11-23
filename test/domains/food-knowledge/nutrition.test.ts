import { describe, expect, it } from 'vitest'
import { foodNutritionFor, formatGrams, gramsOf, recipeNutrition } from '~/domains/food-knowledge'

describe('foodNutritionFor', () => {
  it.each([
    ['garlic', 'Garlic, raw'],
    ['Garlic cloves', 'Garlic, raw'],
    ['unsalted butter', 'Butter, without salt'],
    ['butter', 'Butter, salted'],
    ['large eggs', 'Egg, whole, raw, fresh'],
    ['fresh flat-leaf parsley', 'Parsley, fresh'],
    ['onion, finely diced', 'Onions, raw'],
    ['jasmine rice', 'Rice, white, long-grain, regular, raw, enriched'],
  ])('reads %s as %s', (name, description) => {
    expect(foodNutritionFor(name)?.description).toBe(description)
  })

  it.each([['peanut'], ['egg noodles'], [''], [null]])('knows no food for %s', (name) => {
    expect(foodNutritionFor(name)).toBeNull()
  })
})

describe('gramsOf', () => {
  const rice = foodNutritionFor('rice')!
  const garlic = foodNutritionFor('garlic')!
  const chicken = foodNutritionFor('chicken breast')!

  it('weighs a weight as it is', () => {
    expect(gramsOf(rice, 200, 'g')).toBe(200)
    expect(gramsOf(rice, 1, 'lb')).toBeCloseTo(453.59237)
  })

  it('weighs a volume by what a cup of the food weighs', () => {
    expect(gramsOf(rice, 1, 'cup')).toBeCloseTo(185)
    expect(gramsOf(rice, 2, 'tbsp')).toBeCloseTo((185 * 30) / 236.5882365)
  })

  it('weighs a counted food by what one weighs', () => {
    expect(gramsOf(garlic, 2, 'cloves')).toBe(6)
    expect(gramsOf(garlic, 2, null)).toBe(6)
    expect(gramsOf(chicken, 1, 'whole')).toBe(272)
  })

  it('reads a quantity written as text', () => {
    expect(gramsOf(rice, '0.5', 'cup')).toBeCloseTo(92.5)
  })

  it.each([
    ['a volume of a food with no cup weight', chicken, 1, 'cup'],
    ['a counted food with no weight for one', rice, 2, null],
    ['a unit nobody can weigh', rice, 1, 'handful'],
    ['no quantity', rice, null, 'cup'],
    ['a quantity that is not a number', rice, 'some', 'cup'],
  ] as const)("can't weigh %s", (_name, food, quantity, unit) => {
    expect(gramsOf(food, quantity, unit)).toBeNull()
  })
})

describe('recipeNutrition', () => {
  it('adds up what it can weigh and divides by servings', () => {
    const nutrition = recipeNutrition(
      [
        { name: 'jasmine rice', quantity: 1, unit: 'cup' },
        { name: 'garlic', quantity: 2, unit: 'cloves' },
        { name: 'saffron', quantity: 1, unit: 'pinch' },
      ],
      2,
    )
    // 185 g rice at 365 kcal/100 g and 6 g garlic at 149 kcal/100 g.
    expect(nutrition.total.kcal).toBeCloseTo(1.85 * 365 + 0.06 * 149)
    expect(nutrition.perServing!.kcal).toBeCloseTo((1.85 * 365 + 0.06 * 149) / 2)
    expect(nutrition.perServing!.protein).toBeCloseTo((1.85 * 7.1 + 0.06 * 6.4) / 2)
    expect(nutrition).toMatchObject({ weighed: 2, of: 3 })
  })

  it('has no per-serving figure without servings', () => {
    expect(recipeNutrition([{ name: 'rice', quantity: 1, unit: 'cup' }], null).perServing).toBeNull()
    expect(recipeNutrition([{ name: 'rice', quantity: 1, unit: 'cup' }], 0).perServing).toBeNull()
  })

  it('weighs nothing in a recipe of foods it does not know', () => {
    expect(recipeNutrition([{ name: 'saffron', quantity: 1, unit: 'pinch' }], 4)).toMatchObject({ weighed: 0, of: 1, total: { kcal: 0 } })
  })
})

describe('formatGrams', () => {
  it('writes grams to a tenth below 10 and whole above', () => {
    expect(formatGrams(0.04)).toBe('0 g')
    expect(formatGrams(9.94)).toBe('9.9 g')
    expect(formatGrams(12.4)).toBe('12 g')
  })
})
