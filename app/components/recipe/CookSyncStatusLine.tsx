import { useEffect, useRef, useState } from 'react'
import type { CookSyncStatus } from '~/lib/cook-session-sync'

export const COOK_SYNC_STATUS_TEXT: Record<CookSyncStatus, string> = {
  syncing: 'Syncing progress…',
  synced: 'Progress synced',
  offline: 'Progress saved on this device',
  stopped: 'Progress saved on this device',
  signed_out: 'Signed out: progress saved on this device. Sign in again to sync it.',
  account_changed: 'You signed in as someone else in another tab. Reload to keep cooking.',
  update_required: 'Spoonjoy has been updated. Reload to keep syncing your progress.',
}

const PROBLEM_STATUSES: ReadonlySet<CookSyncStatus> = new Set([
  'offline',
  'stopped',
  'signed_out',
  'account_changed',
  'update_required',
])
const RELOAD_STATUSES: ReadonlySet<CookSyncStatus> = new Set(['account_changed', 'update_required'])

export interface CookSyncStatusLineProps {
  status: CookSyncStatus
  /** Reloads the page; defaults to a full browser reload. */
  onReload?: () => void
}

/**
 * Whether the cook's progress is reaching their account. The visible line follows every change;
 * the screen-reader announcement (a polite live region) speaks only when progress stops reaching
 * the account and when it recovers, so checking items off is not narrated tap by tap.
 */
export function CookSyncStatusLine({ status, onReload = () => window.location.reload() }: CookSyncStatusLineProps) {
  const [announcement, setAnnouncement] = useState('')
  const announcedProblem = useRef(false)

  useEffect(() => {
    if (PROBLEM_STATUSES.has(status)) {
      announcedProblem.current = true
      setAnnouncement(COOK_SYNC_STATUS_TEXT[status])
    } else if (status === 'synced' && announcedProblem.current) {
      announcedProblem.current = false
      setAnnouncement(COOK_SYNC_STATUS_TEXT.synced)
    }
  }, [status])

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p
        className="font-sj-ui text-xs font-semibold text-[var(--sj-ink-soft)]"
        data-testid="cook-sync-status"
        data-status={status}
      >
        {COOK_SYNC_STATUS_TEXT[status]}
      </p>
      {RELOAD_STATUSES.has(status) ? (
        <button
          type="button"
          onClick={onReload}
          className="font-sj-ui inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-action)] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
        >
          Reload
        </button>
      ) : null}
      <span role="status" className="sr-only" data-testid="cook-sync-announcement">
        {announcement}
      </span>
    </div>
  )
}
