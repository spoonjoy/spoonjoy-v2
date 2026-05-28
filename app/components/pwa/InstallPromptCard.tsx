/**
 * Non-pushy PWA install prompt.
 *
 * Listens for the browser-fired `beforeinstallprompt` event, stashes the
 * prompt, and surfaces a small dismissable card. On dismiss, persists a
 * timestamp in `localStorage` so the same user is not re-nagged for at
 * least 14 days (`PWA_INSTALL_RE_NAG_AFTER_MS`).
 *
 * Does not render on:
 * - PWAs already running in standalone display mode
 * - Browsers that never fire `beforeinstallprompt` (Safari, including
 *   iOS — those users see no card; iOS-specific install hints would be
 *   a separate decision)
 * - Within 14 days of a previous dismissal
 *
 * The decision logic is delegated to `~/lib/pwa-install` (pure, unit-tested).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  PWA_INSTALL_DISMISSED_STORAGE_KEY,
  parseDismissedAt,
  serializeDismissedAt,
  shouldShowInstallPrompt,
} from "~/lib/pwa-install";

/**
 * Subset of the BeforeInstallPromptEvent surface we actually use. Typed
 * locally because not every browser TypeScript lib has it.
 */
interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface UseInstallPromptOptions {
  /** Override matchMedia for tests/SSR. Defaults to window.matchMedia. */
  matchMedia?: (query: string) => { matches: boolean };
  /** Override storage for tests/SSR. Defaults to window.localStorage. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Override the current time for tests. */
  now?: () => number;
}

interface UseInstallPromptResult {
  visible: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useInstallPrompt(opts: UseInstallPromptOptions): UseInstallPromptResult {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    // useEffect never runs on the server, so we can assume `window` here.
    const matchMedia = opts.matchMedia ?? window.matchMedia.bind(window);
    const storage = opts.storage ?? window.localStorage;

    // Already installed?
    try {
      setIsInstalled(matchMedia("(display-mode: standalone)").matches);
    } catch {
      setIsInstalled(false);
    }

    // Read prior dismissal timestamp.
    try {
      setDismissedAt(parseDismissedAt(storage.getItem(PWA_INSTALL_DISMISSED_STORAGE_KEY)));
    } catch {
      setDismissedAt(null);
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEventLike);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [opts.matchMedia, opts.storage]);

  const visible = shouldShowInstallPrompt({
    isInstalled,
    canPrompt: prompt !== null,
    dismissedAt,
    now: (opts.now ?? Date.now)(),
  });

  const install = useCallback(async () => {
    /* istanbul ignore next -- @preserve defensive guard: Install button only renders when prompt !== null */
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      }
      setPrompt(null);
    } catch {
      setPrompt(null);
    }
  }, [prompt]);

  const dismiss = useCallback(() => {
    const now = (opts.now ?? Date.now)();
    const storage = opts.storage ?? window.localStorage;
    try {
      storage.setItem(PWA_INSTALL_DISMISSED_STORAGE_KEY, serializeDismissedAt(now));
    } catch {
      // Storage may be disabled in private mode; the dismissal still works in-session.
    }
    setDismissedAt(now);
  }, [opts.now, opts.storage]);

  return { visible, install, dismiss };
}

export function InstallPromptCard(props: { options?: UseInstallPromptOptions }) {
  const { visible, install, dismiss } = useInstallPrompt(props.options ?? {});

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Install Spoonjoy"
      className="fixed left-4 right-4 bottom-20 z-40 mx-auto max-w-md rounded-[var(--sj-radius-surface)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] shadow-[var(--sj-shadow-soft)]"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--sj-ink)]">
            Install Spoonjoy
          </p>
          <p className="mt-1 text-sm text-[var(--sj-ink-muted)]">
            Add Spoonjoy to your home screen for faster access and a more native feel.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-full p-1 text-[var(--sj-ink-muted)] hover:text-[var(--sj-tomato)]"
        >
          {/* Lightweight X glyph; avoid pulling in icon dep just for this. */}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="flex justify-end gap-2 px-4 pb-4">
        <Button plain onClick={dismiss}>
          Not now
        </Button>
        <Button onClick={install}>
          Install
        </Button>
      </div>
    </div>
  );
}
