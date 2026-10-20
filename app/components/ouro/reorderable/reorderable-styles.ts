export { contentClass, dropIndex, EDGE, edgeSpeed, fillLabel, handleClass, itemClass, listClass, MAX_FRAME, MAX_SPEED, moveItem, rootClass, scrollParent };

// Class strings, values and helpers for Reorderable, apart from the component so its file
// exports only components (React Fast Refresh). Class strings are literal so the app's
// Tailwind finds them when it compiles.

/** How near the scrolling area's top or bottom edge, in px, a dragging pointer starts to scroll it. @internal */
const EDGE = 56;

/** The fastest a drag scrolls, in px per millisecond, with the pointer at the edge or past it: 840px a second. @internal */
const MAX_SPEED = 0.84;

/** The longest a frame counts for when a drag scrolls, in ms: a frame after a pause does not jump. @internal */
const MAX_FRAME = 50;

/** @internal */
const rootClass = "min-w-0";

/** The list. While a row is dragged, text is not selected. @internal */
const listClass = "group/reorder m-0 flex min-w-0 list-none flex-col p-0 data-dragging:select-none";

/**
 * One row: the handle, then the content. It is at least 44px tall on a touch screen, so
 * the handles' touch targets never overlap. While another row is dragged it slides out of
 * the way (it jumps with reduced motion); the dragged row follows the pointer above the
 * others, and a row picked up from the keyboard is outlined. A dropped row stays above
 * the others while it springs into its place; the component writes each row's `transform`.
 *
 * @internal
 */
const itemClass =
  "relative m-0 flex min-w-0 list-none items-center gap-2 p-0 pointer-coarse:min-h-11 " +
  "motion-safe:group-data-dragging/reorder:[&:not([data-dragging])]:[transition:transform_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "data-dragging:z-10 data-dragging:rounded-lg data-dragging:bg-background data-dragging:shadow-(--shadow-lg) " +
  "data-dropped:z-10 data-dropped:rounded-lg data-dropped:bg-background " +
  "data-grabbed:rounded-lg data-grabbed:outline-2 data-grabbed:outline-ring data-grabbed:outline-solid";

/** The row's content. No `touch-action`: a touch that starts here scrolls the page. @internal */
const contentClass = "min-w-0 flex-1";

/**
 * The drag handle: a quiet grip button. `touch-none` keeps a touch that starts on it for
 * the drag instead of the page's scroll; `TouchTarget` makes it 44px to touch.
 *
 * @internal
 */
const handleClass =
  "press relative m-0 box-border inline-flex size-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md border-0 " +
  "bg-transparent p-0 text-muted-foreground [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground active:cursor-grabbing data-grabbed:bg-accent data-grabbed:text-accent-foreground " +
  "motion-safe:active:scale-(--ouro-press-scale) active:duration-(--ouro-duration-fast)";

/**
 * Fills a label template: `{label}` is the row's label, `{n}` its 1-based position and
 * `{total}` the number of rows.
 *
 * @internal
 */
function fillLabel(template: string, label: string, n: number, total: number): string {
  return template.replaceAll("{label}", label).replaceAll("{n}", String(n)).replaceAll("{total}", String(total));
}

/** A copy of `list` with the entry at `from` moved to `to`. @internal */
function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Where the row dragged from `from` would land with its center at `center`: the number of
 * other rows it now sits after. It passes a row when its center reaches that row's center
 * (where the row rests), from either side, so a row dragged to the very end of the list
 * lands last.
 *
 * @internal
 */
function dropIndex(centers: readonly number[], from: number, center: number): number {
  return centers.filter((other, index) => index !== from && (index > from ? other <= center : other < center)).length;
}

/**
 * How fast to scroll, in px per millisecond, with the pointer at `y` between the scrolling
 * area's `top` and `bottom`: not at all in the middle, faster the nearer an edge, negative
 * toward the top. The caller multiplies by the frame's time, so the speed is the same at
 * 60Hz and at 120Hz.
 *
 * @internal
 */
function edgeSpeed(y: number, top: number, bottom: number): number {
  const near = (distance: number) => Math.min(Math.max((EDGE - distance) / EDGE, 0), 1) * MAX_SPEED;
  return near(bottom - y) - near(y - top);
}

/**
 * The nearest ancestor of `element` (or `element` itself) that scrolls vertically, or the
 * page's scrolling element.
 *
 * @internal
 */
function scrollParent(element: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.documentElement;
}
