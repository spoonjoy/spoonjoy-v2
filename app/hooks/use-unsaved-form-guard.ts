import { useEffect } from "react";

// A form opts out with data-unsaved-guard="off" (for example a search box that posts).
const OPT_OUT_ATTRIBUTE = "data-unsaved-guard";

function guardedForm(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  const form = target instanceof HTMLFormElement ? target : (target as HTMLInputElement).form ?? target.closest("form");
  if (!form || form.method !== "post" || form.getAttribute(OPT_OUT_ATTRIBUTE) === "off") return null;
  return form;
}

// Asks the browser to confirm a full page unload (reload, tab close, or the reload React Router
// performs when a route chunk fails to load after a release) while a post form on the page holds
// input that was never submitted. In-app navigation unmounts the form, which clears its state.
export function useUnsavedFormGuard(): void {
  useEffect(() => {
    const dirty = new Set<HTMLFormElement>();
    const markDirty = (event: Event) => {
      const form = guardedForm(event.target);
      if (form) dirty.add(form);
    };
    // submit and reset always target the form itself.
    const markClean = (event: Event) => {
      dirty.delete(event.target as HTMLFormElement);
    };
    const confirmUnload = (event: BeforeUnloadEvent) => {
      for (const form of dirty) {
        if (!form.isConnected) dirty.delete(form);
      }
      if (dirty.size === 0) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("submit", markClean, true);
    document.addEventListener("reset", markClean, true);
    window.addEventListener("beforeunload", confirmUnload);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("submit", markClean, true);
      document.removeEventListener("reset", markClean, true);
      window.removeEventListener("beforeunload", confirmUnload);
    };
  }, []);
}
