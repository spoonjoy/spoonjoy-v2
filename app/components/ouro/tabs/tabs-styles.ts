export {
  activations,
  indicatorClass,
  linkIndicatorClass,
  linkItemClass,
  linkListClass,
  listClass,
  orientations,
  ownLook,
  panelClass,
  rootClass,
  tabClass,
  tabFaceClass,
  tabLinkClass,
};
export type { TabsActivation, TabsOrientation };

// Class strings and value lists for Tabs, apart from the components so their files export
// only components (React Fast Refresh). Class strings are literal so the app's Tailwind
// finds them when it compiles.

/**
 * The layouts Tabs supports: tabs in a row above the panel, or in a column beside it.
 *
 * @internal
 * @claim "The layouts Tabs supports: tabs in" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > puts vertical tabs in a row above the panel on a narrow screen)
 * @claim "The layouts Tabs supports: tabs in" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > renders a labelled tab list with the first tab selected and its panel shown)
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
 * The tab list. A hairline under the row (or on the column's end edge, the left in a right-to-left page) is an inset shadow, not a
 * border, so the row can scroll sideways on a narrow screen without clipping the indicator.
 * While it scrolls, a mask fades the side that hides more tabs (`data-fade`, set by TabsList).
 * The mask's `#000` only means opaque: a gradient mask is read for its alpha (`mask-mode:
 * match-source`), so no color of it reaches the page, whatever the theme.
 *
 * @internal
 * @claim "The mask's `#000` only means opaque" https://developer.mozilla.org/en-US/docs/Web/CSS/mask-mode verify:urlOk(https://developer.mozilla.org/en-US/docs/Web/CSS/mask-mode)
 */
const listClass =
  "relative z-0 m-0 box-border flex shrink-0 p-0 " +
  "data-[orientation=horizontal]:overflow-x-auto data-[orientation=horizontal]:[scrollbar-width:none] " +
  "data-[orientation=horizontal]:shadow-[inset_0_-1px_0_0_var(--border)] " +
  "data-[fade=right]:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] " +
  "data-[fade=left]:[mask-image:linear-gradient(to_left,#000_calc(100%-2rem),transparent)] " +
  "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%-2rem),transparent)] " +
  "data-[orientation=vertical]:flex-col data-[orientation=vertical]:shadow-[inset_-1px_0_0_0_var(--border)] " +
  "rtl:data-[orientation=vertical]:shadow-[inset_1px_0_0_0_var(--border)]";

/**
 * A tab: 44px tall with 16px text on a coarse pointer, stepping down to 36px and 14px from
 * `sm` with a fine pointer. The selected tab takes the foreground color, the others are
 * muted. The focus outline is inset, so the scrolling row never clips it. Under forced colours,
 * where the fill and the underline drop away, each tab draws a border, and the selected tab is
 * filled with Highlight and lettered in HighlightText.
 *
 * @internal
 * @claim "Under forced colours, where the fill" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > draws each tab's edge under forced colours, where its fill and the underline drop away)
 * @claim "Under forced colours, where the fill" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > shows which tab is selected under forced colours: Highlight behind it and HighlightText on it)
 * @claim "A tab: 44px tall with 16px" registry/ouro/components/ouro/tabs/tabs.touch.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.touch.test.tsx::keeps 44px tabs with 16px text on a phone, also in landscape)
 * @claim "The focus outline is inset, so" registry/ouro/components/ouro/tabs/tabs-styles.ts verify:fileLine(registry/ouro/components/ouro/tabs/tabs-styles.ts, /outline-ring\s-outline-offset-2\sfocus-visible:outline-2/)
 */
const tabClass =
  "group/tab press relative m-0 box-border inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap " +
  "h-(--ouro-tab-h) px-3 [--ouro-tab-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-tab-h:calc(var(--spacing)*9)] " +
  "pointer-coarse:min-w-11 justify-center data-[orientation=vertical]:justify-start " +
  "rounded-md border-0 bg-transparent text-base font-medium text-muted-foreground sm:pointer-fine:text-sm " +
  "forced-colors:border forced-colors:border-solid " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "not-data-disabled:pointer-fine:hover:text-foreground data-active:text-foreground " +
  "forced-colors:data-active:bg-[Highlight] forced-colors:data-active:text-[HighlightText] " +
  "outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The label and icon inside a tab, which take the press scale. The tab itself never
 * scales, because Base UI's indicator measures the tab's bounding box and a scaled box
 * would put the indicator off the tab.
 *
 * @internal
 * @claim "The tab itself never scales, because" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > slides the indicator with translate and resizes it with scale only, on the ease-in-out token in the base duration)
 * @claim "The tab itself never scales, because" registry/ouro/components/ouro/tabs/tabs-styles.ts verify:fileLine(registry/ouro/components/ouro/tabs/tabs-styles.ts, /motion-safe:group-not-data-disabled/tab:group-active/tab:scale-\(--ouro-press-scale\)/)
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
 * @claim "It is 1px long and scaled" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > slides the indicator with translate and resizes it with scale only, on the ease-in-out token in the base duration)
 * @claim "It is 1px long and scaled" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > slides the indicator under the selected tab)
 * @claim "It is 1px long and scaled" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > resizes the indicator between tabs of different width without ever changing its layout box, and keeps its ends square)
 * @claim "The line is never what Base" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > slides the indicator with translate and resizes it with scale only, on the ease-in-out token in the base duration)
 * @claim "The line is never what Base" registry/ouro/components/ouro/tabs/tabs-styles.ts verify:fileLine(registry/ouro/components/ouro/tabs/tabs-styles.ts, /motion-safe:group-not-data-disabled/tab:group-active/tab:scale-\(--ouro-press-scale\)/)
 */
const indicatorClass =
  "pointer-events-none absolute z-1 bg-primary " +
  "[transition-property:translate,scale] duration-(--ouro-duration-base) ease-(--ouro-ease-in-out) motion-reduce:transition-none in-data-ouro-keyboard:transition-none " +
  "data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:left-0 data-[orientation=horizontal]:h-0.5 " +
  "data-[orientation=horizontal]:w-px data-[orientation=horizontal]:origin-left data-[orientation=horizontal]:translate-x-(--active-tab-left) " +
  "data-[orientation=horizontal]:scale-x-[tan(atan2(var(--active-tab-width,0px),1px))] " +
  "data-[orientation=vertical]:top-0 data-[orientation=vertical]:end-0 data-[orientation=vertical]:w-0.5 " +
  "data-[orientation=vertical]:h-px data-[orientation=vertical]:origin-top data-[orientation=vertical]:translate-y-(--active-tab-top) " +
  "data-[orientation=vertical]:scale-y-[tan(atan2(var(--active-tab-height,0px),1px))]";

/**
 * The list of links when the tabs are links: the tab row's look, without the list's bullets.
 *
 * @internal
 */
const linkListClass = "list-none";

/**
 * One link's list item, which the link fills, so a column of links lines up on the hairline.
 *
 * @internal
 */
const linkItemClass = "m-0 flex p-0";

/**
 * A tab that is a link: the tab's look, filling its list item, without the link's underline.
 *
 * @internal
 */
const tabLinkClass = "flex-1 no-underline";

/**
 * The line under the current link (beside it, in a column). It is drawn inside the current
 * link, on the row's hairline, and stands still, since a link opens a page of its own.
 *
 * @internal
 */
const linkIndicatorClass =
  "pointer-events-none absolute z-1 bg-primary " +
  "data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:h-0.5 " +
  "data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:end-0 data-[orientation=vertical]:w-0.5";

/**
 * A panel. It fades in when its tab is selected; the old panel leaves at once, so the
 * layout never holds two panels.
 *
 * @internal
 * @claim "It fades in when its tab" registry/ouro/components/ouro/tabs/tabs.test.tsx verify:testExists(registry/ouro/components/ouro/tabs/tabs.test.tsx::Tabs > switches by key without animating the indicator or the panel, and by pointer with both)
 */
const panelClass =
  "min-w-0 flex-1 rounded-md outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) data-starting-style:opacity-0 data-ending-style:transition-none in-data-ouro-keyboard:transition-none";
