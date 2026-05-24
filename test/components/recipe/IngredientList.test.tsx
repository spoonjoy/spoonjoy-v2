import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IngredientList, type Ingredient } from '../../../app/components/recipe/IngredientList'

const sampleIngredients: Ingredient[] = [
  { id: '1', quantity: 2, unit: 'cups', name: 'flour', iconKey: 'wheat' },
  { id: '2', quantity: 1, unit: 'cup', name: 'sugar' },
  { id: '3', quantity: 0.5, unit: 'cup', name: 'butter', iconKey: 'milk' },
]

const sampleStepOutputUses = [
  { id: 'step-1', stepNumber: 1, stepTitle: 'Make the dough' },
  { id: 'step-2', stepNumber: 2, stepTitle: null },
]

describe('IngredientList', () => {
  it('returns null for empty ingredients and empty step outputs', () => {
    const { container } = render(<IngredientList ingredients={[]} stepOutputUses={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders ingredients with name, quantity column, and checkbox', () => {
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set()} onToggle={vi.fn()} />)

    expect(screen.getByTestId('ingredient-list')).toBeInTheDocument()
    expect(screen.getByText('flour')).toBeInTheDocument()
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveTextContent('2 cups')
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('hides checkboxes when showCheckboxes is false', () => {
    render(<IngredientList ingredients={sampleIngredients} showCheckboxes={false} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('does not render checkboxes when onToggle is missing', () => {
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set()} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('scales quantity values in the quantity column', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: 2, unit: 'cups', name: 'flour' }]}
        scaleFactor={2}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByTestId('ingredient-quantity-1')).toHaveTextContent('4 cups')
  })

  it('formats fractional scaled quantity', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: 1.5, unit: 'cups', name: 'milk' }]}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByTestId('ingredient-quantity-1')).toHaveTextContent('1 ½ cups')
  })

  it('renders unit-only quantity text when quantity is null', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: null, unit: 'pinch', name: 'garnish' }]}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByTestId('ingredient-quantity-1')).toHaveTextContent('pinch')
    expect(screen.getByText('garnish')).toBeInTheDocument()
  })

  it('uses checkbox labels for accessibility', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: 2, unit: 'cups', name: 'flour' }]}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByRole('checkbox', { name: 'flour' })).toBeInTheDocument()
  })

  it('calls onToggle when ingredient name is clicked', async () => {
    const onToggle = vi.fn()
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set()} onToggle={onToggle} />)

    await userEvent.click(screen.getByText('flour'))
    expect(onToggle).toHaveBeenCalledWith('1')
  })

  it('calls onToggle when checkbox is clicked', async () => {
    const onToggle = vi.fn()
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set()} onToggle={onToggle} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'sugar' }))
    expect(onToggle).toHaveBeenCalledWith('2')
  })

  it('applies strikethrough to checked ingredient name and quantity', () => {
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set(['1'])} onToggle={vi.fn()} />)

    const flourItem = screen.getByTestId('ingredient-item-1')
    expect(within(flourItem).getByText('flour')).toHaveClass('line-through')
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveClass('line-through')
  })

  it('moves checked ingredients to the bottom of the list', () => {
    const { container } = render(
      <IngredientList ingredients={sampleIngredients} checkedIds={new Set(['1'])} onToggle={vi.fn()} />
    )
    const orderedNames = Array.from(container.querySelectorAll('[data-testid^="ingredient-item-"]')).map(
      (item) => item.textContent ?? ''
    )

    expect(orderedNames[0]).toContain('sugar')
    expect(orderedNames[1]).toContain('butter')
    expect(orderedNames[2]).toContain('flour')
  })

  it('keeps unchecked ingredients before a later checked ingredient', () => {
    const { container } = render(
      <IngredientList ingredients={sampleIngredients} checkedIds={new Set(['2'])} onToggle={vi.fn()} />
    )
    const orderedNames = Array.from(container.querySelectorAll('[data-testid^="ingredient-item-"]')).map(
      (item) => item.textContent ?? ''
    )

    expect(orderedNames[0]).toContain('flour')
    expect(orderedNames[1]).toContain('butter')
    expect(orderedNames[2]).toContain('sugar')
  })

  it('renders a step output uses section when references are present', () => {
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    const section = screen.getByTestId('step-output-uses-section')
    expect(section).toBeInTheDocument()
    expect(section).toHaveTextContent('Step 1')
    expect(section).toHaveTextContent('Make the dough')
  })

  it('renders step output references without checkboxes when onStepOutputToggle is missing', () => {
    render(
      <IngredientList
        ingredients={[]}
        stepOutputUses={sampleStepOutputUses}
        showCheckboxes={true}
      />
    )

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/step 2/i)).toBeInTheDocument()
  })

  it('renders step output checkboxes and toggles the selected reference', async () => {
    const onStepOutputToggle = vi.fn()
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        checkedIds={new Set()}
        checkedStepOutputIds={new Set()}
        onToggle={vi.fn()}
        onStepOutputToggle={onStepOutputToggle}
      />
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /step 1.*make the dough/i }))
    expect(onStepOutputToggle).toHaveBeenCalledWith('step-1')
  })

  it('toggles a step output when its text button is clicked', async () => {
    const onStepOutputToggle = vi.fn()
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        checkedIds={new Set()}
        checkedStepOutputIds={new Set()}
        onToggle={vi.fn()}
        onStepOutputToggle={onStepOutputToggle}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /step 1.*make the dough/i }))
    expect(onStepOutputToggle).toHaveBeenCalledWith('step-1')
  })

  it('applies checked styling to checked step output references', () => {
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        checkedIds={new Set()}
        checkedStepOutputIds={new Set(['step-1'])}
        onToggle={vi.fn()}
        onStepOutputToggle={vi.fn()}
      />
    )

    const section = screen.getByTestId('step-output-uses-section')
    const checkedText = within(section).getByText(/step 1/i)
    expect(checkedText.closest('button')).toHaveClass('line-through')
  })

  it('applies min-h-11 touch target class to step output use buttons', () => {
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        checkedIds={new Set()}
        checkedStepOutputIds={new Set()}
        onToggle={vi.fn()}
        onStepOutputToggle={vi.fn()}
      />
    )

    const section = screen.getByTestId('step-output-uses-section')
    const buttons = within(section).getAllByRole('button')
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-11')
    }
  })

  it('applies min-h-11 touch target class to ingredient row buttons', () => {
    render(
      <IngredientList
        ingredients={sampleIngredients}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox')
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveClass('min-h-14')
    }
  })

  it('hides step output checkboxes when showCheckboxes is false', () => {
    render(
      <IngredientList
        ingredients={sampleIngredients}
        stepOutputUses={sampleStepOutputUses}
        showCheckboxes={false}
      />
    )

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/step 1/i)).toBeInTheDocument()
  })

  it('shows checked styling without checkbox controls when checked ids are provided', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: 1, unit: 'cup', name: 'flour' }]}
        checkedIds={new Set(['1'])}
        showCheckboxes={false}
      />
    )

    expect(screen.getByText('flour')).toHaveClass('line-through')
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveClass('line-through')
  })

  it('renders a non-empty placeholder when quantity and unit are missing', () => {
    render(
      <IngredientList
        ingredients={[{ id: '1', quantity: null, unit: '', name: 'pepper' }]}
        checkedIds={new Set()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByTestId('ingredient-quantity-1').textContent).toBe('\u00A0')
  })
})
