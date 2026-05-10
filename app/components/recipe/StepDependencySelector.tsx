import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface StepInfo {
  stepNum: number
  description: string
}

interface AiSuggestion {
  stepNum: number
  reason?: string
}

interface StepDependencySelectorProps {
  currentStepNum: number
  allSteps: StepInfo[]
  selectedDependencies: number[]
  onChange: (deps: number[]) => void
  aiSuggestions?: AiSuggestion[]
  disabled?: boolean
}

export function StepDependencySelector({
  currentStepNum,
  allSteps,
  selectedDependencies,
  onChange,
  aiSuggestions = [],
  disabled = false,
}: StepDependencySelectorProps) {
  const [dismissedSuggestions, setDismissedSuggestions] = useState<number[]>([])
  const [isOpen, setIsOpen] = useState(false)
  // Track internal selections to handle multiple rapid selections
  const [internalSelections, setInternalSelections] = useState<number[]>(selectedDependencies)

  // Sync internal state when props change
  useEffect(() => {
    setInternalSelections(selectedDependencies)
  }, [selectedDependencies])

  // Filter to only show steps that come before the current step
  const previousSteps = allSteps.filter((step) => step.stepNum < currentStepNum)

  // Filter AI suggestions to exclude dismissed ones
  const visibleSuggestions = aiSuggestions.filter(
    (suggestion) => !dismissedSuggestions.includes(suggestion.stepNum)
  )

  const handleSelect = (stepNum: number) => {
    if (!internalSelections.includes(stepNum)) {
      const newSelections = [...internalSelections, stepNum]
      setInternalSelections(newSelections)
      onChange(newSelections)
    }
    setIsOpen(false)
  }

  const handleRemove = (stepNum: number) => {
    const newSelections = internalSelections.filter((dep) => dep !== stepNum)
    setInternalSelections(newSelections)
    onChange(newSelections)
  }

  const handleAcceptSuggestion = (stepNum: number) => {
    if (!internalSelections.includes(stepNum)) {
      const newSelections = [...internalSelections, stepNum]
      setInternalSelections(newSelections)
      onChange(newSelections)
    }
  }

  const handleDismissSuggestion = (stepNum: number) => {
    setDismissedSuggestions([...dismissedSuggestions, stepNum])
  }

  // No previous steps available for step 1
  if (previousSteps.length === 0) {
    return (
      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        <span>Uses output from:</span>
        <span className="ml-2 italic">No previous steps</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-[var(--sj-ink-soft)]">Uses output from:</span>

        {/* Selected dependencies as chips */}
        {internalSelections.map((stepNum) => {
          const step = allSteps.find((s) => s.stepNum === stepNum)
          if (!step) return null
          return (
            <span
              key={stepNum}
              role="button"
              aria-label={`Step ${stepNum}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] px-2 py-0.5 text-sm text-[var(--sj-ink)]"
            >
              Step {stepNum}
              <button
                type="button"
                onClick={() => handleRemove(stepNum)}
                disabled={disabled}
                className="ml-1 rounded-full p-0.5 hover:bg-[color-mix(in_srgb,var(--sj-brass)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}

        {/* Custom dropdown to select dependencies */}
        <div className="relative">
          <button
            type="button"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            disabled={disabled}
            onClick={() => setIsOpen(!isOpen)}
            className="rounded-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 py-1 text-sm text-[var(--sj-ink)] focus:border-[var(--sj-brass)] focus:outline-none focus:ring-1 focus:ring-[var(--sj-brass)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add step...
          </button>
          <div
            role="listbox"
            className={`absolute z-10 mt-1 max-h-60 overflow-auto rounded-[1rem] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] py-1 text-sm shadow-[var(--sj-shadow-soft)] focus:outline-none ${
              isOpen ? '' : 'sr-only'
            }`}
          >
            {previousSteps.map((step) => (
              <div
                key={step.stepNum}
                role="option"
                aria-selected={internalSelections.includes(step.stepNum)}
                onClick={() => handleSelect(step.stepNum)}
                className="cursor-pointer select-none px-3 py-2 text-[var(--sj-ink)] hover:bg-[var(--sj-flour)]"
              >
                Step {step.stepNum}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI suggestions */}
      {visibleSuggestions.length > 0 && (
        <div className="space-y-1">
          {visibleSuggestions.map((suggestion) => (
            <div
              key={suggestion.stepNum}
              className="flex items-center gap-2 rounded-[1rem] border border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_10%,var(--sj-panel-solid))] px-2 py-1 text-sm"
            >
              <span className="text-[var(--sj-ink)]">
                Step {suggestion.stepNum} looks like a dependency
              </span>
              <button
                type="button"
                onClick={() => handleAcceptSuggestion(suggestion.stepNum)}
                disabled={disabled}
                className="rounded-full bg-[var(--sj-brass)] px-2 py-0.5 text-xs font-medium text-[var(--sj-paper)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add it
              </button>
              <button
                type="button"
                onClick={() => handleDismissSuggestion(suggestion.stepNum)}
                disabled={disabled}
                className="rounded-full bg-[var(--sj-flour)] px-2 py-0.5 text-xs font-medium text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
