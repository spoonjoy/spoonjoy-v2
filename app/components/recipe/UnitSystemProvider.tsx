import { useMemo, useState, type ReactNode } from 'react'
import { unitSystemCookie, type UnitSystem } from '~/domains/food-knowledge'
import { UnitSystemContext, type UnitSystemValue } from './use-unit-system'

/**
 * The cook's unit system for everything inside it: the recipe's steps and cook mode. It starts from what the
 * server read from the cook's cookie, so the first render already shows their units.
 */
export function UnitSystemProvider({
  initialSystem,
  children,
}: {
  initialSystem: UnitSystem
  children: ReactNode
}) {
  const [chosen, setChosen] = useState(initialSystem)
  const value = useMemo<UnitSystemValue>(
    () => ({
      system: chosen,
      enabled: true,
      setSystem: (next) => {
        setChosen(next)
        document.cookie = unitSystemCookie(next)
      },
    }),
    [chosen],
  )
  return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>
}
