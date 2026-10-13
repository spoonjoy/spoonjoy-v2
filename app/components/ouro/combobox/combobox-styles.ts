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
 * growing a row at a time as the chips wrap.
 *
 * @internal
 */
const chipsGroupClass =
  "relative m-0 box-border flex w-full min-w-0 flex-wrap items-center gap-1.5 py-1.5 ps-1.5 pe-3 cursor-text " +
  "min-h-(--ouro-control-h) [--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-out " +
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
  "inline-flex h-8 max-w-full min-w-0 items-center gap-0.5 rounded-sm bg-secondary ps-2 text-sm text-secondary-foreground " +
  "sm:pointer-fine:h-6 outline-ring outline-offset-1 data-highlighted:outline-2 data-highlighted:outline-solid " +
  "[&>span]:truncate";

/**
 * A chip's remove button: a square as tall as the chip, with a 44px hit area on a coarse
 * pointer (its `TouchTarget`).
 *
 * @internal
 */
const chipRemoveClass =
  "press relative m-0 box-border inline-flex aspect-square h-full shrink-0 items-center justify-center rounded-sm border-0 p-0 " +
  "bg-transparent text-inherit cursor-pointer [-webkit-tap-highlight-color:transparent] hover:bg-accent " +
  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid [&_svg]:size-3.5";

/**
 * The popup: the input's width, on the popover surface. It opens at once and closes with a
 * 100ms fade and scale toward the input; with reduced motion it only fades. Its height
 * fits the screen above or below the input.
 *
 * @internal
 */
const popupClass =
  "box-border flex w-(--anchor-width) max-w-(--available-width) max-h-[min(var(--available-height),22rem)] flex-col " +
  "origin-(--transform-origin) overflow-hidden rounded-md border border-solid border-border bg-popover text-popover-foreground " +
  "[box-shadow:0_8px_24px_rgb(0_0_0/0.12)] outline-none " +
  "[transition:opacity_var(--ouro-duration-fast)_ease-out,scale_var(--ouro-duration-fast)_ease-out] " +
  "data-starting-style:transition-none data-ending-style:opacity-0 data-ending-style:scale-95 " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-fast)_ease-out] motion-reduce:data-ending-style:scale-100";

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
 */
const itemClass =
  "relative box-border grid min-h-11 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm px-2 py-1.5 " +
  "text-base leading-5 outline-none select-none sm:pointer-fine:min-h-8 sm:pointer-fine:text-sm " +
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:size-4";

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
  "[--ouro-control-h:calc(var(--spacing)*11)] rounded-md border border-solid border-input bg-transparent " +
  "text-start text-base text-foreground font-[inherit] cursor-pointer [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 " +
  "data-placeholder:text-muted-foreground [&>span]:truncate [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground " +
  "group-has-[[data-ouro-combobox-clear]]/combobox-field:[&>span]:me-10";

/**
 * The field on a phone: the button, with the clear button over its end, before the chevron.
 *
 * @internal
 */
const sheetFieldClass = "group/combobox-field relative min-w-0";

/**
 * The clear button on a phone, over the end of the field's button, left of the chevron. It
 * keeps a 44px hit area (its `TouchTarget`).
 *
 * @internal
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
