import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { COOK_SYNC_STATUS_TEXT, CookSyncStatusLine } from '~/components/recipe/CookSyncStatusLine'
import type { CookSyncStatus } from '~/lib/cook-session-sync'

describe('CookSyncStatusLine', () => {
  it.each(Object.entries(COOK_SYNC_STATUS_TEXT) as Array<[CookSyncStatus, string]>)('shows the %s status', (status, text) => {
    render(<CookSyncStatusLine status={status} />)
    expect(screen.getByTestId('cook-sync-status')).toHaveTextContent(text)
    expect(screen.getByTestId('cook-sync-status')).toHaveAttribute('data-status', status)
  })

  it('announces only losing and regaining the sync, not every change', () => {
    const { rerender } = render(<CookSyncStatusLine status="syncing" />)
    const announcement = screen.getByRole('status')
    expect(announcement).toHaveTextContent('')

    rerender(<CookSyncStatusLine status="synced" />)
    rerender(<CookSyncStatusLine status="syncing" />)
    expect(announcement).toHaveTextContent('')

    rerender(<CookSyncStatusLine status="offline" />)
    expect(announcement).toHaveTextContent('Progress saved on this device')
    rerender(<CookSyncStatusLine status="syncing" />)
    expect(announcement).toHaveTextContent('Progress saved on this device')
    rerender(<CookSyncStatusLine status="synced" />)
    expect(announcement).toHaveTextContent('Progress synced')
    rerender(<CookSyncStatusLine status="syncing" />)
    rerender(<CookSyncStatusLine status="synced" />)
    expect(announcement).toHaveTextContent('Progress synced')

    rerender(<CookSyncStatusLine status="account_changed" />)
    expect(announcement).toHaveTextContent('You signed in as someone else in another tab. Reload to keep cooking.')
  })

  it('offers a reload only when another account owns the session', () => {
    const onReload = vi.fn()
    const { rerender } = render(<CookSyncStatusLine status="stopped" onReload={onReload} />)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    rerender(<CookSyncStatusLine status="account_changed" onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reloads the page by default', () => {
    const reload = vi.fn()
    const location = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    render(<CookSyncStatusLine status="account_changed" />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    location.mockRestore()
  })
})
