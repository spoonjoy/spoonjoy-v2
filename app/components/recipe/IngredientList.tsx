import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import type { StepReference } from './StepOutputUseCallout'
import type { IngredientIconKey } from '~/lib/ingredient-affordances'
import { formatQuantity, scaleQuantity } from '~/lib/quantity'
import { ChecklistRow } from '~/components/shopping/checklist-row'

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

export interface IngredientListProps {
  /** Array of ingredients to display */
  ingredients: Ingredient[]
  /** Scale factor for quantities (default: 1) */
  scaleFactor?: number
  /** Set of checked ingredient IDs */
  checkedIds?: Set<string>
  /** Callback when an ingredient is toggled */
  onToggle?: (id: string) => void
  /** Whether to show checkboxes (default: true) */
  showCheckboxes?: boolean
  /** Optional step output uses to render at the top of the list */
  stepOutputUses?: StepReference[]
  /** Set of checked step output IDs */
  checkedStepOutputIds?: Set<string>
  /** Callback when a step output is toggled */
  onStepOutputToggle?: (id: string) => void
}

export function getIngredientLayoutTransition(prefersReducedMotion: boolean | null) {
  return prefersReducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.7 }
}

/**
 * A checkable ingredient list with scaled quantities.
 *
 * Features:
 * - Checkboxes for tracking cooking progress
 * - Scaled quantities using ScaledQuantity component
 * - Strikethrough styling for checked items
 * - Large touch targets for kitchen use
 * - Optional step output uses rendered as the same checklist grammar as ingredients
 */
export function IngredientList({
  ingredients,
  scaleFactor = 1,
  checkedIds = new Set(),
  onToggle,
  showCheckboxes = true,
  stepOutputUses = [],
  checkedStepOutputIds = new Set(),
  onStepOutputToggle,
}: IngredientListProps) {
  const prefersReducedMotion = useReducedMotion()
  const hasStepOutputUses = stepOutputUses.length > 0
  const hasIngredients = ingredients.length > 0
  const orderedIngredients = ingredients
    .map((ingredient, index) => ({
      ingredient,
      index,
      checked: checkedIds.has(ingredient.id),
    }))
    .sort((a, b) => {
      if (a.checked === b.checked) {
        return a.index - b.index
      }
      return a.checked ? 1 : -1
    })

  // Return nothing for empty list (no ingredients and no step outputs)
  if (!hasIngredients && !hasStepOutputUses) {
    return null
  }

  const layoutTransition = getIngredientLayoutTransition(prefersReducedMotion)

  return (
    <LayoutGroup>
      <ul
        data-testid="ingredient-list"
        className="m-0 p-0"
      >
        {hasStepOutputUses && (
          <li data-testid="step-output-uses-section" className="contents">
            <ul className="contents">
              {stepOutputUses.map((ref) => {
                const isChecked = checkedStepOutputIds.has(ref.id)
                const shouldShowCheckbox = showCheckboxes && onStepOutputToggle

                return (
                  <motion.li
                    key={ref.id}
                    layout="position"
                    transition={layoutTransition}
                    className="border-b border-[var(--sj-border)]"
                    data-testid={`step-output-item-${ref.id}`}
                  >
                    <ChecklistRow
                      checked={isChecked}
                      name={formatStepReferenceName(ref)}
                      note={isChecked ? 'used' : 'step output'}
                      onToggle={shouldShowCheckbox ? () => onStepOutputToggle(ref.id) : undefined}
                    />
                  </motion.li>
                )
              })}
            </ul>
          </li>
        )}

        {orderedIngredients.map(({ ingredient, checked }) => (
          <motion.li
            key={ingredient.id}
            layout="position"
            transition={layoutTransition}
            className="border-b border-[var(--sj-border)] last:border-b-0"
            data-layout-animation="ingredient-checkoff-reorder"
            data-testid={`ingredient-item-${ingredient.id}`}
          >
            <IngredientRow
              ingredient={ingredient}
              scaleFactor={scaleFactor}
              isChecked={checked}
              showCheckboxes={showCheckboxes}
              onToggle={onToggle}
            />
          </motion.li>
        ))}
      </ul>
    </LayoutGroup>
  )
}

function IngredientRow({
  ingredient,
  scaleFactor,
  isChecked,
  showCheckboxes,
  onToggle,
}: {
  ingredient: Ingredient
  scaleFactor: number
  isChecked: boolean
  showCheckboxes: boolean
  onToggle?: (id: string) => void
}) {
  const quantityText = getScaledAmountLabel(ingredient, scaleFactor)
  const shouldShowCheckbox = showCheckboxes && onToggle

  return (
    <ChecklistRow
      checked={isChecked}
      name={ingredient.name}
      quantity={quantityText}
      quantityTestId={`ingredient-quantity-${ingredient.id}`}
      note={isChecked ? 'used' : ingredient.categoryLabel}
      onToggle={shouldShowCheckbox ? () => onToggle(ingredient.id) : undefined}
    />
  )
}

function getScaledAmountLabel(ingredient: Ingredient, scaleFactor: number) {
  const hasQuantity = ingredient.quantity != null && !Number.isNaN(ingredient.quantity)
  const scaledQuantity = hasQuantity ? scaleQuantity(ingredient.quantity as number, scaleFactor) : null
  const formattedQuantity = scaledQuantity != null ? formatQuantity(scaledQuantity) : ''

  return [formattedQuantity, ingredient.unit].filter(Boolean).join(' ').trim()
}

export function formatStepReferenceName(reference: StepReference) {
  if (reference.stepTitle) {
    return `Step ${reference.stepNumber}: ${reference.stepTitle}`
  }

  return `Step ${reference.stepNumber}`
}
