import clsx from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'
import type { TargetAndTransition } from 'framer-motion'
import { Link } from '~/components/ui/link'
import { SpoonjoyLogo } from '~/components/ui/spoonjoy-logo'

/**
 * DockCenter - Spoonjoy mark center element for the SpoonDock (v3)
 * 
 * The hero of the dock. Larger than side items with intentional breathing
 * gap from the glass container edges. Subtle breathing animation.
 * 
 * ## Design Specs (v3)
 * - Size: 52x52px container (hero scale vs 44px side items)
 * - Logo: 32px (larger than before)
 * - Breathing: scale 0.98 → 1.02, 2s loop
 * - Reduced motion: static
 * - Intentional center gap via justify-self-center on grid
 */

export interface DockCenterProps {
  /** Route to navigate to on tap (defaults to /) */
  href?: string
  /** Additional CSS classes */
  className?: string
  /** Callback when tapped */
  onClick?: () => void
}

export function DockCenter({
  href = '/',
  className,
  onClick,
}: DockCenterProps) {
  const prefersReducedMotion = useReducedMotion()

  const breathingAnimation = prefersReducedMotion
    ? undefined
    : ({
        scale: [0.98, 1.02, 0.98],
        transition: {
          duration: 2,
          ease: 'easeInOut',
          repeat: Infinity,
          repeatType: 'loop',
        },
      } satisfies TargetAndTransition)

  return (
    <motion.div
      data-testid="dock-center"
      animate={breathingAnimation}
      className={clsx(
        // Hero size - larger than side items
        'w-[52px] h-[52px]',
        'min-w-[44px] min-h-[44px]',
        
        // Center in grid column
        'justify-self-center',
        
        // Flexbox centering
        'flex items-center justify-center',
        
        // Shape - rounded circle
        'rounded-full',
        
        // Background - subtle glass distinction
        'bg-[var(--sj-photo-glass)]',
        
        // Custom class
        className
      )}
    >
      <Link
        href={href}
        onClick={onClick}
        aria-label="Go to Kitchen"
        className={clsx(
          'w-full h-full',
          'flex items-center justify-center',
          'rounded-full',
          'no-underline',
        )}
      >
        <SpoonjoyLogo
          size={32}
          variant="current"
          className="text-[var(--sj-on-photo)]"
        />
      </Link>
    </motion.div>
  )
}
