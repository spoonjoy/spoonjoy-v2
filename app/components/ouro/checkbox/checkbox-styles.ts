export { boxClass, dashClass, indicatorClass, tickClass };

// Class strings for Checkbox, apart from the components so each component
// file exports only components (React Fast Refresh). Class strings are literal so the app's
// Tailwind finds them when it compiles.

/**
 * The box: 20px on touch screens, beside a 24px label line, stepping down to 16px beside a
 * 20px line from the `sm` breakpoint with a fine pointer, so a landscape phone keeps the
 * phone size. Either way it sits 2px down, centered on the label's first line. It fills
 * with the primary color when checked or mixed, presses in, and its hit area is 44px on
 * touch screens.
 *
 * @internal
 * @claim "The box: 20px on touch screens" registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx::keeps the 20px box and 16px label on a landscape phone, past the sm breakpoint)
 * @claim "It fills with the primary color" registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx::gives the box a 44px hit area, though it is 20px)
 * @claim "The box: 20px on touch screens" registry/ouro/components/ouro/checkbox/checkbox.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.test.tsx::Checkbox look > is 16px beside 14px text with a fine pointer from sm, centered on the label's first line)
 * @claim "Either way it sits 2px down" registry/ouro/components/ouro/checkbox/checkbox.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.test.tsx::Checkbox look > is 16px beside 14px text with a fine pointer from sm, centered on the label's first line)
 */
const boxClass =
  "group press relative m-0 mt-0.5 box-border inline-flex size-5 shrink-0 items-center justify-center p-0 sm:pointer-fine:size-4 " +
  "rounded-sm border border-solid border-muted-foreground bg-transparent text-primary-foreground dark:not-data-checked:not-data-indeterminate:bg-input/30 " +
  "data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary " +
  "aria-invalid:border-destructive " +
  "cursor-default select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "not-aria-invalid:not-data-disabled:not-data-checked:not-data-indeterminate:pointer-fine:hover:border-foreground " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The indicator, kept mounted so the tick can fade out as well as in.
 *
 * @internal
 */
const indicatorClass = "pointer-events-none flex size-full items-center justify-center";

/**
 * The tick draws along its path (`pathLength` 1, so a dash of 1 is the whole tick, and its gap
 * of 2 leaves no empty dash at either end for a round cap to draw as a dot) once the box has filled: `stroke-dashoffset` from 1 to 0 over `--ouro-duration-draw`, starting after
 * `--ouro-duration-fast`. Unchecking takes it back along the same path at once, over
 * `--ouro-duration-fast`. With reduced motion nothing draws: the whole tick fades in and out.
 *
 * @internal
 * @claim "The tick draws along its path" registry/ouro/components/ouro/checkbox/checkbox.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.test.tsx::Checkbox look > fills the box, then draws the tick along its path, and only fades and recolours with reduced motion)
 */
const tickClass =
  "[stroke-dasharray:1_2] [stroke-dashoffset:1] group-data-checked:[stroke-dashoffset:0] group-data-indeterminate:hidden " +
  "motion-safe:[transition:stroke-dashoffset_var(--ouro-duration-fast)_var(--ouro-ease-out)] " +
  "motion-safe:group-data-checked:[transition:stroke-dashoffset_var(--ouro-duration-draw)_var(--ouro-ease-out)_var(--ouro-duration-fast)] " +
  "motion-reduce:[stroke-dashoffset:0] motion-reduce:opacity-0 motion-reduce:group-data-checked:opacity-100 " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_var(--ouro-ease-out)]";

/**
 * The dash a mixed box shows in place of the tick.
 *
 * @internal
 */
const dashClass = "hidden group-data-indeterminate:block";

