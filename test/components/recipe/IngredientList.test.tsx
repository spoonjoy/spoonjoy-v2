import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  getIngredientLayoutTransition,
  IngredientList,
  type Ingredient,
} from '../../../app/components/recipe/IngredientList'

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

  it('applies a full-width ruled strike to checked ingredient rows', () => {
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set(['1'])} onToggle={vi.fn()} />)

    const flourItem = screen.getByTestId('ingredient-item-1')
    const strike = within(flourItem).getByTestId('checklist-row-strike')
    expect(strike).toHaveClass('left-0')
    expect(strike).toHaveClass('right-0')
    expect(within(flourItem).getByText('flour')).toHaveClass('text-[var(--sj-ink-soft)]')
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveClass('text-[var(--sj-ink-soft)]')
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

  it('marks ingredient rows for pleasant layout animation when checkoff reorders them', () => {
    render(<IngredientList ingredients={sampleIngredients} checkedIds={new Set(['1'])} onToggle={vi.fn()} />)

    for (const item of screen.getAllByTestId(/^ingredient-item-/)) {
      expect(item).toHaveAttribute('data-layout-animation', 'ingredient-checkoff-reorder')
    }
  })

  it('uses a spring layout transition unless reduced motion is requested', () => {
    expect(getIngredientLayoutTransition(false)).toMatchObject({
      type: 'spring',
      stiffness: 420,
      damping: 38,
      mass: 0.7,
    })
    expect(getIngredientLayoutTransition(null)).toMatchObject({
      type: 'spring',
      stiffness: 420,
      damping: 38,
      mass: 0.7,
    })
  })

  it('removes layout animation duration when reduced motion is requested', () => {
    expect(getIngredientLayoutTransition(true)).toEqual({ duration: 0 })
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
    expect(section).not.toHaveClass('border-l')
    expect(screen.getByTestId('step-output-item-step-1')).toHaveTextContent('Step 1: Make the dough')
    expect(screen.getByTestId('step-output-item-step-1')).toHaveTextContent('step output')
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

    await userEvent.click(screen.getByRole('checkbox', { name: /step 1.*make the dough/i }))
    expect(onStepOutputToggle).toHaveBeenCalledWith('step-1')
  })

  it('renders checked step output references with the shared row strike', () => {
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

    const checkedItem = screen.getByTestId('step-output-item-step-1')
    expect(within(checkedItem).getByTestId('checklist-row-strike')).toHaveClass('right-0')
    expect(within(checkedItem).getByText('used')).toBeInTheDocument()
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
    const checkboxes = within(section).getAllByRole('checkbox')
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveClass('min-h-14')
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

    const flourItem = screen.getByText('flour').closest('li')
    expect(flourItem).not.toBeNull()
    expect(within(flourItem as HTMLElement).getByTestId('checklist-row-strike')).toBeInTheDocument()
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveClass('text-[var(--sj-ink-soft)]')
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
