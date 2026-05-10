import { ArrowUp } from 'lucide-react'
import { Checkbox, CheckboxField } from '../ui/checkbox'
import { Label } from '../ui/fieldset'

export interface StepReference {
  /** Unique identifier */
  id: string
  /** The step number being referenced */
  stepNumber: number
  /** Optional human-readable step title */
  stepTitle: string | null
}

export interface StepOutputUseCalloutProps {
  /** Array of step references to display */
  references: StepReference[]
  /** Optional callback when a step reference is clicked */
  onStepClick?: (stepNumber: number) => void
  /** Set of checked reference IDs */
  checkedIds?: Set<string>
  /** Callback when a reference is toggled */
  onToggle?: (id: string) => void
  /** Whether to show checkboxes (default: true) */
  showCheckboxes?: boolean
}

/**
 * A visually distinctive callout showing step output references.
 *
 * Features:
 * - Colored left border for visual distinction
 * - Arrow icon indicating reference direction
 * - Shows step title when available, falls back to step number
 * - Returns null for empty references (no render)
 * - Optional click handler for navigation
 * - Optional checkboxes for tracking progress
 */
export function StepOutputUseCallout({
  references,
  onStepClick,
  checkedIds = new Set(),
  onToggle,
  showCheckboxes = true,
}: StepOutputUseCalloutProps) {
  // Don't render anything for empty references
  if (references.length === 0) {
    return null
  }

  return (
    <div
      data-testid="step-output-callout"
      className="my-3 rounded-r-[1.25rem] border-l-2 border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-flour)_52%,transparent)] px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <ArrowUp
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sj-brass)]"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <span className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
            Using output from:
          </span>
          <ul className="mt-1 space-y-1">
            {references.map((ref) => {
              const isChecked = checkedIds.has(ref.id)
              const shouldShowCheckbox = showCheckboxes && onToggle

              if (shouldShowCheckbox) {
                return (
                  <li key={ref.id}>
                    <CheckboxField>
                      <Checkbox
                        checked={isChecked}
                        onChange={() => onToggle(ref.id)}
                        aria-label={`Mark Step ${ref.stepNumber}${ref.stepTitle ? `: ${ref.stepTitle}` : ''} as used`}
                      />
                      <Label
                        className={`cursor-pointer text-sm ${
                          isChecked
                            ? 'line-through text-[var(--sj-ink-soft)] opacity-60'
                            : 'text-[var(--sj-ink-soft)]'
                        }`}
                      >
                        <StepReferenceText reference={ref} />
                      </Label>
                    </CheckboxField>
                  </li>
                )
              }

              return (
                <li key={ref.id}>
                  {onStepClick ? (
                    <button
                      type="button"
                      onClick={() => onStepClick(ref.stepNumber)}
                      className="text-sm text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] hover:underline focus:outline-none focus:underline"
                    >
                      <StepReferenceText reference={ref} />
                    </button>
                  ) : (
                    <span className="text-sm text-[var(--sj-ink-soft)]">
                      <StepReferenceText reference={ref} />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

function StepReferenceText({ reference }: { reference: StepReference }) {
  if (reference.stepTitle) {
    return (
      <>
        <span className="font-medium">Step {reference.stepNumber}</span>
        {': '}
        {reference.stepTitle}
      </>
    )
  }

  return <span className="font-medium">Step {reference.stepNumber}</span>
}
