/**
 * StepEditorCard component.
 *
 * A card for editing/creating recipe steps with:
 * - Step number display
 * - Instructions textarea
 * - Duration input (optional)
 * - Ingredient input mode toggle (AI/manual)
 * - IngredientParseInput for AI mode
 * - ManualIngredientInput for manual mode
 * - ParsedIngredientList for displaying parsed ingredients
 * - Save, remove, and reorder controls
 */

import clsx from 'clsx'
import { ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { TouchTarget } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { IngredientInputToggle, type IngredientInputMode } from './IngredientInputToggle'
import { IngredientParseInput } from './IngredientParseInput'
import { ManualIngredientInput } from './ManualIngredientInput'
import { ParsedIngredientList } from './ParsedIngredientList'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

// Button styles extracted for native button compatibility
const buttonBaseStyles = [
  'relative isolate inline-flex items-center justify-center gap-x-2 rounded-lg border text-sm/6 font-semibold',
  'px-3 py-1.5',
  'focus:outline-2 focus:outline-offset-2 focus:outline-blue-500',
  'disabled:opacity-50 disabled:cursor-not-allowed',
]

const buttonOutlineStyles = [
  'border-zinc-950/10 dark:border-white/15',
  'text-zinc-950 dark:text-white',
  'hover:bg-zinc-950/5 dark:hover:bg-white/5',
]

const buttonSolidStyles = [
  'border-transparent bg-(--btn-border)',
  'dark:bg-(--btn-bg)',
  'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-lg)-1px)] before:bg-(--btn-bg)',
  'before:shadow-sm',
  'dark:before:hidden',
  'dark:border-white/5',
  'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-lg)-1px)]',
  'after:shadow-[inset_0_1px_--theme(--color-white/15%)]',
  'hover:after:bg-(--btn-hover-overlay)',
  'dark:after:-inset-px dark:after:rounded-lg',
  'disabled:before:shadow-none disabled:after:shadow-none',
]

const buttonGreenStyles = [
  'text-white [--btn-hover-overlay:var(--color-white)]/10 [--btn-bg:var(--color-green-600)] [--btn-border:var(--color-green-700)]/90',
  '[--btn-icon:var(--color-white)]/60 hover:[--btn-icon:var(--color-white)]/80',
]

const buttonRedStyles = [
  'text-white [--btn-hover-overlay:var(--color-white)]/10 [--btn-bg:var(--color-red-600)] [--btn-border:var(--color-red-700)]/90',
  '[--btn-icon:var(--color-white)]/60 hover:[--btn-icon:var(--color-white)]/80',
]

export interface StepData {
  id: string
  stepNum: number
  stepTitle?: string
  description: string
  duration?: number
  ingredients: ParsedIngredient[]
}

export interface StepEditorCardProps {
  stepNumber: number
  step?: StepData
  recipeId: string
  onSave: (step: Omit<StepData, 'id' | 'stepNum'>) => void
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  disabled?: boolean
  /** Render prop for drag handle */
  dragHandle?: React.ReactNode
  /** Auto-focus the instructions textarea on mount */
  autoFocusInstructions?: boolean
  /** Callback when instructions textarea is focused */
  onFocused?: () => void
}

export function StepEditorCard({
  stepNumber,
  step,
  recipeId,
  onSave,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  disabled = false,
  dragHandle,
  autoFocusInstructions = false,
  onFocused,
}: StepEditorCardProps) {
  const id = useId()
  const instructionsId = `${id}-instructions`
  const durationId = `${id}-duration`
  const instructionsRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus instructions textarea when requested
  useEffect(() => {
    if (autoFocusInstructions && instructionsRef.current) {
      instructionsRef.current.focus()
      onFocused?.()
    }
  }, [autoFocusInstructions, onFocused])

  // Form state
  const [description, setDescription] = useState(step?.description ?? '')
  const [duration, setDuration] = useState<string>(step?.duration?.toString() ?? '')
  const [ingredients, setIngredients] = useState<ParsedIngredient[]>(step?.ingredients ?? [])
  const [inputMode, setInputMode] = useState<IngredientInputMode>('ai')

  // Generate a unique step id for IngredientParseInput
  const stepId = step?.id ?? `new-step-${stepNumber}`

  const handleModeChange = (mode: IngredientInputMode) => {
    setInputMode(mode)
  }

  const handleParsedIngredients = (parsed: ParsedIngredient[]) => {
    setIngredients(parsed)
  }

  const handleManualAdd = (ingredient: { quantity: number; unit: string; ingredientName: string }) => {
    setIngredients((prev) => [...prev, ingredient])
  }

  const handleIngredientEdit = (index: number, ingredient: ParsedIngredient) => {
    setIngredients((prev) => {
      const updated = [...prev]
      updated[index] = ingredient
      return updated
    })
  }

  const handleIngredientRemove = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddAllIngredients = (_addedIngredients: ParsedIngredient[]) => {
    // Ingredients are already in state, this is called from ParsedIngredientList
    // which displays the ingredients that are already added
  }

  const handleSave = () => {
    // Don't save if instructions is empty
    if (!description.trim()) {
      return
    }

    const durationValue = duration ? parseInt(duration, 10) : undefined

    onSave({
      stepTitle: step?.stepTitle,
      description: description.trim(),
      duration: durationValue && durationValue > 0 ? durationValue : undefined,
      ingredients,
    })
  }

  const handleRemove = () => {
    /* istanbul ignore next -- @preserve remove button is disabled when disabled=true */
    if (disabled) return
    onRemove()
  }

  const handleMoveUp = () => {
    // Safe: button only renders when onMoveUp exists, and is disabled when disabled=true
    onMoveUp?.()
  }

  const handleMoveDown = () => {
    // Safe: button only renders when onMoveDown exists, and is disabled when disabled=true
    onMoveDown?.()
  }

  return (
    <article
      aria-label={`Step ${stepNumber}`}
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4"
    >
      {/* Header with step number and title */}
      <div className="flex items-center gap-4 mb-4">
        {dragHandle}
        <div
          className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 font-bold"
        >
          {stepNumber}
        </div>
        <div className="flex-1">
          {step?.stepTitle && (
            <h3 className="text-lg font-semibold">{step.stepTitle}</h3>
          )}
          {step?.description && !step.stepTitle && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">{step.description}</p>
          )}
          {!step?.stepTitle && !step?.description && (
            <span className="text-sm text-zinc-500">Step {stepNumber}</span>
          )}
        </div>
      </div>

      {/* Instructions textarea */}
      <div className="mb-4">
        <label htmlFor={instructionsId} className="block mb-2 text-sm font-bold">
          Instructions
        </label>
        <Textarea
          ref={instructionsRef}
          id={instructionsId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what to do in this step..."
          rows={3}
          required
          disabled={disabled}
          resizable
        />
      </div>

      {/* Duration input */}
      <div className="mb-4">
        <label htmlFor={durationId} className="block mb-2 text-sm font-bold">
          Duration (minutes)
        </label>
        <Input
          type="number"
          id={durationId}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="Optional"
          min="1"
          disabled={disabled}
        />
      </div>

      {/* Ingredient input section */}
      <div className="mb-4 border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <div className="mb-4">
          <IngredientInputToggle
            mode={inputMode}
            onChange={handleModeChange}
            disabled={disabled}
          />
        </div>

        {inputMode === 'ai' ? (
          <IngredientParseInput
            recipeId={recipeId}
            stepId={stepId}
            onParsed={handleParsedIngredients}
            disabled={disabled}
          />
        ) : (
          <ManualIngredientInput
            onAdd={handleManualAdd}
            disabled={disabled}
          />
        )}

        {/* Display ingredients */}
        <div className="mt-4">
          {ingredients.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No ingredients added yet</p>
          ) : (
            <ParsedIngredientList
              ingredients={ingredients}
              onEdit={handleIngredientEdit}
              onRemove={handleIngredientRemove}
              onAddAll={handleAddAllIngredients}
              disabled={disabled}
            />
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className={clsx(buttonBaseStyles, buttonSolidStyles, buttonGreenStyles, 'cursor-default')}
        >
          <TouchTarget>
            <Save className="size-4" aria-hidden="true" />
            Save
          </TouchTarget>
        </button>

        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          className={clsx(buttonBaseStyles, buttonSolidStyles, buttonRedStyles, 'cursor-default')}
        >
          <TouchTarget>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </TouchTarget>
        </button>

        {onMoveUp && (
          <button
            type="button"
            onClick={handleMoveUp}
            disabled={disabled || !canMoveUp}
            className={clsx(buttonBaseStyles, buttonOutlineStyles, 'cursor-default')}
          >
            <TouchTarget>
              <ArrowUp className="size-4" aria-hidden="true" />
              Move Up
            </TouchTarget>
          </button>
        )}

        {onMoveDown && (
          <button
            type="button"
            onClick={handleMoveDown}
            disabled={disabled || !canMoveDown}
            className={clsx(buttonBaseStyles, buttonOutlineStyles, 'cursor-default')}
          >
            <TouchTarget>
              <ArrowDown className="size-4" aria-hidden="true" />
              Move Down
            </TouchTarget>
          </button>
        )}
      </div>
    </article>
  )
}
