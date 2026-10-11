import type { JSX, ReactElement, ReactNode, RefObject } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { checkOpenMode } from "~/lib/ouro/open-mode";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import {
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHandle,
  SheetPopupUnchecked,
  SheetPortal,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
  SheetViewport,
  footerClass,
  sheetHint,
  sheetSides,
  sideWarning,
  type SheetSide,
  type SheetSnapPoint,
} from "~/components/ouro/sheet/sheet-parts";

export type { SheetSide, SheetSnapPoint } from "~/components/ouro/sheet/sheet-parts";

/** Props shared by both ways of opening a Sheet. */
export interface SheetBaseProps {
  /** Names the sheet for screen readers and shows at its top. Always required; hide it with `hideTitle`. */
  title: string;
  /** Hides the title visually. It still names the dialog for screen readers. */
  hideTitle?: boolean | undefined;
  /**
   * The label of the sheet's close button. The button is the last control in the
   * sheet, hidden until it has keyboard focus, so screen-reader users on phones
   * (who have no Escape key) can always close the sheet. @default "Close"
   */
  closeLabel?: string | undefined;
  /** A short line under the title, read out when the sheet opens. */
  description?: ReactNode;
  /** The edge the sheet slides in from and is dragged back to. @default "bottom" */
  side?: SheetSide | (string & { 'Use "bottom", "top", "left" or "right"': never }) | undefined;
  /**
   * Heights a bottom or top sheet rests at, smallest first: fractions of the
   * viewport (`0.5`), `px` or `rem`. `snapPoints={[0.5, 1]}` opens at half
   * height and drags up to full. Without snap points the sheet fits its content.
   */
  snapPoints?: SheetSnapPoint[] | undefined;
  /** The body. It scrolls when it is taller than the sheet. */
  children: ReactNode;
  /**
   * Layout only, applied to the sheet panel: width and margins (`max-w-lg`,
   * `mx-auto`). Your classes win over Ouro UI's. Appearance classes warn in development.
   */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<Sheet open={open} onOpenChange={setOpen}>`. */
  isOpen?: { 'Use <Sheet open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. `onOpenChange(false)` fires on close: `<Sheet open={open} onOpenChange={setOpen}>`. */
  onClose?: { 'Use <Sheet open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. Ouro UI uses `side`: `<Sheet side="bottom">`. */
  position?: { 'Use <Sheet side="bottom">': never };
  /** Not a prop. A sheet fits its content; to set heights use `snapPoints={[0.5, 1]}`. */
  size?: { 'Use <Sheet snapPoints={[0.5, 1]}>': never };
}

/** An uncontrolled Sheet: `trigger` opens it. */
export type SheetWithTriggerProps = SheetBaseProps & {
  /** The element that opens the sheet, usually a Button: `trigger={<Button>Save</Button>}`. */
  trigger: ReactElement;
  /** Not with `trigger`. Remove `trigger` to control the sheet with `open` and `onOpenChange`. */
  open?: never;
  /** Not with `trigger`. Remove `trigger` to control the sheet with `open` and `onOpenChange`. */
  onOpenChange?: never;
};

/** A controlled Sheet: you own `open` and update it in `onOpenChange`. */
export type SheetControlledProps = SheetBaseProps & {
  /** Whether the sheet is open. */
  open: boolean;
  /** Called with `false` when the user dismisses the sheet (swipe, Escape, outside press). */
  onOpenChange: (open: boolean) => void;
  /** Not with `open`. Remove `open` and `onOpenChange` to let a trigger open the sheet. */
  trigger?: never;
};

/** Props for {@link Sheet}: either `trigger`, or `open` with `onOpenChange`. */
export type SheetProps = SheetWithTriggerProps | SheetControlledProps;

/**
 * A panel that slides in from an edge and is dragged back to dismiss: the
 * mobile form of a dialog. It stretches when pulled past its edge, its backdrop
 * lightens as it is dragged away, and it springs back on release. It handles
 * focus, Escape, scroll locking, safe areas and the software keyboard.
 *
 * Use `trigger` for a sheet a button opens, or `open` with `onOpenChange` to
 * control it. Use `Dialog` instead when the content should be a centered
 * dialog on larger screens; it renders this sheet on phones.
 *
 * @example
 * <Sheet title="Save to cookbook" trigger={<Button>Save</Button>}>
 *   <CookbookList />
 * </Sheet>
 * <Sheet title="Filters" open={open} onOpenChange={setOpen} snapPoints={[0.5, 1]}>
 *   <FilterForm />
 * </Sheet>
 */
export function Sheet(props: SheetProps): JSX.Element {
  const {
    title,
    hideTitle,
    closeLabel = "Close",
    description,
    side: sideProp = "bottom",
    snapPoints,
    children,
    className,
    trigger,
    open,
    onOpenChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
    position,
    size,
  } = props as SheetBaseProps & {
    trigger?: ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };

  checkOpenMode("Sheet", "sheet", trigger !== undefined, open, onOpenChange);

  // A side that is not one of Ouro UI's (a type error) warns and renders a bottom sheet.
  const side = sheetSides.includes(sideProp as SheetSide) ? (sideProp as SheetSide) : "bottom";

  useAppearanceClassNameCheck(
    "Sheet",
    className,
    process.env.NODE_ENV !== "production"
      ? sheetHint('<Sheet title="…">', "</Sheet>")
      : /* istanbul ignore next -- production only */ "",
  );
  useDevWarnings(
    "Sheet",
    process.env.NODE_ENV !== "production"
      ? () => [
          side !== sideProp && sideWarning(String(sideProp), '<Sheet side="bottom">'),
          isOpen !== undefined && ["isOpen is not a prop", "<Sheet open={open} onOpenChange={setOpen}>"],
          onClose !== undefined && ["onClose is not a prop", "<Sheet open={open} onOpenChange={setOpen}>"],
          position !== undefined && ["position is not a prop", '<Sheet side="bottom">'],
          size !== undefined && ["size is not a prop; a sheet fits its content", "<Sheet snapPoints={[0.5, 1]}>"],
        ]
      : /* istanbul ignore next -- production only */ undefined,
  );

  return (
    <SheetFrame
      title={title}
      hideTitle={hideTitle}
      closeLabel={closeLabel}
      description={description}
      side={side}
      snapPoints={snapPoints}
      className={className}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </SheetFrame>
  );
}

/**
 * The close button: always present for screen readers (a phone has no Escape key),
 * hidden from view until it has keyboard focus, then shown at the top corner.
 */
const closeClass =
  "sr-only focus-visible:top-3 focus-visible:end-3 focus-visible:z-1 focus-visible:m-0 focus-visible:size-auto " +
  "focus-visible:overflow-visible focus-visible:[clip-path:none] focus-visible:px-3 focus-visible:py-1.5 " +
  "focus-visible:rounded-lg focus-visible:bg-muted focus-visible:text-foreground focus-visible:text-sm focus-visible:leading-5 focus-visible:font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

/** Props for {@link SheetFrame}: a Sheet's props after its checks, plus what `Dialog` adds. */
export interface SheetFrameProps {
  title: string;
  hideTitle?: boolean | undefined;
  closeLabel: string;
  description?: ReactNode;
  side: SheetSide;
  snapPoints?: SheetSnapPoint[] | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** The opening element. May come with `open`, when `Dialog` owns the state. */
  trigger?: ReactElement | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** An actions row below the body (`Dialog`'s `footer`). */
  footer?: ReactNode;
  /** Marks the popup with `data-ouro-presentation`, when `Dialog` renders as a sheet. */
  presentation?: "sheet" | undefined;
  /** Where focus goes on close: `Dialog` passes its own trigger, which it renders outside the sheet. */
  finalFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * The sheet's markup, without prop checks: `Sheet` renders it after its own
 * checks, and `Dialog` renders it on phones after Dialog's checks, so every dev
 * message names the component the app wrote.
 *
 * @internal Shared with `Dialog`; apps use `Sheet`.
 */
export function SheetFrame({
  title,
  hideTitle,
  closeLabel,
  description,
  side,
  snapPoints,
  children,
  className,
  trigger,
  open,
  onOpenChange,
  footer,
  presentation,
  finalFocus,
}: SheetFrameProps): JSX.Element {
  const showHeader = !hideTitle || description !== undefined;
  const titleNode = <SheetTitle visuallyHidden={hideTitle}>{title}</SheetTitle>;

  return (
    <SheetRoot
      side={side}
      snapPoints={snapPoints}
      {...(open !== undefined ? { open, onOpenChange: (next: boolean) => onOpenChange!(next) } : {})}
    >
      {trigger !== undefined && <SheetTrigger render={trigger} />}
      <SheetPortal>
        <SheetBackdrop />
        <SheetViewport>
          <SheetPopupUnchecked
            className={className}
            data-ouro-presentation={presentation}
            {...(finalFocus ? { finalFocus } : {})}
          >
            {side === "bottom" && <SheetHandle />}
            {showHeader ? (
              <div data-ouro-sheet-header="" className="grid shrink-0 gap-1 px-5 pt-3 pb-2">
                {titleNode}
                {description !== undefined && <SheetDescription>{description}</SheetDescription>}
              </div>
            ) : (
              titleNode
            )}
            <SheetContent>{children}</SheetContent>
            {footer !== undefined && (
              <div data-ouro-footer="" className={footerClass}>
                {footer}
              </div>
            )}
            {side === "top" && <SheetHandle />}
            <SheetClose data-ouro-sheet-close="" className={closeClass}>
              {closeLabel}
            </SheetClose>
          </SheetPopupUnchecked>
        </SheetViewport>
      </SheetPortal>
    </SheetRoot>
  );
}
