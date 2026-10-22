export {
  actionClass,
  descriptionClass,
  emptyClass,
  groupDescriptionClass,
  groupLabelClass,
  headerClass,
  hitClass,
  labelClass,
  rootClass,
  rowClass,
  rowInnerClass,
  rowPartNames,
  rowsClass,
  strikeClass,
  textClass,
  valueClass,
};

// Class strings for Checklist, apart from the components so each component file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds them.
// A row's state is on the row (`data-checked`, `data-starting-style`, `data-ending-style`), which
// is the named group `group/row`; the box keeps Checkbox's own `group` for its tick.

/** The group: its header above the rows. @internal */
const rootClass = "grid min-w-0 gap-2 text-foreground outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

/** The header: the group's label and description, and the clear button at its end. @internal */
const headerClass = "flex min-h-8 items-center justify-between gap-3";

/** The group's label. @internal */
const groupLabelClass = "m-0 text-base leading-6 font-medium text-foreground sm:pointer-fine:text-sm sm:pointer-fine:leading-5";

/** The group's description, under its label. @internal */
const groupDescriptionClass = "m-0 text-sm leading-5 text-muted-foreground";

/** The rows. @internal */
const rowsClass = "grid min-w-0";

/**
 * What shows when there are no rows. @internal
 *
 * @claim "What shows when there are no" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > shows the empty state once the last row has left)
 */
const emptyClass = "py-2 text-sm leading-5 text-muted-foreground";

/**
 * A row. It enters from nothing (`@starting-style` while it carries `data-starting-style`)
 * and leaves to nothing (`data-ending-style`): its height through `grid-template-rows` and its
 * opacity, over `--ouro-duration-base`. With reduced motion it only fades, in place.
 *
 * @internal
 */
const rowClass =
  "group/row grid grid-rows-[1fr] opacity-100 " +
  "motion-safe:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out),grid-template-rows_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease] " +
  "data-ending-style:opacity-0 motion-safe:data-ending-style:grid-rows-[0fr] " +
  "starting:data-starting-style:opacity-0 motion-safe:starting:data-starting-style:grid-rows-[0fr]";

/** The row's single grid cell, clipped only while the row grows or shrinks, so a focus ring shows at rest. @internal */
const rowInnerClass = "flex min-h-0 min-w-0 items-center gap-1 group-data-starting-style/row:overflow-hidden group-data-ending-style/row:overflow-hidden";

/**
 * The row's label: the box, the text and the value, so the whole row but its action toggles.
 * It highlights while hovered (a mouse's only) or pressed rather than scaling, as a list row
 * does, and is at least 44px tall on a coarse pointer.
 *
 * @internal
 * @claim "It highlights while hovered (a mouse's" registry/ouro/components/ouro/checklist/checklist.touch.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.touch.test.tsx::gives every row at least 44px to tap)
 * @claim "It highlights while hovered (a mouse's" registry/ouro/components/ouro/checklist/checklist-styles.ts verify:fileLine(registry/ouro/components/ouro/checklist/checklist-styles.ts, /not-has-data-disabled:pointer-fine:hover:bg-muted\/60\snot-has-data-disabled:active:bg-muted\/60/)
 */
const hitClass =
  "relative m-0 flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 pointer-coarse:min-h-11 pointer-coarse:py-2.5 " +
  "cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "[transition:background-color_var(--ouro-duration-fast)_ease] " +
  "not-has-data-disabled:pointer-fine:hover:bg-muted/60 not-has-data-disabled:active:bg-muted/60 has-data-disabled:cursor-not-allowed";

/** The text column: the label, and the description under it. @internal */
const textClass = "flex min-w-0 flex-1 flex-col gap-0.5";

/** Checking softens the label and the value as the strike crosses them; unchecking returns them at once. */
const softens =
  "text-foreground group-data-checked/row:text-muted-foreground " +
  "motion-safe:[transition:color_var(--ouro-duration-fast)_ease] " +
  "motion-safe:group-data-checked/row:[transition:color_var(--ouro-duration-draw)_ease_calc(var(--ouro-duration-fast)*2)] " +
  "motion-reduce:[transition:color_var(--ouro-duration-fast)_ease]";

/** The label's text, as wide as its words so the strike ends where they do. @internal */
const labelClass = "relative w-fit max-w-full text-base leading-6 sm:pointer-fine:text-sm sm:pointer-fine:leading-5 [overflow-wrap:anywhere] " + softens;

/**
 * The strike: a line through the middle of each line of the label (a gradient one line-height
 * tall, repeated down), drawn from the inline start with `scale` over `--ouro-duration-draw` as the
 * tick finishes, and taken back at once when unchecked. With reduced motion it is whole and fades.
 *
 * @internal
 * @claim "The strike: a line through the" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > draws the tick, then the strike, and softens the text)
 */
const strikeClass =
  "pointer-events-none absolute inset-0 " +
  "[background-image:linear-gradient(transparent_calc(50%_-_0.75px),currentColor_calc(50%_-_0.75px)_calc(50%_+_0.75px),transparent_calc(50%_+_0.75px))] [background-size:100%_1lh] [background-repeat:repeat-y] " +
  "[transform-origin:left_center] rtl:[transform-origin:right_center] [scale:0_1] group-data-checked/row:[scale:1] " +
  "motion-safe:[transition:scale_var(--ouro-duration-fast)_var(--ouro-ease-out)] " +
  "motion-safe:group-data-checked/row:[transition:scale_var(--ouro-duration-draw)_var(--ouro-ease-out)_calc(var(--ouro-duration-fast)*2)] " +
  "motion-reduce:[scale:none] motion-reduce:opacity-0 motion-reduce:group-data-checked/row:opacity-100 motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease]";

/** A row's description, under its label. @internal */
const descriptionClass = "text-sm leading-5 text-muted-foreground";

/** A row's value, at the end of its label: an amount, a time. @internal */
const valueClass = "ms-auto shrink-0 ps-3 text-end text-base leading-6 font-medium tabular-nums sm:pointer-fine:text-sm sm:pointer-fine:leading-5 " + softens;

/** A row's own action, beside its label. @internal */
const actionClass = "flex shrink-0 items-center pe-1";

/** The parts of a row whose finite animations hold a leaving row until they end. @internal */
const rowPartNames: readonly string[] = ["row", "box", "tick", "strike", "label", "value"];
