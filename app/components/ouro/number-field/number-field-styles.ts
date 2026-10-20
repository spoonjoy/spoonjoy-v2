export { groupClass, inputClass, scrubClass, stepperClass };

// Class strings for NumberField, apart from the component so its file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds
// them when it compiles.

/**
 * The box around the steppers and the input: Field's control look (44px tall with a 16px
 * font on phones, stepping down from `sm` with a fine pointer), with the focus outline on
 * the box while the input has keyboard focus. Its height is one unprefixed class that reads
 * a variable.
 *
 * @internal
 */
const groupClass =
  "relative m-0 box-border flex w-full min-w-0 items-stretch h-(--ouro-control-h) p-0 " +
  "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "has-[input[aria-invalid=true]]:border-destructive has-[input:disabled]:opacity-50 " +
  "dark:bg-input/30";

/**
 * The input between the steppers: borderless, centered, in tabular figures.
 *
 * @internal
 */
const inputClass =
  "m-0 box-border block h-full min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-center tabular-nums " +
  "text-[length:inherit] text-inherit font-[inherit] outline-none placeholder:text-muted-foreground " +
  "disabled:cursor-not-allowed";

/**
 * A stepper: a square as tall as the inside of the box, at either end, with a press that
 * darkens it, rounded to the box's corners. On a touch screen its `TouchTarget` takes taps
 * over 44px. Disabled at the limit.
 *
 * @internal
 */
const stepperClass =
  "press relative m-0 box-border flex aspect-square h-full shrink-0 items-center justify-center border-0 p-0 " +
  "bg-transparent text-muted-foreground cursor-pointer select-none [-webkit-tap-highlight-color:transparent] " +
  "not-active:pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground not-data-disabled:active:bg-[color-mix(in_oklab,var(--accent)_85%,var(--foreground))] not-data-disabled:active:text-accent-foreground " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid " +
  "first:rounded-s-[calc(var(--radius-md)-1px)] last:rounded-e-[calc(var(--radius-md)-1px)] " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:pointer-fine:hover:bg-transparent [&_svg]:size-4";

/**
 * The label's scrub area: drag it sideways with a mouse to change the value.
 *
 * @internal
 */
const scrubClass = "justify-self-start cursor-ew-resize select-none data-disabled:cursor-default [&_label]:cursor-[inherit]";
