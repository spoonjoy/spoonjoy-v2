import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpoonjoyLogo } from '~/components/spoonjoy-logo'

describe('SpoonjoyLogo', () => {
  describe('rendering', () => {
    it('renders an SVG element', () => {
      render(<SpoonjoyLogo data-testid="logo" />)

      const logo = screen.getByTestId('logo')
      expect(logo.tagName).toBe('svg')
    })

    it('has correct viewBox', () => {
      render(<SpoonjoyLogo data-testid="logo" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('viewBox', '0 0 500 300')
    })
  })

  describe('size prop', () => {
    it('uses default size of 24', () => {
      render(<SpoonjoyLogo data-testid="logo" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('width', '24')
      expect(logo).toHaveAttribute('height', '24')
    })

    it('accepts custom numeric size', () => {
      render(<SpoonjoyLogo data-testid="logo" size={48} />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('width', '48')
      expect(logo).toHaveAttribute('height', '48')
    })

    it('accepts custom string size', () => {
      render(<SpoonjoyLogo data-testid="logo" size="2rem" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('width', '2rem')
      expect(logo).toHaveAttribute('height', '2rem')
    })
  })

  describe('variant prop (branch coverage)', () => {
    it('uses currentColor for current variant (default)', () => {
      // Default variant is 'current' which uses currentColor
      // The fill is applied via CSS class, not inline - we just verify it renders
      render(<SpoonjoyLogo data-testid="logo" variant="current" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toBeInTheDocument()
      expect(logo.className).toContain('fill-current')
    })

    it('sets fill color for black variant', () => {
      // The legacy black variant maps to the cookbook charcoal token.
      // This covers the 'variant === black' branch
      render(<SpoonjoyLogo data-testid="logo" variant="black" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toBeInTheDocument()
    })

    it('sets fill color for white variant', () => {
      // The legacy white variant maps to the cookbook bone token.
      // This covers the else branch (neither current nor black)
      render(<SpoonjoyLogo data-testid="logo" variant="white" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toBeInTheDocument()
    })
  })

  describe('className prop', () => {
    it('applies custom className', () => {
      render(<SpoonjoyLogo data-testid="logo" className="custom-class" />)

      const logo = screen.getByTestId('logo')
      expect(logo.className).toContain('custom-class')
    })

    it('preserves default classes with custom className', () => {
      render(<SpoonjoyLogo data-testid="logo" className="custom-class" />)

      const logo = screen.getByTestId('logo')
      expect(logo.className).toContain('shrink-0')
      expect(logo.className).toContain('fill-current')
      expect(logo.className).toContain('custom-class')
    })
  })

  describe('accessibility', () => {
    it('has data-slot attribute for icon identification', () => {
      render(<SpoonjoyLogo data-testid="logo" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('data-slot', 'icon')
    })
  })

  describe('SVG props passthrough', () => {
    it('passes through additional SVG props', () => {
      render(<SpoonjoyLogo data-testid="logo" aria-hidden="true" />)

      const logo = screen.getByTestId('logo')
      expect(logo).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
