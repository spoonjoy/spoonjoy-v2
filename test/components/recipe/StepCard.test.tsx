import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepCard, type StepCardProps } from '../../../app/components/recipe/StepCard'

const progress = {
  scaleFactor: 1,
  checkedIngredientIds: new Set<string>(),
  onIngredientToggle: vi.fn(),
  checkedStepOutputIds: new Set<string>(),
  onStepOutputToggle: vi.fn(),
} satisfies Partial<StepCardProps>

describe('StepCard', () => {
  it('renders title and description', () => {
    render(<StepCard {...progress} stepNumber={1} title="Mix" description="Mix everything" ingredients={[]} stepOutputUses={[]} />)

    expect(screen.getByText('Mix')).toBeInTheDocument()
    expect(screen.getByTestId('step-number')).toHaveTextContent('Step 1')
    expect(screen.getByText('Mix everything')).toBeInTheDocument()
    expect(screen.queryByTestId('step-ingredients-block')).toBeNull()
  })

  it('renders accessible fallback heading when title is missing', () => {
    render(<StepCard {...progress} stepNumber={2} description="No explicit title" ingredients={[]} stepOutputUses={[]} />)

    expect(screen.getByTestId('step-number')).toHaveTextContent('Step 2')
    expect(screen.getByText('Step 2', { selector: '#step-2-heading' })).toBeInTheDocument()
  })

  it('lists a step that only uses an earlier step\'s output', () => {
    render(
      <StepCard
        {...progress}
        stepNumber={2}
        description="Use prior output"
        ingredients={[]}
        stepOutputUses={[{ id: 'out-1', stepNumber: 1, stepTitle: 'Cook the rice' }]}
      />
    )

    expect(screen.getByRole('group', { name: 'Ingredients' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Step 1: Cook the rice' })).toBeInTheDocument()
  })

  it('keeps the ingredient checklist narrower than the step prose on desktop', () => {
    render(
      <StepCard
        {...progress}
        stepNumber={1}
        description="This prose can keep a comfortable cookbook reading measure."
        ingredients={[{ id: 'i1', quantity: 1, unit: 'cup', name: 'water' }]}
        stepOutputUses={[]}
      />
    )

    expect(screen.getByRole('checkbox', { name: 'water' })).toBeInTheDocument()
    expect(screen.getByTestId('step-ingredients-block')).toHaveClass('mx-auto')
    expect(screen.getByTestId('step-ingredients-block')).toHaveClass('max-w-[38rem]')
    // Print moves the block to the left margin through this class (app/styles/tailwind.css).
    expect(screen.getByTestId('step-ingredients-block')).toHaveClass('sj-step-ingredients')
    expect(screen.getByTestId('step-ingredients-block').closest('.sj-step-card')).not.toBeNull()
    expect(screen.getByText('This prose can keep a comfortable cookbook reading measure.')).not.toHaveClass(
      'max-w-[38rem]'
    )
  })

  it('prints the ingredients as plain lines, without the cook\'s checklist', () => {
    render(
      <StepCard
        {...progress}
        scaleFactor={2}
        stepNumber={2}
        description="Finish"
        ingredients={[
          { id: 'i1', quantity: 1, unit: 'cup', name: 'water' },
          { id: 'i2', quantity: null, unit: '', name: 'salt' },
        ]}
        stepOutputUses={[{ id: 'out-1', stepNumber: 1, stepTitle: null }]}
      />
    )

    expect(screen.getByRole('group', { name: 'Ingredients' }).parentElement).toHaveClass('print:hidden')
    const printed = screen.getByTestId('step-print-ingredients')
    expect(printed).toHaveClass('hidden', 'print:block')
    expect(Array.from(printed.children, (line) => line.textContent)).toEqual(['Step 1', '2 cups water', 'salt'])
  })

  it('marks the step the cook is on', () => {
    const { rerender } = render(
      <StepCard {...progress} stepNumber={2} description="Simmer" ingredients={[]} stepOutputUses={[]} current />
    )
    expect(screen.getByTestId('current-step-marker')).toHaveTextContent('You are here')
    expect(screen.getByRole('article')).toHaveAttribute('data-current-step', '')

    rerender(<StepCard {...progress} stepNumber={2} description="Simmer" ingredients={[]} stepOutputUses={[]} />)
    expect(screen.queryByTestId('current-step-marker')).toBeNull()
    expect(screen.getByRole('article')).not.toHaveAttribute('data-current-step')
  })
})
