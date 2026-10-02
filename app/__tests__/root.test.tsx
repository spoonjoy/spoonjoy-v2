import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

vi.mock('motion/react', () => ({
  motion: {
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  LayoutGroup: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

import { MobileNav } from '~/components/navigation/mobile-nav'
import { ThemeProvider } from '~/components/ui/theme-provider'

function CurrentRootLayoutBehavior({ userId }: { userId: string | null }) {
  const isAuthenticated = !!userId

  return (
    <ThemeProvider>
      <div className="sj-app-shell relative isolate flex min-h-svh w-full flex-col">
        <header className="sj-desktop-topbar sticky top-0 z-30 hidden items-center px-4 lg:flex">
          <nav data-testid="desktop-navbar">Desktop Navbar</nav>
        </header>
        <main className="sj-desktop-surface sj-mobile-surface grow pb-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] lg:pb-0">
          <div data-testid="outlet">Page Content</div>
        </main>
      </div>
      <MobileNav isAuthenticated={isAuthenticated} />
    </ThemeProvider>
  )
}

describe('Root layout responsive behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('phone tab bar (MobileNav) rendering', () => {
    it('renders the phone tab bar on mobile for authenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // the phone tab bar should be present for authenticated users
      // MobileNav wraps the phone tab bar which has role="navigation" and lg:hidden class
      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))
      expect(mobileNav).toBeInTheDocument()
    })

    it('renders the phone tab bar on mobile for unauthenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      // the phone tab bar should also be present for unauthenticated users
      // This test should FAIL initially because current root.tsx only renders MobileNav for authenticated users
      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))
      expect(mobileNav).toBeInTheDocument()
    })

    it('shows authenticated nav items in the phone tab bar for authenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      const tabBar = screen.getByRole('navigation', { name: 'Spoonjoy navigation' })
      for (const tab of ['Kitchen', 'Recipes', 'Cookbooks', 'Shopping', 'Search']) {
        expect(within(tabBar).getByRole('link', { name: tab })).toBeInTheDocument()
      }
    })

    it('shows unauthenticated nav items in the phone tab bar for unauthenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))

      expect(mobileNav).toBeInTheDocument()
      const tabBar = screen.getByRole('navigation', { name: 'Spoonjoy navigation' })
      expect(within(tabBar).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
      expect(within(tabBar).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    })
  })

  describe('StackedLayout navbar visibility', () => {
    it('desktop navbar is hidden on mobile and shown on desktop', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      const header = container.querySelector('.sj-desktop-topbar')
      expect(header).toBeInTheDocument()
      expect(header?.className).toContain('hidden')
      expect(header?.className).toContain('lg:flex')
    })

    it('navbar is visible on desktop (navbar content present)', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // On desktop, the full navbar should be visible with navigation items
      // The StackedLayout wrapper has hidden lg:block, so it shows on desktop
      const header = screen.getByRole('banner')
      expect(header).toBeInTheDocument()

      // Navbar should contain the desktop navbar content
      expect(screen.getByTestId('desktop-navbar')).toBeInTheDocument()
    })
  })

  describe('single mounted outlet', () => {
    it('renders one route outlet instead of hidden desktop and mobile copies', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      expect(screen.getAllByTestId('outlet')).toHaveLength(1)
    })

    it('does not render the old hamburger shell on mobile', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
    })
  })

  describe('content bottom padding for the phone tab bar clearance', () => {
    it('content has correct bottom padding on mobile for the phone tab bar clearance', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      const mobileContentWrapper = container.querySelector('main.sj-mobile-surface')
      expect(mobileContentWrapper).toBeInTheDocument()
      expect(mobileContentWrapper?.className).toContain('pb-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)]')
    })

    it('content padding wrapper contains the Outlet content', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      const mobileMain = container.querySelector('main.sj-mobile-surface')
      expect(mobileMain).toBeInTheDocument()
      expect(mobileMain?.querySelector('[data-testid="outlet"]')).toBeInTheDocument()
      expect(screen.getAllByRole('main')).toHaveLength(1)
    })
  })

  describe('unauthenticated user navigation', () => {
    it('unauthenticated users see the tab bar with Home, Recipes, Log in and Search', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      const tabBar = screen.getByRole('navigation', { name: 'Spoonjoy navigation' })
      expect(within(tabBar).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent?.trim())).toEqual([
        'Home',
        'Recipes',
        'Log in',
        'Search',
      ])
    })

    it('unauthenticated users do NOT see the signed-in tabs', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      const tabBar = screen.getByRole('navigation', { name: 'Spoonjoy navigation' })
      expect(within(tabBar).queryByRole('link', { name: 'Kitchen' })).not.toBeInTheDocument()
      expect(within(tabBar).queryByRole('link', { name: 'Cookbooks' })).not.toBeInTheDocument()
      expect(within(tabBar).queryByRole('link', { name: 'Shopping' })).not.toBeInTheDocument()
    })
  })
})
