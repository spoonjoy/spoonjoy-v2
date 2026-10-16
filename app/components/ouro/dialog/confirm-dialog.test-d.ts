import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import { ConfirmDialog, type ConfirmDialogProps } from "~/components/ouro/dialog/confirm-dialog";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const trigger = createElement("button") as ReactElement;
type SetOpen = (open: boolean) => void;

type Confirm = { title: "Delete?"; confirmLabel: "Delete"; onConfirm: () => void };
expectTypeOf<Confirm & { trigger: ReactElement }>().toExtend<ConfirmDialogProps>();
expectTypeOf<Confirm & { open: boolean; onOpenChange: SetOpen }>().toExtend<ConfirmDialogProps>();
expectTypeOf<
  Confirm & { trigger: ReactElement; description: "Gone for good"; cancelLabel: "Keep"; tone: "destructive"; onConfirm: () => Promise<void> }
>().toExtend<ConfirmDialogProps>();
expectTypeOf<ComponentProps<typeof ConfirmDialog>>().toEqualTypeOf<ConfirmDialogProps>();
expectTypeOf<Confirm>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Omit<Confirm, "confirmLabel"> & { trigger: ReactElement }>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Omit<Confirm, "onConfirm"> & { trigger: ReactElement }>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Confirm & { trigger: ReactElement; tone: "success" }>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Confirm & { trigger: ReactElement; tone: "danger" }>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Confirm & { trigger: ReactElement; destructive: true }>().not.toExtend<ConfirmDialogProps>();
expectTypeOf<Confirm & { trigger: ReactElement; open: true; onOpenChange: SetOpen }>().not.toExtend<ConfirmDialogProps>();


// JSX: the same rules at a call site.
// @ts-expect-error -- confirmLabel is required
createElement(ConfirmDialog, { title: "Delete?", onConfirm: () => {}, trigger });
createElement(ConfirmDialog, { title: "Delete?", confirmLabel: "Delete", onConfirm: () => {}, trigger });
