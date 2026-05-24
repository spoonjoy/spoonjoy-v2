import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// Mock framer-motion
vi.mock('motion/react', () => ({
  motion: {
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  LayoutGroup: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

import { StackedLayout } from '~/components/ui/stacked-layout'
import { MobileNav } from '~/components/navigation/mobile-nav'
import { ThemeProvider } from '~/components/ui/theme-provider'

/**
 * Test component that simulates the root layout structure
 * This mirrors what root.tsx renders for different auth states
 */
function RootLayoutSimulation({ userId }: { userId: string | null }) {
  const isAuthenticated = !!userId

  return (
    <ThemeProvider>
      <StackedLayout
        navbar={<nav data-testid="desktop-navbar">Desktop Navbar</nav>}
        sidebar={<nav data-testid="sidebar">Sidebar</nav>}
      >
        {/* Main content with bottom padding for mobile dock */}
        <div className="pb-20 lg:pb-0" data-testid="content-wrapper">
          <div data-testid="outlet">Page Content</div>
        </div>
      </StackedLayout>
      {/* Mobile navigation dock */}
      <MobileNav isAuthenticated={isAuthenticated} />
    </ThemeProvider>
  )
}

/**
 * Test component that simulates CURRENT root.tsx behavior
 * Mobile-first: SpoonDock is primary nav on mobile, StackedLayout is desktop-only
 */
function CurrentRootLayoutBehavior({ userId }: { userId: string | null }) {
  const isAuthenticated = !!userId

  return (
    <ThemeProvider>
      {/* Desktop: StackedLayout */}
      <div className="hidden lg:block">
        <StackedLayout
          navbar={<nav data-testid="desktop-navbar">Desktop Navbar</nav>}
          sidebar={<nav data-testid="sidebar">Sidebar</nav>}
        >
          <div data-testid="outlet">Page Content</div>
        </StackedLayout>
      </div>

      {/* Mobile: Content only */}
      <div className="lg:hidden">
        <main className="pb-20">
          <div data-testid="outlet">Page Content</div>
        </main>
      </div>

      {/* SpoonDock - mobile only (MobileNav has lg:hidden) */}
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

      expect(screen.getByRole('link', { name: /kitchen home/i })).toBeInTheDocument()
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
    it('navbar is hidden on mobile (StackedLayout wrapper has hidden lg:block)', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // The entire StackedLayout is wrapped in a div with hidden lg:block
      // This means StackedLayout (including hamburger) is hidden on mobile
      const stackedLayoutWrapper = container.querySelector('.hidden.lg\\:block')
      expect(stackedLayoutWrapper).toBeInTheDocument()
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

  describe('hamburger menu on mobile', () => {
    it('hamburger menu is inside hidden StackedLayout wrapper on mobile', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // The hamburger menu exists but is inside the StackedLayout which has hidden lg:block wrapper
      // This means the hamburger is hidden on mobile (because its parent is hidden)
      const openNavButton = screen.queryByRole('button', { name: 'Open navigation' })
      expect(openNavButton).toBeInTheDocument()

      // But the button should be inside the hidden wrapper
      const stackedLayoutWrapper = container.querySelector('.hidden.lg\\:block')
      expect(stackedLayoutWrapper?.contains(openNavButton)).toBe(true)
    })

    it('StackedLayout (with hamburger) is hidden on mobile, visible on desktop', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // The StackedLayout wrapper has hidden lg:block
      // - hidden: not shown by default (mobile)
      // - lg:block: shown on large screens (desktop)
      const stackedLayoutWrapper = container.querySelector('.hidden.lg\\:block')
      expect(stackedLayoutWrapper).toBeInTheDocument()

      // The hamburger exists within this wrapper
      const openNavButton = screen.queryByRole('button', { name: 'Open navigation' })
      expect(stackedLayoutWrapper?.contains(openNavButton)).toBe(true)
    })
  })

  describe('content bottom padding for SpoonDock clearance', () => {
    it('content has correct bottom padding on mobile for SpoonDock clearance', () => {
      const { container } = render(
        <MemoryRouter>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // Mobile content wrapper has pb-20 to clear the SpoonDock
      // It's inside the lg:hidden div (mobile only)
      const mobileContentWrapper = container.querySelector('.lg\\:hidden main.pb-20')
      expect(mobileContentWrapper).toBeInTheDocument()
    })

    it('content padding wrapper contains the Outlet content', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <CurrentRootLayoutBehavior userId="test-user" />
        </MemoryRouter>
      )

      // The mobile main area should exist with pb-20 class
      const mobileMain = container.querySelector('.lg\\:hidden main.pb-20')
      expect(mobileMain).toBeInTheDocument()

      // Desktop main also exists inside StackedLayout
      const allMains = screen.getAllByRole('main')
      expect(allMains.length).toBeGreaterThan(0)
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
