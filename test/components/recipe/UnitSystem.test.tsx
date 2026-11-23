import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatScaledAmount, IngredientList, type Ingredient } from '~/components/recipe/IngredientList'
import { UnitSystemControl } from '~/components/recipe/UnitSystemControl'
import { UnitSystemProvider } from '~/components/recipe/UnitSystemProvider'
import { useUnitSystem } from '~/components/recipe/use-unit-system'
import type { UnitSystem } from '~/domains/food-knowledge'

const flour: Ingredient = { id: 'flour', quantity: 2, unit: 'cups', name: 'flour' }

function List() {
  return (
    <IngredientList
      ingredients={[flour]}
      checkedIds={new Set()}
      onToggle={vi.fn()}
      stepOutputUses={[]}
      checkedStepOutputIds={new Set()}
      onStepOutputToggle={vi.fn()}
    />
  )
}

function renderPage({ initialSystem = 'original' }: { initialSystem?: UnitSystem } = {}) {
  return render(
    <UnitSystemProvider initialSystem={initialSystem}>
      <UnitSystemControl />
      <List />
    </UnitSystemProvider>
  )
}

afterEach(() => {
  cleanup()
  document.cookie = 'sj_units=; Path=/; Max-Age=0'
})

describe('unit systems on a recipe', () => {
  it('write a scaled amount in the chosen system', () => {
    expect(formatScaledAmount(flour, 2, 'metric')).toBe('945 ml')
    expect(formatScaledAmount(flour, 2)).toBe('4 cups')
  })

  it('show amounts as the recipe wrote them outside a provider', () => {
    render(<List />)
    expect(screen.getByText('2 cups')).toBeInTheDocument()
  })

  it('show amounts in the system the page starts with', () => {
    renderPage({ initialSystem: 'metric' })
    expect(screen.getByText('475 ml')).toBeInTheDocument()
  })

  it('show no picker outside a provider', () => {
    render(<UnitSystemControl />)
    expect(screen.queryByRole('radiogroup', { name: 'Units' })).not.toBeInTheDocument()
  })

  it('convert the list when the cook picks a system, and keep the choice in a cookie', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('radiogroup', { name: 'Units' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Metric' }))

    expect(screen.getByText('475 ml')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Metric' })).toBeChecked()
    expect(document.cookie).toContain('sj_units=metric')
  })

  it('give a component outside any provider the recipe as written and a picker that does nothing', async () => {
    const user = userEvent.setup()
    function Probe() {
      const { system, setSystem } = useUnitSystem()
      return (
        <button type="button" onClick={() => setSystem('us')}>
          {system}
        </button>
      )
    }
    render(<Probe />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('original')
    expect(document.cookie).not.toContain('sj_units')
  })
})
