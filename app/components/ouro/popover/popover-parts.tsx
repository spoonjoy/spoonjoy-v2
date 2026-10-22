"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { createContext, useContext, type CSSProperties, type JSX } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import {
  floatingAlign,
  floatingHint,
  floatingMotionClass,
  floatingPlacementWarnings,
  floatingPortalClass,
  floatingSide,
  floatingSurfaceClass,
  type FloatingAlign,
  type FloatingSide,
} from "~/lib/ouro/floating";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { popoverCloseClass } from "~/components/ouro/popover/popover-styles";

export type { FloatingAlign as PopoverAlign, FloatingSide as PopoverSide } from "~/lib/ouro/floating";

const PopoverContext = createContext(false);

/** The JSX that puts a part in its place, for the dev message when it is not. */
function shape(inner: string): string {
  return `<PopoverRoot><PopoverTrigger render={<Button>Open</Button>} /><PopoverPortal><PopoverPositioner><PopoverPopup>${inner}</PopoverPopup></PopoverPositioner></PopoverPortal></PopoverRoot>`;
}

/** Throws in development, with the JSX the part belongs in, unless it sits inside a popover root. */
function usePopoverPart(part: string, inner: string): void {
  if (!useContext(PopoverContext)) {
    devThrow(
      part,
      "must be rendered inside <PopoverRoot>",
      process.env.NODE_ENV !== "production" ? shape(inner) : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
}

/**
 * Part: the state owner of a popover built from parts. Use the `Popover` component
 * instead unless its props cannot express your layout; `Popover` also becomes a bottom
 * sheet on phones with `presentation="auto"`, which parts do not.
 *
 * @example
 * <PopoverRoot>
 *   <PopoverTrigger render={<Button>Share</Button>} />
 *   <PopoverPortal>
 *     <PopoverPositioner side="bottom" align="start">
 *       <PopoverPopup>
 *         <PopoverTitle>Share recipe</PopoverTitle>
 *         …
 *       </PopoverPopup>
 *     </PopoverPositioner>
 *   </PopoverPortal>
 * </PopoverRoot>
 */
export function PopoverRoot(props: BasePopover.Root.Props): JSX.Element {
  return (
    <PopoverContext.Provider value>
      <BasePopover.Root {...props} />
    </PopoverContext.Provider>
  );
}

/**
 * Part: the button that opens and closes the popover. Pass your button as `render={<Button>Open</Button>}`.
 * The trigger anchors the popover, which opens on click while the button is pressed, so the
 * press scale is cancelled on it (Button's pressed wash still shows) and the popover lands once.
 */
export function PopoverTrigger({ style, ...props }: BasePopover.Trigger.Props): JSX.Element {
  usePopoverPart("PopoverTrigger", "…");
  const noScale = (own?: CSSProperties): CSSProperties => ({ ...own, ["--ouro-press-scale" as string]: 1 });
  return <BasePopover.Trigger {...(props.render === undefined ? { className: "forced-colors:border forced-colors:border-solid", "data-ouro-control": "popover", "data-ouro-part": "trigger" } : {})} {...props} style={typeof style === "function" ? (state) => noScale(style(state)) : noScale(style)} />;
}

/**
 * Part: moves the popover to the end of `<body>`, in its own stacking context at the
 * `--ouro-layer` z-index (50 by default, from ouro-base.css), like Dialog and Sheet.
 * Raise it in a `:root` rule of your own after the Ouro tokens: `:root { --ouro-layer: 60; }`.
 * @claim "Part: moves the popover to the" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover stacking > puts the portal on the --ouro-layer level, as its own stacking context)
 * @claim "Part: moves the popover to the" registry/ouro/theme/ouro-base.css verify:fileLine(registry/ouro/theme/ouro-base.css, /^\s+--ouro-layer:\s50;/)
 */
export function PopoverPortal(props: Omit<BasePopover.Portal.Props, "className">): JSX.Element {
  usePopoverPart("PopoverPortal", "…");
  return <BasePopover.Portal {...props} data-ouro="popover-portal" className={floatingPortalClass} />;
}

/** Props for {@link PopoverPositioner}. */
export type PopoverPositionerProps = Omit<BasePopover.Positioner.Props, "className" | "side" | "align"> & {
  /**
   * The side of the trigger the popover sits on; it flips when there is no room. @default "bottom"
   *
   * @claim "it flips when there is no room" https://base-ui.com/react/components/popover verify:urlOk(https://base-ui.com/react/components/popover)
   */
  side?: FloatingSide | (string & { 'Use "top", "bottom", "left" or "right"': never }) | undefined;
  /** How the popover lines up with the trigger along that side. @default "center" */
  align?: FloatingAlign | (string & { 'Use "start", "center" or "end": left is "start", right is "end"': never }) | undefined;
};

/**
 * Part: places the popover beside its trigger (or `anchor`), 8px away and at least 8px
 * from the screen edges, and flips it to the other side when there is no room.
 * @claim "Part: places the popover beside its" registry/ouro/components/ouro/popover/popover-parts.tsx verify:fileLine(registry/ouro/components/ouro/popover/popover-parts.tsx, /sideOffset=\{8\}\scollisionPadding=\{8\}/)
 * @claim "Part: places the popover beside its" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover > opens below its trigger as a non-modal dialog named by its title)
 */
export function PopoverPositioner({ side: sideProp, align: alignProp, ...props }: PopoverPositionerProps): JSX.Element {
  usePopoverPart("PopoverPositioner", "…");
  useDevWarnings(
    "PopoverPositioner",
    process.env.NODE_ENV !== "production"
      ? () => floatingPlacementWarnings("<PopoverPositioner", sideProp, "bottom", alignProp, undefined)
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return <PopoverPositionerUnchecked {...props} side={floatingSide(sideProp, "bottom")} align={floatingAlign(alignProp)} />;
}

/**
 * The positioner without its own prop checks, for `Popover`, which checks its own.
 *
 * @internal
 */
export function PopoverPositionerUnchecked(
  props: Omit<BasePopover.Positioner.Props, "className" | "side" | "align"> & { side: FloatingSide; align: FloatingAlign },
): JSX.Element {
  usePopoverPart("PopoverPositioner", "…");
  return <BasePopover.Positioner sideOffset={8} collisionPadding={8} {...props} data-ouro="popover-positioner" />;
}

/** Props for {@link PopoverPopup}. `className` is for layout only (width, padding). */
export type PopoverPopupProps = Omit<BasePopover.Popup.Props, "className"> & { className?: string | undefined };

/**
 * Part: the popover panel, 18rem wide (never wider than the screen allows) with 1rem of
 * padding. It grows from the trigger over 200ms on the ease-out token and fades; reduced motion
 * keeps only the fade. Put a `PopoverTitle` first: it names the popover.
 * @claim "Part: the popover panel, 18rem wide" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover > is 18rem wide by default, and className sets layout)
 * @claim "It grows from the trigger over" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover motion > grows from the trigger's side on the ease-out token and fades)
 * @claim "It grows from the trigger over" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover motion > drops the scale under reduced motion and keeps the fade)
 */
export function PopoverPopup(props: PopoverPopupProps): JSX.Element {
  useAppearanceClassNameCheck(
    "PopoverPopup",
    props.className,
    process.env.NODE_ENV !== "production"
      ? floatingHint("<PopoverPopup>", "</PopoverPopup>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  return <PopoverPopupUnchecked {...props} />;
}

/**
 * The popup without its own className check, for `Popover`, which checks its own.
 *
 * @internal
 */
export function PopoverPopupUnchecked({ className, ...props }: PopoverPopupProps): JSX.Element {
  usePopoverPart("PopoverPopup", "…");
  return (
    <BasePopover.Popup
      {...props}
      data-ouro="popover"
      className={cn(
        floatingSurfaceClass,
        floatingMotionClass,
        "relative flex w-72 max-w-(--available-width) max-h-(--available-height) min-h-0 flex-col gap-2 p-4",
        className,
      )}
    />
  );
}

/** Props for {@link PopoverTitle}. */
export type PopoverTitleProps = Omit<BasePopover.Title.Props, "className"> & {
  /** Hides the title visually; it still names the popover for screen readers. */
  visuallyHidden?: boolean | undefined;
};

/**
 * Part: the popover's title, which names it. Every popover needs one.
 *
 * @claim "Every popover needs one" registry/ouro/components/ouro/popover/popover.test.tsx verify:fileLine(registry/ouro/components/ouro/popover/popover.test.tsx, /warns\swhen\sthe\stitle\sis\smissing/)
 */
export function PopoverTitle({ visuallyHidden, ...props }: PopoverTitleProps): JSX.Element {
  usePopoverPart("PopoverTitle", "<PopoverTitle>…</PopoverTitle>…");
  return (
    <BasePopover.Title
      {...props}
      data-ouro-popover-title=""
      className={visuallyHidden ? "sr-only" : "m-0 font-[family-name:var(--font-heading,inherit)] text-sm leading-5 font-semibold text-popover-foreground"}
    />
  );
}

/** Part: a line under the title that describes the popover. */
export function PopoverDescription(props: Omit<BasePopover.Description.Props, "className">): JSX.Element {
  usePopoverPart("PopoverDescription", "<PopoverTitle>…</PopoverTitle><PopoverDescription>…</PopoverDescription>…");
  return (
    <BasePopover.Description
      {...props}
      data-ouro-popover-description=""
      className="m-0 text-sm leading-5 text-pretty text-muted-foreground"
    />
  );
}

/**
 * Part: closes the popover. Pass your button as `render={<Button>Done</Button>}`. With no
 * `render` it is the screen-reader close button `Popover` uses: hidden until it has
 * keyboard focus, so phone screen-reader users, who have no Escape key, can close it.
 * @claim "With no `render` it is the" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover > has a close button for screen readers, hidden until it has keyboard focus, labelled by closeLabel)
 * @claim "With no `render` it is the" registry/ouro/components/ouro/popover/popover.test.tsx verify:testExists(registry/ouro/components/ouro/popover/popover.test.tsx::Popover parts > PopoverTitle hides visually, and PopoverClose without render is the screen-reader close button)
 */
export function PopoverClose(props: BasePopover.Close.Props): JSX.Element {
  usePopoverPart("PopoverClose", "<PopoverTitle>…</PopoverTitle><PopoverClose>Close</PopoverClose>");
  return <BasePopover.Close {...(props.render === undefined ? { className: popoverCloseClass, "data-ouro-control": "popover", "data-ouro-part": "close" } : {})} {...props} />;
}
