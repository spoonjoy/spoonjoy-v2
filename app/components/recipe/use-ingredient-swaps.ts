import { createContext, useContext } from 'react'

/** Whether ingredient swaps are on here (the ingredient-swaps flag); off outside a provider. */
export const IngredientSwapsContext = createContext(false)

/** Whether a list that asks for swaps may show them. */
export function useIngredientSwaps(): boolean {
  return useContext(IngredientSwapsContext)
}
