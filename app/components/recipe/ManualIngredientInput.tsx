import { useId, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
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
  // Several step cards can show this form at once, so the ids must be unique
  // per instance or every card's labels would point at the first card's fields.
  const id = useId()
  const quantityId = `${id}-quantity`
  const unitId = `${id}-unit`
  const ingredientNameId = `${id}-ingredient-name`
  const [quantity, setQuantity] = useState<string>('')
  const [unit, setUnit] = useState('')
  const [ingredientName, setIngredientName] = useState('')

  const isDisabled = disabled || loading

  // Not a <form>: this sits inside the Add Step page's own form, and a nested
  // form is invalid HTML. The fields have no name and no native `required`
  // (only aria-required), so they neither travel with nor block that form's
  // submission; Enter adds the ingredient here instead of submitting it.
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
        <div>
          <label htmlFor={quantityId} className="block mb-2 text-sm font-bold">
            Quantity
          </label>
          <Input
            type="number"
            id={quantityId}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            step="any"
            min={QUANTITY_MIN}
            max={QUANTITY_MAX}
            placeholder="1.5"
            disabled={isDisabled}
            autoComplete="off"
            aria-required="true"
          />
        </div>
        <div>
          <label htmlFor={unitId} className="block mb-2 text-sm font-bold">
            Unit
          </label>
          <Input
            type="text"
            id={unitId}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            maxLength={UNIT_NAME_MAX_LENGTH}
            placeholder="cup"
            disabled={isDisabled}
            autoComplete="off"
            aria-required="true"
          />
        </div>
        <div>
          <label htmlFor={ingredientNameId} className="block mb-2 text-sm font-bold">
            Ingredient
          </label>
          <Input
            type="text"
            id={ingredientNameId}
            value={ingredientName}
            onChange={(e) => setIngredientName(e.target.value)}
            maxLength={INGREDIENT_NAME_MAX_LENGTH}
            placeholder="flour"
            disabled={isDisabled}
            autoComplete="off"
            aria-required="true"
          />
        </div>
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
