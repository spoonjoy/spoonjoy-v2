import { Checkbox } from '../ui/checkbox'
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

/**
 * A checkable ingredient list with scaled quantities.
 *
 * Features:
 * - Checkboxes for tracking cooking progress
 * - Scaled quantities using ScaledQuantity component
 * - Strikethrough styling for checked items
 * - Large touch targets for kitchen use
 * - Optional step output uses rendered at the top with amber styling
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

  return (
    <ul
      data-testid="ingredient-list"
      className="space-y-2"
    >
      {hasStepOutputUses && (
        <li data-testid="step-output-uses-section" className="border-l border-[var(--sj-brass)] pl-4">
          <ul className="space-y-2 py-1">
            {stepOutputUses.map((ref) => {
              const isChecked = checkedStepOutputIds.has(ref.id)
              const shouldShowCheckbox = showCheckboxes && onStepOutputToggle

              if (shouldShowCheckbox) {
                return (
                  <li key={ref.id}>
                    <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onStepOutputToggle(ref.id)}
                        className={`min-h-11 min-w-0 text-left text-sm transition-colors ${
                          isChecked
                            ? 'line-through text-[var(--sj-ink-soft)] opacity-60'
                            : 'text-[var(--sj-ink-soft)]'
                        }`}
                      >
                        <StepReferenceText reference={ref} />
                      </button>
                      <Checkbox
                        checked={isChecked}
                        onChange={() => onStepOutputToggle(ref.id)}
                        aria-label={`Mark Step ${ref.stepNumber}${ref.stepTitle ? `: ${ref.stepTitle}` : ''} as used`}
                      />
                    </div>
                  </li>
                )
              }

              return (
                <li key={ref.id}>
                  <span className="text-sm text-[var(--sj-ink-soft)]">
                    <StepReferenceText reference={ref} />
                  </span>
                </li>
              )
            })}
          </ul>
        </li>
      )}

      {orderedIngredients.map(({ ingredient, checked }) => (
        <li
          key={ingredient.id}
          className="border-b border-[var(--sj-border)] last:border-b-0"
          data-testid={`ingredient-item-${ingredient.id}`}
        >
          <IngredientRow
            ingredient={ingredient}
            scaleFactor={scaleFactor}
            isChecked={checked}
            showCheckboxes={showCheckboxes}
            onToggle={onToggle}
          />
        </li>
      ))}
    </ul>
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

function StepReferenceText({ reference }: { reference: StepReference }) {
  if (reference.stepTitle) {
    return (
      <>
        <span className="font-medium">Step {reference.stepNumber}</span>
        {': '}
        {reference.stepTitle}
      </>
    )
  }

  return <span className="font-medium">Step {reference.stepNumber}</span>
}
