let region: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Delay before a message is written: after creating the region (Safari drops text
 * added to a brand-new live region sooner than this, as React Aria's LiveAnnouncer
 * found) and after clearing it for a repeat. A timer, not an animation frame, so
 * a background tab still announces.
 */
const DELAY_MS = 100;

function getRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement("div");
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("data-ouro-announcer", "");
  // Visually hidden, but still read. Inline so it works without the stylesheet.
  Object.assign(region.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    border: "0",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  });
  document.body.append(region);
  return region;
}

/**
 * Speaks `message` politely to screen readers through one shared live region,
 * created at the end of `document.body` on first use. The message is written
 * about 100ms later. Calling it again with the same message speaks it again. A
 * no-op on the server.
 *
 * The region lives outside every component, so it never changes a control's
 * accessible name and never sits inside an `aria-busy` subtree.
 *
 * Internal; not exported from the package.
 *
 * @example
 * useEffect(() => { if (loading) announce("Saving recipe"); }, [loading]);
 */
export function announce(message: string): void {
  // Components call this from effects, which never run on the server.
  /* istanbul ignore if @preserve -- server only */
  if (typeof document === "undefined") return;
  const target = getRegion();
  // Clear first and set the text after the delay, so an identical message is a change.
  target.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    target.textContent = message;
  }, DELAY_MS);
}
