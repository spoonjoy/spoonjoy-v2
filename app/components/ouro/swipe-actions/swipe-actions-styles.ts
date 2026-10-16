export {
  actionClass,
  actionTones,
  contentClass,
  fadeClass,
  FULL_SWIPE,
  menuClass,
  rootClass,
  sideOf,
  stripClass,
  stripTones,
  trackClass,
  type SwipeSide,
};

// Class strings, values and helpers for SwipeActions, apart from the component so its file
// exports only components (React Fast Refresh). Class strings are literal so the app's
// Tailwind finds them when it compiles.

/** A side of the row, in reading order: `leading` is the start edge, `trailing` the end edge. @internal */
type SwipeSide = "leading" | "trailing";

/** The share of the row's width a swipe must pass for its release to run the primary action. @internal */
const FULL_SWIPE = 0.6;

/**
 * The side an offset reveals: sliding the row toward the start (left, or right in a
 * right-to-left page) reveals the trailing actions.
 *
 * @internal
 */
function sideOf(offset: number, rtl: boolean): SwipeSide {
  return offset < 0 !== rtl ? "trailing" : "leading";
}

/**
 * The row. `touch-pan-y` gives the browser vertical pans, so a vertical swipe that starts
 * on a row scrolls the page, and leaves horizontal ones to the row. `overflow-clip` hides
 * the actions beside the row without making the row a scroller, which focus could scroll.
 *
 * @internal
 */
const rootClass = "group/swipe relative box-border min-w-0 touch-pan-y overflow-clip";

/**
 * What slides: the content, with the actions attached to its two edges. The component
 * writes its `transform` directly: under a finger it follows the finger, and on release a
 * spring carries it to rest from where it is (`lib/ouro/spring`). No CSS transition, which
 * a finger could not catch mid-way. It is on its own layer only while it moves: a layer
 * for every row of a long list at rest would cost memory and soften the row's text.
 *
 * @internal
 */
const trackClass = "relative flex min-w-0 items-center group-data-[dragging]/swipe:will-change-transform group-data-[ouro-settling]/swipe:will-change-transform pointer-coarse:min-h-11";

/** The row the app passes in. @internal */
const contentClass = "min-w-0 flex-1";

/**
 * The actions on one side, outside the content's edge until the row slides. The `::after`
 * continues the primary action's color past the buttons, so a swipe further than their
 * width shows no gap.
 *
 * @internal
 */
const stripClass = {
  leading: "absolute inset-y-0 end-full flex items-stretch after:absolute after:inset-y-0 after:end-full after:w-screen after:bg-inherit after:content-['']",
  trailing: "absolute inset-y-0 start-full flex items-stretch after:absolute after:inset-y-0 after:start-full after:w-screen after:bg-inherit after:content-['']",
} as const;

/** The color behind a side's actions: its primary action's. @internal */
const stripTones = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  destructive: "bg-destructive",
  success: "bg-success",
  warning: "bg-warning",
} as const;

/** One action: a block as tall as the row and at least 72px wide, with 16px text on a touch screen. @internal */
const actionClass =
  "press relative m-0 box-border inline-flex min-w-18 shrink-0 cursor-pointer items-center justify-center border-0 px-4 " +
  "text-base font-medium whitespace-nowrap pointer-fine:text-sm " +
  "outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid active:opacity-80";

/** @internal */
const actionTones = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
} as const;

/** An action that is not the primary one fades out past the full-swipe point, so the primary action's color fills the side. @internal */
const fadeClass = "group-data-full/swipe:opacity-0";

/**
 * The actions button's place at the end of the row. With a fine pointer it shows, 8px in
 * from the row's end so it does not touch the edge of an outlined group. On a touch screen
 * it is visually hidden, because the swipe and the long press are the ways there, and
 * stays in the accessibility tree; it shows when the keyboard focuses it, in a 44px column
 * so its touch target stays inside the row.
 *
 * @internal
 */
const menuClass =
  "flex shrink-0 justify-center pointer-fine:pe-2 pointer-coarse:[&:not(:has(:focus-visible))]:sr-only pointer-coarse:has-[:focus-visible]:min-w-11";
