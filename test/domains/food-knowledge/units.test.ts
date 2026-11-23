import { describe, expect, it } from 'vitest'
import {
  formatAmountIn,
  parseUnitSystem,
  resolveUnit,
  UNIT_SYSTEMS,
  unitSystemCookie,
  unitSystemFromCookie,
} from '~/domains/food-knowledge'

describe('resolveUnit', () => {
  it.each([
    ['tsp', 'teaspoon'],
    ['Teaspoons', 'teaspoon'],
    ['tbsp.', 'tablespoon'],
    ['T', 'tablespoon'],
    ['cups', 'cup'],
    ['fl oz', 'us-fluid-ounce'],
    ['fl. oz.', 'us-fluid-ounce'],
    ['pints', 'us-pint'],
    ['qt', 'us-quart'],
    ['gallon', 'us-gallon'],
    ['mL', 'milliliter'],
    ['cl', 'centiliter'],
    ['decilitre', 'deciliter'],
    ['L', 'liter'],
    ['litres', 'liter'],
    ['g', 'gram'],
    ['kilos', 'kilogram'],
    ['mg', 'milligram'],
    ['ounces', 'ounce'],
    ['lbs', 'pound'],
    ['UK pint', 'imperial-pint'],
    ['imperial fl oz', 'imperial-fluid-ounce'],
  ])('reads %s as %s', (text, slug) => {
    expect(resolveUnit(text)?.slug).toBe(slug)
  })

  it('reads a lower-case "t" as nothing, since it may be a teaspoon or a tablespoon', () => {
    expect(resolveUnit('t')).toBeNull()
  })

  it.each([['whole'], ['clove'], ['pinch'], [''], [null], [undefined]])('does not convert %s', (text) => {
    expect(resolveUnit(text)).toBeNull()
  })
})

describe('parseUnitSystem', () => {
  it('keeps a known system', () => {
    expect(parseUnitSystem('imperial')).toBe('imperial')
  })

  it.each([['kelvin'], [''], [null], [undefined]])('reads %s as the recipe as written', (value) => {
    expect(parseUnitSystem(value)).toBe('original')
  })

  it('offers the recipe as written first, then metric, US and imperial', () => {
    expect(UNIT_SYSTEMS.map((system) => system.value)).toEqual(['original', 'metric', 'us', 'imperial'])
  })
})

describe('formatAmountIn', () => {
  describe('as written', () => {
    it('writes the amount as the recipe does', () => {
      expect(formatAmountIn('original', 1, 'cup')).toBe('1 cup')
    })

    it('passes the shopping list rounding through', () => {
      expect(formatAmountIn('original', 1.25, 'whole', { roundCountsUp: true })).toBe('2')
    })
  })

  describe('anything it cannot convert stays as written', () => {
    it('keeps a counted unit', () => {
      expect(formatAmountIn('metric', 2, 'clove')).toBe('2 cloves')
    })

    it('keeps an amount without a quantity', () => {
      expect(formatAmountIn('metric', null, 'cup')).toBe('cup')
    })

    it('keeps a quantity it cannot read', () => {
      expect(formatAmountIn('metric', 'lots', 'cup')).toBe('cup')
    })

    it('keeps a zero amount', () => {
      expect(formatAmountIn('metric', 0, 'cup')).toBe('0 cup')
    })

    it('keeps a unit already in the system, in the recipe\'s own spelling', () => {
      expect(formatAmountIn('us', 2, 'pounds')).toBe('2 pounds')
    })
  })

  describe('metric', () => {
    it.each([
      [1, 'cup', '235 ml'],
      [0.5, 'cup', '120 ml'],
      [4, 'cups', '945 ml'],
      [5, 'cups', '1.18 l'],
      [1, 'fl oz', '2 tbsp'],
      [0.25, 'cup', '60 ml'],
      [2, 'imperial pints', '1.14 l'],
      [1, 'lb', '455 g'],
      [8, 'oz', '225 g'],
      [1, 'oz', '28 g'],
      [0.25, 'oz', '7 g'],
      [0.1, 'oz', '3 g'],
      [0.05, 'oz', '1.5 g'],
      [2.5, 'lb', '1.13 kg'],
      [1500, 'g', '1.5 kg'],
      [1, 'tsp', '1 tsp'],
      [2, 'tbsp', '2 tbsp'],
      [3, 'tbsp', '3 tbsp'],
      [5, 'tbsp', '75 ml'],
      [2, 'qt', '1.89 l'],
      [1, 'gallon', '3.79 l'],
    ])('writes %s %s as %s', (quantity, unit, expected) => {
      expect(formatAmountIn('metric', quantity, unit)).toBe(expected)
    })

    it('reads a quantity given as text', () => {
      expect(formatAmountIn('metric', '2', 'cups')).toBe('475 ml')
    })
  })

  describe('US', () => {
    it.each([
      [240, 'ml', '1 cup'],
      [120, 'ml', '½ cup'],
      [5, 'ml', '1 tsp'],
      [15, 'ml', '1 tbsp'],
      [6, 'tsp', '2 tbsp'],
      [12, 'tbsp', '¾ cup'],
      [1, 'l', '4 ¼ cups'],
      [1, 'liter', '4 ¼ cups'],
      [2, 'l', '8 ½ cups'],
      [4, 'l', '1 gallon'],
      [100, 'g', '3 ½ oz'],
      [500, 'g', '1 ⅛ lb'],
      [1, 'kg', '2 ¼ lb'],
    ])('writes %s %s as %s', (quantity, unit, expected) => {
      expect(formatAmountIn('us', quantity, unit)).toBe(expected)
    })
  })

  describe('imperial', () => {
    it.each([
      [1, 'cup', '8 ½ fl oz'],
      [2, 'cups', '16 ½ fl oz'],
      [600, 'ml', '1 pint'],
      [1.5, 'l', '2 ⅝ pints'],
      [1, 'us pint', '16 ½ fl oz'],
      [10, 'ml', '2 tsp'],
      [30, 'ml', '2 tbsp'],
      [250, 'g', '8 ⅞ oz'],
    ])('writes %s %s as %s', (quantity, unit, expected) => {
      expect(formatAmountIn('imperial', quantity, unit)).toBe(expected)
    })
  })
})

describe('the unit system cookie', () => {
  it('reads the system a cook picked from the request cookies', () => {
    expect(unitSystemFromCookie('theme=dark; sj_units=metric; other=1')).toBe('metric')
  })

  it.each([['sj_units=kelvin'], ['theme=dark'], [''], [null]])('reads %s as the recipe as written', (header) => {
    expect(unitSystemFromCookie(header)).toBe('original')
  })

  it('writes a site-wide cookie that lasts a year', () => {
    expect(unitSystemCookie('us')).toBe('sj_units=us; Path=/; Max-Age=31536000; SameSite=Lax')
  })
})
