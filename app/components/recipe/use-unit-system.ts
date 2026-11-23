import { createContext, useContext } from 'react'
import type { UnitSystem } from '~/domains/food-knowledge'

export interface UnitSystemValue {
  /** How the cook wants amounts written on this page. */
  system: UnitSystem
  /** Switches the page to `system` and keeps it in this browser for every recipe. */
  setSystem: (system: UnitSystem) => void
  /** Whether the cook may pick a system here (the unit-conversion flag); without it amounts stay as written. */
  enabled: boolean
}

/** Filled by `UnitSystemProvider`; outside one, amounts are as written and there is nothing to pick. */
export const UnitSystemContext = createContext<UnitSystemValue>({ system: 'original', setSystem: () => {}, enabled: false })

/** The unit system amounts are written in here: the recipe as written outside a provider. */
export function useUnitSystem(): UnitSystemValue {
  return useContext(UnitSystemContext)
}
