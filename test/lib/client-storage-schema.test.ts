import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_STORAGE_SCHEMA_VERSION,
  __internal__,
  applyStorageSchemaMigration,
} from '~/lib/client-storage-schema'

describe('client storage schema migration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('clears app-scoped local/session storage on schema change and preserves theme', () => {
    window.localStorage.setItem('spoonjoy-theme', 'dark')
    window.localStorage.setItem('spoonjoy-nav-state', 'stale')
    window.localStorage.setItem('ingredient-input-mode', 'manual')
    window.localStorage.setItem('unrelated-key', 'keep')

    window.sessionStorage.setItem('spoonjoy-auth-flow', 'stale')
    window.sessionStorage.setItem('session-unrelated', 'keep')

    applyStorageSchemaMigration()

    expect(window.localStorage.getItem('spoonjoy-theme')).toBe('dark')
    expect(window.localStorage.getItem('spoonjoy-nav-state')).toBeNull()
    expect(window.localStorage.getItem('ingredient-input-mode')).toBeNull()
    expect(window.localStorage.getItem('unrelated-key')).toBe('keep')

    expect(window.sessionStorage.getItem('spoonjoy-auth-flow')).toBeNull()
    expect(window.sessionStorage.getItem('session-unrelated')).toBe('keep')

    expect(window.localStorage.getItem(__internal__.STORAGE_SCHEMA_VERSION_KEY)).toBe(
      APP_STORAGE_SCHEMA_VERSION
    )
  })

  it('does nothing when current schema version already matches', () => {
    window.localStorage.setItem('spoonjoy-theme', 'light')
    window.localStorage.setItem('spoonjoy-nav-state', 'keep')
    window.localStorage.setItem(__internal__.STORAGE_SCHEMA_VERSION_KEY, APP_STORAGE_SCHEMA_VERSION)

    applyStorageSchemaMigration()

    expect(window.localStorage.getItem('spoonjoy-theme')).toBe('light')
    expect(window.localStorage.getItem('spoonjoy-nav-state')).toBe('keep')
  })

  it('returns safely when window is unavailable', () => {
    vi.stubGlobal('window', undefined)

    expect(() => applyStorageSchemaMigration()).not.toThrow()
  })

  it('skips null keys and invalid preserved theme values during cleanup', () => {
    const removedKeys: string[] = []
    const localStorage = {
      length: 3,
      getItem: vi.fn((key: string) => (key === 'spoonjoy-theme' ? 'sepia' : null)),
      key: vi.fn((index: number) => [null, 'spoonjoy-stale', 'spoonjoy-theme'][index] ?? null),
      removeItem: vi.fn((key: string) => removedKeys.push(key)),
      setItem: vi.fn(),
    } as unknown as Storage
    const sessionStorage = {
      length: 0,
      getItem: vi.fn(),
      key: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    } as unknown as Storage

    vi.stubGlobal('window', { localStorage, sessionStorage })

    applyStorageSchemaMigration()

    expect(removedKeys).toEqual(['spoonjoy-stale'])
    expect(localStorage.setItem).toHaveBeenCalledOnce()
    expect(localStorage.setItem).toHaveBeenCalledWith(
      __internal__.STORAGE_SCHEMA_VERSION_KEY,
      APP_STORAGE_SCHEMA_VERSION
    )
  })
})
