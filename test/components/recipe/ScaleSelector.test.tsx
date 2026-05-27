import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ScaleSelector } from '../../../app/components/recipe/ScaleSelector'

describe('ScaleSelector', () => {
  describe('rendering', () => {
    it('renders current scale value with × suffix', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-display')).toHaveTextContent('1×')
    })

    it('renders decimal values correctly', () => {
      render(<ScaleSelector value={1.5} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-display')).toHaveTextContent('1.5×')
    })

    it('renders whole numbers without decimals', () => {
      render(<ScaleSelector value={2} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-display')).toHaveTextContent('2×')
    })

    it('renders minus button', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-minus')).toBeInTheDocument()
    })

    it('renders plus button', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-plus')).toBeInTheDocument()
    })

    it('renders custom display value when provided', () => {
      render(<ScaleSelector value={1} displayValue="4" onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-display')).toHaveTextContent('4')
    })

    it('allows long servings labels to wrap instead of truncating into the controls', () => {
      render(<ScaleSelector value={1} displayValue="Makes 24 very generous dinner-party servings" onChange={vi.fn()} />)

      const display = screen.getByTestId('scale-display')
      expect(display).toHaveTextContent('Makes 24 very generous dinner-party servings')
      expect(display).toHaveClass('break-words')
      expect(display).not.toHaveClass('truncate')
    })

    it('renders as an editorial yield rule instead of circular controls', () => {
      render(<ScaleSelector value={1} displayValue="Serves 4" onChange={vi.fn()} />)

      expect(screen.getByTestId('scale-selector')).toHaveClass('grid')
      expect(screen.getByTestId('scale-selector')).toHaveClass('border-y')
      expect(screen.getByText('Yield')).toBeInTheDocument()
      expect(screen.getByTestId('scale-minus')).toHaveClass('border-r')
      expect(screen.getByTestId('scale-minus')).not.toHaveClass('rounded-full')
      expect(screen.getByTestId('scale-plus')).toHaveClass('border-l')
      expect(screen.getByTestId('scale-plus')).not.toHaveClass('rounded-full')
    })

    it('labels plain scale values as scale when no servings display is provided', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByText('Scale')).toBeInTheDocument()
    })
  })

  describe('increment behavior', () => {
    it('increments by 0.25 by default', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(1.25)
    })

    it('increments by custom step', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} step={0.5} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(1.5)
    })

    it('does not exceed max value', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={49.75} onChange={onChange} max={50} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(50)
    })

    it('does not call onChange when at max', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={50} onChange={onChange} max={50} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('decrement behavior', () => {
    it('decrements by 0.25 by default', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} />)

      await userEvent.click(screen.getByTestId('scale-minus'))
      expect(onChange).toHaveBeenCalledWith(0.75)
    })

    it('decrements by custom step', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} step={0.5} />)

      await userEvent.click(screen.getByTestId('scale-minus'))
      expect(onChange).toHaveBeenCalledWith(0.5)
    })

    it('does not go below min value', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={0.5} onChange={onChange} min={0.25} />)

      await userEvent.click(screen.getByTestId('scale-minus'))
      expect(onChange).toHaveBeenCalledWith(0.25)
    })

    it('does not call onChange when at min', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={0.25} onChange={onChange} min={0.25} />)

      await userEvent.click(screen.getByTestId('scale-minus'))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('disabled states', () => {
    it('disables minus button at min value', () => {
      render(<ScaleSelector value={0.25} onChange={vi.fn()} min={0.25} />)
      expect(screen.getByTestId('scale-minus')).toBeDisabled()
    })

    it('disables plus button at max value', () => {
      render(<ScaleSelector value={50} onChange={vi.fn()} max={50} />)
      expect(screen.getByTestId('scale-plus')).toBeDisabled()
    })

    it('enables both buttons in normal range', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByTestId('scale-minus')).not.toBeDisabled()
      expect(screen.getByTestId('scale-plus')).not.toBeDisabled()
    })
  })

  describe('accessibility', () => {
    it('has accessible label for decrease button', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: /decrease/i })).toBeInTheDocument()
    })

    it('has accessible label for increase button', () => {
      render(<ScaleSelector value={1} onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: /increase/i })).toBeInTheDocument()
    })

    it('supports keyboard interaction for minus button', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} />)

      const minusButton = screen.getByTestId('scale-minus')
      await act(async () => {
        minusButton.focus()
      })
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(0.75)
    })

    it('supports keyboard interaction for plus button', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} />)

      const plusButton = screen.getByTestId('scale-plus')
      await act(async () => {
        plusButton.focus()
      })
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(1.25)
    })
  })

  describe('custom configuration', () => {
    it('respects custom min value', async () => {
      const onChange = vi.fn()
      // Set value close to min so we can hit the boundary
      render(<ScaleSelector value={0.75} onChange={onChange} min={0.5} />)

      await userEvent.click(screen.getByTestId('scale-minus'))
      expect(onChange).toHaveBeenCalledWith(0.5)
    })

    it('respects custom max value', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={9} onChange={onChange} max={10} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(9.25)
    })

    it('respects custom step value', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={1} onChange={onChange} step={1} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(2)
    })
  })

  describe('floating point precision', () => {
    it('handles floating point arithmetic correctly', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={0.1} onChange={onChange} step={0.1} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      expect(onChange).toHaveBeenCalledWith(0.2)
    })

    it('rounds values to avoid floating point errors', async () => {
      const onChange = vi.fn()
      render(<ScaleSelector value={0.7} onChange={onChange} step={0.1} />)

      await userEvent.click(screen.getByTestId('scale-plus'))
      // Should be 0.8, not 0.7999999999999999
      expect(onChange).toHaveBeenCalledWith(0.8)
    })
  })
})
