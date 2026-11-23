export { thumbClass, trackClass };

// Class strings for Switch, apart from the component so its file exports only components
// (React Fast Refresh). Class strings are literal so the app's Tailwind finds them when it
// compiles.

/**
 * The track: 40x24 on touch screens, beside a 24px label line, stepping down to 36x20 beside
 * a 20px line from the `sm` breakpoint with a fine pointer, so a landscape phone keeps the
 * phone size. Off, it is the muted surface inside a 1px `muted-foreground` hairline, which keeps
 * 3:1 against the page (WCAG 1.4.11); with more contrast the hairline is 2px. On, it fills with
 * the primary color, so on and off differ by fill, not only by hue. Its hit area is 44px on
 * touch screens.
 * `--ouro-switch-thumb` is the thumb's size at each density.
 *
 * @internal
 * @claim "Off, it is the muted surface" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > tells on from off without hue, with a 1px off hairline at 3:1 against the page, in light and dark)
 * @claim "with more contrast the hairline is" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > draws the off hairline 1px, and 2px with more contrast, with the thumb in the same place)
 * @claim "Its hit area is 44px on" registry/ouro/components/ouro/switch/switch.touch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.touch.test.tsx::gives the switch a 44px hit area, though it is 24px tall)
 * @claim "The track: 40x24 on touch screens" registry/ouro/components/ouro/switch/switch.touch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.touch.test.tsx::keeps the phone size and 16px label on a landscape phone, past the sm breakpoint)
 * @claim "which keeps 3:1 against the page" https://www.w3.org/TR/WCAG22/#non-text-contrast verify:urlOk(https://www.w3.org/TR/WCAG22/#non-text-contrast)
 * @claim "`--ouro-switch-thumb` is the thumb's size at" registry/ouro/components/ouro/switch/switch-styles.ts verify:fileLine(registry/ouro/components/ouro/switch/switch-styles.ts, /\[--ouro-switch-thumb:var\(--ouro-size-5\)\]\ssm:pointer-fine:\[--ouro-switch-thumb:var\(--ouro-size-4\)\]/)
 */
const trackClass =
  "group relative m-0 box-border inline-flex h-ouro-6 w-ouro-10 shrink-0 items-center p-px sm:pointer-fine:h-ouro-5 sm:pointer-fine:w-ouro-9 " +
  "[--ouro-switch-thumb:var(--ouro-size-5)] sm:pointer-fine:[--ouro-switch-thumb:var(--ouro-size-4)] " +
  "[--corner-shape:round] [corner-shape:round] rounded-full border border-solid border-muted-foreground bg-muted data-checked:border-primary data-checked:bg-primary " +
  // Forced colours drop the fill, so an on track would fall back to Canvas with no checked
  // state showing; set it explicitly to Highlight, to match the thumb's forced HighlightText.
  "forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight] " +
  // More contrast trades the padding for a 2px hairline, so the thumb keeps its place.
  "contrast-more:border-2 contrast-more:p-0 " +
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
 * It is Liquid Glass: a light tint of white, a thin rim and hairline and the theme's small
 * shadow; with reduced transparency or more contrast it
 * is a solid surface. The track's fill tells on from off.
 *
 * @internal
 * @claim "The thumb slides 16px in the" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > fills the track with the primary color and moves the thumb to the end when on)
 * @claim "While the pointer is down it" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > widens the thumb toward its travel while the pointer is down)
 * @claim "The thumb slides 16px in the" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch look and motion > stretches by scaling and slides on translate, never by animating its width, with one timing for both)
 */
const thumbClass =
  "pointer-events-none block size-(--ouro-switch-thumb) [--corner-shape:round] [corner-shape:round] rounded-full " +
  // The Quiet switch's lens: the glass tint over the track with a rim inside, a hairline outside and the theme's small shadow.
  // No backdrop filter, which made every large repaint slower in WebKit without a GPU (ourostack/ouro-ui#728): the thumb only
  // ever lies over its own track, so the lens is drawn. Off, the tint shows the track's muted fill, with the hairline's
  // colour fading in from the near edge as the filter's blur drew it; on, the tint is mixed into the primary fill,
  // saturated by the matrix saturate(1.6) applies.
  "bg-[color-mix(in_oklab,var(--ouro-glass)_var(--ouro-glass-tint),transparent)] " +
  "[box-shadow:inset_0_0_0_.75px_var(--ouro-glass-rim),0_0_0_.5px_var(--ouro-glass-edge),var(--shadow-sm)] " +
  "bg-[image:linear-gradient(to_right,color-mix(in_oklab,var(--muted-foreground)_14%,transparent),transparent_85%)] " +
  "rtl:bg-[image:linear-gradient(to_left,color-mix(in_oklab,var(--muted-foreground)_14%,transparent),transparent_85%)] " +
  "data-checked:bg-none data-checked:bg-[color-mix(in_srgb,var(--ouro-glass)_calc(var(--ouro-glass-tint)*2),var(--primary))] " +
  "supports-[color:color(from_red_srgb_r_g_b)]:data-checked:bg-[color-mix(in_srgb,var(--ouro-glass)_calc(var(--ouro-glass-tint)*2),color(from_var(--primary)_srgb_clamp(0,1.4722*r_-_0.429*g_-_0.0432*b,1)_clamp(0,-0.1278*r_+_1.171*g_-_0.0432*b,1)_clamp(0,-0.1278*r_-_0.429*g_+_1.5568*b,1)))] " +
  "[@media(prefers-reduced-transparency:reduce)]:bg-(--ouro-glass-solid) [@media(prefers-reduced-transparency:reduce)]:bg-none " +
  "contrast-more:bg-(--ouro-glass-solid) contrast-more:bg-none " +
  "forced-colors:bg-[ButtonText] forced-colors:data-checked:bg-[HighlightText] forced-colors:bg-none " +
  // Translate and origin have no logical form, so a right-to-left page reverses them: the thumb
  // starts at the inline start and slides toward the inline end either way.
  "translate-x-0 data-checked:translate-x-ouro-4 rtl:data-checked:-translate-x-ouro-4 " +
  "origin-left rtl:origin-right " +
  "motion-safe:[transition:translate_var(--ouro-duration-press)_var(--ouro-ease-out),scale_var(--ouro-duration-press)_var(--ouro-ease-out)] " +
  "motion-safe:group-active:not-data-disabled:scale-x-[1.2] " +
  "motion-safe:group-active:not-data-disabled:data-checked:translate-x-ouro-3 rtl:motion-safe:group-active:not-data-disabled:data-checked:-translate-x-ouro-3";
