export { thumbClass, trackClass };

// Class strings for Switch, apart from the component so its file exports only components
// (React Fast Refresh). Class strings are literal so the app's Tailwind finds them when it
// compiles.

/**
 * The track: 40x24 on touch screens, beside a 24px label line, stepping down to 36x20 beside
 * a 20px line from the `sm` breakpoint with a fine pointer, so a landscape phone keeps the
 * phone size. Off, it is an outline: a `muted-foreground` border that keeps 3:1 against the
 * page (WCAG 1.4.11) around the page color. On, it fills with the primary color, so on and
 * off differ by fill, not only by hue. Its hit area is 44px on touch screens.
 * `--ouro-switch-thumb` is the thumb's size at each density.
 *
 * @internal
 */
const trackClass =
  "group relative m-0 box-border inline-flex h-6 w-10 shrink-0 items-center p-0 sm:pointer-fine:h-5 sm:pointer-fine:w-9 " +
  "[--ouro-switch-thumb:calc(var(--spacing)*5)] sm:pointer-fine:[--ouro-switch-thumb:calc(var(--spacing)*4)] " +
  "rounded-full border-2 border-solid border-muted-foreground bg-transparent data-checked:border-primary data-checked:bg-primary " +
  "transition-[background-color,border-color] duration-(--ouro-duration-fast) ease-out " +
  "cursor-default select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "aria-invalid:ring-2 aria-invalid:ring-destructive " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The thumb slides 16px with the theme spring when the switch turns on or off. While the
 * pointer is down it stretches 4px toward the way it will travel, as in RedwoodUI: to the
 * right when off, to the left when on. With reduced motion it neither slides nor stretches.
 * It is `muted-foreground` when off and `primary-foreground` when on, so the thumb's color
 * also tells the states apart.
 *
 * @internal
 */
const thumbClass =
  "pointer-events-none block size-(--ouro-switch-thumb) rounded-full bg-muted-foreground data-checked:bg-primary-foreground shadow-sm " +
  "translate-x-0 data-checked:translate-x-4 " +
  "motion-safe:[transition:translate_var(--ouro-spring-duration)_var(--ouro-ease-spring),width_var(--ouro-spring-duration)_var(--ouro-ease-spring)] " +
  "motion-safe:group-active:not-data-disabled:w-[calc(var(--ouro-switch-thumb)+4px)] " +
  "motion-safe:group-active:not-data-disabled:data-checked:translate-x-3";
