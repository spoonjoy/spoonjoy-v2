/**
 * Tests for useIngredientParser hook.
 *
 * This hook wraps useFetcher to provide:
 * - Debounced ingredient parsing (triggers after ~1s of inactivity)
 * - Loading state management
 * - Error state management
 * - Parsed ingredients result
 *
 * Note: These tests use fireEvent with fake timers for debounce-specific tests,
 * and real timers with short delays for router integration tests. This is because
 * React Router's createRoutesStub has internal async mechanisms that don't work
 * well with vitest's fake timers.
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoutesStub } from 'react-router'
import { getIngredientParserAction, useIngredientParser } from '~/hooks/useIngredientParser'

// Configurable debounce delay for testing - allows shorter delay in real timer tests
const TEST_DEBOUNCE_DELAY = 50 // ms - short delay for real timer tests

// Helper component to test the hook
function TestComponent({
  recipeId,
  stepId,
  onStateChange,
}: {
  recipeId: string
  stepId: string
  onStateChange?: (state: ReturnType<typeof useIngredientParser>) => void
}) {
  const parser = useIngredientParser({ recipeId, stepId })

  // Report state changes to test
  if (onStateChange) {
    onStateChange(parser)
  }

  return (
    <div>
      <textarea
        data-testid="input"
        value={parser.text}
        onChange={(e) => parser.setText(e.target.value)}
      />
      <button data-testid="parse" onClick={() => parser.parse()}>
        Parse
      </button>
      <button data-testid="clear" onClick={() => parser.clear()}>
        Clear
      </button>
      {parser.isLoading && <span data-testid="loading">Loading...</span>}
      {parser.error && <span data-testid="error">{parser.error}</span>}
      {parser.parsedIngredients && (
        <ul data-testid="results">
          {parser.parsedIngredients.map((ing, i) => (
            <li key={i}>
              {ing.quantity} {ing.unit} {ing.ingredientName}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Create a test wrapper with router context
function createTestWrapper(actionHandler: (formData: FormData) => Promise<unknown>) {
  return createRoutesStub([
    {
      path: '/recipes/:id/steps/:stepId/edit',
      Component: () => <TestComponent recipeId="recipe-1" stepId="step-1" />,
      action: async ({ request }) => {
        const formData = await request.formData()
        return actionHandler(formData)
      },
    },
  ])
}

describe('useIngredientParser', () => {
  describe('getIngredientParserAction', () => {
    it('posts unsaved new-recipe builder parsing to the new recipe route', () => {
      expect(getIngredientParserAction('new-recipe', 'new-step-1')).toBe('/recipes/new')
    })

    it('posts saved step parsing to the step edit route', () => {
      expect(getIngredientParserAction('recipe-1', 'step-1')).toBe('/recipes/recipe-1/steps/step-1/edit')
    })
  })

  describe('initialization', () => {
    it('initializes with empty text', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByTestId('input')).toHaveValue('')
    })

    it('initializes with isLoading as false', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })

    it('initializes with no error', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
    })

    it('initializes with no parsed ingredients', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.queryByTestId('results')).not.toBeInTheDocument()
    })
  })

  describe('text input', () => {
    it('updates text when setText is called', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })

      expect(screen.getByTestId('input')).toHaveValue('2 cups flour')
    })

    it('clears text when clear is called', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('clear'))

      expect(screen.getByTestId('input')).toHaveValue('')
    })

    it('clears parsed ingredients when clear is called', async () => {
      const Wrapper = createTestWrapper(async () => ({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Parse first using manual parse
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))
      await waitFor(() => expect(screen.getByTestId('results')).toBeInTheDocument())

      // Clear
      fireEvent.click(screen.getByTestId('clear'))

      expect(screen.queryByTestId('results')).not.toBeInTheDocument()
    })

    it('clears error when clear is called', async () => {
      const Wrapper = createTestWrapper(async () => ({
        errors: { parse: 'Parse failed' },
      }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error using manual parse
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'invalid' } })
      fireEvent.click(screen.getByTestId('parse'))
      await waitFor(() => expect(screen.getByTestId('error')).toBeInTheDocument())

      // Clear
      fireEvent.click(screen.getByTestId('clear'))

      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
    })
  })

  describe('debounced parsing', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not trigger parse immediately on text change', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })

      // Immediately after typing, action should not be called
      expect(actionHandler).not.toHaveBeenCalled()
    })

    it('triggers parse after debounce delay (1 second)', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })

      // Before debounce
      expect(actionHandler).not.toHaveBeenCalled()

      // Advance timers by 1 second
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // The debounce triggered, but the actual action runs async
      // Since we're testing debounce behavior, verify the timeout was set up correctly
      // by checking that the action wasn't called before the delay
      expect(actionHandler).not.toHaveBeenCalled() // Still not called because router async hasn't resolved

      // Switch to real timers to let the router resolve
      vi.useRealTimers()
      await waitFor(
        () => {
          expect(actionHandler).toHaveBeenCalled()
        },
        { timeout: 3000 }
      )
    })

    it('resets debounce timer on each keystroke', async () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Type first character
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2' } })

      // Wait 500ms
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Type more
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups' } })

      // Wait 500ms more (total 1000ms from first char, but only 500ms from last)
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should not have fired yet
      expect(actionHandler).not.toHaveBeenCalled()

      // Wait remaining 500ms
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Switch to real timers and verify
      vi.useRealTimers()
      await waitFor(
        () => {
          expect(actionHandler).toHaveBeenCalled()
        },
        { timeout: 3000 }
      )
    })

    it('does not trigger parse for empty text', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Type then delete
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'a' } })
      fireEvent.change(screen.getByTestId('input'), { target: { value: '' } })

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(actionHandler).not.toHaveBeenCalled()
    })

    it('does not trigger parse for whitespace-only text', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '   ' } })

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(actionHandler).not.toHaveBeenCalled()
    })
  })

  describe('manual parsing', () => {
    it('does not trigger parse when text is empty', async () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Click parse without entering any text
      fireEvent.click(screen.getByTestId('parse'))

      // Wait a bit to ensure nothing was triggered
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(actionHandler).not.toHaveBeenCalled()
    })

    it('does not trigger parse when text is whitespace-only', async () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Enter whitespace only
      fireEvent.change(screen.getByTestId('input'), { target: { value: '   ' } })
      fireEvent.click(screen.getByTestId('parse'))

      // Wait a bit to ensure nothing was triggered
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(actionHandler).not.toHaveBeenCalled()
    })

    it('triggers parse immediately when parse() is called', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(actionHandler).toHaveBeenCalled()
      })
    })

    it('cancels pending debounce when parse() is called', async () => {
      vi.useFakeTimers()
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      // Even after debounce period, should only have been called once (from manual parse)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      vi.useRealTimers()
      await waitFor(
        () => {
          expect(actionHandler).toHaveBeenCalledTimes(1)
        },
        { timeout: 3000 }
      )
    })
  })

  describe('loading state', () => {
    it('sets isLoading to true while parsing', async () => {
      let resolveAction: (value: unknown) => void
      const actionPromise = new Promise((resolve) => {
        resolveAction = resolve
      })
      const actionHandler = vi.fn().mockImplementation(() => actionPromise)
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toBeInTheDocument()
      })

      // Resolve to clean up
      await act(async () => {
        resolveAction!({ parsedIngredients: [] })
      })
    })

    it('sets isLoading to false when parsing completes', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('results')).toBeInTheDocument()
      })
    })

    it('sets isLoading to false when parsing fails', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: 'invalid' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('error')).toBeInTheDocument()
      })
    })
  })

  describe('parsing results', () => {
    it('stores parsed ingredients on success', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [
          { quantity: 2, unit: 'cup', ingredientName: 'flour' },
          { quantity: 0.5, unit: 'tsp', ingredientName: 'salt' },
        ],
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), {
        target: { value: '2 cups flour\n1/2 tsp salt' },
      })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        const results = screen.getByTestId('results')
        expect(results).toHaveTextContent('2 cup flour')
        expect(results).toHaveTextContent('0.5 tsp salt')
      })
    })

    it('clears previous results on new parse', async () => {
      let parseCount = 0
      const actionHandler = vi.fn().mockImplementation(async () => {
        parseCount++
        return {
          parsedIngredients: [
            {
              quantity: parseCount,
              unit: 'cup',
              ingredientName: parseCount === 1 ? 'flour' : 'sugar',
            },
          ],
        }
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // First parse
      fireEvent.change(screen.getByTestId('input'), { target: { value: '1 cup flour' } })
      fireEvent.click(screen.getByTestId('parse'))
      await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('flour'))

      // Clear and parse again
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups sugar' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        const results = screen.getByTestId('results')
        expect(results).toHaveTextContent('sugar')
        expect(results).not.toHaveTextContent('flour')
      })
    })
  })

  describe('error handling', () => {
    it('stores error message on parse failure', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Failed to parse: API rate limited' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: 'invalid' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to parse: API rate limited')
      })
    })

    it('clears error on new successful parse', async () => {
      let shouldFail = true
      const actionHandler = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return { errors: { parse: 'Parse failed' } }
        }
        return { parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }] }
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'invalid' } })
      fireEvent.click(screen.getByTestId('parse'))
      await waitFor(() => expect(screen.getByTestId('error')).toBeInTheDocument())

      // Parse again successfully
      shouldFail = false
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.queryByTestId('error')).not.toBeInTheDocument()
        expect(screen.getByTestId('results')).toBeInTheDocument()
      })
    })

    it('clears parsed ingredients on parse failure', async () => {
      let shouldFail = false
      const actionHandler = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return { errors: { parse: 'Parse failed' } }
        }
        return { parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }] }
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Parse successfully first
      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))
      await waitFor(() => expect(screen.getByTestId('results')).toBeInTheDocument())

      // Parse with failure
      shouldFail = true
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'bad input' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument()
        expect(screen.queryByTestId('results')).not.toBeInTheDocument()
      })
    })
  })

  describe('fetcher data', () => {
    it('handles empty response from action (no parsedIngredients, no errors)', async () => {
      // This tests the edge case where action returns something but without
      // parsedIngredients or errors (e.g., empty object or unexpected response)
      const actionHandler = vi.fn().mockResolvedValue({})
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(actionHandler).toHaveBeenCalled()
      })

      // Should not show error or results
      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('results')).not.toBeInTheDocument()
    })

    it('sends correct form data to action', async () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), { target: { value: '2 cups flour' } })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        expect(actionHandler).toHaveBeenCalled()
        const formData = actionHandler.mock.calls[0][0] as FormData
        expect(formData.get('intent')).toBe('parseIngredients')
        expect(formData.get('ingredientText')).toBe('2 cups flour')
      })
    })

    it('preserves multi-line ingredient text', async () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByTestId('input'), {
        target: { value: '2 cups flour\n1/2 tsp salt\n3 eggs' },
      })
      fireEvent.click(screen.getByTestId('parse'))

      await waitFor(() => {
        const formData = actionHandler.mock.calls[0][0] as FormData
        expect(formData.get('ingredientText')).toBe('2 cups flour\n1/2 tsp salt\n3 eggs')
      })
    })
  })
})
