import { describe, expect, it } from 'vitest'
import { swapsFor } from '~/domains/food-knowledge'

describe('swapsFor', () => {
  it('offers the swaps for an ingredient by its name', () => {
    expect(swapsFor('buttermilk')).toEqual([
      'milk with 1 tbsp lemon juice or vinegar per cup, left 5 minutes',
      'plain yogurt thinned with a little milk',
    ])
  })

  it.each([
    ['Eggs'],
    ['large eggs'],
    ['egg'],
  ])('reads %s as egg, whatever its case, number or size', (name) => {
    expect(swapsFor(name)[0]).toBe('in baking, 1 tbsp ground flaxseed stirred into 3 tbsp water per egg')
  })

  it('reads a word a cook puts before the food, such as unsalted', () => {
    expect(swapsFor('unsalted butter')).toEqual(['in cooking, olive oil, ¾ as much'])
  })

  it.each([['peanut butter'], ['egg noodles'], ['buttermilk pancakes'], ['saffron'], [''], [null], [undefined]])(
    'offers nothing for %s',
    (name) => {
      expect(swapsFor(name)).toEqual([])
    },
  )

  it('knows another name for the same food', () => {
    expect(swapsFor('self-rising flour')).toEqual(swapsFor('self-raising flour'))
    expect(swapsFor('self-raising flour')).toHaveLength(1)
  })
})
