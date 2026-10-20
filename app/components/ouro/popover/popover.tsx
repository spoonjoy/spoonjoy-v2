"use client";

import { useRef, useState, type JSX, type ReactElement, type ReactNode, type RefObject } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { devThrow } from "~/lib/ouro/dev";
import { floatingAlign, floatingHint, floatingPlacementWarnings, floatingSide, type FloatingAlign, type FloatingSide } from "~/lib/ouro/floating";
import { lastInput } from "~/lib/ouro/last-input";
import { checkOpenMode } from "~/lib/ouro/open-mode";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useKeyboardScrollable } from "~/lib/ouro/use-keyboard-scrollable";
import { useSheetPresentation } from "~/lib/ouro/use-sheet-presentation";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import {
  PopoverClose,
  PopoverDescription,
  PopoverPopupUnchecked,
  PopoverPortal,
  PopoverPositionerUnchecked,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ouro/popover/popover-parts";

export type { PopoverAlign, PopoverSide } from "~/components/ouro/popover/popover-parts";

/** How a Popover presents: `auto` is a popover from 640px up and a bottom sheet below. */
export type PopoverPresentation = "auto" | "popover" | "sheet";

const presentations: readonly PopoverPresentation[] = ["auto", "popover", "sheet"];

const controlFix = "<Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>";

/** Props shared by both ways of opening a Popover. */
export interface PopoverBaseProps {
  /** Names the popover for screen readers and shows at its top. Always required; hide it with `hideTitle`. */
  title: string;
  /** Hides the title visually. It still names the popover for screen readers. */
  hideTitle?: boolean | undefined;
  /** A short line under the title, read out when the popover opens. */
  description?: ReactNode;
  /**
   * The label of the close button, the last control in the popover. It is hidden until
   * it has keyboard focus, so screen-reader users on phones (who have no Escape key)
   * can always close the popover. @default "Close"
   */
  closeLabel?: string | undefined;
  /** The side of the trigger the popover sits on; it flips when there is no room. @default "bottom" */
  side?: FloatingSide | (string & { 'Use "top", "bottom", "left" or "right"': never }) | undefined;
  /** How the popover lines up with the trigger along that side. @default "center" */
  align?: FloatingAlign | (string & { 'Use "start", "center" or "end": left is "start", right is "end"': never }) | undefined;
  /**
   * `popover` stays beside the trigger at every width. `auto` is a popover from the `sm`
   * breakpoint (640px) up and a bottom sheet below it, for a popover with controls that
   * would be fiddly on a phone. `sheet` is always a bottom sheet. The server renders the
   * popover form and corrects it on hydration.
   * @default "popover"
   */
  presentation?: PopoverPresentation | (string & { 'Use "auto", "popover" or "sheet"': never }) | undefined;
  /** The body. It scrolls when the popover is taller than the space beside the trigger. */
  children: ReactNode;
  /**
   * Layout only, applied to the popover panel: width (`w-96`, 18rem by default) and
   * margins. Your classes win over Ouro UI's. The sheet keeps its full width. Appearance
   * classes warn in development.
   */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>`. */
  isOpen?: { 'Use <Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>': never };
  /** Not a prop. `onOpenChange(false)` fires on close: `<Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>`. */
  onClose?: { 'Use <Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>': never };
  /** Not a prop. Ouro UI splits placement into `side` and `align`: `<Popover side="bottom" align="start">`. */
  placement?: { 'Use side="bottom" align="start"': never };
  /** Not a prop. The body is the children: `<Popover title="…" trigger={…}>…</Popover>`. */
  content?: { 'Use children: <Popover title="..." trigger={...}>...</Popover>': never };
}

/** An uncontrolled Popover: `trigger` opens and closes it, and it sits beside the trigger. */
export type PopoverWithTriggerProps = PopoverBaseProps & {
  /** The element that opens and closes the popover, usually a Button: `trigger={<Button>Share</Button>}`. */
  trigger: ReactElement;
  /** Not with `trigger`. Remove `trigger` to control the popover with `open`, `onOpenChange` and `anchor`. */
  open?: never;
  /** Not with `trigger`. Remove `trigger` to control the popover with `open`, `onOpenChange` and `anchor`. */
  onOpenChange?: never;
  /** Not with `trigger`. The popover sits beside its trigger. */
  anchor?: never;
};

/** A controlled Popover: you own `open`, update it in `onOpenChange`, and say what it points at with `anchor`. */
export type PopoverControlledProps = PopoverBaseProps & {
  /**
   * Whether the popover is open. After a touch or pen tap the popover focuses itself
   * rather than its first input, so no software keyboard pops up; after a key press it
   * focuses the first control.
   */
  open: boolean;
  /** Called with `false` when the user dismisses the popover (Escape, outside press, the close button). */
  onOpenChange: (open: boolean) => void;
  /**
   * The element the popover points at, usually the button that toggles it:
   * `anchor={buttonRef}`. A press on it never counts as an outside press, so its own
   * `onClick` can toggle `open`.
   */
  anchor: RefObject<HTMLElement | null>;
  /** Not with `open`. Remove `open`, `onOpenChange` and `anchor` to let a trigger open the popover. */
  trigger?: never;
};

/** Props for {@link Popover}: either `trigger`, or `open` with `onOpenChange` and `anchor`. */
export type PopoverProps = PopoverWithTriggerProps | PopoverControlledProps;

/**
 * A small non-modal panel beside its trigger, for a short form or a few choices: a share
 * link, filters, a quick edit. It is named by its title, closes on Escape and outside
 * presses, returns focus to the trigger, and flips to the other side when there is no
 * room. With `presentation="auto"` it is a bottom sheet on phones (below 640px).
 *
 * Use `trigger` for a popover a button opens, or `open` with `onOpenChange` and `anchor`
 * to control it. To give the trigger a tooltip too, put the Tooltip inside `trigger`:
 * `trigger={<Tooltip content="Share recipe"><Button aria-label="Share">…</Button></Tooltip>}`. Use `Tooltip` instead for a short label on hover or focus, `HoverCard`
 * for a preview of a link, and `Dialog` when the task needs
 * the user's full attention.
 *
 * It stacks above the page at `--ouro-layer`, a z-index of 50 by default (from
 * ouro-base.css), like Dialog and Sheet. Raise it in a `:root` rule of your own after
 * the Ouro tokens, outside any `@layer`: `:root { --ouro-layer: 60; }`.
 *
 * @group Overlays
 * @see https://ourostack.github.io/ouro-ui/docs/popover
 *
 * @example
 * <Popover title="Share recipe" trigger={<Button>Share</Button>}>
 *   <TextField label="Link" defaultValue={url} readOnly />
 * </Popover>
 * <Popover title="Filters" presentation="auto" open={open} onOpenChange={setOpen} anchor={filtersRef}>
 *   <FilterForm />
 * </Popover>
 */
export function Popover(props: PopoverProps): JSX.Element {
  const {
    title,
    hideTitle,
    description,
    closeLabel = "Close",
    side: sideProp,
    align: alignProp,
    presentation: presentationProp = "popover",
    children,
    className,
    trigger,
    open,
    onOpenChange,
    anchor,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
    placement,
    content,
  } = props as PopoverBaseProps & {
    trigger?: ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    anchor?: RefObject<HTMLElement | null>;
  };

  checkOpenMode("Popover", "popover", trigger !== undefined, open, onOpenChange);
  if (open !== undefined && anchor === undefined) {
    devThrow(
      "Popover",
      "open needs anchor, the element it points at",
      process.env.NODE_ENV !== "production" ? controlFix : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  // A side, alignment or presentation that is not one of Ouro UI's (a type error) warns and renders the default.
  const side = floatingSide(sideProp, "bottom");
  const align = floatingAlign(alignProp);
  const presentation = presentations.includes(presentationProp as PopoverPresentation)
    ? (presentationProp as PopoverPresentation)
    : "popover";

  useAppearanceClassNameCheck(
    "Popover",
    className,
    process.env.NODE_ENV !== "production"
      ? floatingHint('<Popover title="…">', "</Popover>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Popover",
    process.env.NODE_ENV !== "production"
      ? () => [
          !title && ["title is required; it names the popover for screen readers", '<Popover title="Share recipe">'],
          ...floatingPlacementWarnings("<Popover", sideProp, "bottom", alignProp, placement),
          presentation !== presentationProp && [
            `presentation="${String(presentationProp)}" is not a presentation; use ${presentations.map((name) => `"${name}"`).join(", ")}`,
            '<Popover presentation="auto">',
          ],
          isOpen !== undefined && ["isOpen is not a prop", controlFix],
          onClose !== undefined && ["onClose is not a prop", controlFix],
          content !== undefined && ["content is not a prop; the body is children", '<Popover title="…" trigger={…}>…</Popover>'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // The Popover owns the open state even with a trigger, so it stays open when a resize
  // across 640px swaps the popover for the sheet.
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpenNow = controlled ? open : ownOpen;
  const setOpen = controlled ? onOpenChange! : setOwnOpen;

  const asSheet = useSheetPresentation(presentation);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const bodyRef = useKeyboardScrollable<HTMLDivElement>(true);

  // In either presentation the trigger stays a Base UI popover trigger in the same place
  // in the tree, so its DOM node (and its focus, and the server-rendered node after
  // hydration) survives a switch. As a sheet, the popover root stays closed and the press
  // opens the sheet through the same state.

  return (
    <PopoverRoot
      open={isOpenNow && !asSheet}
      onOpenChange={(next, details) => {
        // The app's own toggle (the anchor) is not outside: its onClick decides.
        const target = details.event?.target as Node | undefined;
        if (!next && details.reason === "outside-press" && target && anchor?.current?.contains(target)) return;
        setOpen(next);
      }}
    >
      {trigger !== undefined && (
        <PopoverTrigger render={trigger} ref={triggerRef} aria-expanded={isOpenNow} />
      )}
      <PopoverPortal>
        <PopoverPositionerUnchecked side={side} align={align} {...(anchor ? { anchor } : {})}>
          <PopoverPopupUnchecked
            ref={popupRef}
            className={className}
            data-ouro-presentation="popover"
            {...(controlled
              ? {
                  initialFocus: () => (lastInput() === "touch" || lastInput() === "pen" ? popupRef.current : true),
                  // Safari does not focus a button on click, so name where focus goes back.
                  finalFocus: anchor,
                }
              : {})}
          >
            {(!hideTitle || description !== undefined) ? (
              <div data-ouro-popover-header="" className="grid shrink-0 gap-1">
                <PopoverTitle visuallyHidden={hideTitle}>{title}</PopoverTitle>
                {description !== undefined && <PopoverDescription>{description}</PopoverDescription>}
              </div>
            ) : (
              <PopoverTitle visuallyHidden>{title}</PopoverTitle>
            )}
            <div
              ref={bodyRef}
              data-ouro-popover-content=""
              data-ouro-control="popover"
              data-ouro-part="content"
              className="box-border min-h-0 flex-auto overflow-y-auto overscroll-contain text-sm leading-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              {children}
            </div>
            <PopoverClose data-ouro-popover-close="">{closeLabel}</PopoverClose>
          </PopoverPopupUnchecked>
        </PopoverPositionerUnchecked>
      </PopoverPortal>
      {asSheet && (
        <SheetFrame
          title={title}
          hideTitle={hideTitle}
          closeLabel={closeLabel}
          description={description}
          side="bottom"
          open={isOpenNow}
          onOpenChange={setOpen}
          presentation="sheet"
          finalFocus={trigger !== undefined ? triggerRef : anchor}
        >
          {children}
        </SheetFrame>
      )}
    </PopoverRoot>
  );
}
