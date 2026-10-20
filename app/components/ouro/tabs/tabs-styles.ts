export { activations, indicatorClass, listClass, orientations, ownLook, panelClass, rootClass, tabClass, tabFaceClass };
export type { TabsActivation, TabsOrientation };

// Class strings and value lists for Tabs, apart from the components so their files export
// only components (React Fast Refresh). Class strings are literal so the app's Tailwind
// finds them when it compiles.

/**
 * The layouts Tabs supports: tabs in a row above the panel, or in a column beside it.
 *
 * @internal
 */
const orientations = ["horizontal", "vertical"] as const;

/** `horizontal` puts the tabs in a row above the panel; `vertical` in a column beside it. */
type TabsOrientation = (typeof orientations)[number];

/**
 * How the keyboard selects a tab.
 *
 * @internal
 */
const activations = ["automatic", "manual"] as const;

/** `automatic` selects a tab when the arrow keys focus it; `manual` waits for Enter or Space. */
type TabsActivation = (typeof activations)[number];

/**
 * The `Fix:` for an appearance class on a part that draws its own look.
 *
 * @internal
 */
function ownLook(component: string): (token: string) => string {
  return (token) => `remove "${token}"; ${component} sets its own look`;
}

/**
 * The root: the list above (or beside) the panel.
 *
 * @internal
 */
const rootClass = "flex min-w-0 gap-4 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:flex-row";

/**
 * The tab list. A hairline under the row (or beside the column) is an inset shadow, not a
 * border, so the row can scroll sideways on a narrow screen without clipping the indicator.
 * While it scrolls, a mask fades the side that hides more tabs (`data-fade`, set by TabsList).
 * The mask's `#000` only means opaque: a gradient mask is read for its alpha (`mask-mode:
 * match-source`), so no color of it reaches the page, whatever the theme.
 *
 * @internal
 */
const listClass =
  "relative z-0 m-0 box-border flex shrink-0 p-0 " +
  "data-[orientation=horizontal]:overflow-x-auto data-[orientation=horizontal]:[scrollbar-width:none] " +
  "data-[orientation=horizontal]:shadow-[inset_0_-1px_0_0_var(--border)] " +
  "data-[fade=right]:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] " +
  "data-[fade=left]:[mask-image:linear-gradient(to_left,#000_calc(100%-2rem),transparent)] " +
  "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%-2rem),transparent)] " +
  "data-[orientation=vertical]:flex-col data-[orientation=vertical]:shadow-[inset_-1px_0_0_0_var(--border)]";

/**
 * A tab: 44px tall with 16px text on a coarse pointer, stepping down to 36px and 14px from
 * `sm` with a fine pointer. The selected tab takes the foreground color, the others are
 * muted. The focus outline is inset, so the scrolling row never clips it.
 *
 * @internal
 */
const tabClass =
  "group/tab press relative m-0 box-border inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap " +
  "h-(--ouro-tab-h) px-3 [--ouro-tab-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-tab-h:calc(var(--spacing)*9)] " +
  "pointer-coarse:min-w-11 justify-center data-[orientation=vertical]:justify-start " +
  "rounded-md border-0 bg-transparent text-base font-medium text-muted-foreground sm:pointer-fine:text-sm " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "not-data-disabled:pointer-fine:hover:text-foreground data-active:text-foreground " +
  "outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The label and icon inside a tab, which take the press scale. The tab itself never
 * scales, because Base UI's indicator measures the tab's bounding box and a scaled box
 * would put the indicator off the tab.
 *
 * @internal
 */
const tabFaceClass =
  "inline-flex items-center gap-2 [transition:scale_var(--ouro-duration-press)_var(--ouro-ease-out)] " +
  "motion-safe:group-not-data-disabled/tab:group-active/tab:scale-(--ouro-press-scale)";

/**
 * The line under the selected tab (beside it, in a column). It is 1px long and scaled to the
 * selected tab's width (a unitless factor from Base UI's length), so it slides with `translate`
 * and resizes with `scale`, both on the ease-in-out token, and nothing lays out again. It has
 * square ends because a scaled radius would distort. The line is never what Base UI measures,
 * and the tab never scales. With reduced motion, or while the keys move the selection, it
 * moves without a transition.
 *
 * @internal
 */
const indicatorClass =
  "pointer-events-none absolute z-1 bg-primary " +
  "[transition-property:translate,scale] duration-(--ouro-duration-base) ease-(--ouro-ease-in-out) motion-reduce:transition-none in-data-ouro-keyboard:transition-none " +
  "data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:left-0 data-[orientation=horizontal]:h-0.5 " +
  "data-[orientation=horizontal]:w-px data-[orientation=horizontal]:origin-left data-[orientation=horizontal]:translate-x-(--active-tab-left) " +
  "data-[orientation=horizontal]:scale-x-[tan(atan2(var(--active-tab-width,0px),1px))] " +
  "data-[orientation=vertical]:top-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:w-0.5 " +
  "data-[orientation=vertical]:h-px data-[orientation=vertical]:origin-top data-[orientation=vertical]:translate-y-(--active-tab-top) " +
  "data-[orientation=vertical]:scale-y-[tan(atan2(var(--active-tab-height,0px),1px))]";

/**
 * A panel. It fades in when its tab is selected; the old panel leaves at once, so the
 * layout never holds two panels.
 *
 * @internal
 */
const panelClass =
  "min-w-0 flex-1 rounded-md outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) data-starting-style:opacity-0 data-ending-style:transition-none in-data-ouro-keyboard:transition-none";
