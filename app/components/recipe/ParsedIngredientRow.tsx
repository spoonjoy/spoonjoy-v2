import clsx from 'clsx'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Input } from '~/components/ui/input'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

// Button styles extracted from ~/components/ui/button.tsx for native button compatibility
const iconButtonBaseStyles = [
  'font-sj-ui relative isolate inline-flex items-center justify-center rounded-full border text-sm/6 font-semibold',
  'min-h-11 min-w-11', // 44px minimum touch target
  'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--sj-brass)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
]

const iconButtonPlainStyles = [
  'border-transparent',
  'text-[var(--sj-ink)] hover:bg-[var(--sj-flour)]',
]

const iconButtonGreenStyles = [
  'border-transparent',
  'text-[var(--sj-herb)] hover:bg-[color-mix(in_srgb,var(--sj-herb)_10%,transparent)]',
]

const iconButtonRedStyles = [
  'border-transparent',
  'text-[var(--sj-tomato)] hover:bg-[color-mix(in_srgb,var(--sj-tomato)_10%,transparent)]',
]

interface ValidationErrors {
  quantity?: string
  unit?: string
  ingredientName?: string
}

/**
 * Validates ingredient fields and returns any errors.
 */
function validateIngredientFields(
  quantity: string,
  unit: string,
  ingredientName: string
): ValidationErrors {
  const errors: ValidationErrors = {}

  // Validate quantity
  if (!quantity.trim()) {
    errors.quantity = 'Required'
  } else {
    const parsedQuantity = parseFloat(quantity)
    if (isNaN(parsedQuantity)) {
      errors.quantity = 'Must be a number'
    } else if (parsedQuantity <= 0) {
      errors.quantity = 'Must be positive'
    }
  }

  // Validate unit
  if (!unit.trim()) {
    errors.unit = 'Required'
  }

  // Validate ingredient name
  if (!ingredientName.trim()) {
    errors.ingredientName = 'Required'
  }

  return errors
}

export interface ParsedIngredientRowProps {
  ingredient: ParsedIngredient
  onEdit: (ingredient: ParsedIngredient) => void
  onRemove: (ingredient: ParsedIngredient) => void
  disabled?: boolean
}

export function ParsedIngredientRow({
  ingredient,
  onEdit,
  onRemove,
  disabled = false,
}: ParsedIngredientRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editQuantity, setEditQuantity] = useState<string>(String(ingredient.quantity))
  const [editUnit, setEditUnit] = useState(ingredient.unit)
  const [editIngredientName, setEditIngredientName] = useState(ingredient.ingredientName)
  const [showValidation, setShowValidation] = useState(false)

  // Refs for focus management
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  // Real-time validation
  const validationErrors = useMemo(
    () => validateIngredientFields(editQuantity, editUnit, editIngredientName),
    [editQuantity, editUnit, editIngredientName]
  )

  const hasErrors = Object.keys(validationErrors).length > 0

  // Focus first input when entering edit mode
  useEffect(() => {
    if (isEditing && quantityInputRef.current) {
      quantityInputRef.current.focus()
    }
  }, [isEditing])

  const handleEditClick = () => {
    // Reset edit values to current ingredient values
    setEditQuantity(String(ingredient.quantity))
    setEditUnit(ingredient.unit)
    setEditIngredientName(ingredient.ingredientName)
    setShowValidation(false)
    setIsEditing(true)
  }

  const handleSave = () => {
    // Show validation errors if any
    if (hasErrors) {
      setShowValidation(true)
      return
    }

    const trimmedUnit = editUnit.trim()
    const trimmedIngredientName = editIngredientName.trim()
    const parsedQuantity = parseFloat(editQuantity)

    onEdit({
      quantity: parsedQuantity,
      unit: trimmedUnit,
      ingredientName: trimmedIngredientName,
    })
    setIsEditing(false)
    setShowValidation(false)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setShowValidation(false)
    // Return focus to edit button after exiting edit mode
    requestAnimationFrame(() => {
      editButtonRef.current?.focus()
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  // Format quantity - show decimals only if needed
  const formatQuantity = (qty: number): string => {
    return Number.isInteger(qty) ? String(qty) : String(qty)
  }

  if (isEditing) {
    const showQuantityError = showValidation && validationErrors.quantity
    const showUnitError = showValidation && validationErrors.unit
    const showIngredientNameError = showValidation && validationErrors.ingredientName

    return (
      <li className="py-2" onKeyDown={handleKeyDown}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr] gap-2">
            <div>
              <label htmlFor="edit-quantity" className="sr-only">
                Quantity
              </label>
              <Input
                ref={quantityInputRef}
                type="number"
                id="edit-quantity"
                value={editQuantity}
                onChange={(e) => setEditQuantity(e.target.value)}
                step="any"
                min="0.001"
                required
                aria-label="Quantity"
                aria-invalid={showQuantityError ? 'true' : undefined}
                aria-describedby={showQuantityError ? 'edit-quantity-error' : undefined}
                invalid={!!showQuantityError}
              />
              {showQuantityError && (
                <p id="edit-quantity-error" className="mt-1 text-xs text-[var(--sj-tomato)]">
                  {validationErrors.quantity}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="edit-unit" className="sr-only">
                Unit
              </label>
              <Input
                type="text"
                id="edit-unit"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
                required
                aria-label="Unit"
                aria-invalid={showUnitError ? 'true' : undefined}
                aria-describedby={showUnitError ? 'edit-unit-error' : undefined}
                invalid={!!showUnitError}
              />
              {showUnitError && (
                <p id="edit-unit-error" className="mt-1 text-xs text-[var(--sj-tomato)]">
                  {validationErrors.unit}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="edit-ingredient" className="sr-only">
                Ingredient
              </label>
              <Input
                type="text"
                id="edit-ingredient"
                value={editIngredientName}
                onChange={(e) => setEditIngredientName(e.target.value)}
                required
                aria-label="Ingredient"
                aria-invalid={showIngredientNameError ? 'true' : undefined}
                aria-describedby={showIngredientNameError ? 'edit-ingredient-error' : undefined}
                invalid={!!showIngredientNameError}
              />
              {showIngredientNameError && (
                <p id="edit-ingredient-error" className="mt-1 text-xs text-[var(--sj-tomato)]">
                  {validationErrors.ingredientName}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-1 sm:pt-0.5">
            <button
              type="button"
              onClick={handleSave}
              className={clsx(iconButtonBaseStyles, iconButtonGreenStyles, 'cursor-default')}
              aria-label="Save"
            >
              <Check className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className={clsx(iconButtonBaseStyles, iconButtonPlainStyles, 'cursor-default')}
              aria-label="Cancel"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex-1 flex items-center gap-2 flex-wrap">
        <span className="font-medium">{formatQuantity(ingredient.quantity)}</span>
        <span className="text-[var(--sj-ink-soft)]">{ingredient.unit}</span>
        <span>{ingredient.ingredientName}</span>
      </div>
      <div className="flex gap-1">
        <button
          ref={editButtonRef}
          type="button"
          onClick={handleEditClick}
          disabled={disabled}
          className={clsx(iconButtonBaseStyles, iconButtonPlainStyles, 'cursor-default')}
          aria-label={`Edit ${ingredient.ingredientName}`}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(ingredient)}
          disabled={disabled}
          className={clsx(iconButtonBaseStyles, iconButtonRedStyles, 'cursor-default')}
          aria-label={`Remove ${ingredient.ingredientName}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}
