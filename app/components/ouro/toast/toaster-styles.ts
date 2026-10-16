export { actionClass, closeClass, contentClass, iconTones, portalClass, rootClass, viewportClass };

// Class strings for Toaster, apart from the component so its file exports only components
// (React Fast Refresh). Class strings are literal so the app's Tailwind finds them when it
// compiles.

/**
 * The portal: its own stacking context one level above `--ouro-layer`, so a toast shows
 * over an open Dialog or Sheet.
 *
 * @internal
 */
const portalClass = "relative isolate z-[calc(var(--ouro-layer)+1)]";

/**
 * The fixed region the toasts stack in: full width at the bottom of a phone, inside the
 * safe area, and spacing-scale 90 at the bottom end from `sm`. Each overridable
 * property has one unprefixed utility, so app layout classes win at every width.
 *
 * @internal
 */
const viewportClass =
  "fixed outline-none " +
  "start-(--ouro-toaster-start) end-(--ouro-toaster-end) bottom-(--ouro-toaster-bottom) w-(--ouro-toaster-width) " +
  "[--ouro-toaster-start:calc(var(--spacing)*4)] [--ouro-toaster-end:calc(var(--spacing)*4)] " +
  "[--ouro-toaster-bottom:max(1rem,env(safe-area-inset-bottom))] [--ouro-toaster-width:auto] " +
  "sm:[--ouro-toaster-start:auto] sm:[--ouro-toaster-end:calc(var(--spacing)*6)] " +
  "sm:[--ouro-toaster-bottom:calc(var(--spacing)*6)] sm:[--ouro-toaster-width:calc(var(--spacing)*90)]";

/**
 * One toast. Collapsed, the newest is in front and the older ones peek out above it,
 * smaller; hovering or focusing the stack (`data-expanded`) fans them out. Base UI sets
 * `--toast-index`, `--toast-offset-y` and `--toast-height`. The swipe (`useSwipeAway`)
 * moves the toast with `translate`, which adds to this `transform` and is not in the
 * transition, so it follows the finger at once. A swiped toast (`data-ouro-swiped`)
 * fades on the way it was thrown; a toast closed any other way slides back down. With
 * reduced motion nothing slides or springs: toasts fade in and out where they are.
 * A toast swipes away downward as well as sideways, so it takes every touch gesture
 * (`touch-none`, not `touch-pan-y`): otherwise a downward swipe on a scrollable page
 * scrolls the page, and the browser cancels the swipe.
 *
 * @internal
 */
const rootClass =
  "absolute inset-x-0 bottom-0 box-border origin-bottom touch-none select-none [-webkit-tap-highlight-color:transparent] " +
  "rounded-lg border border-solid border-border bg-popover text-popover-foreground shadow-lg " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "[--gap:0.75rem] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))] " +
  "[--height:var(--toast-frontmost-height,var(--toast-height))] " +
  "[--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1))] " +
  "z-[calc(1000-var(--toast-index))] h-(--height) data-expanded:h-(--toast-height) " +
  "[transform:translateY(calc(0px-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] " +
  "data-expanded:[transform:translateY(var(--offset-y))] " +
  // A strip under each toast bridges the gap, so moving between fanned-out toasts keeps them open.
  "after:absolute after:inset-x-0 after:top-full after:h-[calc(var(--gap)+1px)] after:content-[''] " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:opacity-0 " +
  "motion-safe:data-starting-style:[transform:translateY(150%)] motion-safe:data-expanded:data-starting-style:[transform:translateY(150%)] " +
  "motion-safe:[&[data-ending-style]:not([data-limited]):not([data-ouro-swiped])]:[transform:translateY(150%)] " +
  "motion-safe:[transition:transform_var(--ouro-duration-slow)_var(--ouro-ease-out),opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)]";

/**
 * The toast's content. Toasts behind the front one hide theirs until the stack fans out.
 *
 * @internal
 */
const contentClass =
  "flex h-full items-start gap-3 overflow-hidden p-4 transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) " +
  "data-behind:opacity-0 data-expanded:opacity-100";

/**
 * The action button: a quiet bordered button, 44px to touch on a coarse pointer.
 *
 * @internal
 */
const actionClass =
  "press relative m-0 -my-1 box-border inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-solid border-border " +
  "bg-transparent px-3 text-base font-medium text-foreground pointer-fine:h-8 pointer-fine:text-sm whitespace-nowrap " +
  "cursor-pointer touch-manipulation outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground motion-safe:active:scale-(--ouro-press-scale)";

/**
 * The dismiss button: a small icon button with a 44px touch target on a coarse pointer.
 *
 * @internal
 */
const closeClass =
  "press relative m-0 -me-1 -mt-1 box-border inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 " +
  "text-muted-foreground cursor-pointer touch-manipulation outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground motion-safe:active:scale-(--ouro-press-scale)";

/**
 * The icon color for each tone. `secondary` has no icon.
 *
 * @internal
 */
const iconTones = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;
