"use client";

import { useEffect, useRef, useState, type JSX, type ReactElement, type ReactNode, type RefObject } from "react";
import { devWarn } from "~/lib/ouro/dev";
import { checkOpenMode } from "~/lib/ouro/open-mode";
import { toneWarning } from "~/lib/ouro/tones";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Button } from "~/components/ouro/button/button";
import {
  AlertDialogRoot,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogPopupUnchecked,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "~/components/ouro/dialog/dialog-parts";

/** Props shared by both ways of opening a ConfirmDialog. */
export interface ConfirmDialogBaseProps {
  /** The question, which names the dialog: `title="Delete recipe?"`. */
  title: string;
  /** What happens if the user confirms: `description="This can't be undone."`. */
  description?: ReactNode;
  /** The confirm button's label: the action, not "OK" (`confirmLabel="Delete"`). */
  confirmLabel: string;
  /** The cancel button's label. Cancel has focus when the dialog opens. @default "Cancel" */
  cancelLabel?: string | undefined;
  /** The confirm button's color role. Use `destructive` for destructive actions. @default "primary" */
  tone?: "primary" | "destructive" | (string & { 'danger is "destructive"; accent is "primary"': never }) | undefined;
  /**
   * Runs the action. Return a promise to keep the dialog open while it runs: the
   * confirm button shows `loading` until it settles. When it resolves the dialog
   * closes; when it rejects (or `onConfirm` throws) the dialog stays open so the
   * user can retry or cancel. Cancel and Escape still close it while pending, so a
   * stuck action never traps the user, and the result is then ignored. Cancel does
   * not stop an action that has already started; make `onConfirm` cancellable or
   * idempotent if that matters.
   *
   * If the action removes the trigger (a delete), pass `finalFocus` to what
   * replaces it, such as the next item or the page heading.
   * @claim "Cancel and Escape still close it" registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx::ConfirmDialog > ignores a promise that settles after the user cancelled)
   * @claim "Cancel and Escape still close it" registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx::ConfirmDialog > closes from Cancel without confirming, and takes cancelLabel)
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Where focus goes after a confirmed action closes the confirmation. Any other close
   * (Cancel, Escape, or your app setting `open` to false) returns focus to the trigger,
   * even after an earlier confirm. When `onConfirm` removes the trigger,
   * point this at what replaces it (give a heading `tabIndex={-1}`):
   * `finalFocus={headingRef}`.
   */
  finalFocus?: RefObject<HTMLElement | null> | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<ConfirmDialog open={open} onOpenChange={setOpen}>`. */
  isOpen?: { 'Use <ConfirmDialog open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. `onOpenChange(false)` fires on close: `<ConfirmDialog open={open} onOpenChange={setOpen}>`. */
  onClose?: { 'Use <ConfirmDialog open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. Cancel calls `onOpenChange(false)`: `<ConfirmDialog open={open} onOpenChange={setOpen}>`. */
  onCancel?: { 'Use <ConfirmDialog open={open} onOpenChange={setOpen}>': never };
  /** Not a prop. Ouro UI uses `tone`: `<ConfirmDialog tone="destructive">`. */
  destructive?: { 'Use <ConfirmDialog tone="destructive">': never };
  /** Not a prop. Ouro UI uses `confirmLabel`: `<ConfirmDialog confirmLabel="Delete">`. */
  confirmText?: { 'Use <ConfirmDialog confirmLabel="Delete">': never };
  /** Not a prop. Ouro UI uses `cancelLabel`: `<ConfirmDialog cancelLabel="Keep">`. */
  cancelText?: { 'Use <ConfirmDialog cancelLabel="Keep">': never };
  /** Not a prop. Ouro UI uses `tone`: `<ConfirmDialog tone="destructive">`. */
  variant?: { 'Use <ConfirmDialog tone="destructive">': never };
}

/** An uncontrolled ConfirmDialog: `trigger` opens it. */
export type ConfirmDialogWithTriggerProps = ConfirmDialogBaseProps & {
  /** The element that opens the confirmation, usually a Button: `trigger={<Button tone="destructive">Delete</Button>}`. */
  trigger: ReactElement;
  /** Not with `trigger`. Remove `trigger` to control the confirmation with `open` and `onOpenChange`. */
  open?: never;
  /** Not with `trigger`. Remove `trigger` to control the confirmation with `open` and `onOpenChange`. */
  onOpenChange?: never;
};

/** A controlled ConfirmDialog: you own `open` and update it in `onOpenChange`. */
export type ConfirmDialogControlledProps = ConfirmDialogBaseProps & {
  /** Whether the confirmation is open. */
  open: boolean;
  /** Called with `false` when the user cancels (Cancel or Escape) and when `onConfirm` finishes. */
  onOpenChange: (open: boolean) => void;
  /** Not with `open`. Remove `open` and `onOpenChange` to let a trigger open the confirmation. */
  trigger?: never;
};

/** Props for {@link ConfirmDialog}: either `trigger`, or `open` with `onOpenChange`. */
export type ConfirmDialogProps = ConfirmDialogWithTriggerProps | ConfirmDialogControlledProps;

/**
 * Asks the user to confirm an action, with Cancel focused first. It is always
 * a centered dialog, on phones too, and an outside press does not dismiss it.
 * The actions stack full width on phones, the confirm action at the bottom,
 * nearest the thumb.
 *
 * Use `tone="destructive"` for destructive actions, and return a promise from
 * `onConfirm` to show progress until the action finishes. Cancel and Escape close
 * the dialog even while the action runs, and its result is then ignored. Cancel does
 * not stop an action that has already started; make `onConfirm` cancellable or
 * idempotent if that matters. Use `Dialog` instead when the user has more to do
 * than confirm or cancel.
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
 * @group Overlays
 * @see https://ourostack.github.io/ouro-ui/docs/confirm-dialog
 *
 * @example
 * <ConfirmDialog
 *   title="Delete recipe?"
 *   description="This can't be undone."
 *   confirmLabel="Delete"
 *   tone="destructive"
 *   onConfirm={() => deleteRecipe(id)}
 *   trigger={<Button tone="destructive" variant="soft">Delete</Button>}
 * />
 * @claim "It stacks above the page at" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::Dialog stacking above the app's fixed bars > puts the portal on the --ouro-layer level, as its own stacking context)
 * @claim "It stacks above the page at" registry/ouro/theme/ouro-base.css verify:fileLine(registry/ouro/theme/ouro-base.css, /^\s+--ouro-layer:\s50;/)
 * @claim "Testing accessibility: in WebKit, Base UI's" test/axe-exclude.test.tsx verify:testExists(test/axe-exclude.test.tsx::matches the open dialog's focus guards, and with them excluded axe finds nothing)
 * @claim "It is always a centered dialog" registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx::ConfirmDialog > does not close on an outside press)
 * @claim "It is always a centered dialog" registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/confirm-dialog.test.tsx::ConfirmDialog > stays centered on a phone with side margins and stacks its actions with confirm at the bottom)
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const {
    title,
    description,
    confirmLabel,
    cancelLabel = "Cancel",
    tone: toneProp = "primary",
    onConfirm,
    finalFocus,
    trigger,
    open,
    onOpenChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
    onCancel,
    destructive,
    confirmText,
    cancelText,
    variant,
  } = props as ConfirmDialogBaseProps & {
    trigger?: ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };

  // A tone that is not one of the confirm tones (a type error) warns and renders primary.
  const tone = toneProp === "destructive" ? "destructive" : "primary";

  checkOpenMode("ConfirmDialog", "confirmation", trigger !== undefined, open, onOpenChange);

  useDevWarnings(
    "ConfirmDialog",
    process.env.NODE_ENV !== "production"
      ? () => {
          const controlFix = "<ConfirmDialog open={open} onOpenChange={setOpen}>";
          return [
            !title && ["title is required; it names the confirmation for screen readers", '<ConfirmDialog title="Delete recipe?">'],
            tone !== toneProp && toneWarning("ConfirmDialog", String(toneProp), ["primary", "destructive"]),
            isOpen !== undefined && ["isOpen is not a prop", controlFix],
            onClose !== undefined && ["onClose is not a prop", controlFix],
            onCancel !== undefined && ["onCancel is not a prop; Cancel calls onOpenChange(false)", controlFix],
            destructive !== undefined && ["destructive is not a prop", '<ConfirmDialog tone="destructive">'],
            confirmText !== undefined && ["confirmText is not a prop", '<ConfirmDialog confirmLabel="Delete">'],
            cancelText !== undefined && ["cancelText is not a prop", '<ConfirmDialog cancelLabel="Keep">'],
            variant !== undefined && ["variant is not a prop", '<ConfirmDialog tone="destructive">'],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const [ownOpen, setOwnOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Each open, close and confirm bumps the attempt, so a promise that settles
  // after the user cancelled does not close a dialog they have since reopened.
  const attempt = useRef(0);
  const warnKey = useRef({});
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Whether the last close came from a confirmed action. Only then does focus go to
  // `finalFocus`; Cancel and Escape leave the trigger in place, so focus returns to it.
  const confirmed = useRef(false);

  const controlled = open !== undefined;
  const shown = controlled ? open : ownOpen;
  // Every open starts unconfirmed, however it opened. An app that sets `open` itself
  // never calls setOpen, so without this a close the app makes after reopening a
  // confirmed dialog would still send focus to `finalFocus`.
  useEffect(() => {
    if (shown) confirmed.current = false;
  }, [shown]);

  const setOpen = (next: boolean, afterConfirm = false) => {
    confirmed.current = afterConfirm;
    attempt.current++;
    setPending(false);
    if (controlled) onOpenChange!(next);
    else setOwnOpen(next);
  };

  const confirm = () => {
    let result: void | Promise<void>;
    try {
      result = onConfirm();
    } catch (error) {
      // A synchronous throw takes the rejection path: the dialog stays open and the error is reported.
      result = Promise.reject(error);
    }
    if (!result) {
      setOpen(false, true);
      return;
    }
    const current = ++attempt.current;
    setPending(true);
    result.then(
      () => {
        if (attempt.current === current) setOpen(false, true);
      },
      (error: unknown) => {
        // A rejection from an attempt the user already left (Cancel, Escape, a newer
        // confirm) must not clear a newer confirm's busy state; it is still reported.
        const stale = attempt.current !== current;
        if (!stale) setPending(false);
        /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
        if (process.env.NODE_ENV !== "production") {
          const message = error instanceof Error ? error.message : String(error);
          devWarn(
            "ConfirmDialog",
            stale
              ? `onConfirm rejected with "${message}" after the user had left that confirmation`
              : `onConfirm rejected with "${message}", so the dialog stayed open`,
            "onConfirm={() => remove().catch((error) => { setError(error.message); throw error; })} description={error}",
            warnKey.current,
          );
        }
      },
    );
  };

  return (
    <AlertDialogRoot open={shown} onOpenChange={(next) => setOpen(next)}>
      {trigger !== undefined && <DialogTrigger render={trigger} />}
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopupUnchecked
            size="sm"
            initialFocus={cancelRef}
            {...(finalFocus
              ? { finalFocus: () => (confirmed.current ? (finalFocus.current ?? true) : true) }
              : {})}
            data-ouro-confirm=""
          >
            <div data-ouro-dialog-header="" className="box-border grid shrink-0 gap-1 px-5 pt-5 pb-2">
              <DialogTitle>{title}</DialogTitle>
              {description !== undefined && <DialogDescription>{description}</DialogDescription>}
            </div>
            <DialogFooter>
              <DialogClose
                ref={cancelRef}
                render={
                  <Button variant="outline" tone="secondary" data-ouro-control="confirm-dialog" data-ouro-part="cancel">
                    {cancelLabel}
                  </Button>
                }
              />
              <Button tone={tone} loading={pending} onClick={confirm} data-tone={tone} data-ouro-control="confirm-dialog" data-ouro-part="confirm">
                {confirmLabel}
              </Button>
            </DialogFooter>
          </DialogPopupUnchecked>
        </DialogViewport>
      </DialogPortal>
    </AlertDialogRoot>
  );
}
