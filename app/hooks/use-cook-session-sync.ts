import { useEffect, useRef, useState } from "react";
import {
  CookSessionSync,
  clearOtherUsersCookProgressCache,
  createCookSessionClient,
  normalizeCookProgress,
  readSyncedCookCache,
  writeSyncedCookCache,
  type CookProgressBounds,
  type CookProgressValue,
  type CookSyncStatus,
} from "~/lib/cook-session-sync";

/**
 * App-wide: whenever the signed-in user changes (including to signed out), drops cached cook
 * progress that belongs to any other account. Called from the root with the root loader's user.
 */
export function useCookProgressCacheOwner(userId: string | null): void {
  useEffect(() => {
    clearOtherUsersCookProgressCache(userId);
  }, [userId]);
}

export interface UseCookSessionSyncOptions {
  recipeId: string;
  /** The signed-in cook when cook-session sync is enabled; null keeps progress on this device only. */
  userId: string | null;
  /** True once the page has loaded this recipe's cached progress into its state. */
  ready: boolean;
  bounds: CookProgressBounds;
  progress: CookProgressValue;
  onRemoteProgress: (progress: CookProgressValue) => void;
}

/**
 * Syncs the recipe page's cook progress with the signed-in cook's CookSession and returns the
 * sync status to show, or null when sync is off (signed out, or not enabled in this environment).
 *
 * The page reads the server's progress when it loads, when the tab becomes visible again, when
 * the window regains focus, and when the browser comes back online; the cook's own changes are
 * pushed shortly after each one, and flushed once (keepalive) when the page is hidden, left, or
 * unmounted. There is no timer polling: coming back to the recipe on another device (a new visit,
 * switching tabs or apps, refocusing) is what picks up that device's changes. Nothing is sent
 * while the page is hidden, except that one flush.
 */
export function useCookSessionSync({
  recipeId,
  userId,
  ready,
  bounds,
  progress,
  onRemoteProgress,
}: UseCookSessionSyncOptions): CookSyncStatus | null {
  const [status, setStatus] = useState<CookSyncStatus>("syncing");
  const engineRef = useRef<CookSessionSync | null>(null);
  const latest = useRef({ bounds, progress, onRemoteProgress });
  latest.current = { bounds, progress, onRemoteProgress };

  useEffect(() => {
    if (!userId || !ready) return;

    const isVisible = () => document.visibilityState === "visible";
    const engine = new CookSessionSync({
      client: createCookSessionClient(recipeId, userId),
      progress: latest.current.progress,
      server: readSyncedCookCache(userId, recipeId, latest.current.bounds)?.server ?? null,
      normalize: (value) => normalizeCookProgress(value, latest.current.bounds),
      onProgress: (value) => latest.current.onRemoteProgress(value),
      onChange: () => {
        // Once another account owns the browser's session, this tab's progress is never saved.
        if (engine.status !== "account_changed") {
          writeSyncedCookCache(userId, recipeId, { progress: engine.progress, server: engine.server });
        }
        setStatus(engine.status);
      },
      isVisible,
    });
    engineRef.current = engine;
    setStatus(engine.status);

    const pull = () => void engine.sync(true);
    const onVisibilityChange = () => {
      if (isVisible()) {
        pull();
      } else {
        engine.flush();
      }
    };
    const flush = () => engine.flush();
    window.addEventListener("focus", pull);
    window.addEventListener("online", pull);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    pull();

    return () => {
      // Leaving the recipe: dispose sends pending changes once (keepalive) before stopping.
      engine.dispose();
      engineRef.current = null;
      window.removeEventListener("focus", pull);
      window.removeEventListener("online", pull);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [recipeId, userId, ready]);

  useEffect(() => {
    engineRef.current?.setProgress(progress);
  }, [progress]);

  return userId ? status : null;
}
