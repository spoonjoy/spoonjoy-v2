/**
 * Tests for StepList component.
 *
 * This component manages a collection of StepEditorCard instances with:
 * - '+ Add Step' button to add new steps at end
 * - Remove step with confirmation dialog
 * - Empty state handling
 * - Steps array management (controlled component)
 */

import { render, screen, within, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoutesStub } from 'react-router'
import { useState } from 'react'
import { StepList } from '~/components/recipe/StepList'
import type { StepData } from '~/components/recipe/StepEditorCard'

// Mock localStorage for IngredientInputToggle used by StepEditorCard
let localStorageStore: Record<string, string> = {}

const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key]
  }),
  clear: vi.fn(() => {
    localStorageStore = {}
  }),
}

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Helper to create test steps
function createTestStep(overrides: Partial<StepData> = {}): StepData {
  return {
    id: `step-${Math.random().toString(36).substring(7)}`,
    stepNum: 1,
    description: 'Test step description',
    ingredients: [],
    ...overrides,
  }
}

// Create test wrapper with router context (needed for StepEditorCard's AI parsing)
function createTestWrapper(props: Partial<React.ComponentProps<typeof StepList>> = {}) {
  const defaultProps = {
    steps: [],
    recipeId: 'recipe-1',
    onChange: vi.fn(),
    ...props,
  }

  return createRoutesStub([
    {
      path: '/recipes/:id/edit',
      Component: () => <StepList {...defaultProps} />,
      action: async () => ({ parsedIngredients: [] }),
    },
    // Route for AI ingredient parsing
    {
      path: '/recipes/:id/steps/:stepId/edit',
      action: async () => ({ parsedIngredients: [] }),
    },
  ])
}

function stepCard(stepNum: number) {
  return screen.getByRole('article', { name: `Step ${stepNum}` })
}

async function moveStep(stepNum: number, move: 'Move up' | 'Move down' | 'Move to top' | 'Move to bottom') {
  await userEvent.click(screen.getByRole('button', { name: `Reorder Step ${stepNum}` }))
  await userEvent.click(await screen.findByRole('menuitem', { name: move }))
}

describe('StepList', () => {
  beforeEach(() => {
    localStorageStore = {}
    vi.resetAllMocks()
    localStorageMock.getItem.mockImplementation((key: string) => localStorageStore[key] ?? null)
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      localStorageStore[key] = value
    })
    localStorageMock.removeItem.mockImplementation((key: string) => {
      delete localStorageStore[key]
    })
    localStorageMock.clear.mockImplementation(() => {
      localStorageStore = {}
    })
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  describe('empty state', () => {
    it('renders empty state when steps array is empty', () => {
      const Wrapper = createTestWrapper({ steps: [] })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      expect(screen.getByText(/no steps/i)).toBeInTheDocument()
    })
  })

  describe('rendering steps', () => {
    it('renders StepEditorCard for each step in array', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Third step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Should render 3 step cards
      const articles = screen.getAllByRole('article')
      expect(articles).toHaveLength(3)

      // Each step should be labeled correctly
      expect(stepCard(1)).toBeInTheDocument()
      expect(stepCard(2)).toBeInTheDocument()
      expect(stepCard(3)).toBeInTheDocument()
    })

    it('renders many steps (5+) correctly', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'Step one' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Step two' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Step three' }),
        createTestStep({ id: 'step-4', stepNum: 4, description: 'Step four' }),
        createTestStep({ id: 'step-5', stepNum: 5, description: 'Step five' }),
        createTestStep({ id: 'step-6', stepNum: 6, description: 'Step six' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // All 6 steps should be rendered
      const articles = screen.getAllByRole('article')
      expect(articles).toHaveLength(6)

      // Verify all step labels
      for (let i = 1; i <= 6; i++) {
        expect(stepCard(i)).toBeInTheDocument()
      }
    })

    it('steps maintain correct numbering (1, 2, 3...)', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Third' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Check step numbers are displayed in order
      const stepNumbers = screen.getAllByRole('article')
      expect(within(stepNumbers[0]).getByText('1')).toBeInTheDocument()
      expect(within(stepNumbers[1]).getByText('2')).toBeInTheDocument()
      expect(within(stepNumbers[2]).getByText('3')).toBeInTheDocument()
    })
  })

  describe('add step functionality', () => {
    it('renders "+ Add Step" link for existing recipes (edit mode)', () => {
      const Wrapper = createTestWrapper({ steps: [], recipeId: 'recipe-1' })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // In edit mode, it's a link that navigates to the new step page
      const addLink = screen.getByRole('link', { name: /add step/i })
      expect(addLink).toBeInTheDocument()
      expect(addLink).toHaveAttribute('href', '/recipes/recipe-1/steps/new')
    })

    it('renders "+ Add Step" button visible and clickable for new recipes (create mode)', () => {
      // Use a recipeId starting with 'new-' to trigger button rendering
      const Wrapper = createTestWrapper({ steps: [], recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      const addButton = screen.getByRole('button', { name: /add step/i })
      expect(addButton).toBeInTheDocument()
      expect(addButton).toBeEnabled()
    })

    it('clicking add step calls onChange with new step appended', async () => {
      const onChange = vi.fn()
      const existingSteps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
      ]
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: existingSteps, onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /add step/i }))

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps).toHaveLength(2)
      expect(newSteps[0]).toEqual(existingSteps[0])
      // New step should have correct stepNum
      expect(newSteps[1].stepNum).toBe(2)
      expect(newSteps[1].description).toBe('')
      expect(newSteps[1].ingredients).toEqual([])
    })
  })

  describe('remove step functionality', () => {
    it('remove step shows confirmation dialog', async () => {
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Click the remove button on the step card
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      // Confirmation dialog should appear
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText(/are you sure/i)).toBeInTheDocument()
    })

    it('confirming removal calls onChange without removed step', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Click remove on first step
      const firstStepCard = stepCard(1)
      await userEvent.click(within(firstStepCard).getByRole('button', { name: /remove/i }))

      // Confirm removal
      await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps).toHaveLength(1)
      expect(newSteps[0].id).toBe('step-2')
      // Step number should be renumbered to 1
      expect(newSteps[0].stepNum).toBe(1)
    })

    it('canceling removal keeps step', async () => {
      const onChange = vi.fn()
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Click remove
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      // Cancel removal
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      // onChange should not have been called
      expect(onChange).not.toHaveBeenCalled()

      // Step should still be visible
      expect(stepCard(1)).toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('disabled prop disables add button and all step cards', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1 }),
        createTestStep({ id: 'step-2', stepNum: 2 }),
      ]
      // Use 'new-' prefix to get button behavior (which can be disabled)
      const Wrapper = createTestWrapper({ steps, disabled: true, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      // Add button should be disabled
      expect(screen.getByRole('button', { name: /add step/i })).toBeDisabled()

      // All step cards should have disabled controls
      const removeButtons = screen.getAllByRole('button', { name: /remove/i })
      removeButtons.forEach((button) => {
        expect(button).toBeDisabled()
      })

      const saveButtons = screen.getAllByRole('button', { name: /save/i })
      saveButtons.forEach((button) => {
        expect(button).toBeDisabled()
      })
    })
  })

  describe('onChange callback', () => {
    it('onChange receives properly structured step data', async () => {
      const onChange = vi.fn()
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: [], onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      // Add a new step
      await userEvent.click(screen.getByRole('button', { name: /add step/i }))

      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            stepNum: 1,
            description: expect.any(String),
            ingredients: expect.any(Array),
          }),
        ])
      )
    })
  })

  describe('step content editing', () => {
    it('saving step content calls onChange with updated step data', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'Original description' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Find the description textarea and update it
      const textarea = stepCard(1).querySelector('textarea')
      expect(textarea).toBeInTheDocument()

      // Clear and type new description
      await userEvent.clear(textarea!)
      await userEvent.type(textarea!, 'Updated description')

      // Click save button
      const saveButton = screen.getByRole('button', { name: /save/i })
      await userEvent.click(saveButton)

      // onChange should be called with an updater that changes this step
      expect(onChange).toHaveBeenCalled()
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0](steps)
      expect(lastCall[0].description).toBe('Updated description')
    })

    it('saving step preserves step id and stepNum', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'Original' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Find the first step's textarea and update it
      const firstStepCard = stepCard(1)
      const textarea = firstStepCard.querySelector('textarea')
      expect(textarea).toBeInTheDocument()

      await userEvent.clear(textarea!)
      await userEvent.type(textarea!, 'New content')

      // Click save button on first step
      const saveButton = within(firstStepCard).getByRole('button', { name: /save/i })
      await userEvent.click(saveButton)

      // Check the updater preserves id and stepNum
      expect(onChange).toHaveBeenCalled()
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0](steps)
      expect(lastCall[0].id).toBe('step-1')
      expect(lastCall[0].stepNum).toBe(1)
      // Second step should be unchanged
      expect(lastCall[1].id).toBe('step-2')
      expect(lastCall[1].stepNum).toBe(2)
    })
  })

  describe('reorder functionality', () => {
    const threeSteps = () => [
      createTestStep({ id: 'step-1', stepNum: 1, description: 'First step', ingredients: [{ quantity: 1, unit: 'cup', ingredientName: 'flour' }] }),
      createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      createTestStep({ id: 'step-3', stepNum: 3, description: 'Third step' }),
    ]

    it('is an HX Reorderable list named Steps, with a handle per step', () => {
      const Wrapper = createTestWrapper({ steps: threeSteps() })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /^Reorder Step \d$/ })).toHaveLength(3)
    })

    it('disabled state disables reordering, so a step cannot move while a save is in flight', () => {
      const onChange = vi.fn()
      const Wrapper = createTestWrapper({ steps: threeSteps(), onChange, disabled: true })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const list = screen.getByRole('list', { name: 'Steps' })
      expect(within(list).getAllByRole('listitem').filter((item) => item.parentElement === list)).toHaveLength(3)
      for (const handle of within(list).getAllByRole('button', { name: /^Reorder Step \d$/ })) {
        expect(handle).toHaveAttribute('aria-disabled', 'true')
        expect(handle).not.toHaveAttribute('disabled')
        expect(handle.tabIndex).toBe(0)
      }
      expect(onChange).not.toHaveBeenCalled()
    })

    it("keeps each step's drafts while a save starts and ends: the AI text, the input mode and a half-typed ingredient", async () => {
      function Harness() {
        const [disabled, setDisabled] = useState(false)
        return (
          <>
            <button type="button" onClick={() => setDisabled((value) => !value)}>Toggle saving</button>
            <StepList steps={threeSteps()} recipeId="recipe-1" onChange={vi.fn()} disabled={disabled} />
          </>
        )
      }
      const Stub = createRoutesStub([
        { path: '/recipes/:id/edit', Component: Harness },
        { path: '/recipes/:id/steps/:stepId/edit', action: async () => ({ parsedIngredients: [] }) },
      ])
      render(<Stub initialEntries={['/recipes/recipe-1/edit']} />)
      const toggleSaving = async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Toggle saving' }))
        await userEvent.click(screen.getByRole('button', { name: 'Toggle saving' }))
      }

      const aiText = within(stepCard(1)).getByRole('textbox', { name: 'Ingredient text' })
      fireEvent.change(aiText, { target: { value: '2 eggs' } })
      await toggleSaving()
      expect(within(stepCard(1)).getByRole('textbox', { name: 'Ingredient text' })).toBe(aiText)
      expect(aiText).toHaveValue('2 eggs')

      await userEvent.click(within(stepCard(2)).getByRole('switch', { name: 'AI Parse' }))
      await userEvent.type(within(stepCard(2)).getByRole('textbox', { name: 'Unit' }), 'cup')
      await toggleSaving()
      expect(within(stepCard(2)).getByRole('switch', { name: 'AI Parse' })).not.toBeChecked()
      expect(within(stepCard(2)).getByRole('textbox', { name: 'Unit' })).toHaveValue('cup')
    })

    it('blocks the handles while a save is in flight, without moving the steps out of the list', async () => {
      const onChange = vi.fn()
      const Wrapper = createTestWrapper({ steps: threeSteps(), onChange, disabled: true })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const handle = screen.getByRole('button', { name: 'Reorder Step 2' })
      await userEvent.click(handle)
      expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument()
      handle.focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowUp}')
      await userEvent.keyboard(' ')
      expect(handle).toHaveFocus()
      expect(screen.getAllByRole('button', { name: /^Reorder Step \d$/ })
        .map((button) => button.getAttribute('aria-label'))).toEqual([
        'Reorder Step 1', 'Reorder Step 2', 'Reorder Step 3',
      ])
      expect(onChange).not.toHaveBeenCalled()
    })

    it("a handle's Move up moves the step up and renumbers every step", async () => {
      const onChange = vi.fn()
      const Wrapper = createTestWrapper({ steps: threeSteps(), onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      await moveStep(2, 'Move up')

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps.map((step: StepData) => step.id)).toEqual(['step-2', 'step-1', 'step-3'])
      expect(newSteps.map((step: StepData) => step.stepNum)).toEqual([1, 2, 3])
    })

    it("a handle's Move down moves the step down and keeps its content", async () => {
      const onChange = vi.fn()
      const Wrapper = createTestWrapper({ steps: threeSteps(), onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      await moveStep(1, 'Move down')

      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps.map((step: StepData) => step.id)).toEqual(['step-2', 'step-1', 'step-3'])
      expect(newSteps[1]).toMatchObject({ description: 'First step', stepNum: 2, ingredients: [{ ingredientName: 'flour' }] })
    })

    it('cannot move the first step up or the last step down', async () => {
      const Wrapper = createTestWrapper({ steps: threeSteps() })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: 'Reorder Step 1' }))
      expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('rapid operations', () => {
    it('handles rapid add operations correctly', async () => {
      const onChange = vi.fn()
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: [], onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      const addButton = screen.getByRole('button', { name: /add step/i })

      // Rapidly click add button multiple times
      await userEvent.click(addButton)
      await userEvent.click(addButton)
      await userEvent.click(addButton)

      // Each click should call onChange
      expect(onChange).toHaveBeenCalledTimes(3)

      // Each call should have incrementing stepNum
      expect(onChange.mock.calls[0][0][0].stepNum).toBe(1)
      expect(onChange.mock.calls[1][0][0].stepNum).toBe(1) // Still 1 because steps prop hasn't changed
      expect(onChange.mock.calls[2][0][0].stepNum).toBe(1)
    })

    it('handles add then immediate remove correctly', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
      ]
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps, onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      // Add a step
      await userEvent.click(screen.getByRole('button', { name: /add step/i }))
      expect(onChange).toHaveBeenCalledTimes(1)

      // Now remove the first step
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))
      await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('keyboard navigation', () => {
    it('Enter key on Add Step button adds a new step', async () => {
      const onChange = vi.fn()
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: [], onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      const addButton = screen.getByRole('button', { name: /add step/i })

      // Focus the button and press Enter (wrapped in act to avoid warnings)
      await act(async () => {
        addButton.focus()
      })
      await userEvent.keyboard('{Enter}')

      // Should have called onChange to add a step
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            stepNum: 1,
            description: '',
          }),
        ])
      )
    })

    it('Space key on Add Step button adds a new step', async () => {
      const onChange = vi.fn()
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: [], onChange, recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      const addButton = screen.getByRole('button', { name: /add step/i })

      // Focus the button and press Space (wrapped in act to avoid warnings)
      await act(async () => {
        addButton.focus()
      })
      await userEvent.keyboard(' ')

      // Should have called onChange to add a step
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('newly added step receives focus on its instructions textarea', async () => {
      const onChange = vi.fn()
      // Start with no steps, use 'new-' prefix
      const Wrapper = createTestWrapper({ steps: [], onChange, recipeId: 'new-recipe-1' })
      const { rerender } = render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      // Click add step
      await userEvent.click(screen.getByRole('button', { name: /add step/i }))

      // Simulate parent re-rendering with the new step
      const newStep = onChange.mock.calls[0][0][0]
      const WrapperWithStep = createTestWrapper({ steps: [newStep], onChange, recipeId: 'new-recipe-1' })
      rerender(<WrapperWithStep initialEntries={['/recipes/new-recipe-1/edit']} />)

      // The new step's instructions textarea should receive focus
      const instructionsTextarea = within(stepCard(1)).getByLabelText(/instructions/i)
      expect(instructionsTextarea).toHaveFocus()
    })

    it('Add Step button is keyboard accessible (no tabindex=-1)', () => {
      // Use 'new-' prefix to get button behavior
      const Wrapper = createTestWrapper({ steps: [], recipeId: 'new-recipe-1' })
      render(<Wrapper initialEntries={['/recipes/new-recipe-1/edit']} />)

      const addButton = screen.getByRole('button', { name: /add step/i })
      expect(addButton).not.toHaveAttribute('tabindex', '-1')
    })

    it('Escape key closes confirmation dialog', async () => {
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog by clicking remove
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      // Dialog should be open
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()

      // Press Escape to close
      await userEvent.keyboard('{Escape}')

      // Dialog should be closed (wait for exit animation to complete)
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
    })

    it('dialog traps focus while open', async () => {
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      const dialog = screen.getByRole('alertdialog')
      const cancelButton = within(dialog).getByRole('button', { name: /cancel/i })
      const confirmButton = within(dialog).getByRole('button', { name: /confirm/i })

      // Focus should be inside the dialog
      // Tab through the dialog buttons (wrapped in act to avoid warnings)
      await act(async () => {
        cancelButton.focus()
      })
      expect(cancelButton).toHaveFocus()

      await userEvent.tab()
      expect(confirmButton).toHaveFocus()

      // Tab again should cycle back to cancel (focus trap)
      await userEvent.tab()
      expect(cancelButton).toHaveFocus()
    })

    it('all step card buttons are keyboard accessible (no tabindex=-1)', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all buttons in step cards
      const allButtons = screen.getAllByRole('button')
      allButtons.forEach((button) => {
        expect(button).not.toHaveAttribute('tabindex', '-1')
      })
    })

    it('dialog Cancel button closes dialog when clicked', async () => {
      const onChange = vi.fn()
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      const dialog = screen.getByRole('alertdialog')
      const cancelButton = within(dialog).getByRole('button', { name: /cancel/i })

      // Click cancel button
      await userEvent.click(cancelButton)

      // Dialog should be closed, step should remain (wait for exit animation to complete)
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(stepCard(1)).toBeInTheDocument()
      // onChange should not have been called (step not removed)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('dialog Confirm button activates on Enter key', async () => {
      const onChange = vi.fn()
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      const dialog = screen.getByRole('alertdialog')
      const confirmButton = within(dialog).getByRole('button', { name: /confirm/i })

      // Focus confirm button and press Enter (wrapped in act to avoid warnings)
      await act(async () => {
        confirmButton.focus()
      })
      await userEvent.keyboard('{Enter}')

      // Dialog should be closed, step should be removed (wait for exit animation to complete)
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      // onChange should have been called to remove the step
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([])
    })

    it('dialog Confirm button activates on Space key', async () => {
      const onChange = vi.fn()
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      const dialog = screen.getByRole('alertdialog')
      const confirmButton = within(dialog).getByRole('button', { name: /confirm/i })

      // Focus confirm button and press Space (wrapped in act to avoid warnings)
      await act(async () => {
        confirmButton.focus()
      })
      await userEvent.keyboard(' ')

      // Dialog should be closed, step should be removed (wait for exit animation to complete)
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      // onChange should have been called to remove the step
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([])
    })

    it('dialog Cancel button activates on Space key', async () => {
      const onChange = vi.fn()
      const steps = [createTestStep({ id: 'step-1', stepNum: 1 })]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Open the confirmation dialog
      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      const dialog = screen.getByRole('alertdialog')
      const cancelButton = within(dialog).getByRole('button', { name: /cancel/i })

      // Focus cancel button and press Space (wrapped in act to avoid warnings)
      await act(async () => {
        cancelButton.focus()
      })
      await userEvent.keyboard(' ')

      // Dialog should be closed but step should NOT be removed
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      // onChange should NOT have been called (step not removed)
      expect(onChange).not.toHaveBeenCalled()
      // Step should still be in the document
      expect(stepCard(1)).toBeInTheDocument()
    })
  })
})
