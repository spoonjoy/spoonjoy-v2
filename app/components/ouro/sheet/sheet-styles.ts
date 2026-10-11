export { sheetSides, sideWarning, iosBackdrop, footerClass, sheetHint };
export type { SheetSide };

// Shared class strings, value lists and dev-message helpers for Sheet, its parts and
// Dialog. They live apart from the components so each component file exports only
// components, which React Fast Refresh needs (and an app's linter checks). The export
// list comes first because the shadcn CLI drops comments before a file's first statement.

/** The edge a sheet slides in from, and is dragged back to, to dismiss. */
type SheetSide = "bottom" | "top" | "left" | "right";

/**
 * The four sides, for checking a `side` prop. Shared with `Sheet`.
 *
 * @internal
 */
const sheetSides: readonly SheetSide[] = ["bottom", "top", "left", "right"];

/**
 * The dev message for a side that is not one of {@link sheetSides}. Development only.
 *
 * @internal
 */
function sideWarning(side: string, fix: string): readonly [string, string] {
  return [`side="${side}" is not a side; use ${sheetSides.map((name) => `"${name}"`).join(", ")}`, fix];
}

/**
 * iOS 26+ Safari draws the page under its translucent toolbars, and a fixed element
 * stops at the toolbars, leaving the page under them undimmed. Base UI's guidance is
 * position: absolute (with body { position: relative } in the app). A library cannot
 * set that on body, and Base UI's iOS scroll lock keeps the page's scroll offset, so an
 * absolute backdrop would sit at the top of the document, off screen on a scrolled
 * page. The backdrops therefore keep --ouro-backdrop-top at the offset that puts them at
 * the top of the screen (useBackdropAnchor), and the large viewport height reaches under
 * the toolbars. Shared with the dialog backdrop.
 *
 * @internal
 */
const iosBackdrop =
  "supports-[-webkit-touch-callout:none]:absolute supports-[-webkit-touch-callout:none]:inset-x-0 " +
  "supports-[-webkit-touch-callout:none]:top-[var(--ouro-backdrop-top,0px)] supports-[-webkit-touch-callout:none]:bottom-auto " +
  "supports-[-webkit-touch-callout:none]:h-lvh";

/**
 * The actions row of a Dialog, in either presentation: a row at the end from 640px up.
 * Below it the actions stack full width in DOM order, so the primary action (last)
 * sits at the bottom, nearest the thumb. Shared with `DialogFooter`.
 *
 * @internal
 */
const footerClass = "box-border flex shrink-0 justify-end gap-3 px-5 pt-3 pb-5 max-sm:flex-col max-sm:*:w-full";

/**
 * The Fix code for an appearance class on a sheet part: the theme's CSS variables
 * for colors and radius, or a wrapper inside `open`…`close` for text classes.
 * Development only.
 *
 * @internal
 */
function sheetHint(open: string, close: string) {
  return (token: string): string => {
    if (token.startsWith("rounded")) {
      return `:root { --radius: ${token === "rounded-none" ? "0px" : "0.75rem"} }`;
    }
    if (/^(text|font)-/.test(token)) return `${open}<div className="${token}">…</div>${close}`;
    return ":root { --popover: …; } .dark { --popover: …; }";
  };
}
