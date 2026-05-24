/**
 * StepList component.
 *
 * Manages a collection of StepEditorCard instances with:
 * - '+ Add Step' button to add new steps at end
 * - Remove step with confirmation dialog
 * - Drag-to-reorder with Framer Motion
 * - Up/down buttons for accessible reordering
 * - Empty state handling
 * - Steps array management (controlled component)
 */

import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Link } from '~/components/ui/link'
import { Dialog, DialogActions, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { StepEditorCard, type StepData } from './StepEditorCard'

export interface StepListProps {
  steps: StepData[]
  recipeId: string
  onChange: (steps: StepData[]) => void
  disabled?: boolean
}

interface StepReorderItemProps {
  step: StepData
  index: number
  stepCount: number
  recipeId: string
  disabled: boolean
  autoFocusInstructions: boolean
  onFocused: () => void
  onSave: (data: Omit<StepData, 'id' | 'stepNum'>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDragHandleKeyDown: (event: React.KeyboardEvent, index: number) => void
}

function StepReorderItem({
  step,
  index,
  stepCount,
  recipeId,
  disabled,
  autoFocusInstructions,
  onFocused,
  onSave,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragHandleKeyDown,
}: StepReorderItemProps) {
  const dragControls = useDragControls()
  const canDrag = !disabled && stepCount > 1

  const handleDragPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      dragControls.start(event, { snapToCursor: true })
    },
    [dragControls]
  )

  return (
    <Reorder.Item
      value={step}
      dragListener={false}
      dragControls={dragControls}
    >
      <StepEditorCard
        stepNumber={step.stepNum}
        step={step}
        recipeId={recipeId}
        onSave={onSave}
        onRemove={onRemove}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={index > 0}
        canMoveDown={index < stepCount - 1}
        disabled={disabled}
        autoFocusInstructions={autoFocusInstructions}
        onFocused={onFocused}
        dragHandle={
          <button
            type="button"
            aria-label="Drag to reorder"
            title="Drag to reorder. Use Control + Arrow Up or Down from the keyboard."
            disabled={!canDrag}
            onPointerDown={canDrag ? handleDragPointerDown : undefined}
            onKeyDown={(event) => onDragHandleKeyDown(event, index)}
            className="hidden touch-none cursor-grab rounded-[var(--sj-radius-small)] p-1 text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--sj-brass)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
          >
            <GripVertical className="h-5 w-5" />
          </button>
        }
      />
    </Reorder.Item>
  )
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

  const handleStepSave = (stepId: string, data: Omit<StepData, 'id' | 'stepNum'>) => {
    const newSteps = steps.map((step) =>
      step.id === stepId ? { ...step, ...data } : step
    )
    onChange(newSteps)
  }

  // Renumber steps after reorder and call onChange
  const handleReorder = useCallback(
    (newOrder: StepData[]) => {
      const renumberedSteps = newOrder.map((step, index) => ({
        ...step,
        stepNum: index + 1,
      }))
      onChange(renumberedSteps)
    },
    [onChange]
  )

  // Move step up in list
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return
      const newSteps = [...steps]
      const temp = newSteps[index]
      newSteps[index] = newSteps[index - 1]
      newSteps[index - 1] = temp
      handleReorder(newSteps)
    },
    [steps, handleReorder]
  )

  // Move step down in list
  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= steps.length - 1) return
      const newSteps = [...steps]
      const temp = newSteps[index]
      newSteps[index] = newSteps[index + 1]
      newSteps[index + 1] = temp
      handleReorder(newSteps)
    },
    [steps, handleReorder]
  )

  // Handle keyboard reorder on drag handle
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          handleMoveUp(index)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          handleMoveDown(index)
        }
      }
    },
    [handleMoveUp, handleMoveDown]
  )

  return (
    <div>
      {steps.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--sj-ink-soft)]">No steps yet. Add your first step below.</p>
      ) : (
        <Reorder.Group
          axis="y"
          values={steps}
          onReorder={handleReorder}
          className="sj-list-ruled mb-4"
        >
          {steps.map((step, index) => (
            <StepReorderItem
              key={step.id}
              step={step}
              index={index}
              stepCount={steps.length}
              recipeId={recipeId}
              disabled={disabled}
              autoFocusInstructions={newlyAddedStepId === step.id}
              onFocused={() => handleFocused(step.id)}
              onSave={(data) => handleStepSave(step.id, data)}
              onRemove={() => handleRemoveStep(step.id)}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onDragHandleKeyDown={handleKeyDown}
            />
          ))}
        </Reorder.Group>
      )}

      {/* Use Link for existing recipes (edit mode), Button for new recipes (create mode) */}
      {recipeId && !recipeId.startsWith('new-') ? (
        <Link
          href={`/recipes/${recipeId}/steps/new`}
          className="sj-link inline-flex items-center gap-2"
        >
          + Add Step
        </Link>
      ) : (
        <Button
          type="button"
          onClick={handleAddStep}
          disabled={disabled}
          plain
        >
          <Plus data-slot="icon" />
          Add Step
        </Button>
      )}

      {/* Confirmation dialog for step removal */}
      <Dialog open={stepToRemove !== null} onClose={cancelRemove} role="alertdialog">
        <DialogTitle>Remove Step</DialogTitle>
        <DialogDescription>
          Are you sure you want to remove this step? This action cannot be undone.
        </DialogDescription>
        <DialogActions>
          <Button
            plain
            onClick={cancelRemove}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirmRemove}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
