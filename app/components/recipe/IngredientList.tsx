import { useLayoutEffect, useMemo, useRef } from 'react'
import { Checklist, type ChecklistItemData } from '~/components/ouro/checklist/checklist'
import type { IngredientIconKey } from '~/lib/ingredient-affordances'
import { formatAmountIn, scaleQuantity, swapsFor, type UnitSystem } from "~/domains/food-knowledge"
import { useUnitSystem } from "./use-unit-system"
import { useIngredientSwaps } from "./use-ingredient-swaps"

export interface Ingredient {
  /** Unique identifier */
  id: string
  /** Base quantity (before scaling) */
  quantity: number | null
  /** Unit of measurement (e.g., "cups", "tbsp") */
  unit: string
  /** Ingredient name */
  name: string
  /** Optional shopping affordance category label */
  categoryLabel?: string
  /** Optional shopping affordance icon key */
  iconKey?: IngredientIconKey
}

/** An earlier step whose output this step uses, ticked off like an ingredient. */
export interface StepReference {
  /** Unique identifier */
  id: string
  /** The step number being referenced */
  stepNumber: number
  /** Optional human-readable step title */
  stepTitle: string | null
}

export interface IngredientListProps {
  /** The step's ingredients, in recipe order */
  ingredients: Ingredient[]
  /** Scale factor for quantities (default: 1) */
  scaleFactor?: number
  /** Ingredient ids the cook has ticked off */
  checkedIds: ReadonlySet<string>
  /** Called with an ingredient's id when it is ticked or unticked */
  onToggle: (id: string) => void
  /** Show each ingredient's swaps after its aisle, where swaps are on (cook mode's step list) */
  showSwaps?: boolean
  /** Earlier steps' outputs this step uses, listed before the ingredients */
  stepOutputUses: StepReference[]
  /** Step output ids the cook has ticked off */
  checkedStepOutputIds: ReadonlySet<string>
  /**
   * Keeps the list's "Ingredients" name for screen readers only, where a heading over it already
   * names it (cook mode's "For this step").
   */
  hideLabel?: boolean
  /** Called with a step output's id when it is ticked or unticked */
  onStepOutputToggle: (id: string) => void
}

/** How long a row takes to slide to its new place when a check reorders the list. */
export const SINK_DURATION_MS = 320

/**
 * Unchecked rows first, then checked ones, each group in recipe order: a ticked ingredient sinks
 * to the bottom so what is left to add stays on top (Ari's ask).
 */
export function uncheckedFirst<T extends { checked: boolean }>(items: readonly T[]): T[] {
  return [...items.filter((item) => !item.checked), ...items.filter((item) => item.checked)]
}

/**
 * Slides each checklist row from where it was to where a reorder put it. React keeps a row's
 * element when its place changes, so the element's last measured top is its old place. Rows only
 * move when the order changes, and never with `prefers-reduced-motion: reduce`.
 */
function useSinkMotion(order: string) {
  const root = useRef<HTMLDivElement>(null)
  const tops = useRef(new Map<Element, number>())
  const lastOrder = useRef(order)

  useLayoutEffect(() => {
    const list = root.current
    if (!list) return
    const origin = list.getBoundingClientRect().top
    const rows = [...list.querySelectorAll('[data-slot="checklist-row"]')]
    const next = new Map(rows.map((row) => [row, row.getBoundingClientRect().top - origin] as const))
    const reordered = lastOrder.current !== order
    lastOrder.current = order
    const previous = tops.current
    tops.current = next
    if (!reordered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const [row, top] of next) {
      const from = previous.get(row)
      if (from === undefined || from === top) continue
      row.animate([{ transform: `translateY(${from - top}px)` }, { transform: 'none' }], {
        duration: SINK_DURATION_MS,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
    }
  })

  return root
}

/**
 * A step's ingredients as Ouro HX's `Checklist`: the outputs of earlier steps, then each
 * ingredient with its scaled amount and aisle, with checked rows sunk below the unchecked ones.
 * Ticking a row is the cook's progress; the checklist draws the tick and the strike.
 */
export function IngredientList({
  ingredients,
  scaleFactor = 1,
  checkedIds,
  onToggle,
  stepOutputUses,
  checkedStepOutputIds,
  onStepOutputToggle,
  hideLabel = false,
  showSwaps = false,
}: IngredientListProps) {
  const { system } = useUnitSystem()
  const swapsOn = useIngredientSwaps() && showSwaps
  const outputIds = useMemo(() => new Set(stepOutputUses.map((reference) => reference.id)), [stepOutputUses])
  const items: ChecklistItemData[] = uncheckedFirst([
    ...stepOutputUses.map((reference) => ({
      id: reference.id,
      label: formatStepReferenceName(reference),
      description: 'Step output',
      checked: checkedStepOutputIds.has(reference.id),
    })),
    ...ingredients.map((ingredient) => ({
      id: ingredient.id,
      label: ingredient.name,
      description: swapsOn ? withSwaps(ingredient) : ingredient.categoryLabel,
      value: formatScaledAmount(ingredient, scaleFactor, system) || undefined,
      checked: checkedIds.has(ingredient.id),
    })),
  ])
  const root = useSinkMotion(items.map((item) => item.id).join('\n'))

  if (items.length === 0) {
    return null
  }

  return (
    <Checklist
      ref={root}
      label="Ingredients"
      hideLabel={hideLabel}
      items={items}
      onCheckedChange={(id) => (outputIds.has(id) ? onStepOutputToggle(id) : onToggle(id))}
    />
  )
}

/** An ingredient's aisle, then what to use instead of it: "Dairy · Swap: plain Greek yogurt". */
function withSwaps(ingredient: Ingredient) {
  const swaps = swapsFor(ingredient.name)
  const swapText = swaps.length > 0 ? `Swap: ${swaps.join('; ')}` : undefined
  return [ingredient.categoryLabel, swapText].filter(Boolean).join(' · ') || undefined
}

/** An ingredient's amount at the recipe's scale, in the cook's units: "1 ½ cups", or "" with neither a quantity nor a unit. */
export function formatScaledAmount(ingredient: Ingredient, scaleFactor: number, system: UnitSystem = 'original') {
  const hasQuantity = ingredient.quantity != null && !Number.isNaN(ingredient.quantity)
  const scaledQuantity = hasQuantity ? scaleQuantity(ingredient.quantity as number, scaleFactor) : null

  return formatAmountIn(system, scaledQuantity, ingredient.unit)
}

export function formatStepReferenceName(reference: StepReference) {
  if (reference.stepTitle) {
    return `Step ${reference.stepNumber}: ${reference.stepTitle}`
  }

  return `Step ${reference.stepNumber}`
}
