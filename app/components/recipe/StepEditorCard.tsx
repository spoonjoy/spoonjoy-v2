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

import { ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { IngredientInputToggle, type IngredientInputMode } from './IngredientInputToggle'
import { IngredientParseInput } from './IngredientParseInput'
import { ManualIngredientInput } from './ManualIngredientInput'
import { ParsedIngredientList } from './ParsedIngredientList'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

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
      className="border-b border-[var(--sj-border)] py-5"
    >
      {/* Header with step number and title */}
      <div className="flex items-center gap-4 mb-4">
        {dragHandle}
        <div
          className="font-sj-ui flex h-8 w-8 items-center justify-center rounded-[var(--sj-radius-small)] bg-[var(--sj-ink)] font-bold text-[var(--sj-paper)]"
        >
          {stepNumber}
        </div>
        <div className="flex-1">
          {step?.stepTitle && (
            <h3 className="font-sj-display text-lg font-semibold text-[var(--sj-ink)]">{step.stepTitle}</h3>
          )}
          {step?.description && !step.stepTitle && (
            <p className="line-clamp-1 text-sm text-[var(--sj-ink-soft)]">{step.description}</p>
          )}
          {!step?.stepTitle && !step?.description && (
            <span className="text-sm text-[var(--sj-ink-soft)]">Step {stepNumber}</span>
          )}
        </div>
      </div>

      {/* Instructions textarea */}
      <div className="mb-4">
        <label htmlFor={instructionsId} className="font-sj-ui mb-2 block text-sm font-bold">
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
        <label htmlFor={durationId} className="font-sj-ui mb-2 block text-sm font-bold">
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
      <div className="mb-4 border-t border-[var(--sj-border)] pt-4">
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
            <p className="text-sm text-[var(--sj-ink-soft)]">No ingredients added yet</p>
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
      <div className="flex flex-wrap gap-2 border-t border-[var(--sj-border)] pt-4">
        <Button
          type="button"
          onClick={handleSave}
          disabled={disabled}
        >
          <Save data-slot="icon" aria-hidden="true" />
          Save
        </Button>

        <Button
          type="button"
          variant="destructive"
          onClick={handleRemove}
          disabled={disabled}
        >
          <Trash2 data-slot="icon" aria-hidden="true" />
          Remove
        </Button>

        {onMoveUp && (
          <Button
            type="button"
            plain
            onClick={handleMoveUp}
            disabled={disabled || !canMoveUp}
          >
            <ArrowUp data-slot="icon" aria-hidden="true" />
            Move Up
          </Button>
        )}

        {onMoveDown && (
          <Button
            type="button"
            plain
            onClick={handleMoveDown}
            disabled={disabled || !canMoveDown}
          >
            <ArrowDown data-slot="icon" aria-hidden="true" />
            Move Down
          </Button>
        )}
      </div>
    </article>
  )
}
