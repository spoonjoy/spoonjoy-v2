import { useState } from 'react'
import { Button } from '~/components/button'
import { Field } from '~/components/ouro/field/field'
import { FieldControl } from '~/components/ouro/field/field-parts'
import { TextField } from '~/components/ouro/text-field/text-field'
import {
  INGREDIENT_NAME_MAX_LENGTH,
  QUANTITY_MAX,
  QUANTITY_MIN,
  UNIT_NAME_MAX_LENGTH,
} from '~/lib/validation'

export interface ManualIngredientInputProps {
  onAdd: (ingredient: { quantity: number; unit: string; ingredientName: string }) => void
  disabled?: boolean
  loading?: boolean
}

export function ManualIngredientInput({
  onAdd,
  disabled = false,
  loading = false,
}: ManualIngredientInputProps) {
  const [quantity, setQuantity] = useState<string>('')
  const [unit, setUnit] = useState('')
  const [ingredientName, setIngredientName] = useState('')

  const isDisabled = disabled || loading

  // Not a <form>: this sits inside the Add Step page's own form, and a nested
  // form is invalid HTML. The fields have no name and are not `required`, so
  // they neither travel with nor block that form's submission; Enter adds the
  // ingredient here instead of submitting it. aria-required describes this local
  // add operation without adding a blocking constraint to the surrounding form.
  const handleAdd = () => {
    const trimmedUnit = unit.trim()
    const trimmedIngredientName = ingredientName.trim()
    const parsedQuantity = parseFloat(quantity)

    // Validate all fields are present
    if (!quantity || !trimmedUnit || !trimmedIngredientName) {
      return
    }

    // Validate quantity is a valid number
    /* istanbul ignore next -- @preserve defensive check: type="number" input prevents non-numeric values */
    if (isNaN(parsedQuantity)) {
      return
    }

    onAdd({
      quantity: parsedQuantity,
      unit: trimmedUnit,
      ingredientName: trimmedIngredientName,
    })

    // Clear form after successful submission
    setQuantity('')
    setUnit('')
    setIngredientName('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div role="group" aria-label="Add an ingredient" onKeyDown={handleKeyDown}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-4 items-end">
        {/* Ouro UI's TextField has no number type, so the quantity is its Field and control. */}
        <Field label="Quantity" disabled={isDisabled}>
          <FieldControl
            aria-required="true"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            step="any"
            min={QUANTITY_MIN}
            max={QUANTITY_MAX}
            placeholder="1.5"
            autoComplete="off"
          />
        </Field>
        <TextField
          label="Unit"
          aria-required="true"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          maxLength={UNIT_NAME_MAX_LENGTH}
          placeholder="cup"
          disabled={isDisabled}
          autoComplete="off"
        />
        <TextField
          label="Ingredient"
          aria-required="true"
          value={ingredientName}
          onChange={(e) => setIngredientName(e.target.value)}
          maxLength={INGREDIENT_NAME_MAX_LENGTH}
          placeholder="flour"
          disabled={isDisabled}
          autoComplete="off"
        />
        <Button
          type="button"
          onClick={handleAdd}
          disabled={isDisabled}
          aria-busy={loading}
          aria-label="Add ingredient"
          className="sm:self-end"
        >
          Add
        </Button>
      </div>
    </div>
  )
}
