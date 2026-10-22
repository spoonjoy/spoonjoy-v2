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
 * Universal and named scales compile independently: an unavailable candidate
 * is omitted, preserving the phone value at sm. Same-element [&] variants
 * retain distinct candidates through cn: two for the universal path, one for
 * the later named path. Both share the same variant group, so sm still wins
 * over phone values. Neither path introduces a global spacing default.
 *
 * @internal
 * @claim "Each overridable property has one unprefixed" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > lets unprefixed app clearance and width win on the actual viewport at phone and desktop widths)
 * @claim "The fixed region the toasts stack" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::spans the phone's width at the bottom, inside a 16px margin)
 * @claim "Same-element [&] variants retain distinct candidates" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > keeps named spacing-scale values on the viewport as well as the universal spacing fallback)
 */
const viewportClass =
  "fixed outline-none " +
  "start-(--ouro-toaster-start) end-(--ouro-toaster-end) bottom-(--ouro-toaster-bottom) w-(--ouro-toaster-width) " +
  "[&]:[&]:[--ouro-toaster-start:var(--spacing-4,--spacing(4))] [&]:[--ouro-toaster-start:--theme(--spacing-4)] " +
  "[&]:[&]:[--ouro-toaster-end:var(--spacing-4,--spacing(4))] [&]:[--ouro-toaster-end:--theme(--spacing-4)] " +
  "[--ouro-toaster-bottom:max(1rem,env(safe-area-inset-bottom))] [--ouro-toaster-width:auto] " +
  "sm:[&]:[--ouro-toaster-start:auto] " +
  "sm:[&]:[&]:[--ouro-toaster-end:var(--spacing-6,--spacing(6))] sm:[&]:[--ouro-toaster-end:--theme(--spacing-6)] " +
  "sm:[&]:[&]:[--ouro-toaster-bottom:var(--spacing-6,--spacing(6))] sm:[&]:[--ouro-toaster-bottom:--theme(--spacing-6)] " +
  "sm:[&]:[&]:[--ouro-toaster-width:var(--spacing-90,--spacing(90))] sm:[&]:[--ouro-toaster-width:--theme(--spacing-90)]";

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
 * @claim "A toast swipes away downward as" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > puts the newest toast first in the page, where F6 then Tab reaches it, then each older one)
 * @claim "A toast swipes away downward as" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::the swipe follows the finger (rule 12) > goes back to rest when the browser cancels the touch, however far out it was)
 * @claim "A toast swipes away downward as" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 * @claim "Collapsed, the newest is in front" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 * @claim "Collapsed, the newest is in front" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::waits while a finger is on a toast, and fans the stack out, as a mouse over it does)
 */
const rootClass =
  "absolute inset-x-0 bottom-0 box-border origin-bottom touch-none select-none [-webkit-tap-highlight-color:transparent] " +
  "rounded-lg border border-solid border-border bg-popover text-popover-foreground shadow-(--shadow-lg) " +
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
 * @claim "The action button: a quiet bordered" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::gives the dismiss and action buttons 44px touch targets)
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
 * @claim "The dismiss button: a small icon" registry/ouro/components/ouro/toast/toaster.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.touch.test.tsx::gives the dismiss and action buttons 44px touch targets)
 * @claim "The dismiss button: a small icon" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > closes from the dismiss button)
 */
const closeClass =
  "press relative m-0 -me-1 -mt-1 box-border inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 " +
  "text-muted-foreground cursor-pointer touch-manipulation outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground motion-safe:active:scale-(--ouro-press-scale)";

/**
 * The icon color for each tone. `secondary` has no icon.
 *
 * @internal
 * @claim "The icon color for each tone" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > marks the tone and shows an icon for every tone but secondary)
 * @claim "`secondary` has no icon" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > marks the tone and shows an icon for every tone but secondary)
 */
const iconTones = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;
