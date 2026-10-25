import { useEffect } from "react";

/**
 * Marks the document `<html data-hydrated>` once React has hydrated the page. An effect runs only
 * after hydration commits, so every event handler is attached by then; React Router's own
 * `window.__reactRouterDataRouter` appears when hydration starts, and the app hydrates in a
 * transition that can pause, so a tap before this mark can be lost. The QA journeys wait for it
 * before they act on a freshly loaded page (e2e/journeys/support/app-ready.ts).
 */
export function useHydratedMark(): void {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "";
  }, []);
}
