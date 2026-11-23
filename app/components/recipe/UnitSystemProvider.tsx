import { useMemo, useState, type ReactNode } from 'react'
import { unitSystemCookie, type UnitSystem } from '~/domains/food-knowledge'
import { UnitSystemContext, type UnitSystemValue } from './use-unit-system'

/**
 * The cook's unit system for everything inside it: the recipe's steps and cook mode. It starts from what the
 * server read from the cook's cookie, so the first render already shows their units. The page passes whether
 * unit conversion is on for this cook, so the steps and cook mode need no router to know it.
 */
export function UnitSystemProvider({
  initialSystem,
  enabled,
  children,
}: {
  initialSystem: UnitSystem
  enabled: boolean
  children: ReactNode
}) {
  const [chosen, setChosen] = useState(initialSystem)
  const value = useMemo<UnitSystemValue>(
    () => ({
      system: enabled ? chosen : 'original',
      enabled,
      setSystem: (next) => {
        setChosen(next)
        document.cookie = unitSystemCookie(next)
      },
    }),
    [chosen, enabled],
  )
  return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>
}
