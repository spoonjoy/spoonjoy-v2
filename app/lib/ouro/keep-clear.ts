export { keepClear, KEEP_CLEAR_GAP };

/** How far above a control a kept-clear element sits, in px. */
const KEEP_CLEAR_GAP = 8;

/**
 * Keeps an element fixed at the bottom of the window, such as the toasts' viewport, clear of the
 * elements `selector` matches: one on screen in the lower half of the window, across the element's
 * column, lifts the element to sit 8px above it, and the element comes back down when it goes. It
 * measures again when the page changes outside the element (an element added, removed, restyled or
 * moved) and when the window resizes. Returns what lets go of the page and the window.
 *
 * @claim "lifts the element to sit 8px above it" registry/ouro/lib/ouro/keep-clear.test.ts verify:testExists(registry/ouro/lib/ouro/keep-clear.test.ts::keepClear > lifts the element above a matched control under it, and lets it back down when the control goes)
 * @claim "It measures again when the page" registry/ouro/lib/ouro/keep-clear.test.ts verify:testExists(registry/ouro/lib/ouro/keep-clear.test.ts::keepClear > measures again when the window resizes)
 * @claim "Returns what lets go of the" registry/ouro/lib/ouro/keep-clear.test.ts verify:testExists(registry/ouro/lib/ouro/keep-clear.test.ts::keepClear > lets go of the page and the window when released)
 */
function keepClear(element: HTMLElement, selector: string): () => void {
  const place = () => {
    element.style.removeProperty("bottom");
    const column = element.getBoundingClientRect();
    const height = document.documentElement.clientHeight;
    let lift = 0;
    for (const control of document.querySelectorAll(selector)) {
      const box = control.getBoundingClientRect();
      if (!control.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || box.top < height / 2 || box.right <= column.left || box.left >= column.right) continue;
      lift = Math.max(lift, height - box.top + KEEP_CLEAR_GAP);
    }
    // Stryker disable next-line EqualityOperator: at equal values the lift puts the element where it already is.
    if (lift > height - column.bottom) element.style.bottom = `${lift}px`;
  };
  // The element's own changes, its lift among them, are not the page's: measuring on them would never end.
  const page = new MutationObserver((records) => {
    if (records.some((record) => !element.contains(record.target))) place();
  });
  page.observe(document.body, { childList: true, subtree: true, attributes: true });
  addEventListener("resize", place);
  place();
  return () => {
    page.disconnect();
    removeEventListener("resize", place);
  };
}
