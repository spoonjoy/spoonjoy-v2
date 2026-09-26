import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";

/**
 * True when the current document has an earlier entry in this app session.
 *
 * React Router's browser history stores an `idx` in `window.history.state`: 0 for the entry
 * the app was loaded on, +1 for every in-app push. An index above 0 therefore means Back
 * lands on a Spoonjoy page; 0 or a missing index means the page was opened directly (a
 * shared link, a new tab, a bookmark), where Back would leave the app.
 */
export function hasInAppHistory(): boolean {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object") return false;
  const idx = (state as { idx?: unknown }).idx;
  return typeof idx === "number" && idx > 0;
}

function isPlainPrimaryClick(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

/**
 * Click handler for a "back to the list" link that keeps a real `href` (for no-JS, middle
 * click and open-in-new-tab) but, on a plain primary click, returns to the previous in-app
 * page when there is one. Without in-app history the click is left to the link, so it goes
 * to its `href`.
 */
export function useBackNavigation(): (event: MouseEvent<HTMLElement>) => void {
  const navigate = useNavigate();

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!isPlainPrimaryClick(event) || !hasInAppHistory()) return;
      event.preventDefault();
      void navigate(-1);
    },
    [navigate],
  );
}
