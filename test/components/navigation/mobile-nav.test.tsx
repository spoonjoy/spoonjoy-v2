import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { MobileNav } from '~/components/navigation/mobile-nav'
import { DockContextProvider, DockContext, type DockAction } from '~/components/navigation'
import { ArrowLeft, Edit, Share2, Trash2 } from 'lucide-react'

describe('MobileNav unauthenticated variant', () => {
  it('renders unauthenticated variant when isAuthenticated=false', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('shows Home and Login nav items for unauthenticated users', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Login')).toBeInTheDocument()
    // Should NOT show authenticated items
    expect(screen.queryByText('New')).not.toBeInTheDocument()
    expect(screen.queryByText('List')).not.toBeInTheDocument()
  })

  it('shows SJ logo center', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    expect(screen.getByTestId('dock-center')).toBeInTheDocument()
  })

  it('has lg:hidden class for mobile-only', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('lg:hidden')
  })

  it('marks Home as active on home route (/)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    const homeItem = screen.getByText('Home').closest('a')
    expect(homeItem?.className).toContain('dock-item-active')
  })

  it('does not mark Home as active on other routes', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    const homeItem = screen.getByText('Home').closest('a')
    expect(homeItem?.className).not.toContain('dock-item-active')
  })

  it('marks Login as active on /login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>
    )

    const loginItem = screen.getByRole('link', { name: /login/i })
    expect(loginItem.className).toContain('dock-item-active')
  })
})

describe('MobileNav', () => {
  describe('v3 3-slot authenticated variant', () => {
    it('renders SpoonDock navigation', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('renders 3-slot structure: New, Logo, List', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      expect(screen.getByText('New')).toBeInTheDocument()
      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
      expect(screen.getByText('List')).toBeInTheDocument()
    })

    it('does NOT render old 5-slot items (Recipes, Cookbooks, Profile)', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      expect(screen.queryByText('Recipes')).not.toBeInTheDocument()
      expect(screen.queryByText('Cookbooks')).not.toBeInTheDocument()
      expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    })

    it('New links to /recipes/new', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      const newLink = screen.getByRole('link', { name: /new/i })
      expect(newLink).toHaveAttribute('href', '/recipes/new')
    })

    it('List links to /shopping-list', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      const listLink = screen.getByRole('link', { name: /list/i })
      expect(listLink).toHaveAttribute('href', '/shopping-list')
    })

    it('center logo links to / (Kitchen home)', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      const centerLink = screen.getByRole('link', { name: /kitchen/i })
      expect(centerLink).toHaveAttribute('href', '/')
    })
  })

  describe('route-aware active state', () => {
    it('marks New as active on /recipes/new', () => {
      render(
        <MemoryRouter initialEntries={['/recipes/new']}>
          <MobileNav />
        </MemoryRouter>
      )

      const newItem = screen.getByRole('link', { name: /new/i })
      expect(newItem.className).toContain('dock-item-active')
    })

    it('marks List as active on /shopping-list', () => {
      render(
        <MemoryRouter initialEntries={['/shopping-list']}>
          <MobileNav />
        </MemoryRouter>
      )

      const listItem = screen.getByRole('link', { name: /list/i })
      expect(listItem.className).toContain('dock-item-active')
    })

    it('has no active item on home (/)', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNav />
        </MemoryRouter>
      )

      const newItem = screen.getByRole('link', { name: /new/i })
      expect(newItem.className).not.toContain('dock-item-active')
    })

    it('does not mark New active for other /recipes nested routes', () => {
      render(
        <MemoryRouter initialEntries={['/recipes/123/edit']}>
          <MobileNav />
        </MemoryRouter>
      )

      const newItem = screen.getByRole('link', { name: /new/i })
      expect(newItem.className).not.toContain('dock-item-active')
    })
  })

  describe('contextual actions via useDockContext', () => {
    it('renders default nav items when context has no actions', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <DockContextProvider>
            <MobileNav />
          </DockContextProvider>
        </MemoryRouter>
      )

      expect(screen.getByText('New')).toBeInTheDocument()
      expect(screen.getByText('List')).toBeInTheDocument()
    })

    it('renders contextual actions when context has actions (isContextual=true)', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      expect(screen.getByText('Back')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.queryByText('New')).not.toBeInTheDocument()
      expect(screen.queryByText('List')).not.toBeInTheDocument()
      expect(screen.getByRole('navigation')).toHaveClass('grid-cols-[minmax(96px,1fr)_52px_minmax(96px,1fr)]')
    })

    it('renders left-position actions on left side of dock', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'share', icon: Share2, label: 'Share', onAction: () => {}, position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const nav = screen.getByRole('navigation')
      const center = screen.getByTestId('dock-center')
      const backElement = screen.getByText('Back').closest('a, button')
      const shareElement = screen.getByText('Share').closest('a, button')

      expect(backElement).toBeInTheDocument()
      expect(shareElement).toBeInTheDocument()

      const allElements = nav.querySelectorAll('a, button, [data-testid="dock-center"]')
      const elementsArray = Array.from(allElements)
      const centerIndex = elementsArray.findIndex(el => el.getAttribute('data-testid') === 'dock-center')
      const backIndex = elementsArray.indexOf(backElement as Element)
      const shareIndex = elementsArray.indexOf(shareElement as Element)

      expect(backIndex).toBeLessThan(centerIndex)
      expect(shareIndex).toBeLessThan(centerIndex)
    })

    it('renders right-position actions on right side of dock', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
        { id: 'delete', icon: Trash2, label: 'Delete', onAction: () => {}, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const nav = screen.getByRole('navigation')
      const editElement = screen.getByText('Edit').closest('a, button')
      const deleteElement = screen.getByText('Delete').closest('a, button')

      const allElements = nav.querySelectorAll('a, button, [data-testid="dock-center"]')
      const elementsArray = Array.from(allElements)
      const centerIndex = elementsArray.findIndex(el => el.getAttribute('data-testid') === 'dock-center')
      const editIndex = elementsArray.indexOf(editElement as Element)
      const deleteIndex = elementsArray.indexOf(deleteElement as Element)

      expect(editIndex).toBeGreaterThan(centerIndex)
      expect(deleteIndex).toBeGreaterThan(centerIndex)
    })

    it('renders center logo regardless of context state', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      const { unmount } = render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )
      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
      unmount()

      render(
        <MemoryRouter initialEntries={['/']}>
          <DockContext.Provider value={{ actions: null, setActions: () => {}, isContextual: false }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )
      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
    })

    it('calls onAction function when action is clicked', async () => {
      const user = userEvent.setup()
      const handleEdit = vi.fn()
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: handleEdit, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const editButton = screen.getByText('Edit').closest('a, button')!
      await user.click(editButton)
      expect(handleEdit).toHaveBeenCalledTimes(1)
    })

    it('navigates to href when onAction is a string', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const backLink = screen.getByText('Back').closest('a')
      expect(backLink).toHaveAttribute('href', '/recipes')
    })

    it('falls back to default nav when context is cleared', () => {
      const setActions = vi.fn()
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      const { rerender } = render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      expect(screen.getByText('Back')).toBeInTheDocument()
      expect(screen.queryByText('New')).not.toBeInTheDocument()

      rerender(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions: null, setActions, isContextual: false }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      expect(screen.queryByText('Back')).not.toBeInTheDocument()
      expect(screen.getByText('New')).toBeInTheDocument()
      expect(screen.getByText('List')).toBeInTheDocument()
      expect(screen.getByRole('navigation')).toHaveClass('grid-cols-[72px_1fr_72px]')
    })

    it('renders left item with function onAction as button', async () => {
      const user = userEvent.setup()
      const handleShare = vi.fn()
      const actions: DockAction[] = [
        { id: 'share', icon: Share2, label: 'Share', onAction: handleShare, position: 'left' },
        { id: 'edit', icon: Edit, label: 'Edit', onAction: () => {}, position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const shareButton = screen.getByRole('button', { name: /share/i })
      expect(shareButton).toBeInTheDocument()

      await user.click(shareButton)
      expect(handleShare).toHaveBeenCalledTimes(1)
    })

    it('renders right item with string onAction as navigation link', () => {
      const actions: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
        { id: 'details', icon: Edit, label: 'Details', onAction: '/recipes/123/details', position: 'right' },
      ]

      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      const detailsLink = screen.getByText('Details').closest('a')
      expect(detailsLink).toBeInTheDocument()
      expect(detailsLink).toHaveAttribute('href', '/recipes/123/details')
    })

    it('handles null actions when isContextual is true', () => {
      render(
        <MemoryRouter initialEntries={['/recipes/123']}>
          <DockContext.Provider value={{ actions: null, setActions: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>
      )

      expect(screen.getByTestId('dock-center')).toBeInTheDocument()
      expect(screen.queryByText('New')).not.toBeInTheDocument()
      expect(screen.queryByText('Back')).not.toBeInTheDocument()
    })
  })
})
