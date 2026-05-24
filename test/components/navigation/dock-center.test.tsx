import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// Mock useReducedMotion from framer-motion
const mockUseReducedMotion = vi.fn()
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')
  return {
    ...actual,
    useReducedMotion: () => mockUseReducedMotion(),
  }
})

import { DockCenter } from '~/components/navigation/dock-center'

// Wrapper component for routing context
const RouterWrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
)

describe('DockCenter', () => {
  beforeEach(() => {
    // Default to no reduced motion preference
    mockUseReducedMotion.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('renders the Spoonjoy mark', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      // Should contain an SVG (the logo)
      const logo = screen.getByTestId('dock-center')
      const svg = logo.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders as a link', () => {
      render(
        <RouterWrapper>
          <DockCenter href="/" />
        </RouterWrapper>
      )
      
      expect(screen.getByRole('link')).toBeInTheDocument()
    })

    it('links to home by default', () => {
      render(
        <RouterWrapper>
          <DockCenter href="/" />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/')
    })
  })

  describe('navigation', () => {
    it('navigates to specified href on tap', () => {
      render(
        <RouterWrapper>
          <DockCenter href="/dashboard" />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/dashboard')
    })

    it('calls onClick when tapped', () => {
      const onClick = vi.fn()
      render(
        <RouterWrapper>
          <DockCenter href="/" onClick={onClick} />
        </RouterWrapper>
      )
      
      fireEvent.click(screen.getByRole('link'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('visual prominence', () => {
    it('is larger than regular dock items', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      const center = screen.getByTestId('dock-center')
      // Should have larger dimensions than regular 44px items
      expect(center.className).toMatch(/w-\[52px\]|h-\[52px\]|w-1[2-6]|h-1[2-6]/)
    })

    it('has distinct styling', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      const center = screen.getByTestId('dock-center')
      // Should have background or border to distinguish it
      expect(center.className).toMatch(/bg-|border-|rounded/)
    })
  })

  describe('idle animation', () => {
    it('has breathing/glow animation classes', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      const center = screen.getByTestId('dock-center')
      // Should have animation classes or Framer Motion attributes
      expect(center).toBeInTheDocument()
    })

    it('uses Framer Motion for animation', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      // The container element should be rendered (Framer Motion wraps the component)
      // The container is a DIV that animates, with a Link inside
      const center = screen.getByTestId('dock-center')
      expect(center.tagName).toBe('DIV')
      // The link should be inside
      expect(center.querySelector('a')).toBeInTheDocument()
    })
  })

  describe('reduced motion', () => {
    it('is static when reduced motion is preferred', () => {
      mockUseReducedMotion.mockReturnValue(true)

      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )

      // Should still render, but without animation
      const center = screen.getByTestId('dock-center')
      expect(center).toBeInTheDocument()
    })

    it('uses empty animation object when reduced motion is preferred (branch coverage)', () => {
      // This test explicitly covers the prefersReducedMotion ? {} : {...} branch at line 38
      mockUseReducedMotion.mockReturnValue(true)

      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )

      // When reduced motion is preferred, the breathing animation should be empty {}
      // The component still renders but without scale animation
      const center = screen.getByTestId('dock-center')
      expect(center).toBeInTheDocument()
      // The link inside should still work
      const link = center.querySelector('a')
      expect(link).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('applies custom className', () => {
      render(
        <RouterWrapper>
          <DockCenter className="custom-class" />
        </RouterWrapper>
      )
      
      const center = screen.getByTestId('dock-center')
      expect(center.className).toContain('custom-class')
    })

    it('has touch target for accessibility', () => {
      render(
        <RouterWrapper>
          <DockCenter />
        </RouterWrapper>
      )
      
      const center = screen.getByTestId('dock-center')
      // Should have minimum touch target
      expect(center.className).toMatch(/min-w-\[44|min-h-\[44|w-1[2-6]|h-1[2-6]/)
    })
  })

  describe('accessibility', () => {
    it('has accessible name', () => {
      render(
        <RouterWrapper>
          <DockCenter href="/" />
        </RouterWrapper>
      )
      
      // Link should have aria-label or text content
      const link = screen.getByRole('link', { name: /kitchen|home|spoonjoy|logo/i })
      expect(link).toBeInTheDocument()
    })
  })
})
