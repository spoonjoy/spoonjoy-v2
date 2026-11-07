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
 * @claim "Off, it is an outline: a" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > tells on from off without hue, with an off outline at 3:1 against the page, in light and dark)
 * @claim "Its hit area is 44px on" registry/ouro/components/ouro/switch/switch.touch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.touch.test.tsx::gives the switch a 44px hit area, though it is 24px tall)
 * @claim "The track: 40x24 on touch screens" registry/ouro/components/ouro/switch/switch.touch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.touch.test.tsx::keeps the phone size and 16px label on a landscape phone, past the sm breakpoint)
 * @claim "Off, it is an outline" https://www.w3.org/TR/WCAG22/#non-text-contrast verify:urlOk(https://www.w3.org/TR/WCAG22/#non-text-contrast)
 * @claim "`--ouro-switch-thumb` is the thumb's size at" registry/ouro/components/ouro/switch/switch-styles.ts verify:fileLine(registry/ouro/components/ouro/switch/switch-styles.ts, /\[--ouro-switch-thumb:calc\(var\(--spacing\)\*5\)\]\ssm:pointer-fine:\[--ouro-switch-thumb:calc\(var\(--spacing\)\*4\)\]/)
 */
const trackClass =
  "group relative m-0 box-border inline-flex h-6 w-10 shrink-0 items-center p-0 sm:pointer-fine:h-5 sm:pointer-fine:w-9 " +
  "[--ouro-switch-thumb:calc(var(--spacing)*5)] sm:pointer-fine:[--ouro-switch-thumb:calc(var(--spacing)*4)] " +
  "rounded-full border-2 border-solid border-muted-foreground bg-transparent data-checked:border-primary data-checked:bg-primary " +
  "transition-[background-color,border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "cursor-default select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "aria-invalid:ring-2 aria-invalid:ring-destructive " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The thumb slides 16px in the press duration when the switch turns on or off. While the
 * pointer is down it stretches 4px toward the way it will travel: toward the inline end when
 * off, toward the start when on (right and left in a left-to-right page). With reduced motion it
 * neither slides nor stretches.
 * It is `muted-foreground` when off and `primary-foreground` when on, so the thumb's color
 * also tells the states apart.
 *
 * @internal
 * @claim "The thumb slides 16px in the" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > fills the track with the primary color and moves the thumb to the end when on)
 * @claim "While the pointer is down it" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > widens the thumb toward its travel while the pointer is down)
 * @claim "The thumb slides 16px in the" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > stretches by scaling and slides on translate, never by animating its width, with one timing for both)
 */
const thumbClass =
  "pointer-events-none block size-(--ouro-switch-thumb) rounded-full bg-muted-foreground data-checked:bg-primary-foreground shadow-(--shadow-sm) " +
  // Translate and origin have no logical form, so a right-to-left page reverses them: the thumb
  // starts at the inline start and slides toward the inline end either way.
  "translate-x-0 data-checked:translate-x-4 rtl:data-checked:-translate-x-4 " +
  "origin-left rtl:origin-right " +
  "motion-safe:[transition:translate_var(--ouro-duration-press)_var(--ouro-ease-out),scale_var(--ouro-duration-press)_var(--ouro-ease-out)] " +
  "motion-safe:group-active:not-data-disabled:scale-x-[1.2] " +
  "motion-safe:group-active:not-data-disabled:data-checked:translate-x-3 rtl:motion-safe:group-active:not-data-disabled:data-checked:-translate-x-3";
