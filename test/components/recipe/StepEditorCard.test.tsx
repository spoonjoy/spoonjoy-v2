/**
 * Tests for StepEditorCard component.
 *
 * This component provides a card for editing/creating recipe steps with:
 * - Step number display
 * - Instructions textarea
 * - Duration input (optional)
 * - Ingredient input mode toggle (AI/manual)
 * - IngredientParseInput for AI mode
 * - ManualIngredientInput for manual mode
 * - ParsedIngredientList for displaying parsed ingredients
 * - Save, remove, and reorder controls
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoutesStub } from 'react-router'
import { StepEditorCard } from '~/components/recipe/StepEditorCard'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

// Mock localStorage for IngredientInputToggle
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

// Step data type for edit mode
interface StepData {
  id: string
  stepNum: number
  stepTitle?: string
  description: string
  duration?: number // Duration in minutes
  ingredients: ParsedIngredient[]
}

// Create a test wrapper with router context for AI parsing
function createTestWrapper(
  actionHandler: (formData: FormData) => Promise<unknown>,
  props: Partial<React.ComponentProps<typeof StepEditorCard>> = {}
) {
  const defaultProps = {
    stepNumber: 1,
    recipeId: 'recipe-1',
    onSave: vi.fn(),
    onRemove: vi.fn(),
    ...props,
  }

  return createRoutesStub([
    {
      path: '/recipes/:id/steps/edit',
      Component: () => <StepEditorCard {...defaultProps} />,
      action: async ({ request }) => {
        const formData = await request.formData()
        return actionHandler(formData)
      },
    },
    // Route for AI ingredient parsing (useIngredientParser submits to this)
    {
      path: '/recipes/:id/steps/:stepId/edit',
      action: async ({ request }) => {
        const formData = await request.formData()
        return actionHandler(formData)
      },
    },
  ])
}

describe('StepEditorCard', () => {
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

  describe('rendering', () => {
    it('renders step number', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        stepNumber: 3,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByLabelText(/step 3/i)).toBeInTheDocument()
    })

    it('renders instructions textarea', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByLabelText(/instructions/i)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /instructions/i })).toBeInTheDocument()
    })

    it('renders duration input', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByLabelText(/duration/i)).toBeInTheDocument()
      expect(screen.getByRole('spinbutton', { name: /duration/i })).toBeInTheDocument()
    })

    it('duration input is optional (not required)', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const durationInput = screen.getByRole('spinbutton', { name: /duration/i })
      expect(durationInput).not.toHaveAttribute('required')
    })

    it('renders save button', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    it('renders remove button', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('renders move up button when onMoveUp is provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /move up/i })).toBeInTheDocument()
    })

    it('renders move down button when onMoveDown is provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /move down/i })).toBeInTheDocument()
    })

    it('does not render move buttons when not provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /move down/i })).not.toBeInTheDocument()
    })
  })

  describe('ingredient input toggle', () => {
    it('renders IngredientInputToggle', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('defaults to AI mode (toggle checked)', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('switch')).toBeChecked()
    })

    it('shows AI parse label', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByText(/ai parse/i)).toBeInTheDocument()
    })
  })

  describe('AI mode (default)', () => {
    it('shows IngredientParseInput in AI mode', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // AI mode is default, should show the ingredient parse input
      expect(screen.getByPlaceholderText(/enter ingredients/i)).toBeInTheDocument()
    })

    it('shows helper text for AI parsing', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByText(/ai will parse/i)).toBeInTheDocument()
    })

    it('does not show ManualIngredientInput in AI mode', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // ManualIngredientInput has three separate input fields
      expect(screen.queryByLabelText('Ingredient')).not.toBeInTheDocument()
    })
  })

  describe('manual mode', () => {
    it('shows ManualIngredientInput when toggled to manual mode', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Toggle to manual mode
      await userEvent.click(screen.getByRole('switch'))

      // Manual mode shows quantity, unit, and ingredient inputs
      expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/unit/i)).toBeInTheDocument()
      expect(screen.getByLabelText('Ingredient')).toBeInTheDocument()
    })

    it('does not show IngredientParseInput in manual mode', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Toggle to manual mode
      await userEvent.click(screen.getByRole('switch'))

      // AI parse input should be hidden
      expect(screen.queryByPlaceholderText(/enter ingredients/i)).not.toBeInTheDocument()
    })

    it('shows add button for manual ingredient entry', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Toggle to manual mode
      await userEvent.click(screen.getByRole('switch'))

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
    })
  })

  describe('callbacks', () => {
    it('calls onSave with step data when save clicked', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Mix the flour and water'
      )

      // Click save
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Mix the flour and water',
          ingredients: [],
        })
      )
    })

    it('calls onSave with duration when provided', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions and duration
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Bake in oven'
      )
      await userEvent.type(screen.getByRole('spinbutton', { name: /duration/i }), '30')

      // Click save
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Bake in oven',
          duration: 30,
        })
      )
    })

    it('calls onRemove when remove clicked', async () => {
      const onRemove = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onRemove })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('calls onMoveUp when move up clicked', async () => {
      const onMoveUp = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onMoveUp })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /move up/i }))

      expect(onMoveUp).toHaveBeenCalledTimes(1)
    })

    it('calls onMoveDown when move down clicked', async () => {
      const onMoveDown = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onMoveDown })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /move down/i }))

      expect(onMoveDown).toHaveBeenCalledTimes(1)
    })
  })

  describe('edit mode', () => {
    const existingStep: StepData = {
      id: 'step-1',
      stepNum: 1,
      stepTitle: 'Prep ingredients',
      description: 'Chop the onions and mince the garlic',
      duration: 15,
      ingredients: [
        { quantity: 2, unit: 'whole', ingredientName: 'onion' },
        { quantity: 4, unit: 'clove', ingredientName: 'garlic' },
      ],
    }

    it('pre-populates instructions with existing step data', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('textbox', { name: /instructions/i })).toHaveValue(
        'Chop the onions and mince the garlic'
      )
    })

    it('pre-populates duration with existing step data', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('spinbutton', { name: /duration/i })).toHaveValue(15)
    })

    it('shows existing ingredients in ParsedIngredientList', () => {
      // Use a step with description that doesn't contain ingredient names to avoid ambiguous text matches
      const stepWithIngredients: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Prepare the vegetables',
        ingredients: [
          { quantity: 2, unit: 'whole', ingredientName: 'onion' },
          { quantity: 4, unit: 'clove', ingredientName: 'garlic' },
        ],
      }
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: stepWithIngredients,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Should show the parsed ingredients
      expect(screen.getByText(/onion/i)).toBeInTheDocument()
      expect(screen.getByText(/garlic/i)).toBeInTheDocument()
    })

    it('uses step number from props, not step data', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
        stepNumber: 5, // Different from step.stepNum
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  describe('create mode', () => {
    it('starts with empty instructions', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('textbox', { name: /instructions/i })).toHaveValue('')
    })

    it('starts with empty duration', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('spinbutton', { name: /duration/i })).toHaveValue(null)
    })

    it('starts with no ingredients', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Should show empty state or no ingredient list
      expect(screen.getByText(/no ingredients/i)).toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('disables instructions textarea when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('textbox', { name: /instructions/i })).toBeDisabled()
    })

    it('disables duration input when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('spinbutton', { name: /duration/i })).toBeDisabled()
    })

    it('disables save button when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    })

    it('disables remove button when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled()
    })

    it('disables ingredient input toggle when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('switch')).toHaveAttribute('data-disabled')
    })

    it('disables move up button when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
        onMoveUp: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /move up/i })).toBeDisabled()
    })

    it('disables move down button when disabled', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('button', { name: /move down/i })).toBeDisabled()
    })

    it('does not call onSave when disabled', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('does not call onRemove when disabled', async () => {
      const onRemove = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        disabled: true,
        onRemove,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onRemove).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('instructions field is required', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('textbox', { name: /instructions/i })).toHaveAttribute('required')
    })

    it('prevents save with empty instructions', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Try to save without instructions
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('shows validation error for empty instructions', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Focus and blur the instructions field
      const instructionsField = screen.getByRole('textbox', { name: /instructions/i })
      await userEvent.click(instructionsField)
      await userEvent.tab()

      // Should show validation message
      expect(instructionsField).toBeInvalid()
    })

    it('duration input accepts positive numbers', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const durationInput = screen.getByRole('spinbutton', { name: /duration/i })
      await userEvent.type(durationInput, '30')

      expect(durationInput).toHaveValue(30)
    })

    it('duration input has min attribute of 1', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('spinbutton', { name: /duration/i })).toHaveAttribute('min', '1')
    })

    it('prevents negative duration values', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Test instructions'
      )

      // Try to enter negative duration
      const durationInput = screen.getByRole('spinbutton', { name: /duration/i })
      await userEvent.type(durationInput, '-5')

      // The field should not accept negative values or should be invalid
      expect(durationInput).toBeInvalid()
    })

    it('allows zero duration (treated as not set)', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Test instructions'
      )

      // Duration field should be optional, even with value 0
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      // Should save without duration
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Test instructions',
        })
      )
      // Duration should be undefined when not set
      expect(onSave.mock.calls[0][0].duration).toBeUndefined()
    })
  })

  describe('accessibility', () => {
    it('has accessible step number label', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        stepNumber: 2,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByLabelText(/step 2/i)).toBeInTheDocument()
    })

    it('instructions textarea has accessible label', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByLabelText(/instructions/i)).toBeInTheDocument()
    })

    it('duration input has accessible label', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByLabelText(/duration/i)).toBeInTheDocument()
    })

    it('card has accessible landmark', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        stepNumber: 1,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByRole('article')).toBeInTheDocument()
    })

    it('card has accessible name based on step number', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        stepNumber: 3,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const article = screen.getByRole('article')
      expect(article).toHaveAccessibleName(/step 3/i)
    })
  })

  describe('keyboard interaction', () => {
    it('supports Tab navigation through all interactive elements', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Tab through elements
      await userEvent.tab()
      // First focusable element should be focused
      expect(document.activeElement).toBeInstanceOf(HTMLElement)

      // Continue tabbing through all elements
      const interactiveElements = screen.getAllByRole('button').length + 2 // buttons + inputs
      for (let i = 0; i < interactiveElements; i++) {
        await userEvent.tab()
      }
      // Should cycle through without errors
    })

    it('allows Enter to submit when focused on save button', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in required fields
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Test instructions'
      )

      // Focus the save button and press Enter (wrapped in act to avoid warnings)
      await act(async () => {
        screen.getByRole('button', { name: /save/i }).focus()
      })
      await userEvent.keyboard('{Enter}')

      expect(onSave).toHaveBeenCalled()
    })

    it('Enter key in instructions textarea inserts newline (does not submit)', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const instructionsTextarea = screen.getByRole('textbox', { name: /instructions/i })

      // Focus on instructions textarea and type
      await userEvent.click(instructionsTextarea)
      await userEvent.type(instructionsTextarea, 'Line 1')

      // Press Enter - should insert newline, not submit
      await userEvent.keyboard('{Enter}')
      await userEvent.type(instructionsTextarea, 'Line 2')

      // onSave should NOT have been called
      expect(onSave).not.toHaveBeenCalled()

      // Textarea should contain both lines with newline between
      expect(instructionsTextarea).toHaveValue('Line 1\nLine 2')
    })

    it('Tab from instructions textarea moves focus to duration input', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const instructionsTextarea = screen.getByRole('textbox', { name: /instructions/i })
      const durationInput = screen.getByRole('spinbutton', { name: /duration/i })

      // Focus on instructions textarea
      await userEvent.click(instructionsTextarea)
      expect(instructionsTextarea).toHaveFocus()

      // Tab to next element - should be duration input
      await userEvent.tab()
      expect(durationInput).toHaveFocus()
    })

    it('Tab from duration input eventually reaches ingredient input area', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const durationInput = screen.getByRole('spinbutton', { name: /duration/i })
      const ingredientInput = screen.getByPlaceholderText(/enter ingredients/i)

      // Focus on duration input
      await userEvent.click(durationInput)
      expect(durationInput).toHaveFocus()

      // Tab should move towards ingredient input section
      await userEvent.tab()
      // Check that the ingredient input is eventually reachable
      // The toggle might be in between
      const toggleOrInput = document.activeElement
      expect(toggleOrInput).not.toBe(durationInput)

      // Continue tabbing until we reach the ingredient input
      let foundIngredientInput = false
      for (let i = 0; i < 5; i++) {
        if (document.activeElement === ingredientInput) {
          foundIngredientInput = true
          break
        }
        await userEvent.tab()
      }
      expect(foundIngredientInput).toBe(true)
    })

    it('instructions textarea is not removed from tab order (no tabindex=-1)', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const instructionsTextarea = screen.getByRole('textbox', { name: /instructions/i })
      expect(instructionsTextarea).not.toHaveAttribute('tabindex', '-1')
    })

    it('all buttons in step card are keyboard accessible (no tabindex=-1)', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute('tabindex', '-1')
      })
    })

    it('ingredient input toggle is keyboard accessible', async () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const toggle = screen.getByRole('switch')

      // Focus on toggle (wrapped in act to avoid warnings)
      await act(async () => {
        toggle.focus()
      })
      expect(toggle).toHaveFocus()

      // Press Space to toggle
      await userEvent.keyboard(' ')

      // Toggle should have changed state
      expect(toggle).not.toBeChecked()
    })
  })

  describe('mobile optimization', () => {
    function expectCoarsePointerTouchTarget(element: HTMLElement) {
      const touchTarget = element.querySelector('[data-slot="touch-target"][aria-hidden="true"]')
      expect(touchTarget).toBeInTheDocument()
      expect(touchTarget?.className).toContain('size-[max(100%,2.75rem)]')
      expect(touchTarget?.className).toContain('pointer-fine:hidden')
    }

    it('ingredient toggle renders a coarse-pointer touch target', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expectCoarsePointerTouchTarget(screen.getByRole('switch'))
    })

    it('save button renders a coarse-pointer touch target', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const saveButton = screen.getByRole('button', { name: /save/i })
      expectCoarsePointerTouchTarget(saveButton)
    })

    it('remove button renders a coarse-pointer touch target', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }))
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const removeButton = screen.getByRole('button', { name: /remove/i })
      expectCoarsePointerTouchTarget(removeButton)
    })

    it('move up button renders a coarse-pointer touch target', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const moveUpButton = screen.getByRole('button', { name: /move up/i })
      expectCoarsePointerTouchTarget(moveUpButton)
    })

    it('move down button renders a coarse-pointer touch target', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const moveDownButton = screen.getByRole('button', { name: /move down/i })
      expectCoarsePointerTouchTarget(moveDownButton)
    })

    it('all action buttons render coarse-pointer touch targets', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(4)

      buttons.forEach((button) => {
        expectCoarsePointerTouchTarget(button)
      })
    })
  })

  describe('ingredient management', () => {
    // TODO: This test is flaky in CI - the debounced AI parsing action doesn't complete
    it('updates ingredients when AI parses text', async () => {
      const onSave = vi.fn()
      const parsedResult = [{ quantity: 2, unit: 'cups', ingredientName: 'flour' }]

      // Create action handler that returns parsed ingredients
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: parsedResult }), {
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions first
      await userEvent.type(screen.getByRole('textbox', { name: /instructions/i }), 'Mix ingredients')

      // Type in the AI parse textarea to trigger parsing
      vi.useFakeTimers()
      const ingredientTextarea = screen.getByPlaceholderText(/enter ingredients/i)
      fireEvent.change(ingredientTextarea, { target: { value: '2 cups flour' } })

      // Advance timers to trigger debounce
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      vi.useRealTimers()

      // Wait for the parsed ingredient to appear in the list with longer timeout
      await waitFor(
        () => {
          expect(screen.getByText(/flour/i)).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      // Save and verify ingredients are included
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: parsedResult,
        })
      )
    })

    it('displays ParsedIngredientList when ingredients exist', async () => {
      const existingStep: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Test step',
        ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      }
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      expect(screen.getByText(/flour/i)).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('handles parsed list add-all action without changing ingredients', async () => {
      const existingStep: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Test step',
        ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      }
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /add all 1 ingredients to recipe/i }))
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
        })
      )
    })

    it('includes ingredients in onSave callback', async () => {
      const existingStep: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Test step',
        ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      }
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
        })
      )
    })

    it('adds ingredient via manual mode and includes in save', async () => {
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), { onSave })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Fill in instructions first
      await userEvent.type(
        screen.getByRole('textbox', { name: /instructions/i }),
        'Test step with ingredient'
      )

      // Toggle to manual mode
      await userEvent.click(screen.getByRole('switch'))

      // Fill in manual ingredient fields
      await userEvent.type(screen.getByLabelText(/quantity/i), '3')
      await userEvent.type(screen.getByLabelText(/unit/i), 'tbsp')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'olive oil')

      // Add the ingredient
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      // Verify ingredient appears in the list
      expect(screen.getByText(/olive oil/i)).toBeInTheDocument()

      // Save and verify ingredient is included
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: expect.arrayContaining([
            expect.objectContaining({ ingredientName: 'olive oil' }),
          ]),
        })
      )
    })

    it('edits ingredient in parsed list and includes updated value in save', async () => {
      const existingStep: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Test step',
        ingredients: [{ quantity: 2, unit: 'cup', ingredientName: 'flour' }],
      }
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Click edit button on the ingredient row (uses specific aria-label)
      const editButton = screen.getByRole('button', { name: /edit flour/i })
      await userEvent.click(editButton)

      // Find the quantity input in edit mode and change it
      const quantityInput = screen.getByLabelText(/quantity/i)
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '5')

      // Save the edit - the row Save button has specific aria-label "Save"
      // Get all Save buttons and find the one in the ingredient row (first one)
      const saveButtons = screen.getAllByRole('button', { name: /^save$/i })
      await userEvent.click(saveButtons[0]) // First Save button is in the ingredient row

      // Save the step (this is the step-level Save button with icon)
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: [{ quantity: 5, unit: 'cup', ingredientName: 'flour' }],
        })
      )
    })

    it('removes ingredient from parsed list', async () => {
      const existingStep: StepData = {
        id: 'step-1',
        stepNum: 1,
        description: 'Test step',
        ingredients: [
          { quantity: 2, unit: 'cup', ingredientName: 'flour' },
          { quantity: 1, unit: 'tsp', ingredientName: 'salt' },
        ],
      }
      const onSave = vi.fn()
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        step: existingStep,
        onSave,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Verify both ingredients are shown
      expect(screen.getByText(/flour/i)).toBeInTheDocument()
      expect(screen.getByText(/salt/i)).toBeInTheDocument()

      // Click the remove button for flour (uses specific aria-label)
      await userEvent.click(screen.getByRole('button', { name: /remove flour/i }))

      // Verify flour is removed, salt remains
      expect(screen.queryByText(/flour/i)).not.toBeInTheDocument()
      expect(screen.getByText(/salt/i)).toBeInTheDocument()

      // Save and verify only salt is included (use step Save button)
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: [{ quantity: 1, unit: 'tsp', ingredientName: 'salt' }],
        })
      )
    })
  })

  describe('move handlers not provided', () => {
    it('does not render move up button when onMoveUp is not provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: undefined,
        onMoveDown: vi.fn(),
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Move up button should not be rendered when onMoveUp is not provided
      expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument()
      // Move down button should still be rendered
      expect(screen.getByRole('button', { name: /move down/i })).toBeInTheDocument()
    })

    it('does not render move down button when onMoveDown is not provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: vi.fn(),
        onMoveDown: undefined,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Move down button should not be rendered when onMoveDown is not provided
      expect(screen.queryByRole('button', { name: /move down/i })).not.toBeInTheDocument()
      // Move up button should still be rendered
      expect(screen.getByRole('button', { name: /move up/i })).toBeInTheDocument()
    })

    it('does not render either move button when both handlers are not provided', () => {
      const Wrapper = createTestWrapper(async () => ({ parsedIngredients: [] }), {
        onMoveUp: undefined,
        onMoveDown: undefined,
      })
      render(<Wrapper initialEntries={['/recipes/recipe-1/steps/edit']} />)

      // Neither move button should be rendered
      expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /move down/i })).not.toBeInTheDocument()
    })
  })
})
