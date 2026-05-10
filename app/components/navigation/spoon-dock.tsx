import clsx from 'clsx'

/**
 * SpoonDock - Mobile navigation dock component (v3 — 3-slot layout)
 * 
 * A thumb-friendly bottom navigation dock with glass morphism styling.
 * Uses a 3-column fixed-width grid so the center logo stays perfectly centered
 * regardless of label lengths in the side slots.
 * 
 * ## Design Specs
 * - Fixed bottom position, floating (not edge-to-edge)
 * - Width: max-w-md centered, inset from screen edges
 * - Height: ~64px (generous for center logo breathing room)
 * - Shape: Pill/rounded-full
 * - Glass morphism: bg-black/60 backdrop-blur-xl border-white/10
 * - Safe area: mb-[max(1rem,env(safe-area-inset-bottom))]
 * - Hidden on desktop: lg:hidden
 * - 3-column grid with fixed-width slots
 */

export interface SpoonDockProps {
  children?: React.ReactNode
  className?: string
  layout?: 'default' | 'contextual'
  /** Accessible label for the navigation landmark */
  'aria-label'?: string
}

export function SpoonDock({ 
  children, 
  className,
  layout = 'default',
  'aria-label': ariaLabel = 'Main navigation',
  ...props 
}: SpoonDockProps) {
  return (
    <nav
      role="navigation"
      aria-label={ariaLabel}
      className={clsx(
        // Positioning - fixed at bottom, centered horizontally
        'fixed bottom-0 left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))]',
        
        // 3-column grid. Contextual routes can expose two actions per side.
        'grid items-center',
        layout === 'contextual'
          ? 'grid-cols-[minmax(96px,1fr)_52px_minmax(96px,1fr)]'
          : 'grid-cols-[72px_1fr_72px]',
        
        // Sizing
        'max-w-md mx-auto',
        'h-16', // 64px - extra height for center logo breathing room
        'px-3',
        
        // Shape - pill/rounded
        'rounded-full',
        
        // Glass morphism styling
        'bg-black/60',
        'backdrop-blur-xl',
        'border border-white/10',
        
        // Responsive - hidden on desktop
        'lg:hidden',
        
        // Z-index to stay above content
        'z-50',
        
        // Safe area handling
        'mb-[max(1rem,env(safe-area-inset-bottom))]',
        
        // Custom class
        className
      )}
      {...props}
    >
      {children}
    </nav>
  )
}
