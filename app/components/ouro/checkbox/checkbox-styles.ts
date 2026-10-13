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
 */
const boxClass =
  "group press relative m-0 mt-0.5 box-border inline-flex size-5 shrink-0 items-center justify-center p-0 sm:pointer-fine:size-4 " +
  "rounded-sm border border-solid border-muted-foreground bg-transparent text-primary-foreground dark:not-data-checked:not-data-indeterminate:bg-input/30 " +
  "data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary " +
  "aria-invalid:border-destructive " +
  "cursor-default select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "not-aria-invalid:not-data-disabled:not-data-checked:not-data-indeterminate:hover:border-foreground " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) active:duration-(--ouro-duration-fast) active:ease-out " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The indicator, kept mounted so the tick can draw itself and undraw.
 *
 * @internal
 */
const indicatorClass = "pointer-events-none flex size-full items-center justify-center";

/**
 * The tick draws itself along its path when the box is checked, as in RedwoodUI. With
 * reduced motion it fades in instead.
 *
 * @internal
 */
const tickClass =
  "[stroke-dasharray:1] [stroke-dashoffset:1] group-data-checked:[stroke-dashoffset:0] group-data-indeterminate:hidden " +
  "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-(--ouro-duration-base) motion-safe:ease-out " +
  "motion-reduce:[stroke-dashoffset:0] motion-reduce:opacity-0 motion-reduce:group-data-checked:opacity-100 " +
  "motion-reduce:transition-opacity motion-reduce:duration-(--ouro-duration-fast)";

/**
 * The dash a mixed box shows in place of the tick.
 *
 * @internal
 */
const dashClass = "hidden group-data-indeterminate:block";

