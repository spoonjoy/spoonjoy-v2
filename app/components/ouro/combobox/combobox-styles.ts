export {
  chipClass,
  chipRemoveClass,
  chipsGroupClass,
  chipsInputClass,
  emptyClass,
  itemClass,
  listClass,
  popupClass,
  sheetClearClass,
  sheetChipsClass,
  sheetChipsFieldClass,
  sheetChipsTriggerClass,
  sheetFieldClass,
  sheetInputClass,
  sheetListClass,
  statusClass,
  triggerClass,
};

// Class strings for Combobox, apart from the component so its file exports only components
// (React Fast Refresh). Class strings are literal so the app's Tailwind finds them when it
// compiles. The one-line box reuses TextField's classes; these are what Combobox adds.

/**
 * The box with chips (`multiple`): Field's control look, but at least one control tall and
 * growing a row at a time as the chips wrap. The chips start past its corner's curve: the start
 * inset is the corner's radius (`--ouro-sq-r`, which its `rounded-ouro-control-md` sets), and at least 8px.
 *
 * @internal
 * @claim "The chips start past its corner's curve" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox chips clear the field's corner > starts one chip and wrapped rows of chips past %s, with a gap between the rows)
 */
const chipsGroupClass =
  "relative m-0 box-border flex w-full min-w-0 flex-wrap items-center gap-2 py-2 ps-[max(calc(var(--spacing)*2),var(--ouro-sq-r))] pe-3 cursor-text " +
  "min-h-(--ouro-control-h) [--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-ouro-control-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "ouro-field-cue outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "has-[input[aria-invalid=true]]:border-destructive has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 " +
  "dark:bg-input/30";

/**
 * The input after the chips: it takes the rest of the row, and wraps to its own row when
 * the chips leave it too little room.
 *
 * @internal
 */
const chipsInputClass =
  "m-0 box-border h-8 min-w-16 flex-1 border-0 bg-transparent ps-1.5 py-0 sm:pointer-fine:h-6 " +
  "text-[length:inherit] text-inherit font-[inherit] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed";

/**
 * A chip: the picked item's label and its remove button, on the secondary surface. It
 * shows the focus outline while the keyboard is on it (Left Arrow from the input's start).
 *
 * @internal
 */
const chipClass =
  "inline-flex h-8 max-w-full min-w-0 items-center gap-0.5 rounded-ouro-sm bg-secondary ps-2 text-sm text-secondary-foreground " +
  "sm:pointer-fine:h-6 outline-ring outline-offset-1 data-highlighted:outline-2 data-highlighted:outline-solid " +
  "[&>span]:truncate";

/**
 * A chip's remove button: a square as tall as the chip, with a 44px hit area on a coarse
 * pointer (its `TouchTarget`).
 *
 * @internal
 * @claim "A chip's remove button: a square" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > gives chip remove buttons a 44px hit area)
 */
const chipRemoveClass =
  "press relative m-0 box-border inline-flex aspect-square h-full min-h-ouro-5 shrink-0 items-center justify-center rounded-ouro-sm border-0 p-0 " +
  "bg-transparent text-inherit cursor-pointer [-webkit-tap-highlight-color:transparent] pointer-fine:hover:bg-accent active:bg-accent motion-safe:active:scale-(--ouro-press-scale) " +
  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid";

/**
 * The popup: the input's width, on the popover surface. It opens at once and closes with a
 * 150ms fade and scale toward the input; with reduced motion it only fades. Its height
 * fits the screen above or below the input.
 *
 * @internal
 * @claim "It opens at once and closes" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox looks > closes with only a fade when reduced motion is on)
 * @claim "It opens at once and closes" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox motion > scales about the point Base UI computes next to its input, and leaves on the ease-out token)
 */
const popupClass =
  "box-border flex w-(--anchor-width) max-w-(--available-width) max-h-[min(var(--available-height),22rem)] flex-col " +
  "origin-(--transform-origin) overflow-hidden rounded-ouro-md border border-solid border-border bg-popover text-popover-foreground [--ouro-scroller-surface:var(--popover)] [--ouro-message-list-bubble-default:var(--muted)] " +
  "shadow-(--shadow-lg) outline-none " +
  "[transition:opacity_var(--ouro-duration-fast)_var(--ouro-ease-out),scale_var(--ouro-duration-fast)_var(--ouro-ease-out)] " +
  "data-starting-style:transition-none data-ending-style:opacity-0 data-ending-style:scale-95 " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_var(--ouro-ease-out)] motion-reduce:data-ending-style:scale-100";

/**
 * The list of items: it scrolls inside the popup.
 *
 * @internal
 */
const listClass = "box-border min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 scroll-py-1 outline-none data-empty:p-0";

/**
 * An item: 44px tall on phones and 32px with a fine pointer from `sm`, with a check before
 * the picked ones. The keyboard's or pointer's highlight uses the accent surface.
 *
 * @internal
 * @claim "An item: 44px tall on phones" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox looks > uses a 16px font and a 44px box on phones, stepping down with a mouse on wider screens)
 * @claim "An item: 44px tall on phones" registry/ouro/components/ouro/combobox/combobox.tsx verify:fileLine(registry/ouro/components/ouro/combobox/combobox.tsx, /<BaseCombobox.ItemIndicator\sclassName="col-start-1\sflex">/)
 */
const itemClass =
  "relative box-border grid min-h-ouro-11 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-ouro-sm px-2 py-1.5 " +
  "text-base leading-5 outline-ring -outline-offset-2 select-none sm:pointer-fine:min-h-8 sm:pointer-fine:text-sm " +
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:outline-2 data-highlighted:outline-solid " +
  "not-data-disabled:active:bg-accent not-data-disabled:active:text-accent-foreground " +
  // Forced colours drop the fill, so the highlight takes the system's pair; its own outline still shows the option apart.
  "forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText] " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The line that says nothing matched.
 *
 * @internal
 */
const emptyClass = "box-border px-3 py-2 text-sm leading-5 text-muted-foreground empty:hidden";

/**
 * The loading line: a spinner and the loading label.
 *
 * @internal
 */
const statusClass = "box-border flex items-center gap-2 px-3 py-2 text-sm leading-5 text-muted-foreground empty:hidden";

/**
 * The control on a phone: a button that looks like the input box and opens the sheet. It
 * shows the picked label, or the placeholder in the muted color.
 *
 * @internal
 */
const triggerClass =
  "relative m-0 box-border flex w-full min-w-0 items-center justify-between gap-2 h-(--ouro-control-h) px-3 py-0 " +
  "[--ouro-control-h:calc(var(--spacing)*11)] rounded-ouro-control-md border border-solid border-input bg-transparent " +
  "text-start text-base text-foreground font-[inherit] cursor-pointer [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "not-disabled:active:bg-accent/60 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 " +
  "data-placeholder:text-muted-foreground [&>span]:truncate [&_svg]:shrink-0 [&_svg]:text-muted-foreground " +
  "group-has-[[data-ouro-combobox-clear]]/combobox-field:[&>span]:me-10";

/**
 * The field on a phone: the button, with the clear button over its end, before the chevron.
 *
 * @internal
 */
const sheetFieldClass = "group/combobox-field relative min-w-0";

/**
 * The field on a phone with `multiple`: the button under the chips, which grows a row at a
 * time as they wrap.
 *
 * @internal
 */
const sheetChipsFieldClass = "group/combobox-field relative grid min-w-0 [--ouro-control-h:calc(var(--spacing)*11)]";

/**
 * The button under a phone's chips: the field's whole box, so a tap anywhere but a remove
 * button opens the sheet, and its outline, pressed tint and invalid border cover the chips.
 *
 * @internal
 */
const sheetChipsTriggerClass =
  "relative col-start-1 row-start-1 m-0 box-border flex h-full min-h-(--ouro-control-h) w-full min-w-0 items-center justify-between gap-2 px-3 py-0 " +
  "[--ouro-control-h:calc(var(--spacing)*11)] rounded-ouro-control-md border border-solid border-input bg-transparent " +
  "text-start text-base text-foreground font-[inherit] cursor-pointer [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "not-disabled:active:bg-accent/60 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 " +
  "data-placeholder:text-muted-foreground [&>span]:truncate [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * A phone's chips, over the button: they wrap, leaving the chevron its room. Only the remove
 * buttons take a tap; the rest goes through to the button. They start past the button's corner
 * curve: the start inset is the radius its `rounded-ouro-control-md` gives it (the control radius,
 * at most half the control's height), and at least 6px.
 *
 * @internal
 * @claim "They start past the button's corner" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox chips on a phone clear the field's corner > starts one chip and wrapped rows of chips past %s, with a gap between the rows)
 */
const sheetChipsClass =
  "pointer-events-none relative col-start-1 row-start-1 box-border flex min-w-0 flex-wrap items-center gap-1.5 self-center py-1.5 pe-9 " +
  "ps-[max(calc(var(--spacing)*1.5),min(calc(var(--ouro-control-radius,var(--radius)*0.8)*var(--ouro-radius-scale,1)),calc(var(--ouro-control-h)/2)))] " +
  "empty:hidden [&_button]:pointer-events-auto";

/**
 * The clear button on a phone, over the end of the field's button, left of the chevron. It
 * keeps a 44px hit area (its `TouchTarget`).
 *
 * @internal
 * @claim "It keeps a 44px hit area" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > gives chip remove buttons a 44px hit area)
 */
const sheetClearClass = "absolute inset-y-0 end-9 my-auto";

/**
 * The search input pinned at the top of the sheet.
 *
 * @internal
 */
const sheetInputClass =
  "sticky top-0 z-1 -mx-5 -mt-2 mb-2 box-border flex bg-popover px-5 pt-2 pb-2";

/**
 * The sheet's list: items fill the width and scroll with the sheet's body.
 *
 * @internal
 */
const sheetListClass = "box-border -mx-2 outline-none";
