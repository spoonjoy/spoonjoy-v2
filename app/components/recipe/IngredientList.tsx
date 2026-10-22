import { Checklist, type ChecklistItemData } from '~/components/ouro/checklist/checklist'
import type { IngredientIconKey } from '~/lib/ingredient-affordances'
import { formatAmount, scaleQuantity } from '~/lib/quantity'

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
  /** Earlier steps' outputs this step uses, listed before the ingredients */
  stepOutputUses: StepReference[]
  /** Step output ids the cook has ticked off */
  checkedStepOutputIds: ReadonlySet<string>
  /** Called with a step output's id when it is ticked or unticked */
  onStepOutputToggle: (id: string) => void
}

/**
 * A step's ingredients as Ouro HX's `Checklist`: the outputs of earlier steps first, then each
 * ingredient with its scaled amount and aisle. Ticking a row is the cook's progress; the
 * checklist draws the tick and the strike.
 */
export function IngredientList({
  ingredients,
  scaleFactor = 1,
  checkedIds,
  onToggle,
  stepOutputUses,
  checkedStepOutputIds,
  onStepOutputToggle,
}: IngredientListProps) {
  if (ingredients.length === 0 && stepOutputUses.length === 0) {
    return null
  }

  const outputIds = new Set(stepOutputUses.map((reference) => reference.id))
  const items: ChecklistItemData[] = [
    ...stepOutputUses.map((reference) => ({
      id: reference.id,
      label: formatStepReferenceName(reference),
      description: 'Step output',
      checked: checkedStepOutputIds.has(reference.id),
    })),
    ...ingredients.map((ingredient) => ({
      id: ingredient.id,
      label: ingredient.name,
      description: ingredient.categoryLabel,
      value: formatScaledAmount(ingredient, scaleFactor) || undefined,
      checked: checkedIds.has(ingredient.id),
    })),
  ]

  return (
    <Checklist
      label="Ingredients"
      items={items}
      onCheckedChange={(id) => (outputIds.has(id) ? onStepOutputToggle(id) : onToggle(id))}
    />
  )
}

/** An ingredient's amount at the recipe's scale: "1 ½ cups", or "" with neither a quantity nor a unit. */
export function formatScaledAmount(ingredient: Ingredient, scaleFactor: number) {
  const hasQuantity = ingredient.quantity != null && !Number.isNaN(ingredient.quantity)
  const scaledQuantity = hasQuantity ? scaleQuantity(ingredient.quantity as number, scaleFactor) : null

  return formatAmount(scaledQuantity, ingredient.unit)
}

export function formatStepReferenceName(reference: StepReference) {
  if (reference.stepTitle) {
    return `Step ${reference.stepNumber}: ${reference.stepTitle}`
  }

  return `Step ${reference.stepNumber}`
}
