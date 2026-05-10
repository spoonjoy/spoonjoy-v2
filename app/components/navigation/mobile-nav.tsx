'use client'

import { useLocation } from 'react-router'
import { SpoonDock } from './spoon-dock'
import { DockItem } from './dock-item'
import { DockCenter } from './dock-center'
import { useDockContext, type DockAction } from './dock-context'
import { Plus, ShoppingCart, Home, User } from 'lucide-react'

/**
 * MobileNav - Mobile navigation dock (v3 — 3-slot IA)
 *
 * 3-slot structure:
 *   LEFT:   NEW (+) → /recipes/new
 *   CENTER: Logo → / (Kitchen home)
 *   RIGHT:  LIST (cart) → /shopping-list
 *
 * Supports L2 contextual actions via DockContext — when a page registers
 * contextual actions, those replace the L1 navigation items while the
 * center logo remains.
 *
 * @param isAuthenticated - When false, shows unauthenticated variant (Home, Logo, Login)
 */

// Navigation items for authenticated users (v3 — 3 slots)
const authenticatedNavItems = [
  { icon: Plus, label: 'New', href: '/recipes/new', position: 'left' },
  // Center is the logo
  { icon: ShoppingCart, label: 'List', href: '/shopping-list', position: 'right' },
] as const

// Navigation items for unauthenticated users
const unauthenticatedNavItems = [
  { icon: Home, label: 'Home', href: '/', position: 'left' },
  // Center is the logo
  { icon: User, label: 'Login', href: '/login', position: 'right' },
] as const

type NavItem = { icon: typeof Home; label: string; href: string; position: 'left' | 'right' }

/**
 * Determine which nav item is active based on current path
 */
function getActiveHref(pathname: string, navItems: readonly NavItem[]): string | null {
  for (const item of navItems) {
    if (item.href === '/') {
      if (pathname === '/') {
        return item.href
      }
    } else if (pathname.startsWith(item.href)) {
      return item.href
    }
  }
  return null
}

interface MobileNavProps {
  isAuthenticated?: boolean
}

function renderContextualItem(action: DockAction) {
  if (typeof action.onAction === 'string') {
    return (
      <DockItem
        key={action.id}
        icon={action.icon}
        label={action.label}
        iconClassName={action.iconClassName}
        labelClassName={action.labelClassName}
        href={action.onAction}
      />
    )
  }

  return (
    <DockItem
      key={action.id}
      icon={action.icon}
      label={action.label}
      iconClassName={action.iconClassName}
      labelClassName={action.labelClassName}
      onClick={action.onAction}
    />
  )
}

export function MobileNav({ isAuthenticated = true }: MobileNavProps) {
  const location = useLocation()
  const { actions, isContextual } = useDockContext()
  const defaultNavItems = isAuthenticated ? authenticatedNavItems : unauthenticatedNavItems
  const activeHref = getActiveHref(location.pathname, defaultNavItems)

  // When contextual, use actions from context; otherwise use default nav
  const leftItems = isContextual
    ? (actions ?? []).filter((a) => a.position === 'left')
    : defaultNavItems.filter((item) => item.position === 'left')
  const rightItems = isContextual
    ? (actions ?? []).filter((a) => a.position === 'right')
    : defaultNavItems.filter((item) => item.position === 'right')

  return (
    <SpoonDock layout={isContextual ? 'contextual' : 'default'}>
      {/* Left slot — fixed width via grid */}
      <div className={`flex items-center justify-center ${isContextual ? 'gap-1' : ''}`}>
        {leftItems.map((item) => {
          if (isContextual) {
            const action = item as DockAction
            return renderContextualItem(action)
          }
          const navItem = item as NavItem
          return (
            <DockItem
              key={navItem.href}
              icon={navItem.icon}
              label={navItem.label}
              href={navItem.href}
              active={activeHref === navItem.href}
            />
          )
        })}
      </div>

      {/* Center slot — logo, hero of the dock */}
      <DockCenter href="/" />

      {/* Right slot — fixed width via grid */}
      <div className={`flex items-center justify-center ${isContextual ? 'gap-1' : ''}`}>
        {rightItems.map((item) => {
          if (isContextual) {
            const action = item as DockAction
            return renderContextualItem(action)
          }
          const navItem = item as NavItem
          return (
            <DockItem
              key={navItem.href}
              icon={navItem.icon}
              label={navItem.label}
              href={navItem.href}
              active={activeHref === navItem.href}
            />
          )
        })}
      </div>
    </SpoonDock>
  )
}
