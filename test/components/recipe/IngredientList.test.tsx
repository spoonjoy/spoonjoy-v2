import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatStepReferenceName,
  IngredientList,
  SINK_DURATION_MS,
  uncheckedFirst,
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

  it('lists step outputs first, sinks a checked one, and toggles them through onStepOutputToggle', async () => {
    const { onToggle, onStepOutputToggle } = renderList({
      stepOutputUses: sampleStepOutputUses,
      checkedStepOutputIds: new Set(['step-2']),
    })

    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    const boxes = screen.getAllByRole('checkbox')
    const [first, last] = [boxes[0], boxes[4]]
    expect(first).toHaveAccessibleName('Step 1: Make the dough')
    expect(first).toHaveAccessibleDescription('Step output')
    expect(last).toHaveAccessibleName('Step 2')
    expect(last).toBeChecked()

    await userEvent.click(first!)
    expect(onStepOutputToggle).toHaveBeenCalledWith('step-1')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('names a step output by its number alone when it has no title', () => {
    expect(formatStepReferenceName({ id: 'a', stepNumber: 3, stepTitle: null })).toBe('Step 3')
    expect(formatStepReferenceName({ id: 'a', stepNumber: 3, stepTitle: 'Rest' })).toBe('Step 3: Rest')
  })

  it('sinks checked rows below every unchecked one, each in recipe order', () => {
    renderList({
      stepOutputUses: sampleStepOutputUses,
      checkedStepOutputIds: new Set(['step-1']),
      checkedIds: new Set(['1']),
    })
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'true'])
    expect(screen.getAllByText(/flour|sugar|butter|Step 1: Make the dough|Step 2/).map((label) => label.textContent)).toEqual([
      'Step 2',
      'sugar',
      'butter',
      'Step 1: Make the dough',
      'flour',
    ])
  })

  it('keeps unchecked rows before later checked ones and both groups in order', () => {
    const rows = [
      { id: 'a', checked: true },
      { id: 'b', checked: false },
      { id: 'c', checked: true },
      { id: 'd', checked: false },
    ]
    expect(uncheckedFirst(rows).map((row) => row.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('IngredientList sink motion', () => {
  const props = {
    ingredients: sampleIngredients,
    onToggle: vi.fn(),
    stepOutputUses: [],
    checkedStepOutputIds: new Set<string>(),
    onStepOutputToggle: vi.fn(),
  }
  const original = HTMLElement.prototype.animate

  afterEach(() => {
    HTMLElement.prototype.animate = original
    vi.restoreAllMocks()
  })

  /** Lays rows out 40px apart in DOM order, under a list at the top of the page. */
  function layOutRows() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rows = [...(this.parentElement?.children ?? [])]
      const top = this.matches('[data-slot="checklist-row"]') ? 100 + rows.indexOf(this) * 40 : 100
      return { top } as DOMRect
    })
  }

  function stubMotion(reduce: boolean) {
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduce } as MediaQueryList)
    return animate
  }

  it('slides each moved row from its old place when a check reorders the list', () => {
    layOutRows()
    const animate = stubMotion(false)
    const { rerender } = render(<IngredientList {...props} checkedIds={new Set()} />)
    expect(animate).not.toHaveBeenCalled()

    rerender(<IngredientList {...props} checkedIds={new Set(['1'])} />)
    const moves = animate.mock.calls.map(([keyframes, options]) => [keyframes[0].transform, options.duration])
    // flour sinks from the top to the bottom; sugar and butter each rise one row.
    expect(moves).toEqual([
      ['translateY(40px)', SINK_DURATION_MS],
      ['translateY(40px)', SINK_DURATION_MS],
      ['translateY(-80px)', SINK_DURATION_MS],
    ])
  })

  it('leaves a row that keeps its place, and a new row, where they are', () => {
    layOutRows()
    const animate = stubMotion(false)
    const { rerender } = render(<IngredientList {...props} checkedIds={new Set()} />)
    const salt = { id: '4', quantity: null, unit: 'pinch', name: 'salt' }
    rerender(<IngredientList {...props} ingredients={[...sampleIngredients, salt]} checkedIds={new Set(['2'])} />)
    // flour stays first and salt is new; butter rises one row and sugar sinks two.
    expect(animate.mock.calls.map(([keyframes]) => keyframes[0].transform)).toEqual(['translateY(40px)', 'translateY(-80px)'])
  })

  it('does not move rows when the order stays the same', () => {
    layOutRows()
    const animate = stubMotion(false)
    const { rerender } = render(<IngredientList {...props} checkedIds={new Set(['3'])} />)
    rerender(<IngredientList {...props} checkedIds={new Set(['3'])} scaleFactor={2} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('moves nothing when the cook prefers reduced motion', () => {
    layOutRows()
    const animate = stubMotion(true)
    const { rerender } = render(<IngredientList {...props} checkedIds={new Set()} />)
    rerender(<IngredientList {...props} checkedIds={new Set(['1'])} />)
    expect(animate).not.toHaveBeenCalled()
  })
})
