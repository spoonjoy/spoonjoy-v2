import clsx from 'clsx'
import { useState } from 'react'
import { Input } from '~/components/ui/input'
import {
  INGREDIENT_NAME_MAX_LENGTH,
  QUANTITY_MAX,
  QUANTITY_MIN,
  UNIT_NAME_MAX_LENGTH,
} from '~/lib/validation'

// Button styles extracted from ~/components/ui/button.tsx for native button compatibility
const buttonBaseStyles = [
  'relative isolate inline-flex items-baseline justify-center gap-x-2 rounded-[var(--sj-radius-control)] border text-base/6 font-semibold',
  'px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6',
  'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--sj-brass)]',
  'disabled:opacity-50',
]

const buttonSolidStyles = [
  'border-transparent bg-(--btn-border)',
  'dark:bg-(--btn-bg)',
  'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-lg)-1px)] before:bg-(--btn-bg)',
  'before:shadow-sm',
  'dark:before:hidden',
  'dark:border-[var(--sj-border)]',
  'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-lg)-1px)]',
  'after:shadow-[inset_0_1px_color-mix(in_srgb,var(--sj-bone)_18%,transparent)]',
  'hover:after:bg-(--btn-hover-overlay)',
  'dark:after:-inset-px dark:after:rounded-lg',
  'disabled:before:shadow-none disabled:after:shadow-none',
]

const buttonActionStyles = [
  'text-[var(--sj-on-photo)] [--btn-hover-overlay:color-mix(in_srgb,var(--sj-bone)_12%,transparent)] [--btn-bg:var(--sj-action)] [--btn-border:var(--sj-action-deep)]',
  '[--btn-icon:var(--sj-paper)] hover:[--btn-icon:var(--sj-paper)]',
]

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
        <button
          type="submit"
          disabled={isDisabled}
          aria-busy={loading}
          aria-label="Add ingredient"
          className={clsx(buttonBaseStyles, buttonSolidStyles, buttonActionStyles, 'cursor-default sm:self-end')}
        >
          Add
        </button>
      </div>
    </form>
  )
}
