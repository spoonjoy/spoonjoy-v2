import { Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { ParsedIngredientRow } from './ParsedIngredientRow'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

export interface ParsedIngredientListProps {
  ingredients: ParsedIngredient[]
  onEdit: (index: number, ingredient: ParsedIngredient) => void
  onRemove: (index: number) => void
  onAddAll: (ingredients: ParsedIngredient[]) => void
  disabled?: boolean
  loading?: boolean
}

export function ParsedIngredientList({
  ingredients,
  onEdit,
  onRemove,
  onAddAll,
  disabled = false,
  loading = false,
}: ParsedIngredientListProps) {
  const isDisabled = disabled || loading

  const handleRowEdit = (index: number) => (updatedIngredient: ParsedIngredient) => {
    onEdit(index, updatedIngredient)
  }

  const handleRowRemove = (index: number) => () => {
    onRemove(index)
  }

  const handleAddAll = () => {
    onAddAll(ingredients)
  }

  if (ingredients.length === 0) {
    return (
      <div className="py-4" aria-live="polite">
        <p className="text-center text-[var(--sj-ink-soft)]">No ingredients parsed yet</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">
        Ingredients ({ingredients.length})
      </h3>
      <ul className="m-0 list-none divide-y divide-[var(--sj-border)] p-0" role="list">
        {ingredients.map((ingredient, index) => (
          <ParsedIngredientRow
            key={index}
            ingredient={ingredient}
            onEdit={handleRowEdit(index)}
            onRemove={handleRowRemove(index)}
            disabled={isDisabled}
          />
        ))}
      </ul>
      <div className="mt-4">
        <Button
          type="button"
          onClick={handleAddAll}
          disabled={isDisabled}
          aria-busy={loading}
          aria-label={`Add all ${ingredients.length} ingredients to recipe`}
        >
          <Plus data-slot="icon" aria-hidden="true" />
          Add All ({ingredients.length})
        </Button>
      </div>
    </div>
  )
}
