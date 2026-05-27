import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
        <main className="sj-desktop-surface sj-mobile-surface grow pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
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

  describe('SpoonDock (MobileNav) rendering', () => {
    it('renders SpoonDock on mobile for authenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // SpoonDock should be present for authenticated users
      // MobileNav wraps SpoonDock which has role="navigation" and lg:hidden class
      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))
      expect(mobileNav).toBeInTheDocument()
    })

    it('renders SpoonDock on mobile for unauthenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      // SpoonDock should also be present for unauthenticated users
      // This test should FAIL initially because current root.tsx only renders MobileNav for authenticated users
      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))
      expect(mobileNav).toBeInTheDocument()
    })

    it('shows authenticated nav items in SpoonDock for authenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      expect(screen.getByRole('link', { name: /my kitchen/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /create recipe/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /shopping list/i })).toBeInTheDocument()
    })

    it('shows unauthenticated nav items in SpoonDock for unauthenticated users', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))

      expect(mobileNav).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /spoonjoy public/i })).toHaveAttribute('href', '/')
      expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login')
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

  describe('content bottom padding for SpoonDock clearance', () => {
    it('content has correct bottom padding on mobile for SpoonDock clearance', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      const mobileContentWrapper = container.querySelector('main.sj-mobile-surface')
      expect(mobileContentWrapper).toBeInTheDocument()
      expect(mobileContentWrapper?.className).toContain('pb-[calc(5rem+env(safe-area-inset-bottom))]')
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
    it('unauthenticated users see SpoonDock with Home and Login', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      // For unauthenticated users, SpoonDock should show:
      // - Home (left side)
      // - Center Spoonjoy mark
      // - Login (right side)

      // This test should FAIL initially because MobileNav is only rendered for authenticated users
      const navigations = screen.getAllByRole('navigation')
      const mobileNav = navigations.find(nav => nav.className.includes('lg:hidden'))
      expect(mobileNav).toBeInTheDocument()

      // Check for dock-center (the Spoonjoy mark)
      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
    })

    it('unauthenticated users do NOT see authenticated nav items in SpoonDock', () => {
      render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId={null} />
        </MemoryRouter>
      )

      // Unauthenticated users should NOT see Recipes, Cookbooks, List, Profile
      // They should only see Home and Login
      // This test should FAIL initially because MobileNav isn't rendered for unauth users
      expect(screen.queryByText('Recipes')).not.toBeInTheDocument()
      expect(screen.queryByText('Cookbooks')).not.toBeInTheDocument()
      expect(screen.queryByText('List')).not.toBeInTheDocument()
      expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    })
  })
})
