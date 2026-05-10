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
      expect(nav).toHaveAttribute('aria-label', 'Main navigation')
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
      expect(nav).toHaveClass('left-[max(1rem,env(safe-area-inset-left))]')
      expect(nav).toHaveClass('right-[max(1rem,env(safe-area-inset-right))]')
      expect(nav).toHaveClass('mx-auto')
    })
  })

  describe('3-column grid layout', () => {
    it('uses grid layout with fixed-width side columns', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('grid')
      expect(nav).toHaveClass('grid-cols-[72px_1fr_72px]')
    })

    it('uses wider balanced side columns for contextual action clusters', () => {
      render(<SpoonDock layout="contextual" />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('grid')
      expect(nav).toHaveClass('grid-cols-[minmax(96px,1fr)_52px_minmax(96px,1fr)]')
      expect(nav).not.toHaveClass('grid-cols-[72px_1fr_72px]')
    })

    it('centers items vertically', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('items-center')
    })
  })

  describe('glass morphism styling', () => {
    it('has backdrop blur for glass effect', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toMatch(/backdrop-blur/)
    })

    it('has semi-transparent background', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toMatch(/bg-.*\/\d+/)
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

    it('has 64px height for center logo breathing room', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('h-16')
    })

    it('has z-50 to float above content', () => {
      render(<SpoonDock />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('z-50')
    })
  })
})
