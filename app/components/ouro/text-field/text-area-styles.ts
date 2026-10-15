export { fitHeight, textAreaClass, textAreaSizes, textAreaVariants };

// Class strings and the autoGrow measurement for TextArea, apart from the component so its
// file exports only components (React Fast Refresh). Class strings are literal so the app's
// Tailwind finds them when it compiles.

/**
 * The textarea, whatever its variant and size. The user can drag its height unless it grows
 * by itself.
 *
 * @internal
 */
const textAreaClass =
  "m-0 box-border block w-full min-w-0 rounded-md text-foreground " +
  "font-[inherit] placeholder:text-muted-foreground " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The textarea's frame. `outline` is Field's control look. `plain` draws no border,
 * background or padding, for a textarea inside a frame the app draws (a chat composer); it
 * keeps the corner radius, which only the focus outline shows.
 *
 * @internal
 */
const textAreaVariants = {
  outline:
    "px-3 py-2 border border-solid border-input bg-transparent " +
    "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
    "aria-invalid:border-destructive dark:bg-input/30",
  plain: "p-0 border-0 bg-transparent",
} as const;

/**
 * The textarea's font size. `md` is a 16px font on 24px lines on phones (iOS zooms into
 * smaller text on focus), stepping down to 14px on 20px lines from the `sm` breakpoint with a
 * fine pointer, so a landscape phone keeps the phone size. `lg` is 20px on 28px lines at
 * every width.
 *
 * @internal
 */
const textAreaSizes = {
  md: "text-base leading-6 sm:pointer-fine:text-sm sm:pointer-fine:leading-5",
  lg: "text-xl leading-7",
} as const;

/**
 * Sizes a textarea to its content, between `rows` and `maxRows` lines, and lets it scroll
 * only once it is capped. Only an `autoGrow` TextArea calls it; without `autoGrow` the
 * inline height belongs to the user's resize handle.
 *
 * @internal
 */
function fitHeight(textarea: HTMLTextAreaElement, rows: number, maxRows: number | undefined): void {
  const style = getComputedStyle(textarea);
  const line = parseFloat(style.lineHeight);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const min = rows * line + padding + border;
  const max = maxRows === undefined ? Infinity : Math.max(min, maxRows * line + padding + border);
  // Collapse first so scrollHeight measures the content, not the current height.
  textarea.style.height = `${min}px`;
  const needed = textarea.scrollHeight + border;
  textarea.style.height = `${Math.min(Math.max(needed, min), max)}px`;
  textarea.style.overflowY = needed > max + 0.5 ? "auto" : "hidden";
}
