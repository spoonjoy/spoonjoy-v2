import { Drawer } from "@base-ui/react/drawer";
import { createContext, useContext, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import { useBackdropAnchor } from "~/lib/ouro/use-backdrop-anchor";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { useKeyboardScrollable } from "~/lib/ouro/use-keyboard-scrollable";
import { iosBackdrop, sheetHint, sheetSides, sideWarning, type SheetSide } from "~/components/ouro/sheet/sheet-styles";

export type { SheetSide } from "~/components/ouro/sheet/sheet-styles";

/**
 * A snap point for a bottom or top sheet: a fraction of the viewport height
 * (`0.5`), or a height in `px` or `rem` (`"320px"`, `"20rem"`).
 */
export type SheetSnapPoint = number | `${number}px` | `${number}rem`;

interface SheetContextValue {
  side: SheetSide;
  snap: boolean;
}

const SheetContext = createContext<SheetContextValue | null>(null);

const swipeDirections = { bottom: "down", top: "up", left: "left", right: "right" } as const;

/*
 * Styles: Base UI Drawer, tuned through its CSS variables (spec section 7).
 *
 * - Base UI moves the popup with --drawer-swipe-movement-x/y and places snap points
 *   with --drawer-snap-point-offset. Past the open edge it damps the pull to the
 *   square root of the distance (s = √d for a pull of d). The sheet lifts
 *   k·(s − k/4) with k = --ouro-sheet-stretch, which is never more than the pull:
 *   d − k·(s − k/4) = (s − k/2)² ≥ 0. An 80px pull lifts it about 28px, like
 *   RedwoodUI. A bleed (::after) in the sheet's color extends past the edge, so the
 *   lift reads as stretching.
 * - The backdrop fades with --drawer-swipe-progress, up to --ouro-backdrop-max.
 * - Release and entry use the theme spring; a flick's release is scaled by
 *   --drawer-swipe-strength (0.1 to 1).
 * - Reduced motion drops transform transitions and keeps an opacity fade.
 *
 * Class strings are literal so the app's Tailwind finds them when it compiles.
 */

const backdropClass =
  "fixed inset-0 z-1000 min-h-dvh bg-(--ouro-backdrop-color) " +
  "opacity-[calc(var(--ouro-backdrop-max)*(1-var(--drawer-swipe-progress,0)))] " +
  "[transition:opacity_var(--ouro-spring-duration)_var(--ouro-ease-spring)] " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0 " +
  "data-ending-style:duration-(--ouro-duration-slow) data-ending-style:ease-out data-swiping:duration-0 " +
  // A flick sends the sheet away in about 100ms. Base UI pins the backdrop's
  // --drawer-swipe-strength at 1, but marks it data-swipe-dismiss, so fade it as fast.
  "data-swipe-dismiss:data-ending-style:duration-(--ouro-duration-fast) " +
  iosBackdrop;

const viewportClasses = {
  bottom: "items-end justify-center",
  top: "items-start justify-center",
  left: "justify-start",
  right: "justify-end",
} as const;

const popupBase =
  "[--ouro-sheet-stretch:3.5] [--ouro-sheet-slack:calc(var(--ouro-sheet-stretch)*0.25px)] [--ouro-sheet-gap:2rem] " +
  "relative box-border flex min-h-0 flex-col outline-none touch-none " +
  "bg-popover text-popover-foreground [-webkit-tap-highlight-color:transparent] " +
  "[transition:transform_calc(var(--ouro-spring-duration)*var(--drawer-swipe-strength,1))_var(--ouro-ease-spring)] " +
  "will-change-transform [transform:var(--ouro-sheet-transform)] data-swiping:select-none " +
  // While a finger is down, Base UI also writes the raw damped offset as an inline
  // transform. The stretched transform has to win over it, so it is important here.
  "data-swiping:[transform:var(--ouro-sheet-transform)]! " +
  // The bleed: the sheet's color past its edge, so pulling it inward looks like stretching.
  "after:pointer-events-none after:absolute after:bg-inherit " +
  // Reduced motion: fade in place.
  "motion-reduce:[transition:transform_0s,opacity_var(--ouro-duration-base)_ease-out] " +
  "motion-reduce:data-starting-style:[transform:var(--ouro-sheet-transform)] motion-reduce:data-starting-style:opacity-0 " +
  "motion-reduce:data-ending-style:[transform:var(--ouro-sheet-transform)] motion-reduce:data-ending-style:opacity-0";

// Bottom (the default) and top: full width up to 40rem, fitting content up to the viewport less a gap.
const popupSides = {
  bottom:
    "w-full max-w-[40rem] max-h-[calc(100dvh-var(--ouro-sheet-gap))] ps-[env(safe-area-inset-left,0px)] pe-[env(safe-area-inset-right,0px)] " +
    "[--ouro-sheet-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))] " +
    "[--ouro-sheet-transform:translateY(calc(max(var(--ouro-sheet-y),0px)+min(var(--ouro-sheet-y)+var(--ouro-sheet-slack),0px)*var(--ouro-sheet-stretch)))] " +
    "rounded-t-xl [box-shadow:0_-1px_0_color-mix(in_oklab,var(--border)_60%,transparent),0_-8px_32px_rgb(0_0_0/0.12)] " +
    "after:inset-x-0 after:top-[calc(100%-1px)] after:h-[50dvh] " +
    "data-starting-style:[transform:translateY(calc(100%+2px))] data-ending-style:[transform:translateY(calc(100%+2px))]",
  top:
    "w-full max-w-[40rem] max-h-[calc(100dvh-var(--ouro-sheet-gap))] ps-[env(safe-area-inset-left,0px)] pe-[env(safe-area-inset-right,0px)] " +
    "[--ouro-sheet-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))] " +
    "[--ouro-sheet-transform:translateY(calc(min(var(--ouro-sheet-y),0px)+max(var(--ouro-sheet-y)-var(--ouro-sheet-slack),0px)*var(--ouro-sheet-stretch)))] " +
    "rounded-b-xl [box-shadow:0_1px_0_color-mix(in_oklab,var(--border)_60%,transparent),0_8px_32px_rgb(0_0_0/0.12)] " +
    "pt-[env(safe-area-inset-top,0px)] " +
    "after:inset-x-0 after:bottom-[calc(100%-1px)] after:h-[50dvh] " +
    "data-starting-style:[transform:translateY(calc(-100%-2px))] data-ending-style:[transform:translateY(calc(-100%-2px))]",
  // Left and right: full height, up to 22rem wide, always leaving a strip of the page visible.
  left:
    "h-full w-[min(22rem,calc(100vw-3rem))] pt-[env(safe-area-inset-top,0px)] " +
    "pb-[calc(env(safe-area-inset-bottom,0px)+var(--drawer-keyboard-inset,0px))] " +
    "[--ouro-sheet-x:var(--drawer-swipe-movement-x,0px)] " +
    "[--ouro-sheet-transform:translateX(calc(min(var(--ouro-sheet-x),0px)+max(var(--ouro-sheet-x)-var(--ouro-sheet-slack),0px)*var(--ouro-sheet-stretch)))] " +
    "rounded-r-xl [box-shadow:8px_0_32px_rgb(0_0_0/0.12)] pl-[env(safe-area-inset-left,0px)] " +
    "after:inset-y-0 after:right-[calc(100%-1px)] after:w-[50vw] " +
    "data-starting-style:[transform:translateX(calc(-100%-2px))] data-ending-style:[transform:translateX(calc(-100%-2px))]",
  right:
    "h-full w-[min(22rem,calc(100vw-3rem))] pt-[env(safe-area-inset-top,0px)] " +
    "pb-[calc(env(safe-area-inset-bottom,0px)+var(--drawer-keyboard-inset,0px))] " +
    "[--ouro-sheet-x:var(--drawer-swipe-movement-x,0px)] " +
    "[--ouro-sheet-transform:translateX(calc(max(var(--ouro-sheet-x),0px)+min(var(--ouro-sheet-x)+var(--ouro-sheet-slack),0px)*var(--ouro-sheet-stretch)))] " +
    "rounded-l-xl [box-shadow:-8px_0_32px_rgb(0_0_0/0.12)] pr-[env(safe-area-inset-right,0px)] " +
    "after:inset-y-0 after:left-[calc(100%-1px)] after:w-[50vw] " +
    "data-starting-style:[transform:translateX(calc(100%+2px))] data-ending-style:[transform:translateX(calc(100%+2px))]",
} as const;

/**
 * A bottom sheet's padding keeps its body above the home indicator and the software
 * keyboard. At a lower snap point part of the sheet sits below the screen, so it is
 * padded by that much more and the body ends on screen.
 */
const bottomPadding = {
  fit: "pb-[calc(env(safe-area-inset-bottom,0px)+var(--drawer-keyboard-inset,0px))]",
  snap: "h-[calc(100dvh-var(--ouro-sheet-gap))] pb-[calc(env(safe-area-inset-bottom,0px)+var(--drawer-keyboard-inset,0px)+max(0px,var(--ouro-sheet-y)))]",
} as const;

/** The JSX that puts a part in its place, for the dev message when it is not. */
function shape(inner: string): string {
  return `<SheetRoot><SheetTrigger render={<Button>Open</Button>} /><SheetPortal><SheetBackdrop /><SheetViewport><SheetPopup>${inner}</SheetPopup></SheetViewport></SheetPortal></SheetRoot>`;
}

/** Reads the sheet context, or throws in development with the JSX the part belongs in. */
function useSheetPart(part: string, inner: string): SheetContextValue {
  const context = useContext(SheetContext);
  if (!context) {
    devThrow(
      part,
      "must be rendered inside <SheetRoot>",
      process.env.NODE_ENV !== "production" ? shape(inner) : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  return context;
}

/** Props for {@link SheetRoot}: Base UI `Drawer.Root` props with `side` in place of `swipeDirection`. */
export type SheetRootProps = Omit<Drawer.Root.Props, "swipeDirection" | "snapPoints"> & {
  /** The edge the sheet slides in from. @default "bottom" */
  side?: SheetSide | (string & { 'Use "bottom", "top", "left" or "right"': never }) | undefined;
  /** Snap points for a bottom or top sheet. Without them the sheet fits its content. */
  snapPoints?: SheetSnapPoint[] | undefined;
};

/**
 * Part: the state owner of a sheet built from parts. Use the `Sheet` component
 * instead unless its props cannot express your layout.
 *
 * @example
 * <SheetRoot side="bottom">
 *   <SheetTrigger render={<Button>Open</Button>} />
 *   <SheetPortal>
 *     <SheetBackdrop />
 *     <SheetViewport>
 *       <SheetPopup>
 *         <SheetHandle />
 *         <SheetTitle>Filters</SheetTitle>
 *         <SheetContent>…</SheetContent>
 *       </SheetPopup>
 *     </SheetViewport>
 *   </SheetPortal>
 * </SheetRoot>
 */
export function SheetRoot({ side: sideProp = "bottom", snapPoints, ...props }: SheetRootProps): JSX.Element {
  // A side that is not one of Ouro UI's (a type error) warns and renders a bottom sheet.
  const side = sheetSides.includes(sideProp as SheetSide) ? (sideProp as SheetSide) : "bottom";
  useDevWarnings(
    "SheetRoot",
    process.env.NODE_ENV !== "production"
      ? () => [side !== sideProp && sideWarning(String(sideProp), "<SheetRoot side=\"bottom\">")]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const snap = Boolean(snapPoints && snapPoints.length > 0);
  return (
    <SheetContext.Provider value={{ side, snap }}>
      <Drawer.Root {...props} {...(snapPoints ? { snapPoints } : {})} swipeDirection={swipeDirections[side]} />
    </SheetContext.Provider>
  );
}

/** Part: the button that opens the sheet. Pass your button as `render={<Button>Open</Button>}`. */
export function SheetTrigger(props: Drawer.Trigger.Props): JSX.Element {
  useSheetPart("SheetTrigger", "…");
  return <Drawer.Trigger {...props} />;
}

/**
 * Part: moves the sheet to the end of `<body>` and makes it aware of the
 * software keyboard (`Drawer.VirtualKeyboardProvider`), so focused inputs stay visible.
 * The portal is its own stacking context at the `--ouro-layer` z-index (50 by default,
 * from ouro-base.css). If your app has fixed bars above z-50, raise it in a `:root`
 * rule of your own after the Ouro tokens, outside any `@layer`: `:root { --ouro-layer: 60; }`.
 * Don't edit the line shadcn wrote; `shadcn add` resets it.
 */
export function SheetPortal(props: Omit<Drawer.Portal.Props, "className">): JSX.Element {
  useSheetPart("SheetPortal", "…");
  return (
    <Drawer.VirtualKeyboardProvider>
      <Drawer.Portal {...props} data-ouro="sheet-portal" className="relative isolate z-(--ouro-layer)" />
    </Drawer.VirtualKeyboardProvider>
  );
}

/**
 * Part: the dimming layer. It lightens as the sheet is dragged away. On iOS it
 * stays anchored to the top of the screen on a scrolled page. A `ref` reaches
 * the backdrop element.
 */
export function SheetBackdrop({
  ref,
  ...props
}: Omit<Drawer.Backdrop.Props, "className"> & { ref?: Ref<HTMLDivElement> | undefined }): JSX.Element {
  useSheetPart("SheetBackdrop", "…");
  const anchorRef = useBackdropAnchor(ref);
  return <Drawer.Backdrop {...props} ref={anchorRef} data-ouro="sheet-backdrop" className={backdropClass} />;
}

/** Part: the full-screen layer that positions the popup against its edge. */
export function SheetViewport(props: Omit<Drawer.Viewport.Props, "className">): JSX.Element {
  const { side } = useSheetPart("SheetViewport", "…");
  return (
    <Drawer.Viewport
      {...props}
      data-ouro="sheet-viewport"
      data-side={side}
      className={cn("fixed inset-0 z-1000 flex overflow-hidden touch-none", viewportClasses[side])}
    />
  );
}

/** Props for {@link SheetPopup}. `className` is for layout only (width, margins). */
export type SheetPopupProps = Omit<Drawer.Popup.Props, "className"> & { className?: string | undefined };

/** Part: the sheet panel. It stretches past its edge when pulled and springs back on release. */
export function SheetPopup(props: SheetPopupProps): JSX.Element {
  useAppearanceClassNameCheck(
    "SheetPopup",
    props.className,
    process.env.NODE_ENV !== "production"
      ? sheetHint("<SheetPopup>", "</SheetPopup>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  return <SheetPopupUnchecked {...props} />;
}

/**
 * The popup without its own className check, for `Sheet`, which checks its own `className`.
 *
 * @internal
 */
export function SheetPopupUnchecked({ className, ...props }: SheetPopupProps): JSX.Element {
  const { side, snap } = useSheetPart("SheetPopup", "…");
  return (
    <Drawer.Popup
      {...props}
      className={cn(
        popupBase,
        popupSides[side],
        side === "bottom" && bottomPadding[snap ? "snap" : "fit"],
        side === "top" && snap && "h-[calc(100dvh-var(--ouro-sheet-gap))]",
        className,
      )}
      data-ouro="sheet"
      data-side={side}
      data-snap-points={snap ? "" : undefined}
    />
  );
}

/** Part: the grab handle at the free edge of a bottom or top sheet. Decorative; renders nothing on side sheets. */
export function SheetHandle(): JSX.Element | null {
  const { side } = useSheetPart("SheetHandle", "<SheetHandle />…");
  if (side === "left" || side === "right") return null;
  return (
    <div
      aria-hidden="true"
      data-ouro-sheet-handle=""
      className="flex shrink-0 justify-center py-2 touch-none"
    >
      <div className="h-1.25 w-9 rounded-full bg-border" />
    </div>
  );
}

/** Props for {@link SheetTitle}. */
export type SheetTitleProps = Omit<Drawer.Title.Props, "className"> & {
  /** Hides the title visually; it still names the dialog for screen readers. */
  visuallyHidden?: boolean | undefined;
};

/** Part: the sheet's title, which names the dialog. Every sheet needs one. */
export function SheetTitle({ visuallyHidden, ...props }: SheetTitleProps): JSX.Element {
  useSheetPart("SheetTitle", "<SheetTitle>…</SheetTitle>…");
  return (
    <Drawer.Title
      {...props}
      data-ouro-sheet-title=""
      className={
        visuallyHidden
          ? "sr-only"
          : "m-0 text-lg leading-6 font-semibold text-balance text-popover-foreground"
      }
    />
  );
}

/** Part: a line under the title that describes the dialog. */
export function SheetDescription(props: Omit<Drawer.Description.Props, "className">): JSX.Element {
  useSheetPart("SheetDescription", "<SheetDescription>…</SheetDescription>…");
  return (
    <Drawer.Description
      {...props}
      data-ouro-sheet-description=""
      className="m-0 text-sm leading-5 text-muted-foreground"
    />
  );
}

/** Props for {@link SheetContent}. `className` is for layout only. */
export type SheetContentProps = Omit<Drawer.Content.Props, "className"> & { className?: string | undefined };

/**
 * Part: the scrollable body. A mouse can select text in it without dragging the
 * sheet; touch still drags from anywhere once the body is scrolled to the top.
 * While it overflows it is a tab stop, so a keyboard can scroll it.
 */
export function SheetContent({ className, ref, ...props }: SheetContentProps): JSX.Element {
  const scrollRef = useMergedRef(ref, useKeyboardScrollable<HTMLDivElement>(props.tabIndex === undefined));
  useSheetPart("SheetContent", "<SheetContent>…</SheetContent>");
  useAppearanceClassNameCheck(
    "SheetContent",
    className,
    process.env.NODE_ENV !== "production"
      ? sheetHint("<SheetContent>", "</SheetContent>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  return (
    <Drawer.Content
      {...props}
      ref={scrollRef}
      data-ouro-sheet-content=""
      className={cn(
        "box-border min-h-0 flex-1 overflow-y-auto overscroll-contain touch-auto px-5 pt-2 pb-5",
        // A body that overflows is a tab stop (useKeyboardScrollable); show where focus is.
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        className,
      )}
    />
  );
}

/** Part: closes the sheet. Pass your button as `render={<Button>Done</Button>}`. */
export function SheetClose(props: Drawer.Close.Props): JSX.Element {
  useSheetPart("SheetClose", "<SheetContent><SheetClose>…</SheetClose></SheetContent>");
  return <Drawer.Close {...props} />;
}
