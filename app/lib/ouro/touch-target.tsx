import type { JSX } from "react";

/**
 * Invisible hit-area expander for interactive components. Place it as the
 * first child of a `position: relative` control: on a coarse pointer it covers
 * at least 44x44px, centered on the control, so small controls are easy to tap
 * without growing visually. With a fine pointer it is not rendered as a box at
 * all, so dense desktop layouts keep their exact hit areas.
 *
 * Internal: Ouro UI components use it; apps don't need to.
 *
 * @example
 * <button className="relative">
 *   <TouchTarget />
 *   Save
 * </button>
 */
export function TouchTarget(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-ouro-touch-target=""
      className="absolute top-1/2 left-1/2 hidden size-[max(100%,44px)] -translate-1/2 pointer-coarse:block"
    />
  );
}
