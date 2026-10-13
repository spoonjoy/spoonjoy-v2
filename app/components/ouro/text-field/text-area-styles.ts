export { fitHeight, textAreaClass };

// Class strings and the autoGrow measurement for TextArea, apart from the component so its
// file exports only components (React Fast Refresh). Class strings are literal so the app's
// Tailwind finds them when it compiles.

/**
 * The textarea: Field's control look with a 16px font and 24px lines on phones (iOS zooms
 * into smaller text on focus), stepping down to 14px on 20px lines from the `sm` breakpoint with a fine pointer, so a
 * landscape phone keeps the phone size.
 * The user can drag its height unless it grows by itself.
 *
 * @internal
 */
const textAreaClass =
  "m-0 box-border block w-full min-w-0 px-3 py-2 " +
  "rounded-md border border-solid border-input bg-transparent text-base leading-6 text-foreground sm:pointer-fine:text-sm sm:pointer-fine:leading-5 " +
  "font-[inherit] placeholder:text-muted-foreground " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-out " +
  "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:bg-input/30";

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
