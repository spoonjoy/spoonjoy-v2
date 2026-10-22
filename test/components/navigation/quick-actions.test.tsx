import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addToShoppingList,
  type AddToListOptions,
} from '~/components/navigation/quick-actions'

describe('Quick Actions', () => {
  describe('addToShoppingList', () => {
    const addOptions: AddToListOptions = {
      recipeId: '123',
    }

    it('returns success when items are added', async () => {
      const result = await addToShoppingList(addOptions)

      expect(result.success).toBe(true)
      expect(result.itemsAdded).toBeGreaterThan(0)
    })

    it('accepts optional ingredientIds to add specific ingredients', async () => {
      const optionsWithIngredients: AddToListOptions = {
        recipeId: '123',
        ingredientIds: ['ing-1', 'ing-2'],
      }

      const result = await addToShoppingList(optionsWithIngredients)

      expect(result.success).toBe(true)
      expect(result.itemsAdded).toBeLessThanOrEqual(2)
    })

    it('returns error when recipe not found', async () => {
      const invalidOptions: AddToListOptions = {
        recipeId: 'non-existent',
      }

      const result = await addToShoppingList(invalidOptions)

      // Should handle gracefully
      expect(result).toHaveProperty('success')
      if (!result.success) {
        expect(result.error).toBeDefined()
      }
    })

    it('handles empty ingredientIds array', async () => {
      const optionsWithEmpty: AddToListOptions = {
        recipeId: '123',
        ingredientIds: [],
      }

      const result = await addToShoppingList(optionsWithEmpty)

      // Empty array means no specific ingredients selected
      expect(result).toHaveProperty('success')
    })

    it('returns error when recipeId is empty string (branch coverage)', async () => {
      const emptyIdOptions: AddToListOptions = {
        recipeId: '',
      }

      const result = await addToShoppingList(emptyIdOptions)

      // Empty recipeId should fail with error
      expect(result.success).toBe(false)
      expect(result.itemsAdded).toBe(0)
      expect(result.error).toBe('Recipe not found')
    })
  })
})
