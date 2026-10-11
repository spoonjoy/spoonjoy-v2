import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import { Dialog, type DialogProps } from "~/components/ouro/dialog/dialog";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const trigger = createElement("button") as ReactElement;
type SetOpen = (open: boolean) => void;

// Dialog: a trigger, or open with onOpenChange.
expectTypeOf<{ title: "Edit"; trigger: ReactElement; children: "Body" }>().toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; open: boolean; onOpenChange: SetOpen; children: "Body" }>().toExtend<DialogProps>();
expectTypeOf<{
  title: "Edit";
  trigger: ReactElement;
  hideTitle: true;
  closeLabel: "Dismiss";
  description: "Change the name";
  presentation: "sheet";
  size: "lg";
  footer: ReactElement;
  className: "mt-4";
  children: "Body";
}>().toExtend<DialogProps>();
expectTypeOf<ComponentProps<typeof Dialog>>().toEqualTypeOf<DialogProps>();

// The title is required, and exactly one way to open.
expectTypeOf<{ trigger: ReactElement; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; open: true; onOpenChange: SetOpen; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; open: true; children: "Body" }>().not.toExtend<DialogProps>();
// Named options only.
expectTypeOf<{ title: "Edit"; trigger: ReactElement; presentation: "drawer"; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; size: "xl"; children: "Body" }>().not.toExtend<DialogProps>();
// Sheet-only and guessed props are declared `never`.
expectTypeOf<{ title: "Edit"; trigger: ReactElement; side: "left"; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; snapPoints: [0.5]; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; position: "bottom"; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; isOpen: true; children: "Body" }>().not.toExtend<DialogProps>();
expectTypeOf<{ title: "Edit"; trigger: ReactElement; onClose: () => void; children: "Body" }>().not.toExtend<DialogProps>();

// JSX: the same rules at a call site.
// @ts-expect-error -- neither trigger nor open
createElement(Dialog, { title: "Edit", children: "Body" });
createElement(Dialog, { title: "Edit", trigger, children: "Body" });
