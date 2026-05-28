/**
 * PWA install prompt decision logic.
 *
 * Kept as pure functions so the component can be unit-tested without
 * needing a real browser. The React component in
 * `app/components/pwa/InstallPromptCard.tsx` is the only caller that
 * touches `window`/`localStorage` directly.
 */

export const PWA_INSTALL_DISMISSED_STORAGE_KEY =
  "spoonjoy.pwa-install.dismissed-at";

/**
 * After dismissal, re-nag once 14 days have passed. Long enough to feel
 * unobtrusive; short enough that users who weren't ready then get
 * another chance.
 */
export const PWA_INSTALL_RE_NAG_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface ShouldShowInstallPromptInput {
  /** Whether the PWA is already installed (e.g. matchMedia('(display-mode: standalone)')). */
  isInstalled: boolean;
  /** Whether the browser fired `beforeinstallprompt` (i.e. the prompt is available). */
  canPrompt: boolean;
  /** Last dismissal timestamp from storage, or `null` if never dismissed. */
  dismissedAt: number | null;
  /** Current timestamp. */
  now: number;
}

export function shouldShowInstallPrompt(input: ShouldShowInstallPromptInput): boolean {
  if (input.isInstalled) return false;
  if (!input.canPrompt) return false;
  if (input.dismissedAt !== null) {
    if (input.now - input.dismissedAt < PWA_INSTALL_RE_NAG_AFTER_MS) {
      return false;
    }
  }
  return true;
}

export function parseDismissedAt(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function serializeDismissedAt(timestamp: number): string {
  return String(timestamp);
}
