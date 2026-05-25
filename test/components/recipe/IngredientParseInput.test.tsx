/**
 * Tests for IngredientParseInput component.
 *
 * This component provides a textarea/input for entering natural language
 * ingredient text that gets parsed by AI. It integrates with useIngredientParser
 * to provide debounced parsing with loading and error states.
 *
 * Note: These tests use fireEvent with fake timers for debounce-specific tests,
 * and real timers for router integration tests. This is because React Router's
 * createRoutesStub has internal async mechanisms that don't work well with
 * vitest's fake timers.
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoutesStub } from 'react-router'
import { IngredientParseInput } from '~/components/recipe/IngredientParseInput'

// Create a test wrapper with router context
function createTestWrapper(
  actionHandler: (formData: FormData) => Promise<unknown>,
  props: Partial<React.ComponentProps<typeof IngredientParseInput>> = {}
) {
  const defaultProps = {
    recipeId: 'recipe-1',
    stepId: 'step-1',
    onParsed: vi.fn(),
    ...props,
  }

  return createRoutesStub([
    {
      path: '/recipes/:id/steps/:stepId/edit',
      Component: () => <IngredientParseInput {...defaultProps} />,
      action: async ({ request }) => {
        const formData = await request.formData()
        return actionHandler(formData)
      },
    },
  ])
}

describe('IngredientParseInput', () => {
  describe('rendering', () => {
    it('renders a textarea for ingredient input', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders with placeholder text', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByPlaceholderText(/enter ingredients/i)).toBeInTheDocument()
    })

    it('renders label for textarea', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByLabelText(/ingredient text/i)).toBeInTheDocument()
    })

    it('renders helper text explaining the feature', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByText(/ai will parse/i)).toBeInTheDocument()
    })

    it('textarea is multi-line (has rows attribute)', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('rows')
      expect(parseInt(textarea.getAttribute('rows') || '0')).toBeGreaterThanOrEqual(3)
    })
  })

  describe('loading states', () => {
    it('shows loading indicator while parsing', async () => {
      let resolveAction: (value: unknown) => void
      const actionPromise = new Promise((resolve) => {
        resolveAction = resolve
      })
      const actionHandler = vi.fn().mockImplementation(() => actionPromise)
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
      })

      // Resolve to clean up
      await act(async () => {
        resolveAction!({ parsedIngredients: [] })
      })
    })

    it('hides loading indicator when parsing completes', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
      })
    })

    it('disables textarea while loading', async () => {
      let resolveAction: (value: unknown) => void
      const actionPromise = new Promise((resolve) => {
        resolveAction = resolve
      })
      const actionHandler = vi.fn().mockImplementation(() => actionPromise)
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeDisabled()
      })

      // Resolve to clean up
      await act(async () => {
        resolveAction!({ parsedIngredients: [] })
      })
    })

    it('shows aria-busy on container while loading', async () => {
      let resolveAction: (value: unknown) => void
      const actionPromise = new Promise((resolve) => {
        resolveAction = resolve
      })
      const actionHandler = vi.fn().mockImplementation(() => actionPromise)
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const container = screen.getByRole('textbox').closest('[aria-busy]')
        expect(container).toHaveAttribute('aria-busy', 'true')
      })

      // Resolve to clean up
      await act(async () => {
        resolveAction!({ parsedIngredients: [] })
      })
    })
  })

  describe('error states', () => {
    it('displays error message when parsing fails', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Failed to parse ingredients' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid input' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        // The actionable message transforms "Failed to parse" errors to user-friendly text
        expect(screen.getByRole('alert')).toHaveTextContent(/unable to connect|try again/i)
      })
    })

    it('clears error when user types again', async () => {
      let shouldFail = true
      const actionHandler = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return { errors: { parse: 'Parse failed' } }
        }
        return { parsedIngredients: [] }
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bad' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

      // Type again - error should clear
      shouldFail = false
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bad more text' } })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('marks textarea as invalid when error present', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        // HeadlessUI uses data-invalid attribute instead of aria-invalid for styling
        const textarea = screen.getByRole('textbox')
        expect(textarea).toHaveAttribute('data-invalid')
      })
    })

    it('displays error message with alert role for screen readers', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        // Error message has role="alert" for screen reader announcements
        // The actionable message transforms generic errors to user-friendly text
        const errorAlert = screen.getByRole('alert')
        expect(errorAlert).toHaveTextContent(/went wrong|try again|manually/i)
      })
    })
  })

  describe('error recovery UX', () => {
    it('shows Try Again button for retryable errors', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Failed to parse ingredients' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('try-again-button')).toBeInTheDocument()
      })
    })

    it('does not show Try Again button for non-retryable errors (missing API key)', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'OpenAI API key is required' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('try-again-button')).not.toBeInTheDocument()
    })

    it('shows Add Manually button when onSwitchToManual is provided', async () => {
      const onSwitchToManual = vi.fn()
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler, { onSwitchToManual })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('switch-to-manual-button')).toBeInTheDocument()
      })
    })

    it('calls onSwitchToManual when Add Manually button is clicked', async () => {
      const onSwitchToManual = vi.fn()
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler, { onSwitchToManual })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('switch-to-manual-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('switch-to-manual-button'))

      expect(onSwitchToManual).toHaveBeenCalledTimes(1)
    })

    it('transforms API key error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'OpenAI API key is required' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/AI parsing is unavailable/i)
        expect(alert).toHaveTextContent(/manually/i)
      })
    })

    it('transforms connection error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Failed to parse ingredients' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/unable to connect|try again/i)
      })
    })

    it('transforms network error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'network error occurred' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/unable to connect/i)
      })
    })

    it('transforms connection error to user-friendly message (explicit connection keyword)', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'connection refused' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/unable to connect/i)
      })
    })

    it('transforms timeout error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Request timeout' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/unable to connect/i)
      })
    })

    it('transforms "No response" error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'No response from AI service' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/AI parsing failed to process/i)
      })
    })

    it('transforms schema validation error to user-friendly message', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Response did not match expected schema' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(/AI returned unexpected results/i)
      })
    })

    it('retries parsing when Try Again button is clicked', async () => {
      let callCount = 0
      const actionHandler = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { errors: { parse: 'Failed to parse ingredients' } }
        }
        return { parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }] }
      })
      const onParsed = vi.fn()
      const Wrapper = createTestWrapper(actionHandler, { onParsed })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('try-again-button')).toBeInTheDocument()
      })

      // Click Try Again
      fireEvent.click(screen.getByTestId('try-again-button'))

      await waitFor(() => {
        expect(actionHandler).toHaveBeenCalledTimes(2)
      })

      // Second call should succeed and call onParsed
      await waitFor(() => {
        expect(onParsed).toHaveBeenCalledWith([{ quantity: 2, unit: 'cup', ingredientName: 'flour' }])
      })
    })

    it('does not show Try Again when text is cleared after error', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Failed to parse ingredients' },
      })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger error via debounce with text
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByTestId('try-again-button')).toBeInTheDocument()
      })

      // Clear the text
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })

      // Error should be cleared when text is cleared (error UI not visible)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('debounce behavior', () => {
    it('shows typing indicator before debounce triggers', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups' } })

      // Before debounce triggers
      expect(screen.getByText(/will parse/i)).toBeInTheDocument()
    })

    it('does not show loading indicator before debounce', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })

      // Immediately after typing, no loading indicator
      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
    })
  })

  describe('callback', () => {
    it('calls onParsed when parsing succeeds', async () => {
      const onParsed = vi.fn()
      const parsedIngredients = [
        { quantity: 2, unit: 'cup', ingredientName: 'flour' },
        { quantity: 0.5, unit: 'tsp', ingredientName: 'salt' },
      ]
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients })
      const Wrapper = createTestWrapper(actionHandler, { onParsed })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(onParsed).toHaveBeenCalledWith(parsedIngredients)
      })
    })

    it('does not call onParsed when parsing fails', async () => {
      const onParsed = vi.fn()
      const actionHandler = vi.fn().mockResolvedValue({
        errors: { parse: 'Parse failed' },
      })
      const Wrapper = createTestWrapper(actionHandler, { onParsed })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
      expect(onParsed).not.toHaveBeenCalled()
    })

    it('calls onParsed with empty array when text is cleared', async () => {
      const onParsed = vi.fn()
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler, { onParsed })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Parse first via debounce
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => expect(onParsed).toHaveBeenCalledTimes(1))

      // Clear
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })

      expect(onParsed).toHaveBeenCalledWith([])
    })
  })

  describe('disabled state', () => {
    it('disables textarea when disabled prop is true', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('does not trigger parse when disabled', () => {
      vi.useFakeTimers()
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler, { disabled: true })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Attempt to change (should not work when disabled, but we test the debounce doesn't fire)
      // Note: In reality, a disabled textarea won't receive change events,
      // but we verify the component handles this correctly
      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeDisabled()

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      vi.useRealTimers()
      expect(actionHandler).not.toHaveBeenCalled()
    })
  })

  describe('controlled value', () => {
    it('accepts initial value via defaultValue prop', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        defaultValue: '2 cups flour',
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByRole('textbox')).toHaveValue('2 cups flour')
    })

    it('triggers parse for initial value after debounce', async () => {
      const actionHandler = vi.fn().mockResolvedValue({
        parsedIngredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      })
      const Wrapper = createTestWrapper(actionHandler, {
        defaultValue: '2 cups flour',
      })

      vi.useFakeTimers()
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(actionHandler).toHaveBeenCalled()
      })
    })
  })

  describe('accessibility', () => {
    it('has accessible label', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      expect(screen.getByLabelText(/ingredient text/i)).toBeInTheDocument()
    })

    it('has accessible description', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Description text is visible and provides context
      expect(screen.getByText(/AI will parse your ingredients/i)).toBeInTheDocument()
    })

    it('announces loading state to screen readers', async () => {
      let resolveAction: (value: unknown) => void
      const actionPromise = new Promise((resolve) => {
        resolveAction = resolve
      })
      const actionHandler = vi.fn().mockImplementation(() => actionPromise)
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      // Trigger debounce by changing text then waiting
      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      await waitFor(() => {
        const loadingIndicator = screen.getByTestId('loading-indicator')
        expect(loadingIndicator).toHaveAttribute('aria-live', 'polite')
      })

      // Resolve to clean up
      await act(async () => {
        resolveAction!({ parsedIngredients: [] })
      })
    })
  })

  describe('keyboard interaction', () => {
    it('supports Enter key for new lines in textarea', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: '2 cups flour\n1/2 tsp salt' },
      })

      expect(screen.getByRole('textbox')).toHaveValue('2 cups flour\n1/2 tsp salt')
    })

    it('does not submit form on Enter key', () => {
      const actionHandler = vi.fn().mockResolvedValue({ parsedIngredients: [] })
      const Wrapper = createTestWrapper(actionHandler)
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 cups flour' } })
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' })

      // Enter should just add newline, not trigger immediate parse
      expect(actionHandler).not.toHaveBeenCalled()
    })
  })

  describe('example placeholder', () => {
    it('shows example format in placeholder', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/step-1/edit']} />)

      const textarea = screen.getByRole('textbox')
      const placeholder = textarea.getAttribute('placeholder')
      expect(placeholder).toMatch(/\d+/)
      expect(placeholder?.toLowerCase()).toMatch(/cup|tbsp|tsp|oz/)
    })
  })
})
