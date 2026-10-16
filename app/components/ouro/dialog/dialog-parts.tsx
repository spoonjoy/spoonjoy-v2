"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { createContext, useContext, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import { useBackdropAnchor } from "~/lib/ouro/use-backdrop-anchor";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useKeyboardScrollable } from "~/lib/ouro/use-keyboard-scrollable";
import { cn } from "~/lib/ouro/cn";
import { footerClass, iosBackdrop, sheetHint } from "~/components/ouro/sheet/sheet-styles";
import { dialogSizes, dialogSizeWarning, type DialogSize } from "~/components/ouro/dialog/dialog-styles";

export type { DialogSize } from "~/components/ouro/dialog/dialog-styles";

const DialogContext = createContext(false);

/*
 * Styles. The popup scales from 0.96 and fades in over 300ms, and scales and
 * fades out in 200ms, on the ease-out token; reduced motion keeps only the fade. The viewport keeps a 1rem
 * margin (or the safe area) on every side, so the dialog fits a phone; the body scrolls
 * when the dialog is taller than that. Class strings are literal so the app's Tailwind
 * finds them when it compiles.
 */
const backdropClass =
  "fixed inset-0 z-1000 min-h-dvh bg-(--ouro-backdrop-color) opacity-(--ouro-backdrop-max) " +
  "transition-opacity duration-(--ouro-duration-slow) ease-(--ouro-ease-out) " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--ouro-duration-base) data-ouro-instant:transition-none " +
  iosBackdrop;

const viewportClass =
  "fixed inset-0 z-1000 box-border flex items-center justify-center " +
  "pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] " +
  "pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]";

const popupClass =
  "relative box-border flex w-full max-h-full min-h-0 flex-col outline-none " +
  "rounded-xl bg-popover text-popover-foreground " +
  "[box-shadow:0_0_0_1px_color-mix(in_oklab,var(--border)_60%,transparent),0_16px_48px_rgb(0_0_0/0.18)] " +
  "[transition:transform_var(--ouro-duration-slow)_var(--ouro-ease-out),opacity_var(--ouro-duration-slow)_var(--ouro-ease-out)] " +
  "data-starting-style:[transform:scale(0.96)] data-starting-style:opacity-0 " +
  "data-ending-style:[transform:scale(0.96)] data-ending-style:opacity-0 " +
  "data-ending-style:duration-(--ouro-duration-base) " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "motion-reduce:data-starting-style:[transform:none] motion-reduce:data-ending-style:[transform:none] data-ouro-instant:[transition:none]";

const popupSizes = { sm: "max-w-[24rem]", md: "max-w-[32rem]", lg: "max-w-[40rem]" } as const;

/** The JSX that puts a part in its place, for the dev message when it is not. */
function shape(inner: string): string {
  return `<DialogRoot><DialogTrigger render={<Button>Open</Button>} /><DialogPortal><DialogBackdrop /><DialogViewport><DialogPopup>${inner}</DialogPopup></DialogViewport></DialogPortal></DialogRoot>`;
}

/** Throws in development, with the JSX the part belongs in, unless it sits inside a dialog root. */
function useDialogPart(part: string, inner: string): void {
  if (!useContext(DialogContext)) {
    devThrow(
      part,
      "must be rendered inside <DialogRoot>",
      process.env.NODE_ENV !== "production" ? shape(inner) : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
}

/**
 * Part: the state owner of a centered dialog built from parts. Use the `Dialog`
 * component instead unless its props cannot express your layout; `Dialog` also becomes a bottom sheet on phones, which parts do not.
 *
 * @example
 * <DialogRoot>
 *   <DialogTrigger render={<Button>Edit</Button>} />
 *   <DialogPortal>
 *     <DialogBackdrop />
 *     <DialogViewport>
 *       <DialogPopup size="sm">
 *         <DialogTitle>Edit recipe</DialogTitle>
 *         <DialogContent>…</DialogContent>
 *         <DialogFooter>
 *           <DialogClose render={<Button>Done</Button>} />
 *         </DialogFooter>
 *       </DialogPopup>
 *     </DialogViewport>
 *   </DialogPortal>
 * </DialogRoot>
 */
export function DialogRoot(props: BaseDialog.Root.Props): JSX.Element {
  return (
    <DialogContext.Provider value>
      <BaseDialog.Root {...props} />
    </DialogContext.Provider>
  );
}

/**
 * The root for `ConfirmDialog`: Base UI's alert dialog, which an outside press
 * cannot dismiss. It shares every other part with `DialogRoot`.
 *
 * @internal For `ConfirmDialog`; apps use `ConfirmDialog`.
 */
export function AlertDialogRoot(props: AlertDialog.Root.Props): JSX.Element {
  return (
    <DialogContext.Provider value>
      <AlertDialog.Root {...props} />
    </DialogContext.Provider>
  );
}

/** Part: the button that opens the dialog. Pass your button as `render={<Button>Open</Button>}`. */
export function DialogTrigger(props: BaseDialog.Trigger.Props): JSX.Element {
  useDialogPart("DialogTrigger", "…");
  return <BaseDialog.Trigger {...props} />;
}

/**
 * Part: moves the dialog to the end of `<body>`, in its own stacking context at the
 * `--ouro-layer` z-index (50 by default, from ouro-base.css). If your app has fixed
 * bars above z-50, raise it in a `:root` rule of your own after the Ouro tokens, outside
 * any `@layer`: `:root { --ouro-layer: 60; }`. Don't edit the line shadcn wrote; `shadcn add` resets it.
 */
export function DialogPortal(props: Omit<BaseDialog.Portal.Props, "className">): JSX.Element {
  useDialogPart("DialogPortal", "…");
  return <BaseDialog.Portal {...props} data-ouro="dialog-portal" className="relative isolate z-(--ouro-layer)" />;
}

/**
 * Part: the dimming layer behind the dialog. On iOS it stays anchored to the top
 * of the screen on a scrolled page. A `ref` reaches the backdrop element.
 */
export function DialogBackdrop({
  ref,
  ...props
}: Omit<BaseDialog.Backdrop.Props, "className"> & { ref?: Ref<HTMLDivElement> | undefined }): JSX.Element {
  useDialogPart("DialogBackdrop", "…");
  const anchorRef = useBackdropAnchor(ref);
  return <BaseDialog.Backdrop {...props} ref={anchorRef} data-ouro="dialog-backdrop" className={backdropClass} />;
}

/** Part: the full-screen layer that centers the popup and keeps it clear of the screen edges. */
export function DialogViewport(props: Omit<BaseDialog.Viewport.Props, "className">): JSX.Element {
  useDialogPart("DialogViewport", "…");
  return <BaseDialog.Viewport {...props} data-ouro="dialog-viewport" className={viewportClass} />;
}

/** Props for {@link DialogPopup}. `className` is for layout only (margins, width). */
export type DialogPopupProps = Omit<BaseDialog.Popup.Props, "className"> & {
  className?: string | undefined;
  /** Maximum width: `sm` 24rem, `md` 32rem, `lg` 40rem. @default "md" */
  size?: DialogSize | (string & { 'Use "sm", "md" or "lg"': never }) | undefined;
};

/**
 * Part: the dialog panel. It scales up from 0.96 and fades in over 300ms, and scales and
 * fades out in 200ms; reduced motion keeps only the fade.
 */
export function DialogPopup({ size: sizeProp = "md", ...props }: DialogPopupProps): JSX.Element {
  // A size that is not one of Ouro UI's (a type error) warns and renders md.
  const size = dialogSizes.includes(sizeProp as DialogSize) ? (sizeProp as DialogSize) : "md";
  useDevWarnings(
    "DialogPopup",
    process.env.NODE_ENV !== "production"
      ? () => [size !== sizeProp && dialogSizeWarning(String(sizeProp), '<DialogPopup size="md">')]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  useAppearanceClassNameCheck(
    "DialogPopup",
    props.className,
    process.env.NODE_ENV !== "production"
      ? sheetHint("<DialogPopup>", "</DialogPopup>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  return <DialogPopupUnchecked {...props} size={size} />;
}

/**
 * The popup without its own className check, for `Dialog` and `ConfirmDialog`, which check their own.
 *
 * @internal
 */
export function DialogPopupUnchecked({
  className,
  size,
  ...props
}: Omit<DialogPopupProps, "size"> & { size: DialogSize }): JSX.Element {
  useDialogPart("DialogPopup", "…");
  return (
    <BaseDialog.Popup
      {...props}
      className={cn(popupClass, popupSizes[size], className)}
      data-ouro="dialog"
      data-ouro-presentation="dialog"
      data-size={size}
    />
  );
}

/** Props for {@link DialogTitle}. */
export type DialogTitleProps = Omit<BaseDialog.Title.Props, "className"> & {
  /** Hides the title visually; it still names the dialog for screen readers. */
  visuallyHidden?: boolean | undefined;
};

/** Part: the dialog's title, which names it. Every dialog needs one. */
export function DialogTitle({ visuallyHidden, ...props }: DialogTitleProps): JSX.Element {
  useDialogPart("DialogTitle", "<DialogTitle>…</DialogTitle>…");
  return (
    <BaseDialog.Title
      {...props}
      data-ouro-dialog-title=""
      className={
        visuallyHidden
          ? "sr-only"
          : "m-0 text-lg leading-6 font-semibold text-balance text-popover-foreground"
      }
    />
  );
}

/** Part: a line under the title that describes the dialog. */
export function DialogDescription(props: Omit<BaseDialog.Description.Props, "className">): JSX.Element {
  useDialogPart("DialogDescription", "<DialogTitle>…</DialogTitle><DialogDescription>…</DialogDescription>…");
  return (
    <BaseDialog.Description
      {...props}
      data-ouro-dialog-description=""
      className="m-0 text-sm leading-5 text-pretty text-muted-foreground"
    />
  );
}

/** Props for {@link DialogContent}. `className` is for layout only. */
export type DialogContentProps = Omit<JSX.IntrinsicElements["div"], "className"> & { className?: string | undefined };

/**
 * Part: the dialog's body. It scrolls when the dialog is taller than the
 * screen, and while it overflows it is a tab stop, so a keyboard can scroll it.
 */
export function DialogContent({ className, ref, ...props }: DialogContentProps): JSX.Element {
  const scrollRef = useMergedRef(ref, useKeyboardScrollable<HTMLDivElement>(props.tabIndex === undefined));
  useDialogPart("DialogContent", "<DialogTitle>…</DialogTitle><DialogContent>…</DialogContent>");
  useAppearanceClassNameCheck(
    "DialogContent",
    className,
    process.env.NODE_ENV !== "production"
      ? sheetHint("<DialogContent>", "</DialogContent>")
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  return (
    <div
      {...props}
      ref={scrollRef}
      data-ouro-dialog-content=""
      className={cn(
        "box-border min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pt-2 pb-5",
        // A body that overflows is a tab stop (useKeyboardScrollable); show where focus is.
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        className,
      )}
    />
  );
}

/**
 * Part: the actions row. A row at the end on wider screens; on phones the
 * actions stack full width. Put the primary action last, so it sits at the
 * bottom on phones, nearest the thumb.
 */
export function DialogFooter(props: Omit<JSX.IntrinsicElements["div"], "className">): JSX.Element {
  useDialogPart(
    "DialogFooter",
    "<DialogTitle>…</DialogTitle><DialogContent>…</DialogContent><DialogFooter>…</DialogFooter>",
  );
  return <div {...props} data-ouro-footer="" className={footerClass} />;
}

/** Part: closes the dialog. Pass your button as `render={<Button>Done</Button>}`. */
export function DialogClose(props: BaseDialog.Close.Props): JSX.Element {
  useDialogPart("DialogClose", "<DialogTitle>…</DialogTitle><DialogFooter><DialogClose>…</DialogClose></DialogFooter>");
  return <BaseDialog.Close {...props} />;
}
