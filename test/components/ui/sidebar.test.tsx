import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import {
  Sidebar,
  SidebarHeader,
  SidebarBody,
  SidebarFooter,
  SidebarSection,
  SidebarDivider,
  SidebarSpacer,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
} from '~/components/ui/sidebar'

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('Sidebar components', () => {
  describe('Sidebar', () => {
    it('renders children', () => {
      render(<Sidebar>Sidebar content</Sidebar>)
      expect(screen.getByText('Sidebar content')).toBeInTheDocument()
    })

    it('renders as nav element', () => {
      render(<Sidebar>Content</Sidebar>)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(<Sidebar className="custom-sidebar">Content</Sidebar>)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('custom-sidebar')
    })

    it('applies default layout classes', () => {
      render(<Sidebar>Content</Sidebar>)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('flex')
      expect(nav.className).toContain('h-full')
      expect(nav.className).toContain('min-h-0')
      expect(nav.className).toContain('flex-col')
    })

    it('passes additional props', () => {
      render(<Sidebar data-testid="main-sidebar">Content</Sidebar>)
      expect(screen.getByTestId('main-sidebar')).toBeInTheDocument()
    })

    it('passes aria-label prop', () => {
      render(<Sidebar aria-label="Main sidebar">Content</Sidebar>)
      expect(screen.getByRole('navigation', { name: 'Main sidebar' })).toBeInTheDocument()
    })
  })

  describe('SidebarHeader', () => {
    it('renders children', () => {
      render(<SidebarHeader>Header content</SidebarHeader>)
      expect(screen.getByText('Header content')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      const { container } = render(<SidebarHeader>Content</SidebarHeader>)
      const div = container.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarHeader className="custom-header">Content</SidebarHeader>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('custom-header')
    })

    it('applies flex and border styling classes', () => {
      const { container } = render(<SidebarHeader>Content</SidebarHeader>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('flex')
      expect(div?.className).toContain('flex-col')
      expect(div?.className).toContain('border-b')
      expect(div?.className).toContain('p-4')
    })

    it('passes additional props', () => {
      render(<SidebarHeader data-testid="sidebar-header">Content</SidebarHeader>)
      expect(screen.getByTestId('sidebar-header')).toBeInTheDocument()
    })
  })

  describe('SidebarBody', () => {
    it('renders children', () => {
      render(<SidebarBody>Body content</SidebarBody>)
      expect(screen.getByText('Body content')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      const { container } = render(<SidebarBody>Content</SidebarBody>)
      const div = container.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarBody className="custom-body">Content</SidebarBody>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('custom-body')
    })

    it('applies flex and overflow styling classes', () => {
      const { container } = render(<SidebarBody>Content</SidebarBody>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('flex')
      expect(div?.className).toContain('flex-1')
      expect(div?.className).toContain('flex-col')
      expect(div?.className).toContain('overflow-y-auto')
      expect(div?.className).toContain('p-4')
    })

    it('passes additional props', () => {
      render(<SidebarBody data-testid="sidebar-body">Content</SidebarBody>)
      expect(screen.getByTestId('sidebar-body')).toBeInTheDocument()
    })
  })

  describe('SidebarFooter', () => {
    it('renders children', () => {
      render(<SidebarFooter>Footer content</SidebarFooter>)
      expect(screen.getByText('Footer content')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      const { container } = render(<SidebarFooter>Content</SidebarFooter>)
      const div = container.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarFooter className="custom-footer">Content</SidebarFooter>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('custom-footer')
    })

    it('applies flex and border-t styling classes', () => {
      const { container } = render(<SidebarFooter>Content</SidebarFooter>)
      const div = container.querySelector('div')
      expect(div?.className).toContain('flex')
      expect(div?.className).toContain('flex-col')
      expect(div?.className).toContain('border-t')
      expect(div?.className).toContain('p-4')
    })

    it('passes additional props', () => {
      render(<SidebarFooter data-testid="sidebar-footer">Content</SidebarFooter>)
      expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument()
    })
  })

  describe('SidebarSection', () => {
    it('renders children', () => {
      render(<SidebarSection>Section content</SidebarSection>)
      expect(screen.getByText('Section content')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      const { container } = render(<SidebarSection>Content</SidebarSection>)
      const div = container.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarSection className="custom-section">Content</SidebarSection>)
      const section = container.querySelector('div')
      expect(section?.className).toContain('custom-section')
    })

    it('applies flex layout classes', () => {
      const { container } = render(<SidebarSection>Content</SidebarSection>)
      const section = container.querySelector('div')
      expect(section?.className).toContain('flex')
      expect(section?.className).toContain('flex-col')
      expect(section?.className).toContain('gap-0.5')
    })

    it('has data-slot="section" attribute', () => {
      const { container } = render(<SidebarSection>Content</SidebarSection>)
      const section = container.querySelector('[data-slot="section"]')
      expect(section).toBeInTheDocument()
    })

    it('passes additional props', () => {
      render(<SidebarSection data-testid="sidebar-section">Content</SidebarSection>)
      expect(screen.getByTestId('sidebar-section')).toBeInTheDocument()
    })
  })

  describe('SidebarDivider', () => {
    it('renders as hr element', () => {
      const { container } = render(<SidebarDivider />)
      const hr = container.querySelector('hr')
      expect(hr).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarDivider className="custom-divider" />)
      const hr = container.querySelector('hr')
      expect(hr?.className).toContain('custom-divider')
    })

    it('applies divider styling classes', () => {
      const { container } = render(<SidebarDivider />)
      const hr = container.querySelector('hr')
      expect(hr?.className).toContain('my-4')
      expect(hr?.className).toContain('border-t')
    })

    it('passes additional props', () => {
      const { container } = render(<SidebarDivider data-testid="sidebar-divider" />)
      expect(container.querySelector('[data-testid="sidebar-divider"]')).toBeInTheDocument()
    })
  })

  describe('SidebarSpacer', () => {
    it('renders as div element', () => {
      const { container } = render(<SidebarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer).toBeInTheDocument()
    })

    it('has aria-hidden attribute for accessibility', () => {
      const { container } = render(<SidebarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer).toHaveAttribute('aria-hidden', 'true')
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarSpacer className="custom-spacer" />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('custom-spacer')
    })

    it('applies flex-1 class for space filling', () => {
      const { container } = render(<SidebarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('flex-1')
    })

    it('applies mt-8 margin class', () => {
      const { container } = render(<SidebarSpacer />)
      const spacer = container.querySelector('div')
      expect(spacer?.className).toContain('mt-8')
    })

    it('passes additional props', () => {
      const { container } = render(<SidebarSpacer data-testid="sidebar-spacer" />)
      expect(container.querySelector('[data-testid="sidebar-spacer"]')).toBeInTheDocument()
    })
  })

  describe('SidebarHeading', () => {
    it('renders children', () => {
      render(<SidebarHeading>Heading text</SidebarHeading>)
      expect(screen.getByText('Heading text')).toBeInTheDocument()
    })

    it('renders as h3 element', () => {
      render(<SidebarHeading>Heading</SidebarHeading>)
      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarHeading className="custom-heading">Heading</SidebarHeading>)
      const h3 = container.querySelector('h3')
      expect(h3?.className).toContain('custom-heading')
    })

    it('applies text styling classes', () => {
      const { container } = render(<SidebarHeading>Heading</SidebarHeading>)
      const h3 = container.querySelector('h3')
      expect(h3?.className).toContain('mb-1')
      expect(h3?.className).toContain('px-2')
      expect(h3?.className).toContain('text-xs/6')
      expect(h3?.className).toContain('font-semibold')
    })

    it('passes additional props', () => {
      render(<SidebarHeading data-testid="sidebar-heading">Heading</SidebarHeading>)
      expect(screen.getByTestId('sidebar-heading')).toBeInTheDocument()
    })
  })

  describe('SidebarItem', () => {
    describe('as button (no href)', () => {
      it('renders children', () => {
        render(<SidebarItem>Menu Item</SidebarItem>)
        expect(screen.getByText('Menu Item')).toBeInTheDocument()
      })

      it('renders as button when no href provided', () => {
        render(<SidebarItem>Button Item</SidebarItem>)
        expect(screen.getByRole('button', { name: 'Button Item' })).toBeInTheDocument()
      })

      it('applies custom className', () => {
        const { container } = render(<SidebarItem className="custom-item">Item</SidebarItem>)
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('custom-item')
      })

      it('handles click events', async () => {
        const user = userEvent.setup()
        const handleClick = vi.fn()
        render(<SidebarItem onClick={handleClick}>Clickable</SidebarItem>)
        await user.click(screen.getByRole('button', { name: 'Clickable' }))
        expect(handleClick).toHaveBeenCalled()
      })

      it('applies cursor-default class', () => {
        const { container } = render(<SidebarItem>Item</SidebarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('cursor-default')
      })

      it('supports disabled state', () => {
        render(<SidebarItem disabled>Disabled Item</SidebarItem>)
        const button = screen.getByRole('button', { name: 'Disabled Item' })
        expect(button).toHaveAttribute('data-disabled', '')
      })
    })

    describe('as link (with href)', () => {
      it('renders as link when href is provided', () => {
        render(<SidebarItem href="/home">Home</SidebarItem>, { wrapper: TestWrapper })
        expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      })

      it('has correct href attribute', () => {
        render(<SidebarItem href="/about">About</SidebarItem>, { wrapper: TestWrapper })
        expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
      })

      it('applies custom className', () => {
        const { container } = render(
          <SidebarItem href="/test" className="custom-link">
            Link
          </SidebarItem>,
          { wrapper: TestWrapper }
        )
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('custom-link')
      })

      it('passes additional link props', () => {
        render(
          <SidebarItem href="/external" target="_blank" rel="noopener noreferrer">
            External
          </SidebarItem>,
          { wrapper: TestWrapper }
        )
        const link = screen.getByRole('link', { name: 'External' })
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      })
    })

    describe('current state indicator', () => {
      it('does not show indicator when current is false', () => {
        const { container } = render(<SidebarItem current={false}>Not Current</SidebarItem>)
        const allSpans = container.querySelectorAll('span')
        const indicatorSpan = Array.from(allSpans).find(
          (span) => span.className.includes('absolute') && span.className.includes('inset-y-2')
        )
        expect(indicatorSpan).toBeFalsy()
      })

      it('does not show indicator when current is undefined', () => {
        const { container } = render(<SidebarItem>Item</SidebarItem>)
        const allSpans = container.querySelectorAll('span')
        const indicatorSpan = Array.from(allSpans).find(
          (span) => span.className.includes('absolute') && span.className.includes('inset-y-2')
        )
        expect(indicatorSpan).toBeFalsy()
      })

      it('shows indicator when current is true', () => {
        const { container } = render(<SidebarItem current>Current Page</SidebarItem>)
        const allSpans = container.querySelectorAll('span')
        expect(allSpans.length).toBeGreaterThan(1)
      })

      it('sets data-current attribute when current is true', () => {
        render(<SidebarItem current>Current</SidebarItem>)
        const button = screen.getByRole('button', { name: 'Current' })
        expect(button).toHaveAttribute('data-current', 'true')
      })

      it('does not set data-current when current is false', () => {
        render(<SidebarItem current={false}>Not Current</SidebarItem>)
        const button = screen.getByRole('button', { name: 'Not Current' })
        expect(button).not.toHaveAttribute('data-current')
      })

      it('sets data-current on link when href and current are provided', () => {
        render(
          <SidebarItem href="/current" current>
            Current Link
          </SidebarItem>,
          { wrapper: TestWrapper }
        )
        const link = screen.getByRole('link', { name: 'Current Link' })
        expect(link).toHaveAttribute('data-current', 'true')
      })
    })

    describe('styling', () => {
      it('applies relative positioning to wrapper', () => {
        const { container } = render(<SidebarItem>Item</SidebarItem>)
        const wrapper = container.querySelector('span')
        expect(wrapper?.className).toContain('relative')
      })

      it('applies base styling classes', () => {
        const { container } = render(<SidebarItem>Styled Item</SidebarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('flex')
        expect(button?.className).toContain('w-full')
        expect(button?.className).toContain('items-center')
        expect(button?.className).toContain('rounded-full')
      })

      it('applies gap and padding classes', () => {
        const { container } = render(<SidebarItem>Styled Item</SidebarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('gap-3')
        expect(button?.className).toContain('px-3')
        expect(button?.className).toContain('py-2.5')
      })

      it('applies text styling classes', () => {
        const { container } = render(<SidebarItem>Styled Item</SidebarItem>)
        const button = container.querySelector('button')
        expect(button?.className).toContain('text-left')
        expect(button?.className).toContain('text-base/6')
        expect(button?.className).toContain('font-semibold')
      })
    })

    describe('ref forwarding', () => {
      it('forwards ref to button element', () => {
        const ref = vi.fn()
        render(<SidebarItem ref={ref}>Item</SidebarItem>)
        expect(ref).toHaveBeenCalled()
        expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement)
      })

      it('forwards ref to link element', () => {
        const ref = vi.fn()
        render(
          <SidebarItem href="/test" ref={ref}>
            Link
          </SidebarItem>,
          { wrapper: TestWrapper }
        )
        expect(ref).toHaveBeenCalled()
        expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLAnchorElement)
      })
    })
  })

  describe('SidebarLabel', () => {
    it('renders children', () => {
      render(<SidebarLabel>Label Text</SidebarLabel>)
      expect(screen.getByText('Label Text')).toBeInTheDocument()
    })

    it('renders as span element', () => {
      const { container } = render(<SidebarLabel>Label</SidebarLabel>)
      const span = container.querySelector('span')
      expect(span).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<SidebarLabel className="custom-label">Label</SidebarLabel>)
      const span = container.querySelector('span')
      expect(span?.className).toContain('custom-label')
    })

    it('applies truncate class for text overflow', () => {
      const { container } = render(<SidebarLabel>Label</SidebarLabel>)
      const span = container.querySelector('span')
      expect(span?.className).toContain('truncate')
    })

    it('passes additional props', () => {
      render(<SidebarLabel data-testid="sidebar-label">Label</SidebarLabel>)
      expect(screen.getByTestId('sidebar-label')).toBeInTheDocument()
    })
  })

  describe('Full sidebar composition', () => {
    it('renders a complete sidebar with header, body, and footer', () => {
      render(
        <Sidebar aria-label="Main">
          <SidebarHeader>
            <SidebarSection>
              <SidebarItem href="/">
                <SidebarLabel>Logo</SidebarLabel>
              </SidebarItem>
            </SidebarSection>
          </SidebarHeader>
          <SidebarBody>
            <SidebarSection>
              <SidebarHeading>Navigation</SidebarHeading>
              <SidebarItem href="/home" current>
                <SidebarLabel>Home</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/about">
                <SidebarLabel>About</SidebarLabel>
              </SidebarItem>
            </SidebarSection>
          </SidebarBody>
          <SidebarFooter>
            <SidebarSection>
              <SidebarItem href="/settings">
                <SidebarLabel>Settings</SidebarLabel>
              </SidebarItem>
            </SidebarSection>
          </SidebarFooter>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Logo' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'About' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    })

    it('renders sidebar with divider between sections', () => {
      const { container } = render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/home">Home</SidebarItem>
            </SidebarSection>
            <SidebarDivider />
            <SidebarSection>
              <SidebarItem href="/settings">Settings</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      const hr = container.querySelector('hr')
      expect(hr).toBeInTheDocument()
    })

    it('renders sidebar with spacer for layout', () => {
      const { container } = render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/home">Home</SidebarItem>
            </SidebarSection>
            <SidebarSpacer />
            <SidebarSection>
              <SidebarItem href="/help">Help</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      const spacer = container.querySelector('[aria-hidden="true"]')
      expect(spacer).toBeInTheDocument()
    })

    it('renders sidebar with button and link items', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/home">Home</SidebarItem>
              <SidebarItem onClick={handleClick}>Menu</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Menu' }))
      expect(handleClick).toHaveBeenCalled()
    })

    it('indicates current page correctly', () => {
      render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/home" current>
                Home
              </SidebarItem>
              <SidebarItem href="/about">About</SidebarItem>
              <SidebarItem href="/contact">Contact</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
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
      render(<Sidebar>Content</Sidebar>)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('supports aria-label for navigation identification', () => {
      render(<Sidebar aria-label="Primary sidebar">Content</Sidebar>)
      expect(screen.getByRole('navigation', { name: 'Primary sidebar' })).toBeInTheDocument()
    })

    it('hides decorative spacer from assistive technology', () => {
      const { container } = render(
        <Sidebar>
          <SidebarBody>
            <SidebarSpacer />
          </SidebarBody>
        </Sidebar>
      )
      const hiddenElements = container.querySelectorAll('[aria-hidden="true"]')
      expect(hiddenElements.length).toBe(1)
    })

    it('makes interactive elements focusable', () => {
      render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/home">Home</SidebarItem>
              <SidebarItem onClick={() => {}}>Menu</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      const link = screen.getByRole('link', { name: 'Home' })
      const button = screen.getByRole('button', { name: 'Menu' })

      expect(link).not.toHaveAttribute('tabindex', '-1')
      expect(button).not.toHaveAttribute('tabindex', '-1')
    })

    it('indicates current page for screen readers', () => {
      render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/current" current>
                Current Page
              </SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      const link = screen.getByRole('link', { name: 'Current Page' })
      expect(link).toHaveAttribute('data-current', 'true')
    })

    it('heading provides proper structure for screen readers', () => {
      render(
        <Sidebar>
          <SidebarBody>
            <SidebarSection>
              <SidebarHeading>Section Title</SidebarHeading>
              <SidebarItem href="/item">Item</SidebarItem>
            </SidebarSection>
          </SidebarBody>
        </Sidebar>,
        { wrapper: TestWrapper }
      )

      expect(screen.getByRole('heading', { level: 3, name: 'Section Title' })).toBeInTheDocument()
    })
  })
})
