import { describe, expect, it } from 'vitest'
import { combineAmounts, formatAmountIn } from '~/domains/food-knowledge'

describe('combineAmounts', () => {
  it('adds amounts in the same unit', () => {
    expect(combineAmounts([{ quantity: 1, unit: 'cup' }, { quantity: 2, unit: 'cup' }])).toEqual({ quantity: 3, unit: 'cup' })
  })

  it('adds counted amounts that have no unit', () => {
    expect(combineAmounts([{ quantity: 2, unit: null }, { quantity: 1, unit: null }])).toEqual({ quantity: 3, unit: null })
  })

  it('adds a unit written two ways, in the first way', () => {
    expect(combineAmounts([{ quantity: 1, unit: 'clove' }, { quantity: 2, unit: 'clove' }])).toEqual({ quantity: 3, unit: 'clove' })
    expect(combineAmounts([{ quantity: 1, unit: 'cups' }, { quantity: 1, unit: 'cup' }])).toEqual({ quantity: 2, unit: 'cups' })
  })

  it('adds volumes in different units, in the first unit', () => {
    const total = combineAmounts([{ quantity: 1, unit: 'cup' }, { quantity: 100, unit: 'ml' }])!
    expect(total.unit).toBe('cup')
    expect(total.quantity).toBeCloseTo(1 + 100 / 236.5882365)
    expect(formatAmountIn('metric', total.quantity, total.unit)).toBe('335 ml')
  })

  it('adds weights in different units, in the first unit', () => {
    const total = combineAmounts([{ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'lb' }])!
    expect(total.unit).toBe('g')
    expect(total.quantity).toBeCloseTo(953.59237)
  })

  it('reads a quantity written as text', () => {
    expect(combineAmounts([{ quantity: '1.5', unit: 'cup' }, { quantity: 1, unit: 'cup' }])).toEqual({ quantity: 2.5, unit: 'cup' })
  })

  it.each([
    ['a volume and a weight', [{ quantity: 1, unit: 'cup' }, { quantity: 100, unit: 'g' }]],
    ['a counted amount and a measured one', [{ quantity: 2, unit: null }, { quantity: 100, unit: 'g' }]],
    ['two different unknown units', [{ quantity: 1, unit: 'clove' }, { quantity: 1, unit: 'head' }]],
    ['an amount with no quantity', [{ quantity: null, unit: 'cup' }, { quantity: 1, unit: 'cup' }]],
    ['a quantity that is not a number', [{ quantity: 'some', unit: 'cup' }, { quantity: 1, unit: 'cup' }]],
    ['nothing', []],
  ] as const)('leaves %s apart', (_name, amounts) => {
    expect(combineAmounts(amounts)).toBeNull()
  })
})
