"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { createContext, useCallback, useContext, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import { useBackdropAnchor } from "~/lib/ouro/use-backdrop-anchor";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useKeyboardScrollable } from "~/lib/ouro/use-keyboard-scrollable";
import { cn } from "~/lib/ouro/cn";
import { holdPageAtPress } from "~/lib/ouro/page-scroll-hold";
import { PortalScope } from "~/lib/ouro/portal-container";
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
// --ouro-inset-top is the height of an app bar the app draws across the window's top; the dialog layer starts below it.
// On iOS the backdrop's top is anchored to the screen (useBackdropAnchor), so the inset clips it there instead.
const backdropClass =
  "fixed inset-0 top-(--ouro-inset-top,0px) z-1000 min-h-dvh bg-(--ouro-backdrop-color) opacity-(--ouro-backdrop-max) " +
  "transition-opacity duration-(--ouro-duration-slow) ease-(--ouro-ease-out) " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--ouro-duration-base) data-ouro-instant:transition-none " +
  iosBackdrop +
  " supports-[-webkit-touch-callout:none]:[clip-path:inset(var(--ouro-inset-top,0px)_0_0_0)]";

const viewportClass =
  "fixed inset-0 top-(--ouro-inset-top,0px) z-1000 box-border flex items-center justify-center " +
  "pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] " +
  "pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]";

const popupClass =
  "relative box-border flex max-h-full min-h-0 flex-col outline-none " +
  "rounded-xl bg-popover text-popover-foreground " +
  "ring-1 ring-border/60 shadow-(--shadow-xl) " +
  "[transition:transform_var(--ouro-duration-slow)_var(--ouro-ease-out),opacity_var(--ouro-duration-slow)_var(--ouro-ease-out)] " +
  "data-starting-style:[transform:scale(0.96)] data-starting-style:opacity-0 " +
  "data-ending-style:[transform:scale(0.96)] data-ending-style:opacity-0 " +
  "data-ending-style:duration-(--ouro-duration-base) " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "motion-reduce:data-starting-style:[transform:none] motion-reduce:data-ending-style:[transform:none] data-ouro-instant:[transition:none]";

// Running text: the elements Link also treats as text. In a dialog that fits its content they wrap at 65ch, so their
// one-line width does not widen it, while a table, an image or a grid still does. The rule sits in the ouro-reset
// layer, so the app's own max-width class on a paragraph wins.
const fitClass =
  "w-fit min-w-[min(32rem,100%)] " +
  "[@layer_ouro-reset]:[&_:where(p,h1,h2,h3,h4,h5,h6,li,dt,dd,label,legend,blockquote,figcaption,[data-ouro=text],[data-ouro-text])]:max-w-[65ch]";

// sm, md and lg keep one width whatever the content. auto and the wide sizes fit their content: at least md's width,
// so a short form does not shrink, and at most their cap and the viewport less its margins. auto's cap is 70% of the
// screen, from 40rem to 56rem.
const popupSizes = {
  auto: `${fitClass} max-w-[min(100%,clamp(40rem,70vw,56rem))]`,
  sm: "w-full max-w-[24rem]",
  md: "w-full max-w-[32rem]",
  lg: "w-full max-w-[40rem]",
  xl: `${fitClass} max-w-[min(100%,56rem)]`,
  "2xl": `${fitClass} max-w-[min(100%,72rem)]`,
  full: `${fitClass} max-w-full`,
} as const;

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
 * @claim "It shares every other part with" registry/ouro/components/ouro/dialog/dialog-parts.tsx verify:fileLine(registry/ouro/components/ouro/dialog/dialog-parts.tsx, /export\sfunction\sAlertDialogRoot/)
 */
export function AlertDialogRoot(props: AlertDialog.Root.Props): JSX.Element {
  return (
    <DialogContext.Provider value>
      <AlertDialog.Root {...props} />
    </DialogContext.Provider>
  );
}

/** Part: the button that opens the dialog. Pass your button as `render={<Button>Open</Button>}`. */
export function DialogTrigger({ onPointerDown, onKeyDown, ...props }: BaseDialog.Trigger.Props): JSX.Element {
  useDialogPart("DialogTrigger", "…");
  return (
    <BaseDialog.Trigger
      {...(props.render === undefined ? { className: "forced-colors:border forced-colors:border-solid", "data-ouro-control": "dialog", "data-ouro-part": "trigger" } : {})}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        holdPageAtPress.dialog.onPointerDown(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        holdPageAtPress.dialog.onKeyDown(event);
      }}
    />
  );
}

/**
 * Part: moves the dialog to the end of `<body>`, in its own stacking context at the
 * `--ouro-layer` z-index (50 by default, from ouro-base.css). If your app has fixed
 * bars above z-50, raise it in a `:root` rule of your own after the Ouro tokens, outside
 * any `@layer`: `:root { --ouro-layer: 60; }`. Don't edit the line shadcn wrote; `shadcn add` resets it.
 * @claim "Part: moves the dialog to the" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::Dialog stacking above the app's fixed bars > puts the portal on the --ouro-layer level, as its own stacking context)
 * @claim "Part: moves the dialog to the" registry/ouro/theme/ouro-base.css verify:fileLine(registry/ouro/theme/ouro-base.css, /^\s+--ouro-layer:\s50;/)
 */
export function DialogPortal(props: Omit<BaseDialog.Portal.Props, "className">): JSX.Element {
  useDialogPart("DialogPortal", "…");
  return (
    <BaseDialog.Portal {...props} data-ouro="dialog-portal" className="relative isolate z-(--ouro-layer)">
      <PortalScope>{props.children}</PortalScope>
    </BaseDialog.Portal>
  );
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
  /**
   * The panel's width. By default (`auto`) it fits its content and the screen: at least 32rem, so a form or a short
   * question keeps a comfortable width, and at most 70% of the screen, from 40rem up to 56rem, so a gallery or a table grows
   * on a big screen. Running text (paragraphs, headings, list items, labels, `Text`) wraps at a readable 65ch and does not
   * widen it; bare text in a `div` measures as one long line, so put prose in a `<p>`. `xl` (56rem), `2xl` (72rem) and
   * `full` (the viewport) raise the cap for wide content. `sm` (24rem), `md` (32rem) and `lg` (40rem) pin a fixed width
   * whatever the content. Every size narrows to the viewport less its 1rem margins (or the safe area). @default "auto"
   *
   * @claim "By default (`auto`) it fits" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > fits size %s to its content, from 32rem up to %ipx)
   * @claim "By default (`auto`) it fits" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > follows the screen by default: a wide table makes it %ipx wide on a %ipx screen)
   * @claim "Running text (paragraphs, headings, list" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps running text at a readable 65ch in size %s, so text alone does not widen it)
   * @claim "Running text (paragraphs, headings, list" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > lets the app's own max-width class on a paragraph win over the 65ch measure)
   * @claim "`xl` (56rem), `2xl` (72rem) and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > caps size %s at %ipx wide)
   * @claim "`sm` (24rem), `md` (32rem) and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps size %s at %ipx whatever the content)
   * @claim "Every size narrows to the viewport" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps size %s inside a 390px phone's 16px margins when presentation is dialog)
   */
  size?: DialogSize | (string & { 'Use "auto", "sm", "md", "lg", "xl", "2xl" or "full"': never }) | undefined;
};

/**
 * Part: the dialog panel. It scales up from 0.96 and fades in over 300ms, and scales and
 * fades out in 200ms; reduced motion keeps only the fade.
 * @claim "It scales up from 0.96 and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::motion > scales from 0.96 on the ease-out token and fades, entering in 300ms and leaving in 200ms)
 * @claim "It scales up from 0.96 and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::motion > drops the scale under reduced motion and keeps the fade)
 */
export function DialogPopup({ size: sizeProp = "auto", ...props }: DialogPopupProps): JSX.Element {
  // A size that is not one of Ouro UI's (a type error) warns and renders the default.
  const size = dialogSizes.includes(sizeProp as DialogSize) ? (sizeProp as DialogSize) : "auto";
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
  ref,
  ...props
}: Omit<DialogPopupProps, "size"> & { size: DialogSize }): JSX.Element {
  useDialogPart("DialogPopup", "…");
  const holdRef = useMergedRef(ref, useHeldTop());
  return (
    <BaseDialog.Popup
      {...props}
      ref={holdRef}
      className={cn(popupClass, popupSizes[size], className)}
      data-ouro="dialog"
      data-ouro-presentation="dialog"
      data-size={size}
    />
  );
}

/**
 * Keeps an open dialog's top edge where it opened while its content grows or shrinks, as a macOS sheet does, so a
 * dialog whose steps tick by grows downward instead of moving as a whole. It opens centred, moves up only as far as
 * it must to stay inside the screen's margin, and centres itself again for a window of a new size.
 */
function useHeldTop(): (popup: HTMLElement) => () => void {
  return useCallback((popup: HTMLElement) => {
    const viewport = popup.parentElement!;
    // Where the popup's top is held, from the viewport's top: where the viewport centred it when it opened.
    let held: number | undefined;
    // A relative offset from where the viewport's centring puts it, so the popup's own margins (Lightbox's full
    // screen) stay as they are.
    const place = () => {
      const height = popup.offsetHeight;
      const natural = popup.offsetTop - (parseFloat(popup.style.top) || 0);
      const lowest = viewport.clientHeight - parseFloat(getComputedStyle(viewport).paddingBottom) - height;
      held ??= natural;
      // Taller than the room, it stays where the viewport puts it; otherwise as near the held top as it fits.
      // Stryker disable next-line EqualityOperator: at natural === lowest the popup fills the room, so held >= lowest and both give 0.
      popup.style.top = `${natural > lowest ? 0 : Math.min(held, lowest) - natural}px`;
    };
    place();
    const content = new ResizeObserver(place);
    content.observe(popup);
    // A window of a new height centres it again; a width change (a page's scroll bar coming or going) does not.
    let screenHeight = viewport.clientHeight;
    const screen = new ResizeObserver(() => {
      if (viewport.clientHeight !== screenHeight) held = undefined;
      screenHeight = viewport.clientHeight;
      place();
    });
    screen.observe(viewport);
    // Stryker disable next-line BlockStatement: the observers watch a popup and viewport that are leaving the page, so no test sees them stop.
    return () => {
      // Stryker disable next-line CallExpression: as above.
      content.disconnect();
      // Stryker disable next-line CallExpression: as above.
      screen.disconnect();
    };
  },
  // Stryker disable next-line ArrayDeclaration: the callback reads nothing from render, so any dependency list keeps it.
  []);
}

/** Props for {@link DialogTitle}. */
export type DialogTitleProps = Omit<BaseDialog.Title.Props, "className"> & {
  /** Hides the title visually; it still names the dialog for screen readers. */
  visuallyHidden?: boolean | undefined;
};

/**
 * Part: the dialog's title, which names it. Every dialog needs one.
 *
 * @claim "Every dialog needs one" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:fileLine(registry/ouro/components/ouro/dialog/dialog.test.tsx, /warns\swhen\sthe\stitle\sis\smissing/)
 */
export function DialogTitle({ visuallyHidden, ...props }: DialogTitleProps): JSX.Element {
  useDialogPart("DialogTitle", "<DialogTitle>…</DialogTitle>…");
  return (
    <BaseDialog.Title
      {...props}
      data-ouro-dialog-title=""
      className={
        visuallyHidden
          ? "sr-only"
          : "m-0 font-[family-name:var(--font-heading,inherit)] text-lg leading-6 font-semibold text-balance text-popover-foreground"
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
      data-ouro-control="dialog"
      data-ouro-part="content"
      {...props}
      ref={scrollRef}
      data-ouro-dialog-content=""
      className={cn(
        "box-border min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pt-2 pb-5",
        // A body that overflows is a tab stop (useKeyboardScrollable); show where focus is.
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        // Under forced colours, where the body ends while it is one.
        "forced-colors:[&[tabindex='0']]:outline-1 forced-colors:[&[tabindex='0']]:outline-solid forced-colors:[&[tabindex='0']]:-outline-offset-1",
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
  return <BaseDialog.Close {...(props.render === undefined ? { className: "forced-colors:border forced-colors:border-solid", "data-ouro-control": "dialog", "data-ouro-part": "close" } : {})} {...props} />;
}
