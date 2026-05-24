import { useState } from 'react'
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
  const [quantity, setQuantity] = useState<string>('')
  const [unit, setUnit] = useState('')
  const [ingredientName, setIngredientName] = useState('')

  const isDisabled = disabled || loading

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

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

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-4 items-end">
        <div>
          <label htmlFor="quantity" className="block mb-2 text-sm font-bold">
            Quantity
          </label>
          <Input
            type="number"
            id="quantity"
            name="quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            step="any"
            min={QUANTITY_MIN}
            max={QUANTITY_MAX}
            required
            placeholder="1.5"
            disabled={isDisabled}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="unit" className="block mb-2 text-sm font-bold">
            Unit
          </label>
          <Input
            type="text"
            id="unit"
            name="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            required
            maxLength={UNIT_NAME_MAX_LENGTH}
            placeholder="cup"
            disabled={isDisabled}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="ingredientName" className="block mb-2 text-sm font-bold">
            Ingredient
          </label>
          <Input
            type="text"
            id="ingredientName"
            name="ingredientName"
            value={ingredientName}
            onChange={(e) => setIngredientName(e.target.value)}
            required
            maxLength={INGREDIENT_NAME_MAX_LENGTH}
            placeholder="flour"
            disabled={isDisabled}
            autoComplete="off"
          />
        </div>
        <Button
          type="submit"
          disabled={isDisabled}
          aria-busy={loading}
          aria-label="Add ingredient"
          className="sm:self-end"
        >
          Add
        </Button>
      </div>
    </form>
  )
}
