import { RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { useIngredientParser } from '~/hooks/useIngredientParser'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

export interface IngredientParseInputProps {
  recipeId: string
  stepId: string
  onParsed?: (ingredients: ParsedIngredient[]) => void
  onSwitchToManual?: () => void
  disabled?: boolean
  defaultValue?: string
}

/**
 * Converts technical error messages to user-friendly, actionable messages.
 */
function getActionableErrorMessage(error: string): { message: string; isRetryable: boolean } {
  // API key missing - not retryable, suggest manual mode
  if (error.includes('API key is required')) {
    return {
      message: 'AI parsing is unavailable. You can add ingredients manually using the form below.',
      isRetryable: false,
    }
  }

  // Network or connection errors - retryable
  if (
    error.includes('Failed to parse') ||
    error.includes('connection') ||
    error.includes('network') ||
    error.includes('timeout')
  ) {
    return {
      message: 'Unable to connect to AI service. Please try again or add ingredients manually.',
      isRetryable: true,
    }
  }

  // API response errors - retryable
  if (
    error.includes('No response') ||
    error.includes('Empty response') ||
    error.includes('Invalid JSON')
  ) {
    return {
      message: 'AI parsing failed to process your ingredients. Please try again or add ingredients manually.',
      isRetryable: true,
    }
  }

  // Schema validation errors - retryable (LLM might give better output)
  if (error.includes('schema')) {
    return {
      message: 'AI returned unexpected results. Please try again or add ingredients manually.',
      isRetryable: true,
    }
  }

  // Default fallback - assume retryable
  return {
    message: 'Something went wrong. Please try again or add ingredients manually.',
    isRetryable: true,
  }
}

export function IngredientParseInput({
  recipeId,
  stepId,
  onParsed,
  onSwitchToManual,
  disabled = false,
  defaultValue = '',
}: IngredientParseInputProps) {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`

  const parser = useIngredientParser({ recipeId, stepId })
  const hasInitialized = useRef(false)
  const prevParsedIngredients = useRef<ParsedIngredient[] | null>(null)

  // Initialize with default value
  useEffect(() => {
    if (defaultValue && !hasInitialized.current) {
      hasInitialized.current = true
      parser.setText(defaultValue)
    }
  }, [defaultValue, parser])

  // Call onParsed when parsing succeeds
  useEffect(() => {
    if (parser.parsedIngredients && parser.parsedIngredients !== prevParsedIngredients.current) {
      prevParsedIngredients.current = parser.parsedIngredients
      onParsed?.(parser.parsedIngredients)
    }
  }, [parser.parsedIngredients, onParsed])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    parser.setText(e.target.value)

    // Clear error on typing
    if (parser.error) {
      parser.clear()
      parser.setText(e.target.value)
    }

    // If text is cleared, notify parent with empty array
    if (!e.target.value.trim() && onParsed) {
      onParsed([])
    }
  }

  const isDisabled = disabled || parser.isLoading
  const hasError = !!parser.error

  // Get actionable error info
  const errorInfo = hasError ? getActionableErrorMessage(parser.error!) : null

  // Build aria-describedby based on current state
  const describedByIds = [descriptionId]
  if (hasError) {
    describedByIds.push(errorId)
  }

  const handleTryAgain = () => {
    parser.parse()
  }

  const handleSwitchToManual = () => {
    onSwitchToManual?.()
  }

  return (
    <div aria-busy={parser.isLoading}>
      <label id={labelId} htmlFor={id} className="font-sj-ui mb-2 block text-sm font-bold">
        Ingredient text
      </label>
      <Textarea
        id={id}
        rows={5}
        value={parser.text}
        onChange={handleChange}
        disabled={isDisabled}
        placeholder="Enter ingredients (e.g., 2 cups flour, 1/2 tsp salt)"
        aria-labelledby={labelId}
        aria-describedby={describedByIds.join(' ')}
        invalid={hasError}
        resizable
      />
      <p id={descriptionId} className="mt-2 text-sm text-[var(--sj-ink-soft)]">
        AI will parse your ingredients automatically after you stop typing.
      </p>
      {parser.isLoading && (
        <div
          data-testid="loading-indicator"
          aria-live="polite"
          className="mt-2 flex items-center gap-2 text-sm text-[var(--sj-ink-soft)]"
        >
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Parsing ingredients...
        </div>
      )}
      {hasError && errorInfo && (
        <div
          id={errorId}
          role="alert"
          className="mt-3 rounded-[var(--sj-radius-surface)] border border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] p-3"
        >
          <p className="mb-2 text-sm text-[var(--sj-tomato)]">
            {errorInfo.message}
          </p>
          <div className="flex gap-2">
            {errorInfo.isRetryable && parser.text.trim() && (
              <Button
                type="button"
                plain
                onClick={handleTryAgain}
                disabled={parser.isLoading}
                data-testid="try-again-button"
                aria-label="Try parsing ingredients again"
              >
                <RefreshCw data-slot="icon" aria-hidden="true" />
                Try Again
              </Button>
            )}
            {onSwitchToManual && (
              <Button
                type="button"
                plain
                onClick={handleSwitchToManual}
                data-testid="switch-to-manual-button"
                aria-label="Switch to manual ingredient entry"
              >
                Add Manually
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
