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
 * @claim "The radio: a 20px circle on" registry/ouro/components/ouro/radio-group/radio-group.touch.test.tsx verify:testExists(registry/ouro/components/ouro/radio-group/radio-group.touch.test.tsx::picks on a tap on a label, and keeps the phone size on a landscape phone) verify:fileLine(registry/ouro/components/ouro/radio-group/radio-group-styles.ts, /size-5 shrink-0 items-center justify-center p-0 sm:pointer-fine:size-4/)
 * @claim "It fills with the primary color" registry/ouro/components/ouro/radio-group/radio-group.touch.test.tsx verify:testExists(registry/ouro/components/ouro/radio-group/radio-group.touch.test.tsx::keeps each radio's 44px hit area clear of its neighbors')
 * @claim "It fills with the primary color" registry/ouro/components/ouro/radio-group/radio-group.test.tsx verify:testExists(registry/ouro/components/ouro/radio-group/radio-group.test.tsx::RadioGroup > fills the chosen radio with the primary color and shows its dot)
 * @claim "Either way it sits 2px down" registry/ouro/components/ouro/radio-group/radio-group-styles.ts verify:fileLine(registry/ouro/components/ouro/radio-group/radio-group-styles.ts, /press\srelative\sm-0\smt-0\.5\sbox-border\sinline-flex\ssize-5/)
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
 * @claim "The dot in a chosen radio" registry/ouro/components/ouro/radio-group/radio-group.test.tsx verify:testExists(registry/ouro/components/ouro/radio-group/radio-group.test.tsx::RadioGroup > grows the dot in from 95% as it fades in, never from nothing, and only fades with reduced motion)
 */
const dotClass =
  "pointer-events-none block size-2 rounded-full bg-primary-foreground sm:pointer-fine:size-1.5 " +
  "scale-95 opacity-0 data-checked:scale-100 data-checked:opacity-100 " +
  "motion-safe:[transition:scale_var(--ouro-duration-fast)_var(--ouro-ease-out),opacity_var(--ouro-duration-fast)_var(--ouro-ease-out)] " +
  "motion-reduce:scale-100 motion-reduce:transition-opacity motion-reduce:duration-(--ouro-duration-fast)";
