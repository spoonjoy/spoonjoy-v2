export { groupClass, labelClass, ownLook, rootClass, segmentClass, thumbClass };

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

/**
 * The label, as Field draws it.
 *
 * @internal
 */
const labelClass = "m-0 block text-sm leading-5 font-medium text-foreground select-none";

/**
 * The track: equal columns, one per segment, as wide as the longest label needs. 44px tall on
 * a coarse pointer, stepping down to 36px from `sm` with a fine pointer.
 *
 * @internal
 */
const groupClass =
  "relative isolate m-0 box-border inline-grid max-w-full grid-flow-col auto-cols-[minmax(0,1fr)] p-0.5 " +
  "h-(--ouro-segmented-h) [--ouro-segmented-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-segmented-h:calc(var(--spacing)*9)] " +
  "rounded-lg bg-muted";

/**
 * The raised thumb behind the pressed segment. Segments are equal, so its place is the
 * pressed index times its own width: no measuring, and server HTML already has it right.
 * It slides on the ease-in-out token; with reduced motion, or on an arrow key, it moves at once.
 *
 * @internal
 */
const thumbClass =
  "pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 -z-1 rounded-md " +
  "w-[calc((100%-var(--spacing)*1)/var(--ouro-segment-count))] translate-x-[calc(var(--ouro-segment-index)*100%)] " +
  "bg-background dark:bg-[color-mix(in_oklab,var(--foreground)_16%,var(--muted))] " +
  "shadow-(--shadow-sm) " +
  "[transition:translate_var(--ouro-duration-base)_var(--ouro-ease-in-out),opacity_var(--ouro-duration-fast)_ease] " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease] in-data-ouro-keyboard:[transition:none]";

/**
 * A segment: muted text, the foreground when pressed. The muted text is mixed 20% toward the
 * foreground, so it keeps 4.5:1 on the muted track under shadcn's stock values too (plain
 * `text-muted-foreground` there is 4.34:1).
 *
 * @internal
 */
const segmentClass =
  "press relative m-0 box-border flex min-w-0 cursor-pointer items-center justify-center px-3 pointer-coarse:min-w-11 " +
  "rounded-md border-0 bg-transparent text-base font-medium whitespace-nowrap text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))] sm:pointer-fine:text-sm " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "not-data-disabled:pointer-fine:hover:text-foreground data-pressed:text-foreground " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) " +
  "outline-ring outline-offset-1 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";
