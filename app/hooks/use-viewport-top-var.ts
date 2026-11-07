import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a CSS variable on an element set to the element's distance from the top of the viewport,
 * so a stylesheet can size the element to end on a horizontal fold (app/styles/fold.css). It is
 * re-measured whenever the element's parent changes size, such as when a timer tray opens above it.
 */
export function useViewportTopVar(ref: RefObject<HTMLElement | null>, name: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      element.style.setProperty(name, `${element.getBoundingClientRect().top}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    // A mounted element always has a parent: at least the container React rendered into.
    observer.observe(element.parentElement as HTMLElement);
    return () => observer.disconnect();
  }, [ref, name]);
}
