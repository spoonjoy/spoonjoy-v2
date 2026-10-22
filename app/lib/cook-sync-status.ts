import type { SyncState, SyncStatusProps } from "~/components/ouro/sync-status/sync-status";
import type { CookSyncStatus } from "~/lib/cook-session-sync";

/** What the recipe page says for each state of the cook's progress sync. */
export const COOK_SYNC_STATUS_TEXT: Record<CookSyncStatus, string> = {
  syncing: "Syncing progress…",
  synced: "Progress synced",
  offline: "Progress saved on this device",
  stopped: "Progress saved on this device",
  signed_out: "Signed out: progress saved on this device. Sign in again to sync it.",
  account_changed: "You signed in as someone else in another tab. Reload to keep cooking.",
  update_required: "Spoonjoy has been updated. Reload to keep syncing your progress.",
};

const STATES: Record<CookSyncStatus, SyncState> = {
  syncing: "saving",
  synced: "saved",
  offline: "offline",
  stopped: "offline",
  signed_out: "error",
  account_changed: "error",
  update_required: "error",
};

const RELOAD_STATUSES: ReadonlySet<CookSyncStatus> = new Set(["account_changed", "update_required"]);

/**
 * HX SyncStatus's props for a cook-progress sync status: Spoonjoy's words for each state, and
 * Reload (HX's Retry) only when another account owns the session or the page is out of date.
 * While no problem shows, the error words are the longest, so SyncStatus reserves their height.
 */
export function cookSyncStatusProps(
  status: CookSyncStatus,
  reload: () => void = () => window.location.reload(),
): Pick<SyncStatusProps, "status" | "labels" | "onRetry"> {
  const state = STATES[status];
  return {
    status: state,
    labels: {
      saved: COOK_SYNC_STATUS_TEXT.synced,
      saving: COOK_SYNC_STATUS_TEXT.syncing,
      offline: COOK_SYNC_STATUS_TEXT.offline,
      error: COOK_SYNC_STATUS_TEXT[state === "error" ? status : "account_changed"],
      retry: "Reload",
    },
    onRetry: RELOAD_STATUSES.has(status) ? reload : undefined,
  };
}
