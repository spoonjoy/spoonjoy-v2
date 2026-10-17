/**
 * ConfirmationDialog - A reusable confirmation dialog component
 *
 * Maps Spoonjoy's confirmation contract to the released confirmation primitive.
 * Use this instead of window.confirm() for a consistent, accessible,
 * and visually polished experience.
 */

import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Button } from "~/components/button";

export interface ConfirmationDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called on Cancel/Escape; destructive confirmations do not dismiss on outside press. */
  onClose: () => void;
  /** Called when the user confirms the action */
  onConfirm: () => void;
  /** The dialog title */
  title: string;
  /** The dialog description/message */
  description: string;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Whether this is a destructive action (makes confirm button red) */
  destructive?: boolean;
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmationDialogProps) {
  const accessibleTitle = title || confirmLabel;
  if (!destructive) {
    return <Dialog open={open} onOpenChange={onClose} title={accessibleTitle} description={description}
      footer={<><Button plain onClick={onClose}>{cancelLabel}</Button><Button onClick={onConfirm}>{confirmLabel}</Button></>}
    >{null}</Dialog>;
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onClose}
      title={accessibleTitle}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone="destructive"
      onConfirm={onConfirm}
    />
  );
}
