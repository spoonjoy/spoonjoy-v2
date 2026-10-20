import { Moon, Sun } from 'lucide-react'
import { Button } from '~/components/button'
import { useTheme } from './theme-provider'

// TODO(ouro-hx: color-scheme-toggle): The light, dark and system control becomes HX's color scheme toggle once it ships.
/** One press switches between light and dark: an icon-only HX Button named for the theme it switches to. */
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <Button plain aria-label={`Switch theme to ${nextTheme} mode`} onClick={() => setTheme(nextTheme)}>
      {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
    </Button>
  )
}
