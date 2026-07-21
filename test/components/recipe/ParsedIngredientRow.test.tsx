import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ParsedIngredientRow } from '../../../app/components/recipe/ParsedIngredientRow'
import type { ParsedIngredient } from '../../../app/lib/ingredient-parse.server'

const createIngredient = (overrides: Partial<ParsedIngredient> = {}): ParsedIngredient => ({
  quantity: 2,
  unit: 'cups',
  ingredientName: 'flour',
  ...overrides,
})

describe('ParsedIngredientRow', () => {
  describe('rendering', () => {
    it('displays quantity', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 1.5 })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('1.5')).toBeInTheDocument()
    })

    it('displays unit', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ unit: 'tbsp' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('tbsp')).toBeInTheDocument()
    })

    it('displays ingredient name', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: 'extra virgin olive oil' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('extra virgin olive oil')).toBeInTheDocument()
    })

    it('renders edit button', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('renders remove button', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('formats decimal quantities correctly', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 0.25 })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('0.25')).toBeInTheDocument()
    })

    it('formats whole number quantities without decimal', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 3 })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('displays quantity unit and ingredient in logical order', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 2, unit: 'cups', ingredientName: 'sugar' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      // All three elements should be present
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('cups')).toBeInTheDocument()
      expect(screen.getByText('sugar')).toBeInTheDocument()
    })
  })

  describe('edit action', () => {
    it('enters edit mode when edit button is clicked', async () => {
      const onEdit = vi.fn()
      const ingredient = createIngredient()
      render(
        <ParsedIngredientRow ingredient={ingredient} onEdit={onEdit} onRemove={vi.fn()} />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      // Should enter edit mode (show input fields)
      expect(screen.getByRole('spinbutton', { name: /quantity/i })).toBeInTheDocument()
      // onEdit should NOT be called until save
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('calls onEdit with unchanged values when save clicked without modification', async () => {
      const onEdit = vi.fn()
      const ingredient = createIngredient({ quantity: 3, unit: 'tbsp', ingredientName: 'butter' })
      render(
        <ParsedIngredientRow ingredient={ingredient} onEdit={onEdit} onRemove={vi.fn()} />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).toHaveBeenCalledWith(ingredient)
    })
  })

  describe('remove action', () => {
    it('calls onRemove when remove button is clicked', async () => {
      const onRemove = vi.fn()
      const ingredient = createIngredient()
      render(
        <ParsedIngredientRow ingredient={ingredient} onEdit={vi.fn()} onRemove={onRemove} />
      )

      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('passes the ingredient to onRemove callback', async () => {
      const onRemove = vi.fn()
      const ingredient = createIngredient({ ingredientName: 'salt' })
      render(
        <ParsedIngredientRow ingredient={ingredient} onEdit={vi.fn()} onRemove={onRemove} />
      )

      await userEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onRemove).toHaveBeenCalledWith(ingredient)
    })
  })

  describe('inline edit mode', () => {
    it('switches to edit mode when edit button is clicked', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      // Should show input fields instead of static text
      expect(screen.getByRole('spinbutton', { name: /quantity/i })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /unit/i })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /ingredient/i })).toBeInTheDocument()
    })

    it('populates edit fields with current values', async () => {
      const ingredient = createIngredient({ quantity: 2.5, unit: 'tsp', ingredientName: 'vanilla' })
      render(
        <ParsedIngredientRow ingredient={ingredient} onEdit={vi.fn()} onRemove={vi.fn()} />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      expect(screen.getByRole('spinbutton', { name: /quantity/i })).toHaveValue(2.5)
      expect(screen.getByRole('textbox', { name: /unit/i })).toHaveValue('tsp')
      expect(screen.getByRole('textbox', { name: /ingredient/i })).toHaveValue('vanilla')
    })

    it('shows save button in edit mode', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    it('shows cancel button in edit mode', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('calls onEdit with updated values when save is clicked', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 2, unit: 'cups', ingredientName: 'flour' })}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      // Clear and type new values
      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '3')

      const unitInput = screen.getByRole('textbox', { name: /unit/i })
      await userEvent.clear(unitInput)
      await userEvent.type(unitInput, 'tbsp')

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).toHaveBeenCalledWith({
        quantity: 3,
        unit: 'tbsp',
        ingredientName: 'flour',
      })
    })

    it('exits edit mode after saving', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      // Should be back to display mode
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('discards changes when cancel is clicked', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 2, unit: 'cups', ingredientName: 'flour' })}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      // Modify values
      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '999')

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      // Should not call onEdit
      expect(onEdit).not.toHaveBeenCalled()
      // Should show original value
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('exits edit mode when cancel is clicked', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('saves on Enter key in any edit field', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 1, unit: 'cup', ingredientName: 'milk' })}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const ingredientInput = screen.getByRole('textbox', { name: /ingredient/i })
      await userEvent.clear(ingredientInput)
      await userEvent.type(ingredientInput, 'cream{enter}')

      expect(onEdit).toHaveBeenCalledWith({
        quantity: 1,
        unit: 'cup',
        ingredientName: 'cream',
      })
    })

    it('cancels on Escape key', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      // Focus an input field so Escape key event bubbles to the li's onKeyDown handler
      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.type(quantityInput, '{Escape}')

      expect(onEdit).not.toHaveBeenCalled()
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('edit button has accessible name', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: 'salt' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('remove button has accessible name', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: 'pepper' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('row is a list item or table row semantically', () => {
      const { container } = render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      // Should use semantic list item or have role
      const row = container.firstChild as HTMLElement
      expect(row.tagName === 'LI' || row.getAttribute('role') === 'listitem').toBe(true)
    })

    it('edit mode inputs have proper labels', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      expect(screen.getByRole('spinbutton', { name: /quantity/i })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /unit/i })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /ingredient/i })).toBeInTheDocument()
    })
  })

  describe('validation in edit mode', () => {
    it('does not save with empty quantity', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('does not save with empty unit', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const unitInput = screen.getByRole('textbox', { name: /unit/i })
      await userEvent.clear(unitInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('does not save with empty ingredient name', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const ingredientInput = screen.getByRole('textbox', { name: /ingredient/i })
      await userEvent.clear(ingredientInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('does not save with zero quantity', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '0')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('does not save with negative quantity', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '-1')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('trims whitespace from unit when saving', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 1, unit: 'cup', ingredientName: 'flour' })}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const unitInput = screen.getByRole('textbox', { name: /unit/i })
      await userEvent.clear(unitInput)
      await userEvent.type(unitInput, '  tbsp  ')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).toHaveBeenCalledWith(
        expect.objectContaining({ unit: 'tbsp' })
      )
    })

    it('trims whitespace from ingredient name when saving', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 1, unit: 'cup', ingredientName: 'flour' })}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const ingredientInput = screen.getByRole('textbox', { name: /ingredient/i })
      await userEvent.clear(ingredientInput)
      await userEvent.type(ingredientInput, '  sugar  ')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(onEdit).toHaveBeenCalledWith(
        expect.objectContaining({ ingredientName: 'sugar' })
      )
    })
  })

  describe('edge cases', () => {
    it('handles very small decimal quantities', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ quantity: 0.125 })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('0.125')).toBeInTheDocument()
    })

    it('handles compound ingredient names with special characters', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: "baker's chocolate (70%)" })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText("baker's chocolate (70%)")).toBeInTheDocument()
    })

    it('handles long ingredient names', () => {
      const longName = 'extra virgin cold-pressed first harvest organic olive oil from Sicily'
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: longName })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('handles ingredient with prep notes', () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient({ ingredientName: 'onion, finely diced' })}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      expect(screen.getByText('onion, finely diced')).toBeInTheDocument()
    })
  })

  describe('inline validation feedback', () => {
    it('shows validation error for empty quantity on save attempt', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Required')).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('shows validation error for invalid quantity', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.type(quantityInput, '0')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Must be positive')).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('shows validation error for non-numeric quantity (defensive check)', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      // Bypass browser validation by directly setting the value via DOM manipulation
      await userEvent.clear(quantityInput)
      // Type a letter, which may be filtered by the browser, but set value directly
      Object.defineProperty(quantityInput, 'value', {
        writable: true,
        value: 'abc',
      })
      // Trigger input event to update internal state
      act(() => {
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }))
      })

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Must be a number')).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('shows validation error for empty unit on save attempt', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const unitInput = screen.getByRole('textbox', { name: /unit/i })
      await userEvent.clear(unitInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Required')).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('shows validation error for empty ingredient name on save attempt', async () => {
      const onEdit = vi.fn()
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const ingredientInput = screen.getByRole('textbox', { name: /ingredient/i })
      await userEvent.clear(ingredientInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Required')).toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('marks input as invalid when validation fails', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(quantityInput).toHaveAttribute('aria-invalid', 'true')
    })

    it('clears validation errors on cancel', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText('Required')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      // Re-enter edit mode - validation should be cleared
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      expect(screen.queryByText('Required')).not.toBeInTheDocument()
    })

    it('shows multiple validation errors when multiple fields are invalid', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      const unitInput = screen.getByRole('textbox', { name: /unit/i })
      const ingredientInput = screen.getByRole('textbox', { name: /ingredient/i })

      await userEvent.clear(quantityInput)
      await userEvent.clear(unitInput)
      await userEvent.clear(ingredientInput)
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      // Should show "Required" three times (one for each field)
      expect(screen.getAllByText('Required')).toHaveLength(3)
    })

    it('does not show validation errors until save is attempted', async () => {
      render(
        <ParsedIngredientRow
          ingredient={createIngredient()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /edit/i }))

      const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i })
      await userEvent.clear(quantityInput)

      // Before clicking save, no error should be visible
      expect(screen.queryByText('Required')).not.toBeInTheDocument()
    })
  })
})
