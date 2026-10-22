import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  formatStepReferenceName,
  IngredientList,
  type IngredientListProps,
  type Ingredient,
} from '../../../app/components/recipe/IngredientList'

const sampleIngredients: Ingredient[] = [
  { id: '1', quantity: 2, unit: 'cups', name: 'flour', iconKey: 'wheat', categoryLabel: 'Pantry' },
  { id: '2', quantity: 1, unit: 'cup', name: 'sugar' },
  { id: '3', quantity: 0.5, unit: 'cup', name: 'butter', iconKey: 'milk' },
]

const sampleStepOutputUses = [
  { id: 'step-1', stepNumber: 1, stepTitle: 'Make the dough' },
  { id: 'step-2', stepNumber: 2, stepTitle: null },
]

function renderList(props: Partial<IngredientListProps> = {}) {
  const onToggle = vi.fn()
  const onStepOutputToggle = vi.fn()
  render(
    <IngredientList
      ingredients={sampleIngredients}
      checkedIds={new Set()}
      onToggle={onToggle}
      stepOutputUses={[]}
      checkedStepOutputIds={new Set()}
      onStepOutputToggle={onStepOutputToggle}
      {...props}
    />
  )
  return { onToggle, onStepOutputToggle }
}

describe('IngredientList', () => {
  it('returns null for empty ingredients and empty step outputs', () => {
    const { container } = render(
      <IngredientList
        ingredients={[]}
        checkedIds={new Set()}
        onToggle={vi.fn()}
        stepOutputUses={[]}
        checkedStepOutputIds={new Set()}
        onStepOutputToggle={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is an Ouro HX checklist named Ingredients, one checkbox per ingredient', () => {
    renderList()

    const list = screen.getByRole('group', { name: 'Ingredients' })
    expect(list).toHaveAttribute('data-ouro', 'checklist')
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('data-ouro-control'))).toEqual(['checklist', 'checklist', 'checklist'])
  })

  it('describes each ingredient by its aisle and its amount', () => {
    renderList()

    expect(screen.getByRole('checkbox', { name: 'flour' })).toHaveAccessibleDescription('Pantry 2 cups')
    expect(screen.getByRole('checkbox', { name: 'sugar' })).toHaveAccessibleDescription('1 cup')
  })

  it('scales quantity values', () => {
    renderList({ ingredients: [{ id: '1', quantity: 2, unit: 'cups', name: 'flour' }], scaleFactor: 2 })
    expect(screen.getByRole('checkbox', { name: 'flour' })).toHaveAccessibleDescription('4 cups')
  })

  it('formats a fractional quantity', () => {
    renderList({ ingredients: [{ id: '1', quantity: 1.5, unit: 'cups', name: 'milk' }] })
    expect(screen.getByRole('checkbox', { name: 'milk' })).toHaveAccessibleDescription('1 ½ cups')
  })

  it('shows only the unit when there is no quantity', () => {
    renderList({ ingredients: [{ id: '1', quantity: null, unit: 'pinch', name: 'garnish' }] })
    expect(screen.getByRole('checkbox', { name: 'garnish' })).toHaveAccessibleDescription('pinch')
  })

  it('shows no amount when there is neither a quantity nor a unit', () => {
    renderList({ ingredients: [{ id: '1', quantity: Number.NaN, unit: '', name: 'salt' }] })
    expect(screen.getByRole('checkbox', { name: 'salt' })).not.toHaveAttribute('aria-describedby')
  })

  it('reflects the checked ingredients', () => {
    renderList({ checkedIds: new Set(['2']) })
    expect(screen.getByRole('checkbox', { name: 'sugar' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'flour' })).not.toBeChecked()
  })

  it('calls onToggle with the ingredient id when its row is clicked', async () => {
    const { onToggle, onStepOutputToggle } = renderList()
    await userEvent.click(screen.getByText('flour'))
    expect(onToggle).toHaveBeenCalledWith('1')
    expect(onStepOutputToggle).not.toHaveBeenCalled()
  })

  it('lists step outputs first, and toggles them through onStepOutputToggle', async () => {
    const { onToggle, onStepOutputToggle } = renderList({
      stepOutputUses: sampleStepOutputUses,
      checkedStepOutputIds: new Set(['step-2']),
    })

    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    const [first, second] = screen.getAllByRole('checkbox')
    expect(first).toHaveAccessibleName('Step 1: Make the dough')
    expect(first).toHaveAccessibleDescription('Step output')
    expect(second).toHaveAccessibleName('Step 2')
    expect(second).toBeChecked()

    await userEvent.click(first!)
    expect(onStepOutputToggle).toHaveBeenCalledWith('step-1')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('names a step output by its number alone when it has no title', () => {
    expect(formatStepReferenceName({ id: 'a', stepNumber: 3, stepTitle: null })).toBe('Step 3')
    expect(formatStepReferenceName({ id: 'a', stepNumber: 3, stepTitle: 'Rest' })).toBe('Step 3: Rest')
  })
})
