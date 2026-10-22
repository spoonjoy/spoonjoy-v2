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

// The line flows as text, so Reload follows the message on its last line instead of starting a
// row of its own.
const LINE_CLASS_NAME =
  '[grid-area:1/1] m-0 font-sj-ui text-xs/4 font-semibold text-[var(--sj-ink-soft)]'
// Reload is a 44px tap target drawn around a line-high label, so it never makes its line taller.
const RELOAD_CLASS_NAME =
  "relative ml-3 inline-block font-sj-ui text-xs/4 font-semibold uppercase tracking-[0.14em] text-[var(--sj-action)] after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"

const ALL_STATUSES = Object.keys(COOK_SYNC_STATUS_TEXT) as CookSyncStatus[]

export interface CookSyncStatusLineProps {
  status: CookSyncStatus
  /** Reloads the page; defaults to a full browser reload. */
  onReload?: () => void
}

// TODO(ouro-hx: sync-status, spoonjoy/spoonjoy-v2#570): Saved, syncing and offline become HX's SyncStatus in #570.
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

  // Every status shares one grid cell with an invisible copy of each other status's line, so the
  // line is always as tall as its tallest status at the current width: a status that wraps to two
  // lines, or that adds Reload, never moves the page below it. The copies are hidden from
  // assistive technology and hold no controls.
  return (
    <div className="mt-3 grid" data-testid="cook-sync-status-line">
      {ALL_STATUSES.map((reserved) => (
        <p key={reserved} aria-hidden="true" className={`invisible ${LINE_CLASS_NAME}`} data-testid="cook-sync-status-reserve">
          <span>{COOK_SYNC_STATUS_TEXT[reserved]}</span>
          {RELOAD_STATUSES.has(reserved) ? <span className={RELOAD_CLASS_NAME}>Reload</span> : null}
        </p>
      ))}
      <p className={LINE_CLASS_NAME}>
        <span data-testid="cook-sync-status" data-status={status}>
          {COOK_SYNC_STATUS_TEXT[status]}
        </span>
        {RELOAD_STATUSES.has(status) ? (
          <button type="button" onClick={onReload} className={RELOAD_CLASS_NAME}>
            Reload
          </button>
        ) : null}
      </p>
      <span role="status" className="sr-only" data-testid="cook-sync-announcement">
        {announcement}
      </span>
    </div>
  )
}
