/**
 * StepList component.
 *
 * Manages a collection of StepEditorCard instances with:
 * - '+ Add Step' button to add new steps at end
 * - Remove step with confirmation dialog
 * - Reordering with Ouro HX Reorderable: drag a step's handle, or open its menu to move it
 * - Empty state handling
 * - Steps array management (controlled component)
 */

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '~/components/button'
import { Link } from '~/components/ouro/link/link'
import { ConfirmDialog } from '~/components/ouro/dialog/confirm-dialog'
import { Reorderable } from '~/components/ouro/reorderable/reorderable'
import { StepEditorCard, type StepData } from './StepEditorCard'

export interface StepListProps {
  steps: StepData[]
  recipeId: string
  /**
   * Receives the new steps, or (for a card's draft or Save) an updater applied
   * to the latest steps, like a useState setter.
   */
  onChange: Dispatch<SetStateAction<StepData[]>>
  disabled?: boolean
}

export function StepList({ steps, recipeId, onChange, disabled = false }: StepListProps) {
  const [stepToRemove, setStepToRemove] = useState<string | null>(null)
  // Track the ID of a newly added step to auto-focus its instructions
  const [newlyAddedStepId, setNewlyAddedStepId] = useState<string | null>(null)
  // Track previous step IDs to detect newly added steps
  const prevStepIdsRef = useRef<Set<string>>(new Set())

  // Detect when a new step is added and set focus flag
  useEffect(() => {
    const currentIds = new Set(steps.map((s) => s.id))
    const newIds = [...currentIds].filter((id) => !prevStepIdsRef.current.has(id))

    if (newIds.length > 0) {
      // Focus the last newly added step (typically there's only one)
      setNewlyAddedStepId(newIds[newIds.length - 1])
    }

    prevStepIdsRef.current = currentIds
  }, [steps])

  // Clear the focus flag after focusing
  // Note: onFocused is only called by StepEditorCard when autoFocusInstructions is true,
  // which only happens when stepId === newlyAddedStepId. The else branch is defensive.
  const handleFocused = useCallback((stepId: string) => {
    /* istanbul ignore else -- @preserve onFocused only called when autoFocusInstructions=true (stepId always matches) */
    if (newlyAddedStepId === stepId) {
      setNewlyAddedStepId(null)
    }
  }, [newlyAddedStepId])

  const handleAddStep = () => {
    const newStep: StepData = {
      id: `step-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      stepNum: steps.length + 1,
      description: '',
      ingredients: [],
    }
    onChange([...steps, newStep])
  }

  const handleRemoveStep = (stepId: string) => {
    setStepToRemove(stepId)
  }

  const confirmRemove = useCallback(() => {
    /* istanbul ignore next -- @preserve confirm action only available when stepToRemove is set */
    if (!stepToRemove) return

    const newSteps = steps
      .filter((step) => step.id !== stepToRemove)
      .map((step, index) => ({
        ...step,
        stepNum: index + 1,
      }))
    onChange(newSteps)
    setStepToRemove(null)
  }, [stepToRemove, steps, onChange])

  const cancelRemove = useCallback(() => {
    setStepToRemove(null)
  }, [])

  // Note: Native keyboard event handling (Enter/Space) is provided by:
  // 1. HeadlessUI Dialog components for focus management
  // 2. Native button element behavior
  // No additional handlers needed - buttons work with keyboard out of the box

  // An updater, not a rebuilt array: several cards can report drafts in the
  // same commit, and rebuilding from this render's `steps` would let the last
  // report overwrite the others with stale steps.
  const handleStepSave = (stepId: string, data: Omit<StepData, 'id' | 'stepNum'>) => {
    onChange((previous) =>
      previous.map((step) => (step.id === stepId ? { ...step, ...data } : step))
    )
  }

  // Put the steps in the order Reorderable reports, renumbered.
  const handleReorder = useCallback(
    (ids: string[]) => {
      const byId = new Map(steps.map((step) => [step.id, step]))
      onChange(ids.map((id, index) => ({ ...byId.get(id)!, stepNum: index + 1 })))
    },
    [steps, onChange]
  )

  return (
    <div>
      {steps.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--sj-ink-soft)]">No steps yet. Add your first step below.</p>
      ) : (
        <Reorderable
          label="Steps"
          className="mb-4"
          onReorder={handleReorder}
          items={steps.map((step) => ({
            id: step.id,
            label: `Step ${step.stepNum}`,
            content: (
              <StepEditorCard
                stepNumber={step.stepNum}
                step={step}
                recipeId={recipeId}
                onSave={(data) => handleStepSave(step.id, data)}
                onChange={(data) => handleStepSave(step.id, data)}
                onRemove={() => handleRemoveStep(step.id)}
                disabled={disabled}
                autoFocusInstructions={newlyAddedStepId === step.id}
                onFocused={() => handleFocused(step.id)}
              />
            ),
          }))}
        />
      )}

      {/* Use Link for existing recipes (edit mode), Button for new recipes (create mode) */}
      {recipeId && !recipeId.startsWith('new-') ? (
        <Link
          href={`/recipes/${recipeId}/steps/new`}
          className="inline-flex min-h-11 items-center gap-2"
        >
          + Add step
        </Link>
      ) : (
        <Button
          type="button"
          onClick={handleAddStep}
          disabled={disabled}
          plain
        >
          <Plus data-slot="icon" />
          Add step
        </Button>
      )}

      {/* Confirmation dialog for step removal */}
      <ConfirmDialog
        open={stepToRemove !== null}
        onOpenChange={cancelRemove}
        title="Remove step"
        description="Are you sure you want to remove this step? This action cannot be undone."
        confirmLabel="Confirm"
        tone="destructive"
        onConfirm={confirmRemove}
      />
    </div>
  )
}
