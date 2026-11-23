import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RecipeNutrition } from '~/components/recipe/RecipeNutrition'

const ingredients = [
  { name: 'jasmine rice', quantity: 1, unit: 'cup' },
  { name: 'garlic', quantity: 2, unit: 'cloves' },
  { name: 'saffron', quantity: 1, unit: 'pinch' },
]

afterEach(cleanup)

function value(term: string) {
  const dt = within(screen.getByTestId('recipe-nutrition')).getByText(term, { selector: 'dt' })
  return dt.nextElementSibling?.textContent
}

describe('RecipeNutrition', () => {
  it("shows each serving's calories and macros, and how much of the recipe they cover", () => {
    render(<RecipeNutrition ingredients={ingredients} servings={2} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Nutrition' })).toBeInTheDocument()
    expect(screen.getByText('Per serving, from 2 of 3 ingredients.')).toBeInTheDocument()
    // (185 g rice × 3.65 kcal + 6 g garlic × 1.49 kcal) / 2 servings
    expect(value('Calories')).toBe('342 kcal')
    expect(value('Protein')).toBe('6.8 g')
    expect(value('Carbohydrate')).toBe('75 g')
    expect(value('Fat')).toBe('0.7 g')
    expect(value('Fiber')).toBe('1.3 g')
    expect(screen.getByRole('link', { name: 'USDA FoodData Central' })).toHaveAttribute('href', 'https://fdc.nal.usda.gov/')
  })

  it('shows the whole recipe when it does not say how many it serves', () => {
    render(<RecipeNutrition ingredients={ingredients.slice(0, 1)} servings={undefined} />)
    expect(screen.getByText('For the whole recipe, from 1 of 1 ingredient.')).toBeInTheDocument()
    expect(value('Calories')).toBe('675 kcal')
  })

  it('reads servings written as text by their first number', () => {
    render(<RecipeNutrition ingredients={ingredients} servings="2-3" />)
    expect(value('Calories')).toBe('342 kcal')
  })

  it('shows nothing for a recipe it can weigh none of', () => {
    const { container } = render(<RecipeNutrition ingredients={ingredients.slice(2)} servings={2} />)
    expect(container).toBeEmptyDOMElement()
  })
})
