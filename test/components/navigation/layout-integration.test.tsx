import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { SpoonDock } from '~/components/navigation/spoon-dock'
import { DockItem } from '~/components/navigation/dock-item'
import { DockCenter } from '~/components/navigation/dock-center'
import { Plus, ShoppingCart } from 'lucide-react'

// Mock useLocation for route-aware testing
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useLocation: vi.fn(),
  }
})

const mockedUseLocation = vi.mocked(useLocation)

// v3 3-slot navigation items
const navItems = [
  { icon: Plus, label: 'New', href: '/recipes/new', position: 'left' },
  // Center is the logo
  { icon: ShoppingCart, label: 'List', href: '/shopping-list', position: 'right' },
] as const

/**
 * Assembled SpoonDock v3 for testing — 3-slot layout
 */
function AssembledSpoonDock({ currentPath = '/' }: { currentPath?: string }) {
  const getActiveHref = (path: string): string | null => {
    for (const item of navItems) {
      if (path.startsWith(item.href)) return item.href
    }
    return null
  }

  const activeHref = getActiveHref(currentPath)
  const leftItem = navItems.find(i => i.position === 'left')!
  const rightItem = navItems.find(i => i.position === 'right')!

  return (
    <SpoonDock>
      {/* Left slot */}
      <div className="flex items-center justify-center">
        <DockItem
          icon={leftItem.icon}
          label={leftItem.label}
          href={leftItem.href}
          active={activeHref === leftItem.href}
        />
      </div>

      {/* Center Spoonjoy mark */}
      <DockCenter href="/" />

      {/* Right slot */}
      <div className="flex items-center justify-center">
        <DockItem
          icon={rightItem.icon}
          label={rightItem.label}
          href={rightItem.href}
          active={activeHref === rightItem.href}
        />
      </div>
    </SpoonDock>
  )
}

describe('SpoonDock v3 Layout Integration', () => {
  beforeEach(() => {
    mockedUseLocation.mockReturnValue({ pathname: '/', search: '', hash: '', state: null, key: 'default' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('3-slot dock rendering', () => {
    it('renders SpoonDock with 3 slots: New, Logo, List', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      expect(screen.getByRole('navigation')).toBeInTheDocument()
      expect(screen.getByText('New')).toBeInTheDocument()
      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
      expect(screen.getByText('List')).toBeInTheDocument()
    })

    it('does NOT render old 5-slot items', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      expect(screen.queryByText('Recipes')).not.toBeInTheDocument()
      expect(screen.queryByText('Cookbooks')).not.toBeInTheDocument()
      expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    })

    it('renders DockCenter with home link', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      const homeLink = screen.getByRole('link', { name: /kitchen/i })
      expect(homeLink).toHaveAttribute('href', '/')
    })

    it('renders nav items as links with correct hrefs', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      expect(screen.getByRole('link', { name: /new/i })).toHaveAttribute('href', '/recipes/new')
      expect(screen.getByRole('link', { name: /list/i })).toHaveAttribute('href', '/shopping-list')
    })
  })

  describe('route-aware active state', () => {
    it('marks New as active on /recipes/new', () => {
      render(
        <MemoryRouter initialEntries={['/recipes/new']}>
          <AssembledSpoonDock currentPath="/recipes/new" />
        </MemoryRouter>
      )

      const newItem = screen.getByRole('link', { name: /new/i })
      expect(newItem.className).toContain('dock-item-active')
    })

    it('marks List as active on /shopping-list', () => {
      render(
        <MemoryRouter initialEntries={['/shopping-list']}>
          <AssembledSpoonDock currentPath="/shopping-list" />
        </MemoryRouter>
      )

      const listItem = screen.getByRole('link', { name: /list/i })
      expect(listItem.className).toContain('dock-item-active')
    })

    it('no item is active on home (/)', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <AssembledSpoonDock currentPath="/" />
        </MemoryRouter>
      )

      const links = screen.getAllByRole('link')
      const activeLinks = links.filter(link => link.className.includes('dock-item-active'))
      expect(activeLinks).toHaveLength(0)
    })
  })

  describe('mobile cookbook grid layout', () => {
    it('dock uses place / primary / tools columns', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('grid')
      expect(nav).toHaveClass('grid-cols-[minmax(3rem,0.9fr)_auto_auto]')
    })
  })

  describe('responsive behavior', () => {
    it('dock has lg:hidden class for desktop hiding', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('lg:hidden')
    })
  })

  describe('bottom padding compatibility', () => {
    it('dock has z-50 to float above content', () => {
      render(
        <MemoryRouter>
          <AssembledSpoonDock />
        </MemoryRouter>
      )

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('z-50')
    })
  })
})
