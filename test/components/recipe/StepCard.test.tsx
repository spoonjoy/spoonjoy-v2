import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StepCard } from '../../../app/components/recipe/StepCard'

const ingredientListSpy = vi.fn()

vi.mock('../../../app/components/recipe/IngredientList', () => ({
  IngredientList: (props: unknown) => {
    ingredientListSpy(props)
    return <div data-testid="ingredient-list-mock" />
  },
}))

describe('StepCard', () => {
  beforeEach(() => {
    ingredientListSpy.mockClear()
  })

  it('renders title and description', () => {
    render(
      <StepCard
        stepNumber={1}
        title="Mix"
        description="Mix everything"
        ingredients={[]}
        stepOutputUses={[]}
      />
    )

    expect(screen.getByText('Mix')).toBeInTheDocument()
    expect(screen.getByTestId('step-number')).toHaveTextContent('Step 1')
    expect(screen.getByText('Mix everything')).toBeInTheDocument()
  })

  it('renders accessible fallback heading when title is missing', () => {
    render(
      <StepCard
        stepNumber={2}
        description="No explicit title"
        ingredients={[]}
        stepOutputUses={[]}
      />
    )

    expect(screen.getByTestId('step-number')).toHaveTextContent('Step 2')
    expect(screen.getByText('Step 2', { selector: '#step-2-heading' })).toBeInTheDocument()
  })

  it('passes showCheckboxes=true when only step output toggle is provided', () => {
    render(
      <StepCard
        stepNumber={1}
        description="Use prior output"
        ingredients={[{ id: 'i1', quantity: 1, unit: 'cup', name: 'water' }]}
        stepOutputUses={[]}
        onStepOutputToggle={vi.fn()}
      />
    )

    expect(screen.getByTestId('ingredient-list-mock')).toBeInTheDocument()
    expect(ingredientListSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        showCheckboxes: true,
      })
    )
  })

  it('keeps the ingredient checklist narrower than the step prose on desktop', () => {
    render(
      <StepCard
        stepNumber={1}
        description="This prose can keep a comfortable cookbook reading measure."
        ingredients={[{ id: 'i1', quantity: 1, unit: 'cup', name: 'water' }]}
        stepOutputUses={[]}
      />
    )

    expect(screen.getByTestId('step-ingredients-block')).toHaveClass('mx-auto')
    expect(screen.getByTestId('step-ingredients-block')).toHaveClass('max-w-[38rem]')
    expect(screen.getByText('This prose can keep a comfortable cookbook reading measure.')).not.toHaveClass(
      'max-w-[38rem]'
    )
  })
})
