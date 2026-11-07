import { RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '~/components/ouro/button/button'
import { Alert } from '~/components/ouro/alert/alert'
import { TextArea } from '~/components/ouro/text-field/text-area'
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
  const parser = useIngredientParser({ recipeId, stepId })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevParsedIngredients = useRef<ParsedIngredient[] | null>(null)

  // The textarea is uncontrolled: it is server-rendered on "Add Step", and a
  // controlled `value` would wipe text typed before hydration on the first
  // re-render after it. On mount, hand the parser whatever the field holds,
  // the default value or text typed before hydration, so it gets parsed.
  useEffect(() => {
    const initialText = textareaRef.current!.value
    if (initialText) {
      parser.setText(initialText)
    }
    // Mount only: later text arrives through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleTryAgain = () => {
    parser.parse()
  }

  const handleSwitchToManual = () => {
    onSwitchToManual?.()
  }

  return (
    <div aria-busy={parser.isLoading}>
      <TextArea
        ref={textareaRef}
        label="Ingredient text"
        description="AI will parse your ingredients automatically after you stop typing."
        rows={5}
        defaultValue={defaultValue}
        onChange={handleChange}
        disabled={isDisabled}
        placeholder="Enter ingredients (e.g., 2 cups flour, 1/2 tsp salt)"
      />
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
      {/* The parser failing is not a mistake in the text, so it is an alert with the ways on from
          it, not the field's error. */}
      {errorInfo && (
        <Alert
          tone="destructive"
          title={errorInfo.message}
          className="mt-3"
          action={
            <>
              {errorInfo.isRetryable && parser.text.trim() && (
                <Button
                  type="button"
                  variant="outline" tone="secondary"
                  onClick={handleTryAgain}
                  disabled={parser.isLoading}
                  data-testid="try-again-button"
                  aria-label="Try parsing ingredients again"
                >
                  <RefreshCw data-slot="icon" aria-hidden="true" />
                  Try again
                </Button>
              )}
              {onSwitchToManual && (
                <Button
                  type="button"
                  variant="outline" tone="secondary"
                  onClick={handleSwitchToManual}
                  data-testid="switch-to-manual-button"
                  aria-label="Switch to manual ingredient entry"
                >
                  Add manually
                </Button>
              )}
            </>
          }
        />
      )}
    </div>
  )
}
