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
        <span className="text-sm text-zinc-700 dark:text-zinc-300">Uses output from:</span>

        {/* Selected dependencies as chips */}
        {internalSelections.map((stepNum) => {
          const step = allSteps.find((s) => s.stepNum === stepNum)
          if (!step) return null
          return (
            <span
              key={stepNum}
              role="button"
              aria-label={`Step ${stepNum}`}
              className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
            >
              Step {stepNum}
              <button
                type="button"
                onClick={() => handleRemove(stepNum)}
                disabled={disabled}
                className="ml-1 rounded p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            Add step...
          </button>
          <div
            role="listbox"
            className={`absolute z-10 mt-1 max-h-60 overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-zinc-800 dark:ring-white/10 ${
              isOpen ? '' : 'sr-only'
            }`}
          >
            {previousSteps.map((step) => (
              <div
                key={step.stepNum}
                role="option"
                aria-selected={internalSelections.includes(step.stepNum)}
                onClick={() => handleSelect(step.stepNum)}
                className="cursor-pointer select-none px-3 py-2 text-zinc-900 hover:bg-blue-500 hover:text-white dark:text-white"
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
              className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-sm dark:bg-amber-900/20"
            >
              <span className="text-amber-800 dark:text-amber-300">
                Step {suggestion.stepNum} looks like a dependency
              </span>
              <button
                type="button"
                onClick={() => handleAcceptSuggestion(suggestion.stepNum)}
                disabled={disabled}
                className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
              >
                Add it
              </button>
              <button
                type="button"
                onClick={() => handleDismissSuggestion(suggestion.stepNum)}
                disabled={disabled}
                className="rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
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
