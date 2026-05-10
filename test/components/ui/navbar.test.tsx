import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import {
  Navbar,
  NavbarDivider,
  NavbarSection,
  NavbarSpacer,
  NavbarItem,
  NavbarLabel,
} from '~/components/ui/navbar'

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('Navbar components', () => {
  describe('Navbar', () => {
    it('renders children', () => {
      render(<Navbar>Navigation content</Navbar>)
      expect(screen.getByText('Navigation content')).toBeInTheDocument()
    })

    it('renders as nav element', () => {
      render(<Navbar>Content</Navbar>)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(<Navbar className="custom-nav">Content</Navbar>)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('custom-nav')
    })

    it('applies default layout classes', () => {
      render(<Navbar>Content</Navbar>)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('flex')
      expect(nav.className).toContain('flex-1')
      expect(nav.className).toContain('items-center')
    })

    it('passes additional props', () => {
      render(<Navbar data-testid="main-nav">Content</Navbar>)
      expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    })

    it('passes aria-label prop', () => {
      render(<Navbar aria-label="Main navigation">Content</Navbar>)
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    })
  })

  describe('NavbarDivider', () => {
    it('renders as div element', () => {
      const { container } = render(<NavbarDivider />)
      const divider = container.querySelector('div')
      expect(divider).toBeInTheDocument()
    })

    it('has aria-hidden attribute for accessibility', () => {
      const { container } = render(<NavbarDivider />)
      const divider = container.querySelector('div')
      expect(divider).toHaveAttribute('aria-hidden', 'true')
    })

    it('applies custom className', () => {
      const { container } = render(<NavbarDivider className="custom-divider" />)
      const divider = container.querySelector('div')
      expect(divider?.className).toContain('custom-divider')
    })

    it('applies divider styling classes', () => {
      const { container } = render(<NavbarDivider />)
      const divider = container.querySelector('div')
      expect(divider?.className).toContain('h-6')
      expect(divider?.className).toContain('w-px')
    })

    it('passes additional props', () => {
      const { container } = render(<NavbarDivider data-testid="nav-divider" />)
      expect(container.querySelector('[data-testid="nav-divider"]')).toBeInTheDocument()
    })
  })

  describe('NavbarSection', () => {
    it('renders children', () => {
      render(<NavbarSection>Section content</NavbarSection>)
      expect(screen.getByText('Section content')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      const { container } = render(<NavbarSection>Content</NavbarSection>)
      // The component wraps a div in LayoutGroup
      const div = container.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<NavbarSection className="custom-section">Content</NavbarSection>)
      const section = container.querySelector('div')
      expect(section?.className).toContain('custom-section')
    })

    it('applies flex layout classes', () => {
      const { container } = render(<NavbarSection>Content</NavbarSection>)
      const section = container.querySelector('div')
      expect(section?.className).toContain('flex')
      expect(section?.className).toContain('items-center')
      expect(section?.className).toContain('gap-3')
    })

    it('passes additional props', () => {
      render(<NavbarSection data-testid="nav-section">Content</NavbarSection>)
      expect(screen.getByTestId('nav-section')).toBeInTheDocument()
    })
  })

  describe('NavbarSpacer', () => {
    it('renders as div element', () => {
      const { container } = render(<NavbarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer).toBeInTheDocument()
    })

    it('has aria-hidden attribute for accessibility', () => {
      const { container } = render(<NavbarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer).toHaveAttribute('aria-hidden', 'true')
    })

    it('applies custom className', () => {
      const { container } = render(<NavbarSpacer className="custom-spacer" />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('custom-spacer')
    })

    it('applies flex-1 class for space filling', () => {
      const { container } = render(<NavbarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('flex-1')
    })

    it('applies negative margin class', () => {
      const { container } = render(<NavbarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('-ml-4')
    })

    it('passes additional props', () => {
      const { container } = render(<NavbarSpacer data-testid="nav-spacer" />)
      expect(container.querySelector('[data-testid="nav-spacer"]')).toBeInTheDocument()
    })
  })

  describe('NavbarItem', () => {
    describe('as button (no href)', () => {
      it('renders children', () => {
        render(<NavbarItem>Menu Item</NavbarItem>)
        expect(screen.getByText('Menu Item')).toBeInTheDocument()
      })

      it('renders as button when no href provided', () => {
        render(<NavbarItem>Button Item</NavbarItem>)
        expect(screen.getByRole('button', { name: 'Button Item' })).toBeInTheDocument()
      })

      it('applies custom className', () => {
        const { container } = render(<NavbarItem className="custom-item">Item</NavbarItem>)
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('custom-item')
      })

      it('handles click events', async () => {
        const user = userEvent.setup()
        const handleClick = vi.fn()
        render(<NavbarItem onClick={handleClick}>Clickable</NavbarItem>)
        await user.click(screen.getByRole('button', { name: 'Clickable' }))
        expect(handleClick).toHaveBeenCalled()
      })

      it('applies cursor-default class', () => {
        const { container } = render(<NavbarItem>Item</NavbarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('cursor-default')
      })

      it('supports disabled state', () => {
        render(<NavbarItem disabled>Disabled Item</NavbarItem>)
        const button = screen.getByRole('button', { name: 'Disabled Item' })
        expect(button).toHaveAttribute('data-disabled', '')
      })
    })

    describe('as link (with href)', () => {
      it('renders as link when href is provided', () => {
        render(<NavbarItem href="/home">Home</NavbarItem>, { wrapper: TestWrapper })
        expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      })

      it('has correct href attribute', () => {
        render(<NavbarItem href="/about">About</NavbarItem>, { wrapper: TestWrapper })
        expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
      })

      it('applies custom className', () => {
        const { container } = render(
          <NavbarItem href="/test" className="custom-link">
            Link
          </NavbarItem>,
          { wrapper: TestWrapper }
        )
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('custom-link')
      })

      it('passes additional link props', () => {
        render(
          <NavbarItem href="/external" target="_blank" rel="noopener noreferrer">
            External
          </NavbarItem>,
          { wrapper: TestWrapper }
        )
        const link = screen.getByRole('link', { name: 'External' })
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      })
    })

    describe('current state indicator', () => {
      it('does not show indicator when current is false', () => {
        const { container } = render(<NavbarItem current={false}>Not Current</NavbarItem>)
        // The indicator has specific classes: absolute inset-x-2 -bottom-2.5
        const indicator = container.querySelector('span.absolute.inset-x-2')
        expect(indicator).not.toBeInTheDocument()
      })

      it('does not show indicator when current is undefined', () => {
        const { container } = render(<NavbarItem>Item</NavbarItem>)
        // There should be no motion.span for the indicator
        const allSpans = container.querySelectorAll('span')
        const indicatorSpan = Array.from(allSpans).find(
          (span) => span.className.includes('absolute') && span.className.includes('inset-x-2')
        )
        expect(indicatorSpan).toBeFalsy()
      })

      it('shows indicator when current is true', () => {
        const { container } = render(<NavbarItem current>Current Page</NavbarItem>)
        // The motion.span element is rendered when current is true
        const allSpans = container.querySelectorAll('span')
        // Should have more than just the wrapper span when current
        expect(allSpans.length).toBeGreaterThan(1)
      })

      it('sets data-current attribute when current is true', () => {
        render(<NavbarItem current>Current</NavbarItem>)
        const button = screen.getByRole('button', { name: 'Current' })
        expect(button).toHaveAttribute('data-current', 'true')
      })

      it('does not set data-current when current is false', () => {
        render(<NavbarItem current={false}>Not Current</NavbarItem>)
        const button = screen.getByRole('button', { name: 'Not Current' })
        expect(button).not.toHaveAttribute('data-current')
      })

      it('sets data-current on link when href and current are provided', () => {
        render(
          <NavbarItem href="/current" current>
            Current Link
          </NavbarItem>,
          { wrapper: TestWrapper }
        )
        const link = screen.getByRole('link', { name: 'Current Link' })
        expect(link).toHaveAttribute('data-current', 'true')
      })
    })

    describe('styling', () => {
      it('applies relative positioning to wrapper', () => {
        const { container } = render(<NavbarItem>Item</NavbarItem>)
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('relative')
      })

      it('applies base styling classes', () => {
        const { container } = render(<NavbarItem>Styled Item</NavbarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('flex')
        expect(button?.className).toContain('items-center')
        expect(button?.className).toContain('rounded-full')
      })
    })
  })

  describe('NavbarLabel', () => {
    it('renders children', () => {
      render(<NavbarLabel>Label Text</NavbarLabel>)
      expect(screen.getByText('Label Text')).toBeInTheDocument()
    })

    it('renders as span element', () => {
      const { container } = render(<NavbarLabel>Label</NavbarLabel>)
      const span = container.querySelector('span')
      expect(span).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<NavbarLabel className="custom-label">Label</NavbarLabel>)
      const span = container.querySelector('span')
      expect(span?.className).toContain('custom-label')
    })

    it('applies truncate class for text overflow', () => {
      const { container } = render(<NavbarLabel>Label</NavbarLabel>)
      const span = container.querySelector('span')
      expect(span?.className).toContain('truncate')
    })

    it('passes additional props', () => {
      render(<NavbarLabel data-testid="nav-label">Label</NavbarLabel>)
      expect(screen.getByTestId('nav-label')).toBeInTheDocument()
    })
  })

  describe('Full navbar composition', () => {
    it('renders a complete navbar with sections and items', () => {
      render(
        <Navbar aria-label="Main">
          <NavbarSection>
            <NavbarItem href="/" current>
              <NavbarLabel>Home</NavbarLabel>
            </NavbarItem>
            <NavbarItem href="/about">
              <NavbarLabel>About</NavbarLabel>
            </NavbarItem>
          </NavbarSection>
          <NavbarSpacer />
          <NavbarSection>
            <NavbarItem href="/login">
              <NavbarLabel>Login</NavbarLabel>
            </NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'About' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument()
    })

    it('renders navbar with divider between sections', () => {
      const { container } = render(
        <Navbar>
          <NavbarSection>
            <NavbarItem href="/home">Home</NavbarItem>
          </NavbarSection>
          <NavbarDivider />
          <NavbarSection>
            <NavbarItem href="/settings">Settings</NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      const divider = container.querySelector('[aria-hidden="true"]')
      expect(divider).toBeInTheDocument()
    })

    it('renders navbar with button and link items', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      render(
        <Navbar>
          <NavbarSection>
            <NavbarItem href="/home">Home</NavbarItem>
            <NavbarItem onClick={handleClick}>Menu</NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Menu' }))
      expect(handleClick).toHaveBeenCalled()
    })

    it('indicates current page correctly', () => {
      render(
        <Navbar>
          <NavbarSection>
            <NavbarItem href="/home" current>
              Home
            </NavbarItem>
            <NavbarItem href="/about">About</NavbarItem>
            <NavbarItem href="/contact">Contact</NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      const homeLink = screen.getByRole('link', { name: 'Home' })
      const aboutLink = screen.getByRole('link', { name: 'About' })
      const contactLink = screen.getByRole('link', { name: 'Contact' })

      expect(homeLink).toHaveAttribute('data-current', 'true')
      expect(aboutLink).not.toHaveAttribute('data-current')
      expect(contactLink).not.toHaveAttribute('data-current')
    })
  })

  describe('Accessibility', () => {
    it('renders nav element with proper landmark role', () => {
      render(<Navbar>Content</Navbar>)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('supports aria-label for navigation identification', () => {
      render(<Navbar aria-label="Primary navigation">Content</Navbar>)
      expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()
    })

    it('hides decorative elements from assistive technology', () => {
      const { container } = render(
        <Navbar>
          <NavbarDivider />
          <NavbarSpacer />
        </Navbar>
      )
      const hiddenElements = container.querySelectorAll('[aria-hidden="true"]')
      expect(hiddenElements.length).toBe(2)
    })

    it('makes interactive elements focusable', () => {
      render(
        <Navbar>
          <NavbarSection>
            <NavbarItem href="/home">Home</NavbarItem>
            <NavbarItem onClick={() => {}}>Menu</NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      const link = screen.getByRole('link', { name: 'Home' })
      const button = screen.getByRole('button', { name: 'Menu' })

      expect(link).not.toHaveAttribute('tabindex', '-1')
      expect(button).not.toHaveAttribute('tabindex', '-1')
    })

    it('indicates current page for screen readers', () => {
      render(
        <Navbar>
          <NavbarSection>
            <NavbarItem href="/current" current>
              Current Page
            </NavbarItem>
          </NavbarSection>
        </Navbar>,
        { wrapper: TestWrapper }
      )

      const link = screen.getByRole('link', { name: 'Current Page' })
      expect(link).toHaveAttribute('data-current', 'true')
    })
  })
})
