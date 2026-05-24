import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { ParsedIngredientRow } from './ParsedIngredientRow'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

// Button styles extracted from ~/components/ui/button.tsx for native button compatibility
const buttonBaseStyles = [
  'relative isolate inline-flex items-center justify-center gap-x-2 rounded-[var(--sj-radius-control)] border text-base/6 font-semibold',
  'px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6',
  'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--sj-brass)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
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
        <button
          type="button"
          onClick={handleAddAll}
          disabled={isDisabled}
          aria-busy={loading}
          aria-label={`Add all ${ingredients.length} ingredients to recipe`}
          className={clsx(buttonBaseStyles, buttonSolidStyles, buttonActionStyles, 'cursor-default')}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add All ({ingredients.length})
        </button>
      </div>
    </div>
  )
}
