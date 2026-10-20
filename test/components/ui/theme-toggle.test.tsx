import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ThemeToggle } from '~/components/theme-toggle'
import {
  THEME_SWITCH_DURATION_MS,
  THEME_SWITCHING_ATTRIBUTE,
  ThemeProvider,
} from '~/components/theme-provider'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock matchMedia for system theme detection
const matchMediaMock = vi.fn((query: string) => ({
  matches: false, // System prefers light by default in tests
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', { value: matchMediaMock })

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorageMock.clear()
    document.documentElement.classList.remove('light', 'dark')
    vi.clearAllMocks()
  })

  it('opens the colour-fade window on <html> for the switch it triggers, then closes it', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    const button = await screen.findByRole('button', { name: 'Switch theme to dark mode' })

    vi.useFakeTimers()
    try {
      fireEvent.click(button)
      expect(document.documentElement).toHaveAttribute(THEME_SWITCHING_ATTRIBUTE)
      expect(document.documentElement.classList.contains('dark')).toBe(true)

      act(() => {
        vi.advanceTimersByTime(THEME_SWITCH_DURATION_MS)
      })
      expect(document.documentElement).not.toHaveAttribute(THEME_SWITCHING_ATTRIBUTE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a button', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  it('has accessible label', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    await waitFor(() => {
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label')
      expect(button.getAttribute('aria-label')).toContain('theme')
    })
  })

  it('toggles between light and dark while defaulting from system preference', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    const button = screen.getByRole('button')

    // Initial state resolves from system preference.
    expect(button).toHaveAttribute('aria-label', 'Switch theme to dark mode')

    // Click 1: light -> dark
    fireEvent.click(button)
    await waitFor(() => {
      expect(button.getAttribute('aria-label')).toContain('light')
    })

    // Click 2: dark -> light
    fireEvent.click(button)
    await waitFor(() => {
      expect(button.getAttribute('aria-label')).toContain('dark')
    })
  })

  it('saves preference to localStorage when cycling', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    const button = screen.getByRole('button')

    // Click to set dark from system-resolved light.
    fireEvent.click(button)
    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith('spoonjoy-theme', 'dark')
    })
  })
})
