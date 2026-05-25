import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Badge, BadgeButton } from '~/components/ui/badge'

// Wrapper component to provide React Router context for link tests
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('Badge', () => {
  describe('Badge component', () => {
    it('renders children', () => {
      render(<Badge>Status</Badge>)
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('renders as a span element', () => {
      const { container } = render(<Badge>Label</Badge>)
      const badge = container.querySelector('span')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('Label')
    })

    it('applies default neutral token color when no color prop provided', () => {
      const { container } = render(<Badge>Default</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('var(--sj-charcoal)')
      expect(badge?.className).toContain('text-[var(--sj-ink)]')
    })

    it('applies custom className', () => {
      const { container } = render(<Badge className="custom-badge">Styled</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('custom-badge')
    })

    it('applies base styling classes', () => {
      const { container } = render(<Badge>Base</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('inline-flex')
      expect(badge?.className).toContain('items-center')
      expect(badge?.className).toContain('rounded-[var(--sj-radius-small)]')
      expect(badge?.className).toContain('font-medium')
    })

    it('passes additional props to span', () => {
      render(<Badge data-testid="test-badge">Props</Badge>)
      expect(screen.getByTestId('test-badge')).toBeInTheDocument()
    })

    it('renders with different color variants', () => {
      const colors = [
        'red',
        'orange',
        'amber',
        'yellow',
        'lime',
        'green',
        'emerald',
        'teal',
        'cyan',
        'sky',
        'blue',
        'indigo',
        'violet',
        'purple',
        'fuchsia',
        'pink',
        'rose',
        'zinc',
      ] as const
      colors.forEach((color) => {
        const { unmount } = render(<Badge color={color}>{color}</Badge>)
        expect(screen.getByText(color)).toBeInTheDocument()
        unmount()
      })
    })

    it('applies action token classes for red variant', () => {
      const { container } = render(<Badge color="red">Error</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('var(--sj-tomato)')
      expect(badge?.className).toContain('text-[var(--sj-tomato)]')
    })

    it('applies growth token classes for green variant', () => {
      const { container } = render(<Badge color="green">Success</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('var(--sj-herb)')
      expect(badge?.className).toContain('text-[var(--sj-herb)]')
    })

    it('maps blue variant to neutral token classes', () => {
      const { container } = render(<Badge color="blue">Info</Badge>)
      const badge = container.querySelector('span')
      expect(badge?.className).toContain('var(--sj-charcoal)')
      expect(badge?.className).toContain('text-[var(--sj-ink)]')
    })
  })

  describe('BadgeButton component', () => {
    it('renders as a button by default', () => {
      render(<BadgeButton>Click me</BadgeButton>)
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
    })

    it('renders as a link when href is provided', () => {
      render(
        <TestWrapper>
          <BadgeButton href="/test">Link badge</BadgeButton>
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: 'Link badge' })).toHaveAttribute('href', '/test')
    })

    it('applies default zinc color', () => {
      render(<BadgeButton>Default</BadgeButton>)
      const badge = screen.getByText('Default')
      expect(badge.className).toContain('var(--sj-charcoal)')
    })

    it('applies custom className', () => {
      const { container } = render(<BadgeButton className="custom-badge-btn">Styled</BadgeButton>)
      const button = container.querySelector('button')
      expect(button?.className).toContain('custom-badge-btn')
    })

    it('applies color to inner Badge', () => {
      render(<BadgeButton color="red">Error</BadgeButton>)
      const badge = screen.getByText('Error')
      expect(badge.className).toContain('var(--sj-tomato)')
      expect(badge.className).toContain('text-[var(--sj-tomato)]')
    })

    it('renders with different color variants', () => {
      const colors = ['red', 'blue', 'green', 'indigo', 'zinc'] as const
      colors.forEach((color) => {
        const { unmount } = render(<BadgeButton color={color}>{color}</BadgeButton>)
        expect(screen.getByRole('button', { name: color })).toBeInTheDocument()
        unmount()
      })
    })

    it('passes button props when not a link', () => {
      render(<BadgeButton disabled>Disabled</BadgeButton>)
      const button = screen.getByRole('button', { name: 'Disabled' })
      expect(button).toBeDisabled()
    })

    it('includes TouchTarget for accessibility', () => {
      const { container } = render(<BadgeButton>Touch</BadgeButton>)
      const touchTarget = container.querySelector('span[aria-hidden="true"]')
      expect(touchTarget).toBeInTheDocument()
    })

    it('applies focus styling classes', () => {
      const { container } = render(<BadgeButton>Focus</BadgeButton>)
      const button = container.querySelector('button')
      expect(button?.className).toContain('focus:not-data-focus:outline-hidden')
      expect(button?.className).toContain('data-focus:outline-2')
    })

    it('renders link badge with correct href', () => {
      render(
        <TestWrapper>
          <BadgeButton href="/destination">Navigate</BadgeButton>
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: 'Navigate' })).toHaveAttribute('href', '/destination')
    })

    it('forwards ref to button element', () => {
      const ref = { current: null } as React.RefObject<HTMLElement>
      render(
        <BadgeButton ref={ref}>Ref badge</BadgeButton>
      )
      expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    })

    it('forwards ref to anchor element when href provided', () => {
      const ref = { current: null } as React.RefObject<HTMLElement>
      render(
        <TestWrapper>
          <BadgeButton href="/test" ref={ref}>Ref link badge</BadgeButton>
        </TestWrapper>
      )
      expect(ref.current).toBeInstanceOf(HTMLAnchorElement)
    })
  })
})
