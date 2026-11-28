import type { JSX } from "react";

/**
 * Invisible hit-area expander for interactive components. Place it as the
 * first child of a `position: relative` control: on a coarse pointer it covers
 * at least 44x44px, centered on the control, so small controls are easy to tap
 * without growing visually. With a fine pointer it is not rendered as a box at
 * all, so dense desktop layouts keep their exact hit areas.
 *
 * `fine` is for a control under 24px that has room around it: with a fine
 * pointer it covers at least 24x24px too, WCAG 2.5.8's minimum, still without
 * growing visually.
 *
 * Internal: Ouro UI components use it; apps don't need to.
 *
 * @example
 * <button className="relative">
 *   <TouchTarget />
 *   Save
 * </button>
 * @claim "With a fine pointer it is" registry/ouro/lib/ouro/touch-target.tsx verify:fileLine(registry/ouro/lib/ouro/touch-target.tsx, /hidden\ssize-\[max\(100%,44px\)\]\s-translate-1\/2\spointer-coarse:block/)
 * @claim "`fine` is for a control" registry/ouro/components/ouro/conversation-list/conversation-list.hover.test.tsx verify:testExists(registry/ouro/components/ouro/conversation-list/conversation-list.hover.test.tsx::ConversationList hover > gives the more button and the section grip a hit area of at least 24px to a mouse, the size they draw unchanged)
 */
export function TouchTarget({ fine = false }: { fine?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-ouro-touch-target=""
      className={
        fine
          ? "absolute top-1/2 left-1/2 size-[max(100%,24px)] -translate-1/2 pointer-coarse:size-[max(100%,44px)]"
          : "absolute top-1/2 left-1/2 hidden size-[max(100%,44px)] -translate-1/2 pointer-coarse:block"
      }
    />
  );
}
