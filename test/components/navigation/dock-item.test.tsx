import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DockItem } from '~/components/navigation/dock-item'
import { Home, BookOpen, ShoppingCart, User } from 'lucide-react'

// Wrapper component for routing context
const RouterWrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
)

describe('DockItem', () => {
  const defaultProps = {
    icon: Home,
    label: 'Home',
    href: '/',
  }

  describe('rendering', () => {
    it('renders icon and label', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} />
        </RouterWrapper>
      )
      
      // Should render the label text
      expect(screen.getByText('Home')).toBeInTheDocument()
      
      // Should render an icon (SVG element from Lucide)
      const link = screen.getByRole('link')
      const svg = link.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders as a link with correct href', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} href="/recipes" label="Recipes" />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link', { name: /recipes/i })
      expect(link).toHaveAttribute('href', '/recipes')
    })

    it('applies custom className', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} className="custom-class" />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      expect(link.className).toContain('custom-class')
    })

    it('applies icon and place label class overrides', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="place" iconClassName="icon-custom" labelClassName="label-custom" />
        </RouterWrapper>
      )

      const link = screen.getByRole('link')
      expect(link.querySelector('svg')?.getAttribute('class')).toContain('icon-custom')
      expect(screen.getByText('Home').className).toContain('label-custom')
    })
  })

  describe('touch target', () => {
    it('has minimum touch target of 44px', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      expect(link).toHaveClass('min-h-[50px]')
      expect(link).toHaveClass('w-[50px]')
    })

    it('touch target is clickable', () => {
      const onClick = vi.fn()
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} onClick={onClick} />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      fireEvent.click(link)
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('active state', () => {
    it('visually distinguishes active state', () => {
      const { rerender } = render(
        <RouterWrapper>
          <DockItem {...defaultProps} active={false} />
        </RouterWrapper>
      )
      
      const inactiveLink = screen.getByRole('link')
      const inactiveClass = inactiveLink.className

      rerender(
        <RouterWrapper>
          <DockItem {...defaultProps} active={true} />
        </RouterWrapper>
      )
      
      const activeLink = screen.getByRole('link')
      const activeClass = activeLink.className
      
      // Active and inactive states should have different classes
      expect(activeClass).not.toBe(inactiveClass)
    })

    it('active place label uses on-photo text', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="place" active={true} />
        </RouterWrapper>
      )
      
      const label = screen.getByText('Home')
      expect(label.className).toContain('text-[var(--sj-on-photo)]')
    })

    it('inactive tool icon has reduced contrast', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} active={false} />
        </RouterWrapper>
      )
      
      const icon = screen.getByRole('link').querySelector('svg')
      expect(icon?.getAttribute('class')).toContain('text-[var(--sj-on-photo-soft)]')
    })

    it('uses tomato styling for dangerous primary actions', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="primary" tone="danger" label="Delete" href="/danger" />
        </RouterWrapper>
      )

      expect(screen.getByRole('link', { name: /delete/i }).className).toContain('bg-[var(--sj-tomato)]')
    })

    it('uses an on-photo brass fill for the default primary so it stays visible on the dark dock', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="primary" label="Create" href="/recipes/new" />
        </RouterWrapper>
      )

      const link = screen.getByRole('link', { name: /create/i })
      // --sj-brass reads on the always-dark dock in both themes; --sj-action is
      // dark-on-dark in light mode and must not be used here.
      expect(link.className).toContain('bg-[var(--sj-brass)]')
      expect(link.className).not.toContain('bg-[var(--sj-action)]')
    })
  })

  describe('press state', () => {
    it('has press feedback animation classes', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} />
        </RouterWrapper>
      )
      
      const link = screen.getByRole('link')
      // Should have transition and active:scale classes for press feedback
      expect(link.className).toMatch(/active:scale|transition/)
    })
  })

  describe('liquid glass label styling', () => {
    it('has small place label typography', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="place" />
        </RouterWrapper>
      )
      
      const label = screen.getByText('Home')
      expect(label.className).toContain('text-sm')
    })

    it('uses tight, readable place label spacing', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} variant="place" sublabel="home" />
        </RouterWrapper>
      )
      
      const sublabel = screen.getByText('home')
      expect(sublabel.className).toContain('tracking-[0.12em]')
    })
  })

  describe('different icons', () => {
    it('renders with BookOpen icon', () => {
      render(
        <RouterWrapper>
          <DockItem icon={BookOpen} label="Recipes" href="/recipes" />
        </RouterWrapper>
      )
      
      expect(screen.getByText('Recipes')).toBeInTheDocument()
      expect(screen.getByRole('link').querySelector('svg')).toBeInTheDocument()
    })

    it('renders with ShoppingCart icon', () => {
      render(
        <RouterWrapper>
          <DockItem icon={ShoppingCart} label="List" href="/shopping-list" />
        </RouterWrapper>
      )
      
      expect(screen.getByText('List')).toBeInTheDocument()
      expect(screen.getByRole('link').querySelector('svg')).toBeInTheDocument()
    })

    it('renders with User icon', () => {
      render(
        <RouterWrapper>
          <DockItem icon={User} label="Profile" href="/account/settings" />
        </RouterWrapper>
      )
      
      expect(screen.getByText('Profile')).toBeInTheDocument()
      expect(screen.getByRole('link').querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('link has accessible name', () => {
      render(
        <RouterWrapper>
          <DockItem {...defaultProps} />
        </RouterWrapper>
      )
      
      // Link should be findable by its label text
      expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument()
    })
  })
})
