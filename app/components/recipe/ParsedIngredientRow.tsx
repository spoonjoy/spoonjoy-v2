import { Pencil, Trash2, Check, X } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Button } from '~/components/ouro/button/button'
import { Field } from '~/components/ouro/field/field'
import { FieldControl } from '~/components/ouro/field/field-parts'
import { TextField } from '~/components/ouro/text-field/text-field'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'
import { formatQuantity } from '~/lib/quantity'

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

  if (isEditing) {
    const showQuantityError = showValidation && validationErrors.quantity
    const showUnitError = showValidation && validationErrors.unit
    const showIngredientNameError = showValidation && validationErrors.ingredientName

    return (
      <li className="py-2">
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr] gap-2">
            {/* Ouro UI's TextField has no number type, so the quantity is its Field and control. */}
            <Field label="Quantity" hideLabel required error={showQuantityError || undefined}>
              <FieldControl
                ref={quantityInputRef}
                type="number"
                value={editQuantity}
                onChange={(e) => setEditQuantity(e.target.value)}
                onKeyDown={handleKeyDown}
                step="any"
                min="0.001"
              />
            </Field>
            <TextField
              label="Unit"
              hideLabel
              required
              value={editUnit}
              onChange={(e) => setEditUnit(e.target.value)}
              onKeyDown={handleKeyDown}
              error={showUnitError || undefined}
            />
            <TextField
              label="Ingredient"
              hideLabel
              required
              value={editIngredientName}
              onChange={(e) => setEditIngredientName(e.target.value)}
              onKeyDown={handleKeyDown}
              error={showIngredientNameError || undefined}
            />
          </div>
          <div className="flex gap-1 sm:pt-0.5">
            <Button type="button" onClick={handleSave} aria-label="Save">
              <Check />
            </Button>
            <Button type="button" variant="outline" tone="secondary" onClick={handleCancel} aria-label="Cancel">
              <X />
            </Button>
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
        <Button
          ref={editButtonRef}
          type="button"
          variant="outline" tone="secondary"
          onClick={handleEditClick}
          disabled={disabled}
          aria-label={`Edit ${ingredient.ingredientName}`}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="soft" tone="destructive"
          onClick={() => onRemove(ingredient)}
          disabled={disabled}
          aria-label={`Remove ${ingredient.ingredientName}`}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}
