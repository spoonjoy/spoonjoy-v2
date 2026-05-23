import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StackedLayout } from '~/components/ui/stacked-layout'

// Mock framer-motion to avoid animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  LayoutGroup: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

describe('StackedLayout', () => {
  describe('basic rendering', () => {
    it('renders children content', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Main content</div>
        </StackedLayout>
      )
      expect(screen.getByText('Main content')).toBeInTheDocument()
    })

    it('renders navbar prop content', () => {
      render(
        <StackedLayout navbar={<div>Navbar content</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Main</div>
        </StackedLayout>
      )
      expect(screen.getByText('Navbar content')).toBeInTheDocument()
    })

    it('renders main element for content area', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div data-testid="content">Content</div>
        </StackedLayout>
      )
      const main = screen.getByRole('main')
      expect(main).toBeInTheDocument()
      expect(main).toContainElement(screen.getByTestId('content'))
    })

    it('renders header element containing navbar', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      expect(screen.getByRole('banner')).toBeInTheDocument()
    })
  })

  describe('layout structure', () => {
    it('applies proper layout classes to root container', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const root = container.firstChild as HTMLElement
      expect(root.className).toContain('relative')
      expect(root.className).toContain('isolate')
      expect(root.className).toContain('flex')
      expect(root.className).toContain('min-h-svh')
      expect(root.className).toContain('w-full')
      expect(root.className).toContain('flex-col')
    })

    it('applies proper classes to main content area', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const main = screen.getByRole('main')
      expect(main.className).toContain('flex')
      expect(main.className).toContain('flex-1')
      expect(main.className).toContain('flex-col')
    })

    it('lets pages own their max-width container', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div data-testid="content">Content</div>
        </StackedLayout>
      )
      const contentContainer = container.querySelector('.mx-auto.w-full')
      expect(contentContainer).toBeInTheDocument()
      expect(contentContainer).toContainElement(screen.getByTestId('content'))
    })

    it('header contains navbar in flex layout', () => {
      render(
        <StackedLayout navbar={<div data-testid="navbar">Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const header = screen.getByRole('banner')
      expect(header.className).toContain('flex')
      expect(header.className).toContain('items-center')
      expect(header).toContainElement(screen.getByTestId('navbar'))
    })
  })

  describe('mobile navigation toggle', () => {
    it('renders open menu button with aria-label', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
    })

    it('opens mobile sidebar when menu button is clicked', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Mobile sidebar content</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('shows close button when mobile sidebar is open', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument()
      })
    })

    it('closes mobile sidebar when close button is clicked', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      // Open the sidebar
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Close the sidebar
      await user.click(screen.getByRole('button', { name: 'Close navigation' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('closes mobile sidebar when pressing Escape', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      // Open the sidebar
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Press Escape
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('mobile sidebar dialog', () => {
    it('mobile sidebar has lg:hidden class for responsive hiding', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        expect(dialog.className).toContain('lg:hidden')
      })
    })

    it('renders sidebar content inside mobile dialog', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav data-testid="sidebar">Sidebar nav</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        expect(dialog).toContainElement(screen.getByTestId('sidebar'))
      })
    })

    it('mobile sidebar panel has proper styling classes', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        // Check for the panel with fixed positioning
        const panel = container.querySelector('[data-headlessui-state]')
        expect(panel).toBeInTheDocument()
      })
    })

    it('mobile sidebar has backdrop for closing', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        // The backdrop is rendered as part of the dialog
        const dialog = screen.getByRole('dialog')
        expect(dialog).toBeInTheDocument()
        // The backdrop has transition classes that include bg-black/30
        const backdrop = dialog.parentElement?.querySelector('[data-headlessui-state]')
        expect(backdrop).toBeInTheDocument()
      })
    })
  })

  describe('icons', () => {
    it('renders open menu icon with aria-hidden', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const openIcon = container.querySelector('button[aria-label="Open navigation"] svg')
      expect(openIcon).toBeInTheDocument()
      expect(openIcon).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders open menu icon with data-slot attribute', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const openIcon = container.querySelector('button[aria-label="Open navigation"] svg')
      expect(openIcon).toHaveAttribute('data-slot', 'icon')
    })

    it('renders close menu icon with aria-hidden when sidebar is open', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close navigation' })
      const closeIcon = closeButton.querySelector('svg')
      expect(closeIcon).toBeInTheDocument()
      expect(closeIcon).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders close menu icon with data-slot attribute when sidebar is open', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close navigation' })
      const closeIcon = closeButton.querySelector('svg')
      expect(closeIcon).toHaveAttribute('data-slot', 'icon')
    })
  })

  describe('responsive design', () => {
    it('open menu button wrapper has lg:hidden class for mobile only', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const openButton = screen.getByRole('button', { name: 'Open navigation' })
      // The button is inside a span (from NavbarItem), which is inside the div with lg:hidden
      const buttonWrapper = openButton.closest('.lg\\:hidden')
      expect(buttonWrapper).toBeInTheDocument()
    })

    it('navbar wrapper takes remaining space with flex-1', () => {
      const { container } = render(
        <StackedLayout navbar={<div data-testid="navbar">Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const navbar = screen.getByTestId('navbar')
      const navbarWrapper = navbar.parentElement
      expect(navbarWrapper?.className).toContain('flex-1')
      expect(navbarWrapper?.className).toContain('min-w-0')
    })

    it('main content avoids an extra framed padding shell', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const main = screen.getByRole('main')
      expect(main.className).toContain('flex')
      expect(main.className).not.toContain('lg:px-3')
    })
  })

  describe('branded surface classes', () => {
    it('root container uses the Spoonjoy app shell', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const root = container.firstChild as HTMLElement
      expect(root.className).toContain('sj-app-shell')
      expect(root.className).toContain('relative')
    })

    it('content area uses the branded desktop surface', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const contentWrapper = container.querySelector('.grow')
      expect(contentWrapper?.className).toContain('sj-desktop-surface')
      expect(contentWrapper?.className).not.toContain('backdrop-blur-xl')
    })

    it('mobile sidebar panel uses the branded panel shell', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        const panelContent = dialog.querySelector('.sj-panel')
        expect(panelContent).toBeInTheDocument()
        expect(panelContent?.className).toContain('flex')
        expect(panelContent?.className).toContain('rounded-[var(--sj-radius-hero)]')
      })
    })
  })

  describe('accessibility', () => {
    it('open navigation button is accessible', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const openButton = screen.getByRole('button', { name: 'Open navigation' })
      expect(openButton).toBeInTheDocument()
      expect(openButton).toHaveAttribute('aria-label', 'Open navigation')
    })

    it('close navigation button is accessible', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const closeButton = screen.getByRole('button', { name: 'Close navigation' })
        expect(closeButton).toBeInTheDocument()
        expect(closeButton).toHaveAttribute('aria-label', 'Close navigation')
      })
    })

    it('mobile sidebar uses dialog role for accessibility', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('main content area uses main landmark', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('header uses banner landmark', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      expect(screen.getByRole('banner')).toBeInTheDocument()
    })

    it('icons are hidden from screen readers', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const icons = container.querySelectorAll('svg')
      icons.forEach((icon) => {
        expect(icon).toHaveAttribute('aria-hidden', 'true')
      })
    })
  })

  describe('composition', () => {
    it('works with sidebar component content', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout
          navbar={<div>Navbar</div>}
          sidebar={
            <nav aria-label="Main navigation">
              <ul>
                <li>Home</li>
                <li>About</li>
                <li>Contact</li>
              </ul>
            </nav>
          }
        >
          <div>Content</div>
        </StackedLayout>
      )

      // Open mobile sidebar to see the content
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
        expect(screen.getByText('Home')).toBeInTheDocument()
        expect(screen.getByText('About')).toBeInTheDocument()
        expect(screen.getByText('Contact')).toBeInTheDocument()
      })
    })

    it('works with complex navbar content', () => {
      render(
        <StackedLayout
          navbar={
            <nav aria-label="Main navbar">
              <span>Logo</span>
              <button>Profile</button>
            </nav>
          }
          sidebar={<nav>Sidebar</nav>}
        >
          <div>Content</div>
        </StackedLayout>
      )

      expect(screen.getByRole('navigation', { name: 'Main navbar' })).toBeInTheDocument()
      expect(screen.getByText('Logo')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    })

    it('works with complex children content', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <article>
            <h1>Page Title</h1>
            <p>Page content goes here</p>
            <button>Action button</button>
          </article>
        </StackedLayout>
      )

      expect(screen.getByRole('article')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Page Title' })).toBeInTheDocument()
      expect(screen.getByText('Page content goes here')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Action button' })).toBeInTheDocument()
    })
  })

  describe('state management', () => {
    it('sidebar starts closed', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('can open and close sidebar multiple times', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      // First open
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // First close
      await user.click(screen.getByRole('button', { name: 'Close navigation' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Second open
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Second close
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('content styling', () => {
    it('content wrapper removes the old card shell classes', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const contentWrapper = container.querySelector('.grow')
      expect(contentWrapper?.className).toContain('sj-desktop-surface')
      expect(contentWrapper?.className).not.toContain('rounded-[1.75rem]')
      expect(contentWrapper?.className).not.toContain('shadow-[var(--sj-shadow-soft)]')
      expect(contentWrapper?.className).not.toContain('border')
    })

    it('content wrapper leaves page padding to the route', () => {
      const { container } = render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const contentWrapper = container.querySelector('.grow')
      expect(contentWrapper?.className).not.toContain('p-6')
      expect(contentWrapper?.className).not.toContain('lg:p-10')
    })

    it('header has proper padding', () => {
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )
      const header = screen.getByRole('banner')
      expect(header.className).toContain('px-4')
    })
  })

  describe('mobile sidebar panel styling', () => {
    it('mobile sidebar panel has rounded branded corners', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        const panelInner = dialog.querySelector('.sj-panel')
        expect(panelInner).toBeInTheDocument()
        expect(panelInner?.className).toContain('rounded-[var(--sj-radius-hero)]')
      })
    })

    it('mobile sidebar panel uses the branded panel primitive', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        const panelInner = dialog.querySelector('.sj-panel')
        expect(panelInner).toBeInTheDocument()
        expect(panelInner?.className).toContain('sj-panel')
      })
    })

    it('mobile sidebar has max width constraint', async () => {
      const user = userEvent.setup()
      render(
        <StackedLayout navbar={<div>Navbar</div>} sidebar={<nav>Sidebar</nav>}>
          <div>Content</div>
        </StackedLayout>
      )

      await user.click(screen.getByRole('button', { name: 'Open navigation' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        // The dialog panel has the max-width class
        const panel = dialog.querySelector('[id^="headlessui-dialog-panel"]')
        expect(panel).toBeInTheDocument()
        expect(panel?.className).toContain('max-w-80')
      })
    })
  })
})
