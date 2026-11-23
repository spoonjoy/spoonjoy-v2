import type { ReactNode } from 'react'
import { IngredientSwapsContext } from './use-ingredient-swaps'

/** Turns ingredient swaps on for the lists inside it that ask for them (cook mode's step list). */
export function IngredientSwapsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <IngredientSwapsContext.Provider value={enabled}>{children}</IngredientSwapsContext.Provider>
}
