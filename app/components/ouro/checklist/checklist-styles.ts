export {
  actionClass,
  descriptionClass,
  emptyClass,
  groupDescriptionClass,
  groupLabelClass,
  headerClass,
  hitClass,
  hitOutlineClass,
  hitPlainClass,
  labelClass,
  mediaClass,
  noteClass,
  outOfOrderBoxClass,
  outlineCardClass,
  outlineRowInnerClass,
  rootClass,
  roundBoxClass,
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

/**
 * The row's single grid cell, clipped only while the row grows or shrinks, so a focus ring shows at rest. A child
 * selector, not `group-data-starting-style/row`: Chrome restyles every element under anything that gains or loses
 * `data-starting-style` while a `group-data-*` rule on it exists, which made each sheet and popover open restyle the
 * whole of it again (ourostack/ouro-ui#648).
 *
 * @internal
 * @claim "A child selector, not `group-data-starting-style/row`" site/e2e/site-menu.spec.ts verify:testExists(site/e2e/site-menu.spec.ts::the site's CSS has no rule that makes an open restyle more than it changes)
 */
const rowInnerClass = "flex min-h-0 min-w-0 items-center gap-1 [[data-starting-style]>&]:overflow-hidden [[data-ending-style]>&]:overflow-hidden";

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
  "relative m-0 flex min-w-0 flex-1 gap-3 pointer-coarse:min-h-11 " +
  "cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "[transition:background-color_var(--ouro-duration-fast)_ease] " +
  "not-has-data-disabled:pointer-fine:hover:bg-muted/60 not-has-data-disabled:active:bg-muted/60 has-data-disabled:cursor-not-allowed";

/** The hit area's shape in a plain checklist: the box at the top of the label's first line. @internal */
const hitPlainClass = "items-start rounded-ouro-md px-2 py-2 pointer-coarse:py-2.5";

/**
 * The hit area's shape in an outlined row: it fills the row's card, its media, text and round
 * tick centered on one line.
 *
 * @internal
 */
const hitOutlineClass = "items-center rounded-ouro-xl px-3 py-2";

/**
 * An outlined row's single grid cell, clipped only while the row grows or shrinks. The space
 * between cards is the cards' own margin, inside this cell, so a row that leaves takes its share
 * with it.
 *
 * @internal
 */
const outlineRowInnerClass = "min-h-0 min-w-0 [[data-starting-style]>&]:overflow-hidden [[data-ending-style]>&]:overflow-hidden";

/**
 * An outlined row's card: a hairline border on the theme's border colour, on Ouro's xl corner,
 * holding the hit area and the row's action.
 *
 * @internal
 * @claim "An outlined row's card: a hairline" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist outline > frames each row as a card and puts a round tick at its end, which fills with the tone)
 */
const outlineCardClass = "my-1 flex min-w-0 items-center gap-1 rounded-ouro-xl border border-solid border-border";

/**
 * A row's media: an icon in a soft 36px tile, the muted surface behind the muted foreground, as
 * Item's icon tile is. Hidden from screen readers; the label names the row.
 *
 * @internal
 * @claim "A row's media: an icon in" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist outline > draws each item's media in a soft tile at the start of the row, hidden from screen readers)
 */
const mediaClass = "flex size-9 shrink-0 items-center justify-center rounded-ouro-lg bg-muted text-muted-foreground *:[svg]:size-5";

/**
 * The round tick at the end of an outlined row: the box as a 24px circle (the check radius set
 * to a full round), centered on the row. It fills with the primary tone when ticked, and with the
 * warning tone while out of order.
 *
 * @internal
 * @claim "The round tick at the end of" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist outline > frames each row as a card and puts a round tick at its end, which fills with the tone)
 */
const roundBoxClass = "mt-0 size-6 sm:pointer-fine:size-6 [--ouro-check-radius:9999px] [--ouro-check-corner-shape:round]";

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

/**
 * The box of a row ticked out of order (`Checklist`'s `ordered`): the warning tone in place of
 * the primary, so it reads as ticked but not yet right, with a dashed edge that forced colours
 * keep. Its colours change over `--ouro-duration-fast`.
 *
 * @internal
 * @claim "The box of a row ticked" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > marks a step ticked before the one that comes first, names that step, and announces it)
 */
const outOfOrderBoxClass =
  "data-out-of-order:data-checked:border-warning data-out-of-order:data-checked:bg-warning data-out-of-order:data-checked:text-warning-foreground forced-colors:data-out-of-order:border-dashed";

/**
 * The note under an out-of-order row's label, naming the step that comes first: the warning
 * tone mixed 20% toward the foreground, as Alert's is, so it holds 4.5:1. It fades in over
 * `--ouro-duration-fast`, with reduced motion too, since it only fades.
 *
 * @internal
 * @claim "the warning tone mixed 20% toward" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > keeps 4.5:1 for the out-of-order note in light and dark)
 */
const noteClass =
  "text-sm leading-5 font-medium text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))] opacity-100 starting:opacity-0 [transition:opacity_var(--ouro-duration-fast)_ease]";

/** A row's description, under its label. @internal */
const descriptionClass = "text-sm leading-5 text-muted-foreground";

/** A row's value, at the end of its label: an amount, a time. @internal */
const valueClass = "ms-auto shrink-0 ps-3 text-end text-base leading-6 font-medium tabular-nums sm:pointer-fine:text-sm sm:pointer-fine:leading-5 " + softens;

/** A row's own action, beside its label. @internal */
const actionClass = "flex shrink-0 items-center pe-1";

/** The parts of a row whose finite animations hold a leaving row until they end. @internal */
const rowPartNames: readonly string[] = ["row", "box", "tick", "strike", "label", "value"];
