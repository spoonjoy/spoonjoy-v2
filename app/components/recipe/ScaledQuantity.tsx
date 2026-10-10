import { formatAmount, scaleQuantity } from '../../lib/quantity'

export interface ScaledQuantityProps {
  /** The base quantity (before scaling) */
  quantity: number | null | undefined
  /** The unit of measurement (e.g., "cups", "tbsp") */
  unit?: string
  /** The ingredient name */
  name: string
  /** Scale factor to apply to quantity (default: 1) */
  scaleFactor?: number
}

/**
 * Displays an ingredient's scaled quantity with proper Unicode fractions.
 *
 * Format: "2 ½ cups flour" (quantity + unit + name)
 *
 * Features:
 * - Uses Unicode fractions (½, ¼, ⅓) for better readability
 * - Applies scale factor to quantity before display
 * - Handles missing/null quantities gracefully
 * - Readable typography for kitchen use
 */
export function ScaledQuantity({
  quantity,
  unit,
  name,
  scaleFactor = 1,
}: ScaledQuantityProps) {
  // Handle null/undefined quantity
  const hasQuantity = quantity != null && !Number.isNaN(quantity)

  // Calculate scaled quantity
  const scaledQuantity = hasQuantity ? scaleQuantity(quantity, scaleFactor) : null

  const parts = [formatAmount(scaledQuantity, unit), name].filter(Boolean)

  return (
    <span
      data-testid="scaled-quantity"
      className="text-[var(--sj-ink)]"
    >
      {parts.join(' ')}
    </span>
  )
}
