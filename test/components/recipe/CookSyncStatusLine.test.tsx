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

  it('offers a reload only when another account owns the session or the page is out of date', () => {
    const onReload = vi.fn()
    const { rerender } = render(<CookSyncStatusLine status="stopped" onReload={onReload} />)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    rerender(<CookSyncStatusLine status="signed_out" onReload={onReload} />)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    rerender(<CookSyncStatusLine status="account_changed" onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    rerender(<CookSyncStatusLine status="update_required" onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(2)
  })

  it('reloads the page by default', () => {
    const reload = vi.fn()
    const location = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    render(<CookSyncStatusLine status="account_changed" />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    location.mockRestore()
  })

  it('reserves room for every status, so a change of status never moves the page', () => {
    const { rerender } = render(<CookSyncStatusLine status="syncing" />)
    const reserves = () => screen.getAllByTestId('cook-sync-status-reserve')
    const statuses = Object.keys(COOK_SYNC_STATUS_TEXT) as CookSyncStatus[]

    expect(reserves()).toHaveLength(statuses.length)
    expect(reserves().map((reserve) => reserve.textContent)).toEqual(
      statuses.map((status) =>
        status === 'account_changed' || status === 'update_required'
          ? `${COOK_SYNC_STATUS_TEXT[status]}Reload`
          : COOK_SYNC_STATUS_TEXT[status]),
    )
    // The copies share the shown line's grid cell, take no part in the page's meaning, hold no controls,
    // and do not change with the status.
    const before = reserves().map((reserve) => reserve.outerHTML)
    reserves().forEach((reserve) => {
      expect(reserve).toHaveClass('invisible', '[grid-area:1/1]')
      expect(reserve).toHaveAttribute('aria-hidden', 'true')
      expect(reserve.querySelector('button, a, input, [tabindex]')).toBeNull()
    })
    expect(screen.getByTestId('cook-sync-status').parentElement).toHaveClass('[grid-area:1/1]')
    expect(screen.getByTestId('cook-sync-status-line')).toHaveClass('grid')

    rerender(<CookSyncStatusLine status="update_required" />)
    expect(reserves().map((reserve) => reserve.outerHTML)).toEqual(before)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('keeps Reload on the message line, as tall as the text, with a 44px tap area', () => {
    render(<CookSyncStatusLine status="account_changed" />)
    const reload = screen.getByRole('button', { name: 'Reload' })
    expect(reload).toHaveClass('inline-block', 'text-xs/4', 'after:-inset-y-3.5')
    expect(reload).not.toHaveClass('min-h-11')
    expect(reload.parentElement).toBe(screen.getByTestId('cook-sync-status').parentElement)
  })
})
