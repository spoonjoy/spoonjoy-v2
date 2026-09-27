import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ManualIngredientInput } from '../../../app/components/recipe/ManualIngredientInput'

describe('ManualIngredientInput', () => {
  describe('rendering', () => {
    it('renders three input fields', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/unit/i)).toBeInTheDocument()
      expect(screen.getByLabelText('Ingredient')).toBeInTheDocument()
    })

    // Every step card in the recipe builder can show this form at once. Fixed ids
    // ("quantity", "unit", "ingredientName") repeated across cards, so each card's labels
    // pointed at the first card's fields.
    it('gives each instance its own field ids so labels point at their own fields', () => {
      render(
        <>
          <section aria-label="first card">
            <ManualIngredientInput onAdd={vi.fn()} />
          </section>
          <section aria-label="second card">
            <ManualIngredientInput onAdd={vi.fn()} />
          </section>
        </>
      )

      const ids = Array.from(document.querySelectorAll('input')).map((input) => input.id)
      expect(ids).toHaveLength(6)
      expect(ids.every(Boolean)).toBe(true)
      expect(new Set(ids).size).toBe(6)

      for (const card of screen.getAllByRole('region')) {
        for (const label of Array.from(card.querySelectorAll('label'))) {
          const field = document.getElementById(label.htmlFor)
          expect(card.contains(field)).toBe(true)
        }
      }
    })

    it('renders add button', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
    })

    it('renders quantity input as number type', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      expect(quantityInput).toHaveAttribute('type', 'number')
    })

    it('renders unit input as text type', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const unitInput = screen.getByLabelText(/unit/i)
      expect(unitInput).toHaveAttribute('type', 'text')
    })

    it('renders ingredient name input as text type', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const ingredientInput = screen.getByLabelText('Ingredient')
      expect(ingredientInput).toHaveAttribute('type', 'text')
    })

    it('has grid layout with 4 columns on desktop', () => {
      const { container } = render(<ManualIngredientInput onAdd={vi.fn()} />)

      const gridContainer = container.querySelector('.grid')
      expect(gridContainer).toBeInTheDocument()
      // Responsive: grid-cols-1 on mobile, sm:grid-cols-[1fr_1fr_2fr_auto] on desktop
      expect(gridContainer).toHaveClass('grid-cols-1')
      expect(gridContainer).toHaveClass('sm:grid-cols-[1fr_1fr_2fr_auto]')
    })

    it('renders with placeholder text', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      expect(screen.getByPlaceholderText(/1\.5/)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/cup/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/flour/i)).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('requires quantity field', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      expect(quantityInput).toHaveAttribute('required')
    })

    it('requires unit field', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const unitInput = screen.getByLabelText(/unit/i)
      expect(unitInput).toHaveAttribute('required')
    })

    it('requires ingredient name field', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const ingredientInput = screen.getByLabelText('Ingredient')
      expect(ingredientInput).toHaveAttribute('required')
    })

    it('has minimum quantity of 0.001', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      expect(quantityInput).toHaveAttribute('min', '0.001')
    })

    it('has maximum quantity of 99999', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      expect(quantityInput).toHaveAttribute('max', '99999')
    })

    it('has step attribute for decimal quantities', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      expect(quantityInput).toHaveAttribute('step', 'any')
    })

    it('has max length for unit name', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const unitInput = screen.getByLabelText(/unit/i)
      expect(unitInput).toHaveAttribute('maxLength', '50')
    })

    it('has max length for ingredient name', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const ingredientInput = screen.getByLabelText('Ingredient')
      expect(ingredientInput).toHaveAttribute('maxLength', '100')
    })
  })

  describe('form submission', () => {
    it('calls onAdd with ingredient data on submit', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 2,
        unit: 'cups',
        ingredientName: 'flour',
      })
    })

    it('calls onAdd with decimal quantity', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '1.5')
      await userEvent.type(screen.getByLabelText(/unit/i), 'tbsp')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'butter')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 1.5,
        unit: 'tbsp',
        ingredientName: 'butter',
      })
    })

    it('clears form after successful submission', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(screen.getByLabelText(/quantity/i)).toHaveValue(null)
      expect(screen.getByLabelText(/unit/i)).toHaveValue('')
      expect(screen.getByLabelText('Ingredient')).toHaveValue('')
    })

    it('does not call onAdd with empty quantity', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('does not call onAdd with empty unit', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('does not call onAdd with empty ingredient name', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('trims whitespace from unit name', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), '  cups  ')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 2,
        unit: 'cups',
        ingredientName: 'flour',
      })
    })

    it('trims whitespace from ingredient name', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), '  flour  ')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 2,
        unit: 'cups',
        ingredientName: 'flour',
      })
    })
  })

  describe('keyboard interaction', () => {
    it('submits form on Enter key in ingredient field', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour{enter}')

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 2,
        unit: 'cups',
        ingredientName: 'flour',
      })
    })

    it('tabs between fields in correct order', async () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      const unitInput = screen.getByLabelText(/unit/i)
      const ingredientInput = screen.getByLabelText('Ingredient')
      const addButton = screen.getByRole('button', { name: /add/i })

      // Focus quantity input
      await userEvent.click(quantityInput)
      expect(quantityInput).toHaveFocus()

      // Tab to unit
      await userEvent.tab()
      expect(unitInput).toHaveFocus()

      // Tab to ingredient
      await userEvent.tab()
      expect(ingredientInput).toHaveFocus()

      // Tab to button
      await userEvent.tab()
      expect(addButton).toHaveFocus()
    })
  })

  describe('accessibility', () => {
    it('has accessible labels for all inputs', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      // Labels should be associated with inputs
      expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/unit/i)).toBeInTheDocument()
      expect(screen.getByLabelText('Ingredient')).toBeInTheDocument()
    })

    it('add button has accessible name', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
    })

    it('inputs have autocomplete attributes', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} />)

      const quantityInput = screen.getByLabelText(/quantity/i)
      const unitInput = screen.getByLabelText(/unit/i)
      const ingredientInput = screen.getByLabelText('Ingredient')

      expect(quantityInput).toHaveAttribute('autocomplete', 'off')
      expect(unitInput).toHaveAttribute('autocomplete', 'off')
      expect(ingredientInput).toHaveAttribute('autocomplete', 'off')
    })
  })

  describe('disabled state', () => {
    it('disables all inputs when disabled prop is true', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} disabled />)

      expect(screen.getByLabelText(/quantity/i)).toBeDisabled()
      expect(screen.getByLabelText(/unit/i)).toBeDisabled()
      expect(screen.getByLabelText('Ingredient')).toBeDisabled()
    })

    it('disables add button when disabled prop is true', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} disabled />)

      expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
    })

    it('does not call onAdd when disabled and form is submitted', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} disabled />)

      // Try to interact (should not work when disabled)
      const quantityInput = screen.getByLabelText(/quantity/i)
      await userEvent.click(quantityInput)

      expect(onAdd).not.toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('disables inputs when loading prop is true', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} loading />)

      expect(screen.getByLabelText(/quantity/i)).toBeDisabled()
      expect(screen.getByLabelText(/unit/i)).toBeDisabled()
      expect(screen.getByLabelText('Ingredient')).toBeDisabled()
    })

    it('disables add button when loading prop is true', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} loading />)

      expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
    })

    it('shows loading indicator on button when loading', () => {
      render(<ManualIngredientInput onAdd={vi.fn()} loading />)

      // Button should indicate loading state
      const button = screen.getByRole('button', { name: /add/i })
      expect(button).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('programmatic form submission (bypasses HTML5 validation)', () => {
    it('does not call onAdd when quantity is empty (JS validation)', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      // Fill unit and ingredient but not quantity
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')

      // Programmatically submit the form to bypass HTML5 validation
      const form = screen.getByRole('button', { name: /add/i }).closest('form')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('does not call onAdd when unit is only whitespace (JS validation)', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), '   ')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')

      // Programmatically submit the form to bypass HTML5 validation
      const form = screen.getByRole('button', { name: /add/i }).closest('form')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('does not call onAdd when ingredient is only whitespace (JS validation)', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'cups')
      await userEvent.type(screen.getByLabelText('Ingredient'), '   ')

      // Programmatically submit the form to bypass HTML5 validation
      const form = screen.getByRole('button', { name: /add/i }).closest('form')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

      expect(onAdd).not.toHaveBeenCalled()
    })

  })

  describe('edge cases', () => {
    it('handles very small decimal quantities', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '0.125')
      await userEvent.type(screen.getByLabelText(/unit/i), 'tsp')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'vanilla')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 0.125,
        unit: 'tsp',
        ingredientName: 'vanilla',
      })
    })

    it('handles ingredient names with special characters', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '1')
      await userEvent.type(screen.getByLabelText(/unit/i), 'tbsp')
      await userEvent.type(screen.getByLabelText('Ingredient'), "baker's chocolate (70%)")
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 1,
        unit: 'tbsp',
        ingredientName: "baker's chocolate (70%)",
      })
    })

    it('handles compound ingredient names', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '2')
      await userEvent.type(screen.getByLabelText(/unit/i), 'tbsp')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'extra virgin olive oil')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 2,
        unit: 'tbsp',
        ingredientName: 'extra virgin olive oil',
      })
    })

    it('handles max quantity value', async () => {
      const onAdd = vi.fn()
      render(<ManualIngredientInput onAdd={onAdd} />)

      await userEvent.type(screen.getByLabelText(/quantity/i), '99999')
      await userEvent.type(screen.getByLabelText(/unit/i), 'g')
      await userEvent.type(screen.getByLabelText('Ingredient'), 'flour')
      await userEvent.click(screen.getByRole('button', { name: /add/i }))

      expect(onAdd).toHaveBeenCalledWith({
        quantity: 99999,
        unit: 'g',
        ingredientName: 'flour',
      })
    })
  })
})
