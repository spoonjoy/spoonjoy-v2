import React, { createContext, useContext, useEffect, useRef, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'spoonjoy-theme'

/**
 * Colours fade only while <html> carries this attribute (see the theme-switching
 * rules in app/styles/tailwind.css). Outside that window colour changes are
 * instant, so state-coloured controls never sit at a low-contrast mid-fade colour.
 */
export const THEME_SWITCHING_ATTRIBUTE = 'data-theme-switching'
/** Long enough for the stylesheet's 0.2s theme fade to finish. */
export const THEME_SWITCH_DURATION_MS = 250

function getSystemTheme(): 'light' | 'dark' {
  /* istanbul ignore next -- @preserve SSR safety: window is undefined during server-side rendering */
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme(): Theme {
  /* istanbul ignore next -- @preserve SSR safety: window is undefined during server-side rendering */
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [mounted, setMounted] = useState(false)
  const switchingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Open the fade window just before the theme class flips. Reduced-motion
  // users get an instant switch.
  const markThemeSwitching = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.setAttribute(THEME_SWITCHING_ATTRIBUTE, '')
    if (switchingTimer.current) clearTimeout(switchingTimer.current)
    switchingTimer.current = setTimeout(() => {
      switchingTimer.current = null
      root.removeAttribute(THEME_SWITCHING_ATTRIBUTE)
    }, THEME_SWITCH_DURATION_MS)
  }

  useEffect(() => {
    return () => {
      if (switchingTimer.current) {
        clearTimeout(switchingTimer.current)
        switchingTimer.current = null
        document.documentElement.removeAttribute(THEME_SWITCHING_ATTRIBUTE)
      }
    }
  }, [])

  // Initialize theme from localStorage after mount
  useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    setMounted(true)
  }, [])

  // Update resolved theme and apply class to document
  useEffect(() => {
    if (!mounted) return

    const resolved = theme === 'system' ? getSystemTheme() : theme
    setResolvedTheme(resolved)

    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
  }, [theme, mounted])

  // Listen for system theme changes
  useEffect(() => {
    if (!mounted) return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        markThemeSwitching()
        const resolved = getSystemTheme()
        setResolvedTheme(resolved)
        const root = document.documentElement
        root.classList.remove('light', 'dark')
        root.classList.add(resolved)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme, mounted])

  const setTheme = (newTheme: Theme) => {
    markThemeSwitching()
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
  }

  // Prevent flash of wrong theme by not rendering until mounted
  if (!mounted) {
    return (
      <ThemeContext.Provider value={{ theme: 'system', resolvedTheme: 'light', setTheme }}>
        {children}
      </ThemeContext.Provider>
    )
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
