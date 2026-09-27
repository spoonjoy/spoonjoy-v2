import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ParsedIngredientList } from '../../../app/components/recipe/ParsedIngredientList'
import type { ParsedIngredient } from '../../../app/lib/ingredient-parse.server'

const createIngredient = (overrides: Partial<ParsedIngredient> = {}): ParsedIngredient => ({
  quantity: 2,
  unit: 'cups',
  ingredientName: 'flour',
  ...overrides,
})

const createIngredientList = (count: number = 3): ParsedIngredient[] => [
  createIngredient({ quantity: 2, unit: 'cups', ingredientName: 'flour' }),
  createIngredient({ quantity: 1, unit: 'tsp', ingredientName: 'salt' }),
  createIngredient({ quantity: 0.5, unit: 'cup', ingredientName: 'sugar' }),
].slice(0, count)

describe('ParsedIngredientList', () => {
  describe('rendering', () => {
    it('renders a list of ingredients', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText('flour')).toBeInTheDocument()
      expect(screen.getByText('salt')).toBeInTheDocument()
      expect(screen.getByText('sugar')).toBeInTheDocument()
    })

    it('renders correct number of ingredient rows', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Each row has edit and remove buttons
      const editButtons = screen.getAllByRole('button', { name: /edit/i })
      expect(editButtons).toHaveLength(3)
    })

    it('renders "Add All" button', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /add all/i })).toBeInTheDocument()
    })

    it('shows ingredient count in Add All button', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Should show count like "Add All (3)" or "Add All 3 Ingredients"
      const addAllButton = screen.getByRole('button', { name: /add all/i })
      expect(addAllButton.textContent).toMatch(/3/)
    })

    it('renders empty state when no ingredients', () => {
      render(
        <ParsedIngredientList
          ingredients={[]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText(/no ingredients/i)).toBeInTheDocument()
    })

    it('hides Add All button when empty', () => {
      render(
        <ParsedIngredientList
          ingredients={[]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /add all/i })).not.toBeInTheDocument()
    })

    it('omits Add All when the caller has nothing for it to do', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByRole('list')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /add all/i })).not.toBeInTheDocument()
    })

    it('renders as a list element', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByRole('list')).toBeInTheDocument()
    })

    it('displays quantity, unit, and name for each ingredient', () => {
      render(
        <ParsedIngredientList
          ingredients={[createIngredient({ quantity: 3, unit: 'tbsp', ingredientName: 'butter' })]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('tbsp')).toBeInTheDocument()
      expect(screen.getByText('butter')).toBeInTheDocument()
    })
  })

  describe('Add All action', () => {
    it('calls onAddAll when Add All button is clicked', async () => {
      const onAddAll = vi.fn()
      const ingredients = createIngredientList(3)
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={onAddAll}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /add all/i }))

      expect(onAddAll).toHaveBeenCalledTimes(1)
    })

    it('passes all ingredients to onAddAll', async () => {
      const onAddAll = vi.fn()
      const ingredients = createIngredientList(3)
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={onAddAll}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /add all/i }))

      expect(onAddAll).toHaveBeenCalledWith(ingredients)
    })

    it('is disabled when loading', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
          loading
        />
      )

      expect(screen.getByRole('button', { name: /add all/i })).toBeDisabled()
    })

    it('shows loading indicator when loading', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
          loading
        />
      )

      const addAllButton = screen.getByRole('button', { name: /add all/i })
      expect(addAllButton).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('edit action on individual rows', () => {
    it('enters edit mode when row edit button is clicked', async () => {
      const onEdit = vi.fn()
      const ingredients = [
        createIngredient({ ingredientName: 'flour' }),
        createIngredient({ ingredientName: 'sugar' }),
      ]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Get the first edit button
      const firstRow = screen.getByText('flour').closest('li')!
      const editButton = within(firstRow).getByRole('button', { name: /edit/i })
      await userEvent.click(editButton)

      // Should enter edit mode (show input fields) but not call onEdit yet
      expect(within(firstRow).getByRole('spinbutton', { name: /quantity/i })).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('passes correct ingredient index to onEdit after save', async () => {
      const onEdit = vi.fn()
      const ingredients = [
        createIngredient({ ingredientName: 'flour' }),
        createIngredient({ ingredientName: 'sugar' }),
      ]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Click edit on the second ingredient and save
      const secondRow = screen.getByText('sugar').closest('li')!
      const editButton = within(secondRow).getByRole('button', { name: /edit/i })
      await userEvent.click(editButton)
      await userEvent.click(within(secondRow).getByRole('button', { name: /save/i }))

      // onEdit should receive the index and ingredient
      expect(onEdit).toHaveBeenCalledWith(1, ingredients[1])
    })

    it('onEdit receives updated ingredient after inline edit', async () => {
      const onEdit = vi.fn()
      const ingredients = [createIngredient({ quantity: 2, unit: 'cups', ingredientName: 'flour' })]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Enter edit mode
      const row = screen.getByText('flour').closest('li')!
      await userEvent.click(within(row).getByRole('button', { name: /edit/i }))

      // Change quantity and save
      const quantityInput = within(row).getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '5')
      await userEvent.click(within(row).getByRole('button', { name: /save/i }))

      expect(onEdit).toHaveBeenCalledWith(0, { quantity: 5, unit: 'cups', ingredientName: 'flour' })
    })
  })

  describe('remove action on individual rows', () => {
    it('calls onRemove when row remove button is clicked', async () => {
      const onRemove = vi.fn()
      const ingredients = [
        createIngredient({ ingredientName: 'flour' }),
        createIngredient({ ingredientName: 'sugar' }),
      ]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={onRemove}
          onAddAll={vi.fn()}
        />
      )

      const firstRow = screen.getByText('flour').closest('li')!
      const removeButton = within(firstRow).getByRole('button', { name: /remove/i })
      await userEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalled()
    })

    it('passes correct ingredient index to onRemove', async () => {
      const onRemove = vi.fn()
      const ingredients = [
        createIngredient({ ingredientName: 'flour' }),
        createIngredient({ ingredientName: 'sugar' }),
        createIngredient({ ingredientName: 'salt' }),
      ]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={onRemove}
          onAddAll={vi.fn()}
        />
      )

      // Remove the second ingredient (sugar)
      const secondRow = screen.getByText('sugar').closest('li')!
      const removeButton = within(secondRow).getByRole('button', { name: /remove/i })
      await userEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalledWith(1)
    })
  })

  describe('disabled state', () => {
    it('disables all row actions when disabled', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
          disabled
        />
      )

      const editButtons = screen.getAllByRole('button', { name: /edit/i })
      const removeButtons = screen.getAllByRole('button', { name: /remove/i })

      editButtons.forEach((button) => expect(button).toBeDisabled())
      removeButtons.forEach((button) => expect(button).toBeDisabled())
    })

    it('disables Add All button when disabled', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
          disabled
        />
      )

      expect(screen.getByRole('button', { name: /add all/i })).toBeDisabled()
    })

    it('does not call onAddAll when disabled', async () => {
      const onAddAll = vi.fn()
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={onAddAll}
          disabled
        />
      )

      // Try to click (button is disabled so this shouldn't trigger)
      const addAllButton = screen.getByRole('button', { name: /add all/i })
      await userEvent.click(addAllButton).catch(() => {})

      expect(onAddAll).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('list has accessible role', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByRole('list')).toBeInTheDocument()
    })

    it('each ingredient is a list item', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      const listItems = screen.getAllByRole('listitem')
      expect(listItems).toHaveLength(3)
    })

    it('Add All button has descriptive accessible name', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      const button = screen.getByRole('button', { name: /add all/i })
      expect(button).toBeInTheDocument()
    })

    it('empty state message is accessible', () => {
      render(
        <ParsedIngredientList
          ingredients={[]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Should have a visible message, not just visual indication
      expect(screen.getByText(/no ingredients/i)).toBeInTheDocument()
    })
  })

  describe('single ingredient', () => {
    it('works correctly with single ingredient', () => {
      render(
        <ParsedIngredientList
          ingredients={[createIngredient({ ingredientName: 'eggs' })]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText('eggs')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add all/i })).toBeInTheDocument()
    })

    it('Add All button works with single ingredient', async () => {
      const onAddAll = vi.fn()
      const ingredients = [createIngredient({ ingredientName: 'eggs' })]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={onAddAll}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /add all/i }))

      expect(onAddAll).toHaveBeenCalledWith(ingredients)
    })

    it('shows singular in Add All button for single ingredient', () => {
      render(
        <ParsedIngredientList
          ingredients={[createIngredient()]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      // Should show "Add All (1)" or "Add 1 Ingredient" (singular)
      const button = screen.getByRole('button', { name: /add all/i })
      expect(button.textContent).toMatch(/1/)
    })
  })

  describe('many ingredients', () => {
    it('renders large list of ingredients', () => {
      const ingredients = Array.from({ length: 20 }, (_, i) =>
        createIngredient({ ingredientName: `ingredient ${i + 1}` })
      )
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText('ingredient 1')).toBeInTheDocument()
      expect(screen.getByText('ingredient 20')).toBeInTheDocument()
    })

    it('Add All button shows correct count for many ingredients', () => {
      const ingredients = Array.from({ length: 15 }, (_, i) =>
        createIngredient({ ingredientName: `item ${i}` })
      )
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      const button = screen.getByRole('button', { name: /add all/i })
      expect(button.textContent).toMatch(/15/)
    })
  })

  describe('edge cases', () => {
    it('handles ingredients with special characters', () => {
      render(
        <ParsedIngredientList
          ingredients={[createIngredient({ ingredientName: "baker's chocolate (70%)" })]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText("baker's chocolate (70%)")).toBeInTheDocument()
    })

    it('handles ingredients with very long names', () => {
      const longName = 'extra virgin cold-pressed first harvest organic olive oil from Sicily'
      render(
        <ParsedIngredientList
          ingredients={[createIngredient({ ingredientName: longName })]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('handles decimal quantities correctly', () => {
      render(
        <ParsedIngredientList
          ingredients={[createIngredient({ quantity: 0.125, ingredientName: 'salt' })]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByText('0.125')).toBeInTheDocument()
    })

    it('preserves ingredient order', () => {
      const ingredients = [
        createIngredient({ ingredientName: 'first' }),
        createIngredient({ ingredientName: 'second' }),
        createIngredient({ ingredientName: 'third' }),
      ]
      render(
        <ParsedIngredientList
          ingredients={ingredients}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      const listItems = screen.getAllByRole('listitem')
      expect(within(listItems[0]).getByText('first')).toBeInTheDocument()
      expect(within(listItems[1]).getByText('second')).toBeInTheDocument()
      expect(within(listItems[2]).getByText('third')).toBeInTheDocument()
    })
  })

  describe('header and labeling', () => {
    it('has a heading for the list', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(2)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      expect(screen.getByRole('heading', { name: /ingredients/i })).toBeInTheDocument()
    })

    it('heading shows count of ingredients', () => {
      render(
        <ParsedIngredientList
          ingredients={createIngredientList(3)}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onAddAll={vi.fn()}
        />
      )

      const heading = screen.getByRole('heading', { name: /ingredients/i })
      expect(heading.textContent).toMatch(/3/)
    })
  })
})
