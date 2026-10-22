import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StepsSectionHeading } from '~/components/recipe/StepsSectionHeading'

describe('StepsSectionHeading', () => {
  it('shows the Steps heading and the checklist hint', () => {
    render(<StepsSectionHeading hasProgress={false} onClearProgress={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Steps' })).toBeInTheDocument()
    expect(screen.getByText('Tap ingredients as you go')).toHaveClass('print:hidden')
    expect(screen.getByText('Cook mode', { selector: 'p' })).toHaveClass('sj-print-hidden')
  })

  it('keeps Clear progress laid out but invisible, disabled and hidden while nothing is checked', () => {
    render(<StepsSectionHeading hasProgress={false} onClearProgress={vi.fn()} />)
    const clear = screen.getByTestId('clear-progress-button')
    const room = clear.parentElement!

    // Still in the layout, so the first check moves nothing.
    expect(clear).toHaveTextContent('Clear progress')
    expect(clear).toHaveAttribute('data-ouro-control', 'button')
    expect(room).toHaveClass('invisible')
    expect(room).not.toHaveClass('hidden')
    expect(clear).toBeDisabled()
    expect(room).toHaveAttribute('aria-hidden', 'true')
    expect(room).toHaveAttribute('data-state', 'reserved')
    expect(screen.queryByRole('button', { name: 'Clear progress' })).toBeNull()
  })

  it('shows Clear progress once something is checked, and clears on a tap', async () => {
    const onClearProgress = vi.fn()
    render(<StepsSectionHeading hasProgress onClearProgress={onClearProgress} />)
    const clear = screen.getByRole('button', { name: 'Clear progress' })
    const room = clear.parentElement!

    expect(room).toHaveClass('visible')
    expect(room).not.toHaveClass('invisible')
    expect(clear).toBeEnabled()
    expect(room).not.toHaveAttribute('aria-hidden')
    expect(room).toHaveAttribute('data-state', 'shown')

    await userEvent.click(clear)
    expect(onClearProgress).toHaveBeenCalledTimes(1)
  })

  it('does not clear while there is nothing to clear', async () => {
    const onClearProgress = vi.fn()
    render(<StepsSectionHeading hasProgress={false} onClearProgress={onClearProgress} />)
    await userEvent.click(screen.getByTestId('clear-progress-button'), { pointerEventsCheck: 0 })
    expect(onClearProgress).not.toHaveBeenCalled()
  })
})
