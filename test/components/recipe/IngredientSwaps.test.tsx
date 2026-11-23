import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IngredientList, type Ingredient } from '~/components/recipe/IngredientList'

const buttermilk: Ingredient = { id: 'buttermilk', quantity: 1, unit: 'cup', name: 'buttermilk', categoryLabel: 'Dairy' }

function List({ showSwaps, ingredients = [buttermilk] }: { showSwaps?: boolean; ingredients?: Ingredient[] }) {
  return (
    <IngredientList
      ingredients={ingredients}
      checkedIds={new Set()}
      onToggle={vi.fn()}
      stepOutputUses={[]}
      checkedStepOutputIds={new Set()}
      onStepOutputToggle={vi.fn()}
      showSwaps={showSwaps}
    />
  )
}

afterEach(cleanup)

describe('ingredient swaps in a list', () => {
  it('follow the aisle where the list asks for them', () => {
    render(<List showSwaps />)
    expect(screen.getByRole('checkbox', { name: 'buttermilk' })).toHaveAccessibleDescription(
      /^Dairy · Swap: milk with 1 tbsp lemon juice or vinegar per cup, left 5 minutes; plain yogurt thinned with a little milk/,
    )
  })

  it('stay away from a list that does not ask for them', () => {
    render(<List />)
    expect(screen.queryByText(/Swap:/)).not.toBeInTheDocument()
  })



  it('stand alone for an ingredient without an aisle, and leave one with no swap as it was', () => {
    render(
      <List
          showSwaps
          ingredients={[
            { id: 'honey', quantity: 2, unit: 'tbsp', name: 'honey' },
            { id: 'saffron', quantity: 1, unit: 'pinch', name: 'saffron', categoryLabel: 'Spices' },
            { id: 'salt', quantity: 1, unit: 'tsp', name: 'salt' },
          ]}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'honey' })).toHaveAccessibleDescription(/^Swap: maple syrup/)
    expect(screen.getByRole('checkbox', { name: 'saffron' })).toHaveAccessibleDescription(/^Spices/)
    expect(screen.getByRole('checkbox', { name: 'saffron' })).not.toHaveAccessibleDescription(/Swap/)
    expect(screen.getByRole('checkbox', { name: 'salt' })).not.toHaveAccessibleDescription(/Swap/)
  })
})
