import { Minus, Plus } from 'lucide-react'

export interface ScaleSelectorProps {
  /** Current scale factor */
  value: number
  /** Optional custom display text instead of the formatted scale factor */
  displayValue?: string
  /** Callback when scale changes */
  onChange: (value: number) => void
  /** Minimum scale factor (default: 0.25) */
  min?: number
  /** Maximum scale factor (default: 50) */
  max?: number
  /** Increment step (default: 0.25) */
  step?: number
}

/**
 * A recipe-yield selector with +/− buttons for recipe scaling.
 *
 * Features:
 * - Full-width mobile touch targets for kitchen use
 * - 0.25 increments for recipe-friendly scaling
 * - Editorial yield display that fits the cookbook page
 * - Disabled state at min/max boundaries
 */
export function ScaleSelector({
  value,
  displayValue,
  onChange,
  min = 0.25,
  max = 50,
  step = 0.25,
}: ScaleSelectorProps) {
  const isAtMin = value <= min
  const isAtMax = value >= max

  const handleDecrement = () => {
    /* istanbul ignore next -- @preserve decrement button is disabled at min boundary */
    if (!isAtMin) {
      // Round to avoid floating point issues
      const newValue = Math.round((value - step) * 100) / 100
      onChange(Math.max(min, newValue))
    }
  }

  const handleIncrement = () => {
    /* istanbul ignore next -- @preserve increment button is disabled at max boundary */
    if (!isAtMax) {
      // Round to avoid floating point issues
      const newValue = Math.round((value + step) * 100) / 100
      onChange(Math.min(max, newValue))
    }
  }

  // Format the display value, removing unnecessary decimal places
  const formatDisplayValue = (v: number): string => {
    // If it's a whole number, show without decimals
    if (Number.isInteger(v)) {
      return `${v}×`
    }
    // Otherwise show up to 2 decimal places, trimming trailing zeros
    return `${parseFloat(v.toFixed(2))}×`
  }

  const visibleValue = displayValue ?? formatDisplayValue(value)
  const caption = displayValue ? 'Yield' : 'Scale'

  return (
    <div
      data-testid="scale-selector"
      className="grid w-full grid-cols-[3rem_minmax(0,1fr)_3rem] items-stretch border-y border-[var(--sj-border-strong)] text-[var(--sj-ink)] sm:max-w-[28rem]"
    >
      <button
        type="button"
        disabled={isAtMin}
        onClick={handleDecrement}
        aria-label="Decrease scale"
        data-testid="scale-minus"
        className="grid min-h-16 place-items-center border-r border-[var(--sj-border)] text-[var(--sj-ink)] transition hover:bg-[var(--sj-flour)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] disabled:text-[var(--sj-border-strong)] disabled:hover:bg-transparent"
      >
        <Minus className="size-5" aria-hidden="true" />
      </button>

      <span className="grid min-h-16 min-w-0 place-items-center px-3 py-2 text-center sm:px-4">
        <span className="font-sj-ui text-[0.62rem]/4 font-bold uppercase tracking-[0.22em] text-[var(--sj-ink-soft)]">
          {caption}
        </span>
        <span
          data-testid="scale-display"
          aria-live="polite"
          className="font-sj-display max-w-full break-words text-balance text-xl/7 font-semibold text-[var(--sj-ink)] sm:text-2xl/8"
        >
          {visibleValue}
        </span>
      </span>

      <button
        type="button"
        disabled={isAtMax}
        onClick={handleIncrement}
        aria-label="Increase scale"
        data-testid="scale-plus"
        className="grid min-h-16 place-items-center border-l border-[var(--sj-border)] text-[var(--sj-ink)] transition hover:bg-[var(--sj-flour)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] disabled:text-[var(--sj-border-strong)] disabled:hover:bg-transparent"
      >
        <Plus className="size-5" aria-hidden="true" />
      </button>
    </div>
  )
}
