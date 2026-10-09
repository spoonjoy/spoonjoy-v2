import { act, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StepList } from '~/components/recipe/StepList'
import type { StepData, StepEditorCardProps } from '~/components/recipe/StepEditorCard'

// Each card reports its draft through onChange from an effect. When two cards report in the same
// commit, StepList used to rebuild the steps from the `steps` prop captured in that render for
// each report, so the second report overwrote the first with stale steps and one card's typing
// was lost. This stand-in card reports a draft whenever StepList's shared `disabled` prop turns
// on, which makes every card report in the same commit.
vi.mock('~/components/recipe/StepEditorCard', () => ({
  StepEditorCard: ({ stepNumber, disabled, onChange }: StepEditorCardProps) => {
    useEffect(() => {
      if (disabled) {
        onChange?.({ description: `Draft for step ${stepNumber}`, ingredients: [] })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled])
    return <article aria-label={`Step ${stepNumber}`} />
  },
}))

vi.mock('motion/react', () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}))

describe('StepList draft syncing', () => {
  it("keeps every card's draft when the cards report in the same commit", () => {
    let latestSteps: StepData[] = []
    let reportDrafts = () => {}

    function StatefulStepList() {
      const [steps, setSteps] = useState<StepData[]>([
        { id: 'step-1', stepNum: 1, description: '', ingredients: [] },
        { id: 'step-2', stepNum: 2, description: '', ingredients: [] },
      ])
      const [disabled, setDisabled] = useState(false)
      latestSteps = steps
      reportDrafts = () => setDisabled(true)
      return <StepList steps={steps} recipeId="new-recipe" onChange={setSteps} disabled={disabled} />
    }

    render(<StatefulStepList />)
    expect(screen.getAllByRole('article')).toHaveLength(2)

    act(() => reportDrafts())

    expect(latestSteps.map((step) => step.description)).toEqual(['Draft for step 1', 'Draft for step 2'])
  })
})
