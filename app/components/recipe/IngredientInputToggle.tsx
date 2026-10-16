import { useCallback, useEffect, useState } from 'react'
import { Switch } from '~/components/ouro/switch/switch'

export type IngredientInputMode = 'ai' | 'manual'

const DEFAULT_STORAGE_KEY = 'ingredient-input-mode'

export interface IngredientInputToggleProps {
  /** Callback when mode changes */
  onChange: (mode: IngredientInputMode) => void
  /** Initial mode when uncontrolled. Ignored if `mode` is set. */
  defaultMode?: IngredientInputMode
  /** Controlled mode. When set, component is fully controlled. */
  mode?: IngredientInputMode
  /** Disables the toggle */
  disabled?: boolean
  /** Custom localStorage key for persistence */
  storageKey?: string
}

/**
 * Reads mode from localStorage, returning null on error or invalid value
 */
function readStoredMode(key: string): IngredientInputMode | null {
  try {
    const stored = localStorage.getItem(key)
    if (stored === 'ai' || stored === 'manual') {
      return stored
    }
    return null
  } catch {
    return null
  }
}

/**
 * Writes mode to localStorage, silently failing on error
 */
function writeStoredMode(key: string, mode: IngredientInputMode): void {
  try {
    localStorage.setItem(key, mode)
  } catch {
    // Silently ignore localStorage errors
  }
}

/**
 * A toggle switch for switching between AI-parsed and manual ingredient input modes.
 *
 * Features:
 * - Persists preference to localStorage automatically (uncontrolled mode)
 * - Supports both controlled (`mode` prop) and uncontrolled (`defaultMode` prop) usage
 * - Calls onChange on mount with initial mode
 */
export function IngredientInputToggle({
  onChange,
  defaultMode = 'ai',
  mode: controlledMode,
  disabled = false,
  storageKey = DEFAULT_STORAGE_KEY,
}: IngredientInputToggleProps) {
  const isControlled = controlledMode !== undefined

  // Determine initial mode for uncontrolled component
  const getInitialMode = useCallback((): IngredientInputMode => {
    if (isControlled) {
      return controlledMode
    }
    // Check localStorage first, fall back to defaultMode
    return readStoredMode(storageKey) ?? defaultMode
  }, [isControlled, controlledMode, storageKey, defaultMode])

  const [internalMode, setInternalMode] = useState<IngredientInputMode>(getInitialMode)

  // Effective mode is either controlled or internal
  const effectiveMode = isControlled ? controlledMode : internalMode

  // Call onChange on mount with initial mode
  useEffect(() => {
    onChange(effectiveMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount

  // Handle toggle change
  const handleChange = useCallback(
    (checked: boolean) => {
      const newMode: IngredientInputMode = checked ? 'ai' : 'manual'

      if (!isControlled) {
        setInternalMode(newMode)
        writeStoredMode(storageKey, newMode)
      }

      onChange(newMode)
    },
    [isControlled, onChange, storageKey]
  )

  return (
    <Switch
      label="AI Parse"
      description="Use AI to parse ingredients from text"
      checked={effectiveMode === 'ai'}
      onCheckedChange={handleChange}
      disabled={disabled}
    />
  )
}
