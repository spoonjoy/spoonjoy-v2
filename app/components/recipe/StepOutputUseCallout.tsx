import { ChecklistRow } from '~/components/shopping/checklist-row'

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
  checkedIds?: ReadonlySet<string>
  /** Callback when a reference is toggled */
  onToggle?: (id: string) => void
  /** Whether to show checkboxes (default: true) */
  showCheckboxes?: boolean
}

/**
 * A quiet checklist treatment showing step output references.
 *
 * Features:
 * - Shares the ingredient-row visual grammar
 * - Labels step outputs as prep work without introducing a separate callout design
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
      className="my-3 border-y border-[var(--sj-border)] py-2"
    >
      <span className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        Using output from:
      </span>
      <ul className="mt-2 divide-y divide-[var(--sj-border)]">
        {references.map((ref) => {
          const isChecked = checkedIds.has(ref.id)
          const shouldShowCheckbox = showCheckboxes && onToggle
          const name = formatStepReferenceName(ref)

          return (
            <li key={ref.id}>
              <ChecklistRow
                checked={isChecked}
                name={name}
                note={isChecked ? 'used' : 'step output'}
                onToggle={shouldShowCheckbox ? () => onToggle(ref.id) : undefined}
                onPress={!shouldShowCheckbox && onStepClick ? () => onStepClick(ref.stepNumber) : undefined}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatStepReferenceName(reference: StepReference) {
  if (reference.stepTitle) {
    return `Step ${reference.stepNumber}: ${reference.stepTitle}`
  }

  return `Step ${reference.stepNumber}`
}
