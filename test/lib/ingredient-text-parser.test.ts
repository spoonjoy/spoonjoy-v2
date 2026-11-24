import { describe, expect, it } from 'vitest'
import { UNIT_NAMES, resolveUnit } from '~/domains/food-knowledge'
import { MEASURED_UNIT_WRITTEN, parseIngredientLine, parseIngredientText } from '~/lib/ingredient-text-parser'

// The same cases as the native editor's IngredientTextParserTests (spoonjoy-apple), so the web
// fallback and the native parser agree line for line.

const parsed = (line: string) => parseIngredientLine(line)

describe('rule-based ingredient text parser', () => {
  it('turns a pasted block into one row per line', () => {
    expect(parseIngredientText('2 cups rice\n3 large eggs\n\n  \n1 tbsp soy sauce\r\n1 lb spaghetti\r2 tbsp kosher salt')).toEqual([
      { quantity: 2, unit: 'cup', ingredientName: 'rice' },
      { quantity: 3, unit: 'large', ingredientName: 'eggs' },
      { quantity: 1, unit: 'tbsp', ingredientName: 'soy sauce' },
      { quantity: 1, unit: 'lb', ingredientName: 'spaghetti' },
      { quantity: 2, unit: 'tbsp', ingredientName: 'kosher salt' },
    ])
    expect(parseIngredientText('   \n')).toEqual([])
  })

  it('reads fractions, mixed numbers, unicode fractions and decimals', () => {
    expect(parsed('1/2 cup milk')?.quantity).toBe(0.5)
    expect(parsed('3/4 cup milk')?.quantity).toBe(0.75)
    expect(parsed('1 1/2 cups flour')?.quantity).toBe(1.5)
    expect(parsed('1½ cups flour')?.quantity).toBe(1.5)
    expect(parsed('1 ½ cups flour')?.quantity).toBe(1.5)
    expect(parsed('½ tsp salt')?.quantity).toBe(0.5)
    expect(parsed('¼ tsp salt')?.quantity).toBe(0.25)
    expect(parsed('2.5 lb potatoes')?.quantity).toBe(2.5)
    expect(parsed('.5 cup milk')?.quantity).toBe(0.5)
    expect(parsed('4/2 cup milk')?.quantity).toBe(2)
    expect(parsed('1/0 cup milk')).toEqual({ quantity: 1, unit: 'whole', ingredientName: '1/0 cup milk' })
    expect(parsed('/2 cup milk')).toEqual({ quantity: 1, unit: 'whole', ingredientName: '/2 cup milk' })
    expect(parsed('1/2/3 cup milk')).toEqual({ quantity: 1, unit: 'whole', ingredientName: '1/2/3 cup milk' })
    expect(parsed('1.2.3 cup milk')).toEqual({ quantity: 1, unit: 'whole', ingredientName: '1.2.3 cup milk' })
    expect(parsed('2 1 cup milk')?.quantity).toBe(2)
    expect(parsed('1.5 1/2 cup milk')).toEqual({ quantity: 1.5, unit: 'whole', ingredientName: '1/2 cup milk' })
    expect(parsed('1/2 1/2 cup milk')).toEqual({ quantity: 0.5, unit: 'whole', ingredientName: '1/2 cup milk' })
  })

  it('keeps the lower number of a range', () => {
    expect(parsed('2-3 cups rice')?.quantity).toBe(2)
    expect(parsed('2 – 3 cups rice')?.quantity).toBe(2)
    expect(parsed('2 to 3 cups rice')).toEqual({ quantity: 2, unit: 'cup', ingredientName: 'rice' })
    expect(parsed('2 - cups rice')?.ingredientName).toBe('- cups rice')
  })

  it('ignores approximate words and list bullets', () => {
    expect(parsed('about 2 cups rice')?.quantity).toBe(2)
    expect(parsed('Approximately about 2 cups rice')?.ingredientName).toBe('rice')
    expect(parsed('approx. 2 cups rice')?.quantity).toBe(2)
    expect(parsed('~2 cups rice')?.quantity).toBe(2)
    expect(parsed('- 2 cups rice')?.ingredientName).toBe('rice')
    expect(parsed('• 2 cups rice')?.ingredientName).toBe('rice')
    expect(parsed('* - 2 cups rice')?.ingredientName).toBe('rice')
    expect(parsed('-rice')?.ingredientName).toBe('-rice')
  })

  it('normalizes units to singular standard forms', () => {
    const cases: Array<[string, string]> = [
      ['1 cups a', 'cup'], ['1 Tablespoons a', 'tbsp'], ['1 tbsp. a', 'tbsp'], ['1 teaspoon a', 'tsp'],
      ['1 ounces a', 'oz'], ['1 lbs a', 'lb'], ['1 pounds a', 'lb'], ['1 grams a', 'g'],
      ['1 kilograms a', 'kg'], ['1 millilitres a', 'ml'], ['1 liters a', 'l'], ['1 cloves a', 'clove'],
      ['1 pinches a', 'pinch'], ['1 dashes a', 'dash'], ['1 cans a', 'can'], ['1 slices a', 'slice'],
      ['1 pieces a', 'piece'], ['1 sticks a', 'stick'], ['1 bunches a', 'bunch'], ['1 sprigs a', 'sprig'],
      ['1 heads a', 'head'], ['1 pkg a', 'package'], ['1 Small a', 'small'], ['1 medium a', 'medium'], ['1 large a', 'large'],
    ]
    for (const [line, unit] of cases) expect(parsed(line)?.unit, line).toBe(unit)
  })

  it('uses whole for countable items and drops "of" after a unit', () => {
    expect(parsed('2 eggs')).toEqual({ quantity: 2, unit: 'whole', ingredientName: 'eggs' })
    expect(parsed('3 cloves of garlic')).toEqual({ quantity: 3, unit: 'clove', ingredientName: 'garlic' })
    expect(parsed('pinch of salt')).toEqual({ quantity: 1, unit: 'pinch', ingredientName: 'salt' })
    expect(parsed('2 cups Of rice')?.ingredientName).toBe('rice')
    expect(parsed('salt')).toEqual({ quantity: 1, unit: 'whole', ingredientName: 'salt' })
  })

  it('keeps prep notes and modifiers in the name', () => {
    expect(parsed('1 cup flour, sifted')?.ingredientName).toBe('flour, sifted')
    expect(parsed('2 tbsp extra virgin olive oil')?.ingredientName).toBe('extra virgin olive oil')
  })

  it('skips lines without an ingredient name', () => {
    for (const line of ['', '   ', '2 cups', '2', '- ']) expect(parsed(line), JSON.stringify(line)).toBeNull()
  })

  // Every unit the unit table converts is one the parser reads: each name and abbreviation, in a
  // few real-looking lines, comes out as that unit's written form, which the table reads back.
  describe('reads every unit in the unit table', () => {
    const names = [...UNIT_NAMES]

    it('writes each measured unit in a form the unit table reads back as the same unit', () => {
      const slugs = new Set(UNIT_NAMES.values())
      expect(Object.keys(MEASURED_UNIT_WRITTEN).sort()).toEqual([...slugs].sort())
      for (const [slug, written] of Object.entries(MEASURED_UNIT_WRITTEN)) {
        expect(resolveUnit(written), written).toMatchObject({ slug })
      }
    })

    it.each(names)('reads "%s"', (name, slug) => {
      const unit = MEASURED_UNIT_WRITTEN[slug]
      expect(parsed(`2 ${name} chicken stock`), name).toEqual({ quantity: 2, unit, ingredientName: 'chicken stock' })
      expect(parsed(`1 1/2 ${name} of milk`), name).toEqual({ quantity: 1.5, unit, ingredientName: 'milk' })
      expect(parsed(`½ ${name.toUpperCase()} flour, sifted`), name).toEqual({ quantity: 0.5, unit, ingredientName: 'flour, sifted' })
      const dotted = name.replace(/(\S+)$/, '$1.')
      expect(parsed(`- about 3 ${dotted} water`), dotted).toEqual({ quantity: 3, unit, ingredientName: 'water' })
    })

    it('reads the lines cooks write', () => {
      const cases: Array<[string, { quantity: number; unit: string; ingredientName: string }]> = [
        ['1 quart chicken stock', { quantity: 1, unit: 'qt', ingredientName: 'chicken stock' }],
        ['2 qts stock', { quantity: 2, unit: 'qt', ingredientName: 'stock' }],
        ['1 tbsp oil', { quantity: 1, unit: 'tbsp', ingredientName: 'oil' }],
        ['½ cup flour', { quantity: 0.5, unit: 'cup', ingredientName: 'flour' }],
        ['3 cloves garlic', { quantity: 3, unit: 'clove', ingredientName: 'garlic' }],
        ['8 fl oz cream', { quantity: 8, unit: 'fl oz', ingredientName: 'cream' }],
        ['1 pint milk', { quantity: 1, unit: 'pt', ingredientName: 'milk' }],
        ['1 gallon water', { quantity: 1, unit: 'gal', ingredientName: 'water' }],
        ['2 dl cream', { quantity: 2, unit: 'dl', ingredientName: 'cream' }],
        ['1 UK pint ale', { quantity: 1, unit: 'imperial pint', ingredientName: 'ale' }],
        ['500 mg saffron', { quantity: 500, unit: 'mg', ingredientName: 'saffron' }],
        ['1 kilo potatoes', { quantity: 1, unit: 'kg', ingredientName: 'potatoes' }],
        ['2 T butter', { quantity: 2, unit: 'tbsp', ingredientName: 'butter' }],
      ]
      for (const [line, expected] of cases) expect(parsed(line), line).toEqual(expected)
    })
  })
})
