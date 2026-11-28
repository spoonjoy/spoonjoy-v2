export { countClass, glassGroupClass, groupClass, iconClass, labelClass, ownLook, revealClass, rootClass, segmentClass, thumbClass };

// Class strings for SegmentedControl, apart from the component so its file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds
// them when it compiles.

/**
 * The `Fix:` for an appearance class: the control draws its own look.
 *
 * @internal
 */
function ownLook(component: string): (token: string) => string {
  return (token) => `remove "${token}"; ${component} sets its own look`;
}

/**
 * The label above the track, and the track.
 *
 * @internal
 */
const rootClass = "box-border grid min-w-0 content-start justify-items-start gap-2";

// revealOnHover: with a mouse, transparent until the pointer rests on the control or focus is in it.
const revealClass = "transition-opacity duration-(--ouro-duration-fast) ease-[ease] pointer-fine:[&:not(:hover,:focus-within)]:opacity-0";

/**
 * The label, as Field draws it.
 *
 * @internal
 */
const labelClass = "m-0 block text-sm leading-5 font-medium text-foreground select-none";

/**
 * The track: one column per segment, each at least as wide as its label, so no label is cut. The
 * columns are equal when every label fits an equal share, as Apple's segmented control does; when
 * one doesn't, it keeps its width and the others share the rest equally. 44px tall on a coarse pointer, stepping down to
 * 36px from `sm` with a fine pointer.
 * @claim "so no label is cut" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > shows every label whole: equal segments when they fit, and a long label keeps its width when they don't)
 * @claim "The columns are equal when every label fits" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > shows every label whole: equal segments when they fit, and a long label keeps its width when they don't)
 *
 * @internal
 * @claim "44px tall on a coarse pointer" registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx::keeps 44px segments with 16px text on a phone, also in landscape)
 */
const groupClass =
  "relative isolate m-0 box-border inline-grid max-w-full grid-flow-col auto-cols-[minmax(max-content,1fr)] p-0.5 [anchor-scope:--ouro-segment] " +
  "h-(--ouro-segmented-h) [--ouro-segmented-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-segmented-h:calc(var(--spacing)*9)] " +
  "rounded-ouro-control bg-muted forced-colors:border forced-colors:border-solid";

/**
 * The raised thumb behind the pressed segment, whose edges it takes by CSS anchor positioning
 * (the pressed segment is the anchor, Baseline since January 2026): no measuring, and server
 * HTML already has it right.
 * It slides on the ease-in-out token; with reduced motion, or on an arrow key, it moves at once.
 *
 * @internal
 * @claim "no measuring, and server HTML already has it right" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > slides the thumb under the pressed segment with a transition)
 * @claim "no measuring, and server HTML already has it right" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > keeps the label id and pressed state in server HTML and hydrates without a mismatch)
 */
const thumbClass =
  "pointer-events-none absolute top-0.5 bottom-0.5 -z-1 rounded-ouro-control-md " +
  "[position-anchor:--ouro-segment] start-[anchor(start)] end-[anchor(end)] " +
  "bg-background dark:bg-[color-mix(in_oklab,var(--foreground)_16%,var(--muted))] " +
  // Comes after dark:, so under forced colours the fill is Highlight in either theme: the dark fill
  // would otherwise win the cascade and be forced to Canvas, leaving HighlightText unreadable on it.
  "forced-colors:bg-[Highlight] forced-colors:dark:bg-[Highlight] " +
  "shadow-(--shadow-sm) " +
  "[transition:inset-inline-start_var(--ouro-duration-base)_var(--ouro-ease-in-out),inset-inline-end_var(--ouro-duration-base)_var(--ouro-ease-in-out),opacity_var(--ouro-duration-fast)_ease] " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease] in-data-ouro-keyboard:[transition:none]";

/**
 * A segment: muted text, the foreground when pressed. The muted text is mixed 20% toward the
 * foreground, for more contrast on the muted track than plain `text-muted-foreground` has.
 * Under forced colours the pressed segment is lettered in HighlightText on the thumb's Highlight.
 * Hover lifts only the other segments' text, so the pointer resting on the pressed segment never
 * turns its letters back to the page's text colour. The pressed segment opts out of forced-colours
 * adjustment, or the browser's own override can draw its label in the same colour as the thumb
 * behind it instead of the HighlightText the segment asks for.
 *
 * @internal
 * @claim "Hover lifts only the other segments'" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > keeps HighlightText on the pressed segment under forced colours while the pointer rests on it)
 * @claim "The muted text is mixed 20%" registry/ouro/components/ouro/segmented-control/segmented-control-styles.ts verify:fileLine(registry/ouro/components/ouro/segmented-control/segmented-control-styles.ts, /text-\[color-mix\(in_oklab,var\(--muted-foreground\)_80%,var\(--foreground\)\)\]/)
 * @claim "opts out of forced-colours adjustment" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > draws the pressed label in HighlightText under forced colours at rest, not the thumb's own colour)
 */
const segmentClass =
  "press relative m-0 box-border flex cursor-pointer items-center justify-center px-3 pointer-coarse:min-w-ouro-11 " +
  "rounded-ouro-control-md border-0 bg-transparent text-base font-medium whitespace-nowrap text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))] sm:pointer-fine:text-sm " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "not-data-disabled:not-data-pressed:pointer-fine:hover:text-foreground data-pressed:text-foreground " +
  "forced-colors:data-pressed:forced-color-adjust-none forced-colors:data-pressed:text-[HighlightText] " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) data-pressed:[anchor-name:--ouro-segment] " +
  "outline-ring outline-offset-1 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/** A segment's icon, before its label. @internal */
const iconClass = "me-1.5 flex [&:only-child]:me-0 [&_svg]:size-[1.25em]";

/** A count pill inside the segment, after its label. @internal */
const countClass =
  "ms-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-foreground/15 px-1 text-[10px] leading-none tabular-nums";

/**
 * Liquid Glass for a window toolbar: a capsule of the theme's glass with a rim, and a glass thumb.
 *
 * @internal
 */
const glassGroupClass =
  // ButtonGroup's glass height class, so the docs CSS carries it once; cn's merge drops the group's own h-.
  "h-(--ouro-glass-h,calc(var(--spacing)*10)) " +
  "min-h-ouro-8 rounded-full [corner-shape:superellipse(1.05)] border border-(--ouro-glass-rim) " +
  "bg-[color-mix(in_oklab,var(--ouro-glass)_var(--ouro-glass-tint),transparent)] shadow-(--shadow-sm) backdrop-blur-xl " +
  "[&_[data-ouro-segment-thumb]]:rounded-full [&_[data-ouro-segment-thumb]]:bg-foreground/10 " +
  // Stryker disable next-line StringLiteral: a test cannot emulate reduced transparency (Playwright has no option for it)
  "[@media(prefers-reduced-transparency:reduce)]:bg-(--ouro-glass-solid) [@media(prefers-reduced-transparency:reduce)]:border-(--ouro-glass-edge) " +
  "[@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none " +
  "contrast-more:bg-(--ouro-glass-solid) contrast-more:border-current contrast-more:backdrop-blur-none";
