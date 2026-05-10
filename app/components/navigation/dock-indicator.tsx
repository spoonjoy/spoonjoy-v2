import clsx from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * DockIndicator - Sliding active state indicator pill
 * 
 * Uses Framer Motion's layoutId for smooth shared layout animations.
 * The pill slides to the active item position with spring physics.
 * 
 * ## Animation Specs
 * - Spring: stiffness: 400, damping: 30
 * - Duration: ~300ms
 * - Reduced motion: instant position change (no animation)
 */

export interface DockIndicatorProps {
  /** Index of the currently active item (0-based) */
  activeIndex: number
  /** Total number of items in the dock */
  itemCount: number
  /** Additional CSS classes */
  className?: string
}

export function DockIndicator({
  activeIndex,
  itemCount,
  className,
}: DockIndicatorProps) {
  const prefersReducedMotion = useReducedMotion()

  // Calculate the horizontal position as a percentage
  // Items are evenly distributed across the container
  const itemWidth = 100 / itemCount
  const leftPosition = activeIndex * itemWidth + itemWidth / 2

  // Spring animation config
  const springConfig = {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30,
  }

  return (
    <motion.div
      data-testid="dock-indicator"
      data-active-index={activeIndex}
      layoutId="dock-active-indicator"
      className={clsx(
        // Positioning
        'absolute',
        'top-1/2 -translate-y-1/2',
        
        // Size - slightly smaller than touch target
        'w-12 h-10',
        
        // Shape
        'rounded-full',
        
        // Background - subtle glass effect
        'bg-white/10',
        
        // Custom class
        className
      )}
      style={{
        left: `${leftPosition}%`,
        x: '-50%', // Center horizontally at the position
      }}
      initial={false}
      animate={{
        left: `${leftPosition}%`,
      }}
      transition={prefersReducedMotion ? { duration: 0 } : springConfig}
    />
  )
}
