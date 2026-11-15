export { groupClass, labelClass, ownLook, revealClass, rootClass, segmentClass, thumbClass };

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
  "rounded-lg bg-muted forced-colors:border forced-colors:border-solid";

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
  "pointer-events-none absolute top-0.5 bottom-0.5 -z-1 rounded-md " +
  "[position-anchor:--ouro-segment] start-[anchor(start)] end-[anchor(end)] " +
  "forced-colors:bg-[Highlight] " +
  "bg-background dark:bg-[color-mix(in_oklab,var(--foreground)_16%,var(--muted))] " +
  "shadow-(--shadow-sm) " +
  "[transition:inset-inline-start_var(--ouro-duration-base)_var(--ouro-ease-in-out),inset-inline-end_var(--ouro-duration-base)_var(--ouro-ease-in-out),opacity_var(--ouro-duration-fast)_ease] " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease] in-data-ouro-keyboard:[transition:none]";

/**
 * A segment: muted text, the foreground when pressed. The muted text is mixed 20% toward the
 * foreground, for more contrast on the muted track than plain `text-muted-foreground` has.
 * Under forced colours the pressed segment is lettered in HighlightText on the thumb's Highlight.
 * Hover lifts only the other segments' text, so the pointer resting on the pressed segment never
 * turns its letters back to the page's text colour.
 *
 * @internal
 * @claim "Hover lifts only the other segments'" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > keeps HighlightText on the pressed segment under forced colours while the pointer rests on it)
 * @claim "The muted text is mixed 20%" registry/ouro/components/ouro/segmented-control/segmented-control-styles.ts verify:fileLine(registry/ouro/components/ouro/segmented-control/segmented-control-styles.ts, /text-\[color-mix\(in_oklab,var\(--muted-foreground\)_80%,var\(--foreground\)\)\]/)
 */
const segmentClass =
  "press relative m-0 box-border flex cursor-pointer items-center justify-center px-3 pointer-coarse:min-w-11 " +
  "rounded-md border-0 bg-transparent text-base font-medium whitespace-nowrap text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))] sm:pointer-fine:text-sm " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "not-data-disabled:not-data-pressed:pointer-fine:hover:text-foreground data-pressed:text-foreground forced-colors:data-pressed:text-[HighlightText] " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) data-pressed:[anchor-name:--ouro-segment] " +
  "outline-ring outline-offset-1 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";
