import {
  cloneElement,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { checkOpenMode } from "~/lib/ouro/open-mode";
import { useMergedRef } from "~/lib/ouro/refs";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import { sheetHint } from "~/components/ouro/sheet/sheet-styles";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPopupUnchecked,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogViewport,
} from "~/components/ouro/dialog/dialog-parts";
import { dialogSizes, dialogSizeWarning, type DialogSize } from "~/components/ouro/dialog/dialog-styles";

export type { DialogSize } from "~/components/ouro/dialog/dialog-parts";

/** How a Dialog presents: `auto` is a centered dialog from 640px up and a bottom sheet below. */
export type DialogPresentation = "auto" | "dialog" | "sheet";

const presentations: readonly DialogPresentation[] = ["auto", "dialog", "sheet"];

/** Props shared by both ways of opening a Dialog. */
export interface DialogBaseProps {
  /** Names the dialog for screen readers and shows at its top. Always required; hide it with `hideTitle`. */
  title: string;
  /** Hides the title visually. It still names the dialog for screen readers. */
  hideTitle?: boolean | undefined;
  /**
   * The label of the close button. A centered dialog shows it as an icon button
   * in the top corner; as a sheet it is hidden until it has keyboard focus.
   * Screen-reader users on phones (who have no Escape key) can always reach it.
   * @default "Close"
   */
  closeLabel?: string | undefined;
  /** A short line under the title, read out when the dialog opens. */
  description?: ReactNode;
  /**
   * `auto` renders a centered dialog from the `sm` breakpoint (640px) up and a
   * bottom sheet you can drag away below it. The server renders the dialog form
   * and corrects it on hydration; nothing shows until it opens, so nothing shifts.
   * @default "auto"
   */
  presentation?: DialogPresentation | (string & { 'Use "auto", "dialog" or "sheet"': never }) | undefined;
  /** The centered dialog's maximum width: `sm` 24rem, `md` 32rem, `lg` 40rem. @default "md" */
  size?: DialogSize | (string & { 'Use "sm", "md" or "lg"': never }) | undefined;
  /**
   * The actions row: a row at the end on wider screens, stacked full width on
   * phones. Put the primary action last, so it sits on the right on wider
   * screens and at the bottom, nearest the thumb, on phones:
   * `footer={<><Button variant="outline" tone="secondary">Cancel</Button><Button>Save</Button></>}`.
   */
  footer?: ReactNode;
  /** The body. It scrolls when the dialog is taller than the screen. */
  children: ReactNode;
  /**
   * Layout only, applied to the panel: margins (`mt-4`). Use `size` for width.
   * Your classes win over Ouro UI's. Appearance classes warn in development.
   */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<Dialog open={open} onOpenChange={setOpen}>`. */
  isOpen?: { 'Use <Dialog open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. `onOpenChange(false)` fires on close: `<Dialog open={open} onOpenChange={setOpen}>`. */
  onClose?: { 'Use <Dialog open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. A Dialog is centered, or a bottom sheet on phones. For another edge use `<Sheet side="…">`. */
  position?: { 'Use <Sheet side="right">': never };
  /** Not a prop. A Dialog is centered, or a bottom sheet on phones. For another edge use `<Sheet side="…">`. */
  side?: { 'Use <Sheet side="right">': never };
  /** Not a prop. A Dialog fits its content. For snap points use `<Sheet snapPoints={[0.5, 1]}>`. */
  snapPoints?: { 'Use <Sheet snapPoints={[0.5, 1]}>': never };
}

/** An uncontrolled Dialog: `trigger` opens it. */
export type DialogWithTriggerProps = DialogBaseProps & {
  /** The element that opens the dialog, usually a Button: `trigger={<Button>Edit</Button>}`. */
  trigger: ReactElement;
  /** Not with `trigger`. Remove `trigger` to control the dialog with `open` and `onOpenChange`. */
  open?: never;
  /** Not with `trigger`. Remove `trigger` to control the dialog with `open` and `onOpenChange`. */
  onOpenChange?: never;
};

/** A controlled Dialog: you own `open` and update it in `onOpenChange`. */
export type DialogControlledProps = DialogBaseProps & {
  /**
   * Whether the dialog is open. When a touch or pen tap opened it (on your own
   * button, say), the centered dialog focuses itself rather than its first input,
   * so no software keyboard pops up; after a key press it focuses the first control.
   */
  open: boolean;
  /** Called with `false` when the user dismisses the dialog (close button, Escape, outside press, swipe). */
  onOpenChange: (open: boolean) => void;
  /** Not with `open`. Remove `open` and `onOpenChange` to let a trigger open the dialog. */
  trigger?: never;
};

/** Props for {@link Dialog}: either `trigger`, or `open` with `onOpenChange`. */
export type DialogProps = DialogWithTriggerProps | DialogControlledProps;

/** The props Dialog reads from, and adds to, its trigger element. */
type TriggerProps = {
  ref?: Ref<HTMLElement> | undefined;
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  onPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  "aria-haspopup"?: string;
  "aria-expanded"?: boolean;
};

/**
 * A compact icon button in the top corner: a centered dialog has no swipe to dismiss.
 * The header's end padding keeps the title clear of it, even when the title is hidden.
 */
const closeClass =
  "absolute top-3 end-3 box-border inline-flex size-8 items-center justify-center m-0 p-0 border-0 rounded-lg " +
  "bg-transparent text-muted-foreground cursor-pointer [-webkit-tap-highlight-color:transparent] " +
  "[transition:background-color_var(--ouro-duration-fast)_ease-out,color_var(--ouro-duration-fast)_ease-out] " +
  "hover:bg-accent hover:text-accent-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [&>svg]:size-4";

/**
 * How the user last interacted with the page: the pointer type of the last
 * `pointerdown` on the document ("mouse", "touch" or "pen"), or "keyboard" after a
 * later key press. A controlled Dialog reads it when it opens, because the app's own
 * button opened it and Dialog never saw that press.
 */
let lastInput = "";

/** Starts recording {@link lastInput}, in the capture phase so nothing can stop it. */
function trackLastInput(): void {
  document.addEventListener("pointerdown", (event) => (lastInput = event.pointerType), true);
  document.addEventListener("keydown", () => (lastInput = "keyboard"), true);
}

// From module load, not from the first Dialog's mount: an app that mounts its Dialog on
// the tap that opens it (`{editing && <Dialog open … />}`) must still see that tap.
/* istanbul ignore else @preserve -- the else path is server rendering, which has no document */
if (typeof document !== "undefined") trackLastInput();

/** The close button's icon: a 16px cross in the text color. */
function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A dialog that presents itself for the screen: a centered dialog on wider
 * screens and a bottom sheet you can drag away on phones (below 640px). It
 * handles focus, Escape, outside presses, scroll locking and a close button.
 *
 * Use `trigger` for a dialog a button opens, or `open` with `onOpenChange` to
 * control it. Use `ConfirmDialog` instead to confirm an action, and `Sheet`
 * instead when the panel should slide in from an edge at every width.
 *
 * It stacks above the page at `--ouro-layer`, a z-index of 50 by default (from
 * ouro-base.css). If your app has fixed bars above z-50, raise it in a `:root` rule
 * of your own after the Ouro tokens, outside any `@layer`: `:root { --ouro-layer: 60; }`.
 * Don't edit the `--ouro-layer: 50` line shadcn wrote; `shadcn add` resets it.
 *
 * Testing accessibility: in WebKit, Base UI's focus guards take `role="button"`
 * without a name so VoiceOver's cursor stays trapped. Exclude them:
 * `new AxeBuilder({ page }).exclude("[data-base-ui-focus-guard]")`.
 *
 * @see https://ourostack.github.io/ouro-ui/docs/dialog
 *
 * @example
 * <Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>
 *   <RecipeForm />
 * </Dialog>
 * <Dialog
 *   title="Save to cookbook"
 *   open={open}
 *   onOpenChange={setOpen}
 *   footer={<Button onClick={() => setOpen(false)}>Done</Button>}
 * >
 *   <CookbookList />
 * </Dialog>
 */
export function Dialog(props: DialogProps): JSX.Element {
  const {
    title,
    hideTitle,
    closeLabel = "Close",
    description,
    presentation: presentationProp = "auto",
    size: sizeProp = "md",
    footer,
    children,
    className,
    trigger,
    open,
    onOpenChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
    position,
    side,
    snapPoints,
  } = props as DialogBaseProps & {
    trigger?: ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };

  checkOpenMode("Dialog", "dialog", trigger !== undefined, open, onOpenChange);

  // A size or presentation that is not one of Ouro UI's (a type error) warns and renders the default.
  const size = dialogSizes.includes(sizeProp as DialogSize) ? (sizeProp as DialogSize) : "md";
  const presentation = presentations.includes(presentationProp as DialogPresentation)
    ? (presentationProp as DialogPresentation)
    : "auto";

  useAppearanceClassNameCheck(
    "Dialog",
    className,
    process.env.NODE_ENV !== "production"
      ? sheetHint('<Dialog title="…">', "</Dialog>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Dialog",
    process.env.NODE_ENV !== "production"
      ? () => {
          const where = "a Dialog is centered, or a bottom sheet on phones";
          const list = (values: readonly string[]) => values.map((name) => `"${name}"`).join(", ");
          return [
            !title && ["title is required; it names the dialog for screen readers", '<Dialog title="Edit recipe">'],
            size !== sizeProp && dialogSizeWarning(String(sizeProp), '<Dialog size="md">'),
            presentation !== presentationProp && [
              `presentation="${String(presentationProp)}" is not a presentation; use ${list(presentations)}`,
              '<Dialog presentation="auto">',
            ],
            isOpen !== undefined && ["isOpen is not a prop", "<Dialog open={open} onOpenChange={setOpen}>"],
            onClose !== undefined && ["onClose is not a prop", "<Dialog open={open} onOpenChange={setOpen}>"],
            position !== undefined && [`position is not a prop; ${where}`, '<Sheet side="bottom">'],
            side !== undefined && [`side is not a prop; ${where}`, `<Sheet side="${String(side)}">`],
            snapPoints !== undefined && [
              "snapPoints is not a prop; a Dialog fits its content",
              "<Sheet snapPoints={[0.5, 1]}>",
            ],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // The Dialog owns the open state even with a trigger, so the dialog stays open
  // when a resize across 640px swaps the centered dialog for the sheet.
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpenNow = controlled ? open : ownOpen;
  const setOpen = controlled ? onOpenChange! : setOwnOpen;

  // The trigger is rendered once, outside both presentations, so its DOM node (and
  // its focus, and the server-rendered node after hydration) survives a switch
  // between the centered dialog and the sheet.
  const triggerRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // How the trigger last opened the dialog. Base UI's own trigger records this so a
  // tap focuses the popup instead of the first input (which would raise the
  // software keyboard); the cloned trigger records it here instead.
  const [lastPointer, setLastPointer] = useState<string>();
  const [tapOpened, setTapOpened] = useState(false);
  const triggerProps = (trigger?.props ?? {}) as TriggerProps;
  const mergedTriggerRef = useMergedRef(triggerProps.ref, triggerRef);
  const triggerNode =
    trigger !== undefined &&
    cloneElement(trigger as ReactElement<TriggerProps>, {
      ref: mergedTriggerRef,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        triggerProps.onPointerDown?.(event);
        setLastPointer(event.pointerType);
      },
      onClick: (event: MouseEvent<HTMLElement>) => {
        triggerProps.onClick?.(event);
        if (event.defaultPrevented) return;
        // A click with no pointer behind it (detail 0) came from the keyboard.
        const pointer = event.detail === 0 ? "keyboard" : lastPointer;
        setTapOpened(pointer === "touch" || pointer === "pen");
        setOpen(true);
      },
      "aria-haspopup": "dialog",
      "aria-expanded": isOpenNow,
    });
  // Focus returns to the trigger on close, in either presentation.
  const finalFocus = trigger !== undefined ? { finalFocus: triggerRef } : {};
  // The centered dialog focuses itself after a touch or pen open, and the first
  // control otherwise, as Base UI does with its own trigger. A controlled dialog
  // decides when it opens, from the last press on the page. (The sheet always
  // focuses itself, like a plain Sheet.)
  const initialFocus = controlled
    ? { initialFocus: () => (lastInput === "touch" || lastInput === "pen" ? popupRef.current : true) }
    : tapOpened
      ? { initialFocus: popupRef }
      : {};

  // The server and hydration render the dialog form; the client corrects it after.
  const wide = useMediaQuery("(min-width: 640px)", true);
  const presented =
    presentation === "sheet" || (presentation === "auto" && !wide) ? (
      <SheetFrame
        title={title}
        hideTitle={hideTitle}
        closeLabel={closeLabel}
        description={description}
        side="bottom"
        className={className}
        open={isOpenNow}
        onOpenChange={setOpen}
        footer={footer}
        presentation="sheet"
        {...finalFocus}
      >
        {children}
      </SheetFrame>
    ) : (
      <DialogRoot open={isOpenNow} onOpenChange={(next) => setOpen(next)}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport>
            <DialogPopupUnchecked
              ref={popupRef}
              className={className}
              size={size}
              {...finalFocus}
              {...initialFocus}
            >
              {/* Always rendered: with a hidden title it still keeps the body clear of the close button. */}
              <div data-ouro-dialog-header="" className="box-border grid min-h-13 shrink-0 gap-1 pt-5 pr-13 pb-2 pl-5">
                <DialogTitle visuallyHidden={hideTitle}>{title}</DialogTitle>
                {description !== undefined && <DialogDescription>{description}</DialogDescription>}
              </div>
              <DialogContent>{children}</DialogContent>
              {footer !== undefined && <DialogFooter>{footer}</DialogFooter>}
              <DialogClose data-ouro-dialog-close="" aria-label={closeLabel} className={closeClass}>
                <TouchTarget />
                <CloseIcon />
              </DialogClose>
            </DialogPopupUnchecked>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>
    );

  return (
    <>
      {triggerNode}
      {presented}
    </>
  );
}
