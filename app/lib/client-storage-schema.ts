const STORAGE_SCHEMA_VERSION_KEY = 'spoonjoy-storage-schema-version'
/** Where HX's colour scheme keeps the reader's choice; the storage migration keeps it. */
export const THEME_STORAGE_KEY = 'spoonjoy-theme'

// Bump this when client-side persisted state changes incompatibly.
export const APP_STORAGE_SCHEMA_VERSION = '2026-02-17.1'

const APP_LOCAL_STORAGE_PREFIXES = ['spoonjoy-'] as const
const APP_LOCAL_STORAGE_KEYS = ['ingredient-input-mode'] as const
const APP_SESSION_STORAGE_PREFIXES = ['spoonjoy-'] as const
const APP_SESSION_STORAGE_KEYS = [] as const

function removeMatchingKeys(
  storage: Storage,
  options: {
    exactKeys: readonly string[]
    prefixes: readonly string[]
    excludedKeys?: ReadonlySet<string>
  }
): void {
  const { exactKeys, prefixes, excludedKeys } = options

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (!key) continue
    if (excludedKeys?.has(key)) continue

    const matchesExact = exactKeys.includes(key)
    const matchesPrefix = prefixes.some((prefix) => key.startsWith(prefix))

    if (matchesExact || matchesPrefix) {
      storage.removeItem(key)
    }
  }
}

export function applyStorageSchemaMigration(): void {
  if (typeof window === 'undefined') return

  try {
    const currentVersion = window.localStorage.getItem(STORAGE_SCHEMA_VERSION_KEY)

    if (currentVersion === APP_STORAGE_SCHEMA_VERSION) {
      return
    }

    const theme = window.localStorage.getItem(THEME_STORAGE_KEY)

    removeMatchingKeys(window.localStorage, {
      exactKeys: APP_LOCAL_STORAGE_KEYS,
      prefixes: APP_LOCAL_STORAGE_PREFIXES,
      excludedKeys: new Set([THEME_STORAGE_KEY, STORAGE_SCHEMA_VERSION_KEY]),
    })

    removeMatchingKeys(window.sessionStorage, {
      exactKeys: APP_SESSION_STORAGE_KEYS,
      prefixes: APP_SESSION_STORAGE_PREFIXES,
    })

    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }

    window.localStorage.setItem(STORAGE_SCHEMA_VERSION_KEY, APP_STORAGE_SCHEMA_VERSION)
  } catch {
    // Ignore storage access errors (private mode, quota, security settings).
  }
}

export const __internal__ = {
  STORAGE_SCHEMA_VERSION_KEY,
  THEME_STORAGE_KEY,
}
