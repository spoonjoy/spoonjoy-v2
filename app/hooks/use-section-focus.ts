import { useEffect } from "react";

/**
 * Scrolls to and focuses the page section named by `?section=` (one of `ids`), so a link from the
 * apps or from sign-in lands on it even when the fragment was lost on the way.
 */
export function useSectionFocus(ids: readonly string[]): void {
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (!section || !ids.includes(section)) return;
    const element = document.getElementById(section);
    if (!element) return;
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
    element.scrollIntoView({ block: "start" });
    element.focus({ preventScroll: true });
    // Once, on arrival: the ids are a fixed list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
