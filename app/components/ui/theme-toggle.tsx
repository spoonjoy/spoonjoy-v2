import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from './theme-provider'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  const cycleTheme = () => {
    if (theme === 'system') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('dark')
    } else {
      setTheme('system')
    }
  }

  return (
    <Headless.Button
      onClick={cycleTheme}
      className={clsx(
        'relative flex min-h-11 min-w-11 items-center justify-center rounded-full p-2',
        'text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)]',
        'hover:bg-[var(--sj-flour)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sj-brass)]',
        'transition-colors duration-200'
      )}
      aria-label={`Current theme: ${theme}. Click to cycle themes.`}
      title={`Theme: ${theme === 'system' ? `System (${resolvedTheme})` : theme}`}
    >
      {theme === 'system' ? (
        <Monitor className="h-5 w-5" />
      ) : theme === 'light' ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Headless.Button>
  )
}

// Dropdown version for more explicit control
export function ThemeDropdown() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  const themes = [
    { value: 'system' as const, label: 'System', icon: Monitor },
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
  ]

  return (
    <Headless.Menu as="div" className="relative">
      <Headless.MenuButton
        className={clsx(
          'flex min-h-11 min-w-11 items-center justify-center rounded-full p-2',
          'text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)]',
          'hover:bg-[var(--sj-flour)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sj-brass)]',
          'transition-colors duration-200'
        )}
        aria-label="Toggle theme"
      >
        {resolvedTheme === 'dark' ? (
          <Moon className="h-5 w-5" />
        ) : (
          <Sun className="h-5 w-5" />
        )}
      </Headless.MenuButton>

      <Headless.MenuItems
        className={clsx(
          'absolute right-0 z-50 mt-2 w-36 origin-top-right',
          'rounded-[var(--sj-radius-surface)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)]',
          'shadow-[var(--sj-shadow-soft)]',
          'focus:outline-none'
        )}
      >
        <div className="p-1">
          {themes.map(({ value, label, icon: Icon }) => (
            <Headless.MenuItem key={value}>
              {({ focus }) => (
                <button
                  onClick={() => setTheme(value)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-[var(--sj-radius-control)] px-3 py-2 text-sm',
                    focus && 'bg-[var(--sj-flour)]',
                    theme === value
                      ? 'text-[var(--sj-tomato)]'
                      : 'text-[var(--sj-ink-soft)]'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {value === 'system' && resolvedTheme && (
                    <span className="ml-auto text-[var(--sj-ink-soft)]" aria-hidden="true">
                      {resolvedTheme === 'dark' ? (
                        <Moon className="h-3 w-3" />
                      ) : (
                        <Sun className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </button>
              )}
            </Headless.MenuItem>
          ))}
        </div>
      </Headless.MenuItems>
    </Headless.Menu>
  )
}
