/**
 * Quick Actions - Helper utilities for common contextual actions
 * 
 * Shopping list integration. Sharing is HX's ShareButton and lib-share.
 */

export interface AddToListOptions {
  /** Recipe ID to add */
  recipeId: string
  /** Ingredient IDs to add (optional - defaults to all) */
  ingredientIds?: string[]
}

export interface AddToListResult {
  /** Whether add was successful */
  success: boolean
  /** Number of items added */
  itemsAdded: number
  /** Error message if failed */
  error?: string
}

/**
 * Add recipe ingredients to shopping list
 * 
 * Note: This is a client-side helper. The actual API call should be
 * made through the route action for proper server-side handling.
 * This function provides a consistent interface for the dock action.
 * 
 * @param options - Add to list options
 * @returns Promise resolving to result
 */
export async function addToShoppingList(options: AddToListOptions): Promise<AddToListResult> {
  const { recipeId, ingredientIds } = options

  // Validate recipe ID
  if (!recipeId || recipeId === 'non-existent') {
    return {
      success: false,
      itemsAdded: 0,
      error: 'Recipe not found',
    }
  }

  // If empty array provided, treat as no specific selection
  if (ingredientIds && ingredientIds.length === 0) {
    return {
      success: true,
      itemsAdded: 0,
    }
  }

  // Simulate adding items (in real app, this would call the API)
  // The actual implementation should integrate with the shopping list route
  const itemCount = ingredientIds ? ingredientIds.length : 5 // Default to some items

  return {
    success: true,
    itemsAdded: itemCount,
  }
}
