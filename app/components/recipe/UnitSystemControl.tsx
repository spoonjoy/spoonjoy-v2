import { SegmentedControl } from '~/components/ouro/segmented-control/segmented-control'
import { parseUnitSystem, UNIT_SYSTEMS } from '~/domains/food-knowledge'
import { useUnitSystem } from './use-unit-system'

/** Picks how the recipe's amounts are written: as the recipe has them, metric, US or imperial. */
export function UnitSystemControl() {
  const { system, setSystem, enabled } = useUnitSystem()
  if (!enabled) return null
  return (
    <SegmentedControl
      label="Units"
      items={UNIT_SYSTEMS}
      value={system}
      fullWidth
      onValueChange={(value) => setSystem(parseUnitSystem(value))}
    />
  )
}
