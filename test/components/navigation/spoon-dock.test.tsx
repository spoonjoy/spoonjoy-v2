import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpoonDock } from '~/components/navigation/spoon-dock'

describe('SpoonDock', () => {
  describe('rendering', () => {
    it('renders as a navigation element', () => {
      render(<SpoonDock />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('has aria-label for accessibility', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveAttribute('aria-label', 'Spoonjoy navigation')
    })

    it('supports custom aria-label', () => {
      render(<SpoonDock aria-label="Custom nav" />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveAttribute('aria-label', 'Custom nav')
    })

    it('renders children', () => {
      render(
        <SpoonDock>
          <button>Test Item</button>
        </SpoonDock>
      )
      expect(screen.getByRole('button', { name: 'Test Item' })).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(<SpoonDock className="custom-class" />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('custom-class')
    })
  })

  describe('positioning', () => {
    it('has fixed positioning at bottom', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('fixed')
      expect(nav).toHaveClass('bottom-0')
    })

    it('is horizontally centered with safe area insets', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('left-[max(0.75rem,env(safe-area-inset-left))]')
      expect(nav).toHaveClass('right-[max(0.75rem,env(safe-area-inset-right))]')
      expect(nav).toHaveClass('mx-auto')
    })
  })

  describe('full-width layout', () => {
    it('distributes place / primary / tools edge-to-edge', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      // Flex + justify-between spreads the groups across the full width with
      // equal gaps, so the dock never leaves a lopsided void.
      expect(nav).toHaveClass('flex')
      expect(nav).toHaveClass('justify-between')
      expect(nav).not.toHaveClass('grid')
    })

    it('keeps a minimum gap that compacts on narrow phones', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      // gap-* is the floor; justify-between adds the remaining slack. Gap +
      // padding tighten at <=389px (iPhone 13 mini / SE / 5) so items never spill.
      expect(nav).toHaveClass('gap-2')
      expect(nav).toHaveClass('max-[389px]:gap-1')
      expect(nav).toHaveClass('max-[389px]:p-1.5')
    })

    it('uses one consistent layout for root and contextual docks', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('flex')
      expect(nav).toHaveClass('justify-between')
      expect(nav).not.toHaveClass('grid-cols-[72px_1fr_72px]')
    })

    it('centers items vertically', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('items-center')
    })
  })

  describe('surface styling', () => {
    it('uses a solid fill with no backdrop-filter (iOS keeps fixed elements with backdrop-filter from sticking)', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).not.toMatch(/backdrop-blur/)
    })

    it('has a solid dark background', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('bg-[var(--sj-photo-charcoal)]')
    })

    it('has subtle border for glass edge', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toMatch(/border/)
    })
  })

  describe('safe area handling', () => {
    it('has safe-area-inset-bottom margin', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('mb-[')
    })
  })

  describe('responsive visibility', () => {
    it('is hidden on desktop (lg breakpoint and above)', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('lg:hidden')
    })
  })

  describe('dimensions', () => {
    it('has a max-width constraint', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toMatch(/max-w-/)
    })

    it('has a pill/rounded shape', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('rounded-full')
    })

    it('has 68px height for thumbable controls', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('h-17')
    })

    it('has z-50 to float above content', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('z-50')
    })
  })
})
