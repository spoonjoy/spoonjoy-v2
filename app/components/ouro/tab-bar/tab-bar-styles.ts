export { accessoryClass, barClass, breakpoints, iconClass, labelClass, listClass, rootClass, tabClass };

// Class strings are literal so the app's Tailwind finds them when it compiles.

/**
 * The root holds the bar's room at the end of the page, so the last of the content scrolls
 * clear of it: the bar's 64px, the gap above it and the gap below it (at least the phone's
 * home-indicator inset). The bar itself is fixed to the bottom of the screen.
 * @claim "The root holds the bar's room" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > sits fixed at the bottom of a phone screen, with equal 64px tabs, and keeps its room in the page)
 */
const rootClass = "block h-[calc(5rem+max(1rem,env(safe-area-inset-bottom,0px)))] shrink-0 print:hidden";

/** Where the bar hides, because the app's Navbar or Sidebar takes over from there. */
const breakpoints = {
  sm: "sm:hidden",
  md: "md:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
  never: "",
} as const;

/**
 * The bar, fixed to the bottom of the screen. While the on-screen keyboard is up
 * (`data-closed`) it slides below the screen and fades; with reduced motion it fades in place.
 */
const barClass =
  "fixed inset-x-0 bottom-0 z-(--ouro-layer) mx-auto mb-[max(1rem,env(safe-area-inset-bottom,0px))] box-border flex max-w-lg items-center gap-2 " +
  "ps-[max(0.75rem,env(safe-area-inset-left,0px))] pe-[max(0.75rem,env(safe-area-inset-right,0px))] " +
  "transition-[translate,opacity] duration-(--ouro-duration-base) ease-(--ouro-ease-out) " +
  "data-closed:pointer-events-none data-closed:translate-y-[calc(100%+max(1rem,env(safe-area-inset-bottom,0px)))] data-closed:opacity-0 " +
  "motion-reduce:transition-opacity motion-reduce:duration-(--ouro-duration-fast) motion-reduce:data-closed:translate-y-0";

/**
 * One solid surface for the tabs and the accessory, so no page content shows through.
 *
 * @claim "One solid surface for the tabs" registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx verify:testExists(registry/ouro/components/ouro/tab-bar/tab-bar.test.tsx::TabBar > sits fixed at the bottom of a phone screen, with equal 64px tabs, and keeps its room in the page)
 */
const surface = "bg-popover text-muted-foreground ring-1 ring-border/60 shadow-(--shadow-lg) forced-colors:border forced-colors:border-solid";

const listClass = `m-0 box-border flex h-16 min-w-0 flex-1 list-none items-stretch rounded-full p-1 ${surface}`;

/**
 * A tab: the icon over a short label. The current page's tab has the accent wash; a press
 * scales it (not with reduced motion), and the colors ease.
 */
const tabClass =
  "press relative box-border flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-0.5 no-underline " +
  "text-muted-foreground select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "pointer-fine:hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground " +
  "forced-colors:aria-[current=page]:outline-2 forced-colors:aria-[current=page]:outline-solid " +
  "motion-safe:active:scale-(--ouro-press-scale) outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

const iconClass = "flex size-[1.375rem] shrink-0 items-center justify-center [&>svg]:size-full";

const labelClass = "max-w-full truncate text-[0.6875rem] leading-none font-semibold tracking-[0.01em]";

/** The accessory sits apart in a circle of its own, as tall as the bar. */
const accessoryClass =
  `press relative box-border grid size-16 shrink-0 place-items-center rounded-full no-underline ${surface} ` +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "pointer-fine:hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground " +
  "forced-colors:aria-[current=page]:outline-2 forced-colors:aria-[current=page]:outline-solid " +
  "motion-safe:active:scale-(--ouro-press-scale) outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
