export { dotClass, radioClass };

// Class strings for Radio, apart from the components so each component file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds
// them when it compiles.

/**
 * The radio: a 20px circle on touch screens, beside a 24px label line, stepping down to
 * 16px beside a 20px line from the `sm` breakpoint with a fine pointer, so a landscape phone
 * keeps the phone size. Either way it sits 2px down, centered on the label's first line. It
 * fills with the primary color when chosen, presses in, and its hit area is 44px on touch
 * screens.
 *
 * @internal
 */
const radioClass =
  "press relative m-0 mt-0.5 box-border inline-flex size-5 shrink-0 items-center justify-center p-0 sm:pointer-fine:size-4 " +
  "rounded-full border border-solid border-muted-foreground bg-transparent dark:not-data-checked:bg-input/30 " +
  "data-checked:border-primary data-checked:bg-primary " +
  "aria-invalid:border-destructive " +
  "cursor-default select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "not-aria-invalid:not-data-disabled:not-data-checked:pointer-fine:hover:border-foreground " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The dot in a chosen radio: it grows in from 95% as it fades in, and with reduced motion only fades.
 *
 * @internal
 */
const dotClass =
  "pointer-events-none block size-2 rounded-full bg-primary-foreground sm:pointer-fine:size-1.5 " +
  "scale-95 opacity-0 data-checked:scale-100 data-checked:opacity-100 " +
  "motion-safe:[transition:scale_var(--ouro-duration-fast)_var(--ouro-ease-out),opacity_var(--ouro-duration-fast)_var(--ouro-ease-out)] " +
  "motion-reduce:scale-100 motion-reduce:transition-opacity motion-reduce:duration-(--ouro-duration-fast)";
