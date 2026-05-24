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
import { StepList } from '~/components/recipe/StepList'
import type { StepData } from '~/components/recipe/StepEditorCard'

const dragControlsStartMock = vi.hoisted(() => vi.fn())

vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: dragControlsStartMock }),
}))

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
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/step 2/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/step 3/i)).toBeInTheDocument()
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
        expect(screen.getByLabelText(new RegExp(`step ${i}`, 'i'))).toBeInTheDocument()
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
      const firstStepCard = screen.getByLabelText(/step 1/i)
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
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument()
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
      const textarea = screen.getByLabelText(/step 1/i).querySelector('textarea')
      expect(textarea).toBeInTheDocument()

      // Clear and type new description
      await userEvent.clear(textarea!)
      await userEvent.type(textarea!, 'Updated description')

      // Click save button
      const saveButton = screen.getByRole('button', { name: /save/i })
      await userEvent.click(saveButton)

      // onChange should be called with the updated step
      expect(onChange).toHaveBeenCalled()
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
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
      const firstStepCard = screen.getByLabelText(/step 1/i)
      const textarea = firstStepCard.querySelector('textarea')
      expect(textarea).toBeInTheDocument()

      await userEvent.clear(textarea!)
      await userEvent.type(textarea!, 'New content')

      // Click save button on first step
      const saveButton = within(firstStepCard).getByRole('button', { name: /save/i })
      await userEvent.click(saveButton)

      // Check the call preserves id and stepNum
      expect(onChange).toHaveBeenCalled()
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
      expect(lastCall[0].id).toBe('step-1')
      expect(lastCall[0].stepNum).toBe(1)
      // Second step should be unchanged
      expect(lastCall[1].id).toBe('step-2')
      expect(lastCall[1].stepNum).toBe(2)
    })
  })

  describe('reorder functionality', () => {
    it('up button moves step up in list', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Third step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Click up button on second step
      const secondStepCard = screen.getByLabelText(/step 2/i)
      await userEvent.click(within(secondStepCard).getByRole('button', { name: /move up/i }))

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      // Step 2 should now be first
      expect(newSteps[0].id).toBe('step-2')
      expect(newSteps[1].id).toBe('step-1')
      expect(newSteps[2].id).toBe('step-3')
    })

    it('down button moves step down in list', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Third step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Click down button on second step
      const secondStepCard = screen.getByLabelText(/step 2/i)
      await userEvent.click(within(secondStepCard).getByRole('button', { name: /move down/i }))

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      // Step 2 should now be third
      expect(newSteps[0].id).toBe('step-1')
      expect(newSteps[1].id).toBe('step-3')
      expect(newSteps[2].id).toBe('step-2')
    })

    it('first step has up button disabled', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const firstStepCard = screen.getByLabelText(/step 1/i)
      const upButton = within(firstStepCard).getByRole('button', { name: /move up/i })
      expect(upButton).toBeDisabled()
    })

    it('last step has down button disabled', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const lastStepCard = screen.getByLabelText(/step 2/i)
      const downButton = within(lastStepCard).getByRole('button', { name: /move down/i })
      expect(downButton).toBeDisabled()
    })

    it('reorder updates stepNum for all affected steps', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
        createTestStep({ id: 'step-3', stepNum: 3, description: 'Third step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Move third step to first position (up twice)
      const thirdStepCard = screen.getByLabelText(/step 3/i)
      await userEvent.click(within(thirdStepCard).getByRole('button', { name: /move up/i }))

      const newSteps = onChange.mock.calls[0][0]
      // All step numbers should be correctly updated
      expect(newSteps[0].stepNum).toBe(1)
      expect(newSteps[1].stepNum).toBe(2)
      expect(newSteps[2].stepNum).toBe(3)
    })

    it('steps maintain their data (description, ingredients) after reorder', async () => {
      const onChange = vi.fn()
      const ingredientData = [
        { quantity: 1, unit: 'cup', ingredientName: 'flour' },
      ]
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'Mix ingredients' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Bake for 30 minutes', ingredients: ingredientData }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Move second step up
      const secondStepCard = screen.getByLabelText(/step 2/i)
      await userEvent.click(within(secondStepCard).getByRole('button', { name: /move up/i }))

      const newSteps = onChange.mock.calls[0][0]
      // Second step is now first, should still have its data
      expect(newSteps[0].id).toBe('step-2')
      expect(newSteps[0].description).toBe('Bake for 30 minutes')
      expect(newSteps[0].ingredients).toEqual(ingredientData)
      // First step is now second, should still have its data
      expect(newSteps[1].id).toBe('step-1')
      expect(newSteps[1].description).toBe('Mix ingredients')
    })

    it('onChange called with reordered array', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1 }),
        createTestStep({ id: 'step-2', stepNum: 2 }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Move second step up
      const secondStepCard = screen.getByLabelText(/step 2/i)
      await userEvent.click(within(secondStepCard).getByRole('button', { name: /move up/i }))

      // onChange should be called exactly once with the new order
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'step-2', stepNum: 1 }),
          expect.objectContaining({ id: 'step-1', stepNum: 2 }),
        ])
      )
    })

    it('drag handle has accessible aria-label', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Look for drag handle with aria-label within the step card
      const stepCard = screen.getByLabelText(/step 1/i)
      const dragHandle = within(stepCard).getByRole('button', { name: /drag to reorder/i })
      expect(dragHandle).toBeInTheDocument()
    })

    it('pointer down on the drag handle starts Framer Motion drag controls', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const firstStepCard = screen.getByLabelText(/step 1/i)
      const dragHandle = within(firstStepCard).getByRole('button', { name: /drag to reorder/i })
      fireEvent.pointerDown(dragHandle, { pointerId: 1, buttons: 1, clientX: 10, clientY: 10 })

      expect(dragControlsStartMock).toHaveBeenCalledTimes(1)
      expect(dragControlsStartMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pointerdown' }),
        { snapToCursor: true }
      )
    })

    it('disables the drag handle when there is only one step', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'Only step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const stepCard = screen.getByLabelText(/step 1/i)
      const dragHandle = within(stepCard).getByRole('button', { name: /drag to reorder/i })

      expect(dragHandle).toBeDisabled()
    })

    it('keyboard: arrow up on focused step with modifier key reorders', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles (one per step) and focus on the second one
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      expect(dragHandles).toHaveLength(2)
      dragHandles[1].focus() // Second step's drag handle

      // Use Ctrl+ArrowUp to move step up
      await userEvent.keyboard('{Control>}{ArrowUp}{/Control}')

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps[0].id).toBe('step-2')
      expect(newSteps[1].id).toBe('step-1')
    })

    it('keyboard: arrow down on focused step with modifier key reorders', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles and focus on the first one
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      expect(dragHandles).toHaveLength(2)
      dragHandles[0].focus() // First step's drag handle

      // Use Ctrl+ArrowDown to move step down
      await userEvent.keyboard('{Control>}{ArrowDown}{/Control}')

      expect(onChange).toHaveBeenCalledTimes(1)
      const newSteps = onChange.mock.calls[0][0]
      expect(newSteps[0].id).toBe('step-2')
      expect(newSteps[1].id).toBe('step-1')
    })

    it('disabled state disables reorder buttons', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1 }),
        createTestStep({ id: 'step-2', stepNum: 2 }),
      ]
      const Wrapper = createTestWrapper({ steps, disabled: true })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // All move up/down buttons should be disabled
      const moveUpButtons = screen.getAllByRole('button', { name: /move up/i })
      const moveDownButtons = screen.getAllByRole('button', { name: /move down/i })

      moveUpButtons.forEach((button) => {
        expect(button).toBeDisabled()
      })
      moveDownButtons.forEach((button) => {
        expect(button).toBeDisabled()
      })
    })

    it('single step has both up and down buttons disabled', () => {
      const steps = [createTestStep({ id: 'step-1', stepNum: 1, description: 'Only step' })]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      const stepCard = screen.getByLabelText(/step 1/i)
      const upButton = within(stepCard).getByRole('button', { name: /move up/i })
      const downButton = within(stepCard).getByRole('button', { name: /move down/i })

      expect(upButton).toBeDisabled()
      expect(downButton).toBeDisabled()
    })

    it('keyboard: arrow up on first step does not reorder', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles and focus on the first one
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      dragHandles[0].focus()

      // Use Ctrl+ArrowUp - should not reorder since it's already first
      await userEvent.keyboard('{Control>}{ArrowUp}{/Control}')

      // onChange should not be called because we can't move up from first position
      expect(onChange).not.toHaveBeenCalled()
    })

    it('keyboard: arrow down on last step does not reorder', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles and focus on the last one
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      dragHandles[1].focus()

      // Use Ctrl+ArrowDown - should not reorder since it's already last
      await userEvent.keyboard('{Control>}{ArrowDown}{/Control}')

      // onChange should not be called because we can't move down from last position
      expect(onChange).not.toHaveBeenCalled()
    })

    it('keyboard: arrow keys without modifier key do not reorder', async () => {
      const onChange = vi.fn()
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps, onChange })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles and focus on the second one
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      dragHandles[1].focus()

      // Press ArrowUp without modifier - should not reorder
      await userEvent.keyboard('{ArrowUp}')

      // onChange should not be called because no modifier key was pressed
      expect(onChange).not.toHaveBeenCalled()
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
      const stepCard = screen.getByLabelText(/step 1/i)
      const instructionsTextarea = within(stepCard).getByLabelText(/instructions/i)
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

    it('drag handles are keyboard accessible', () => {
      const steps = [
        createTestStep({ id: 'step-1', stepNum: 1, description: 'First step' }),
        createTestStep({ id: 'step-2', stepNum: 2, description: 'Second step' }),
      ]
      const Wrapper = createTestWrapper({ steps })
      render(<Wrapper initialEntries={['/recipes/recipe-1/edit']} />)

      // Get all drag handles and verify they're accessible
      const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i })
      expect(dragHandles).toHaveLength(2)
      dragHandles.forEach((handle) => {
        expect(handle).not.toHaveAttribute('tabindex', '-1')
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
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument()
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
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument()
    })
  })
})
