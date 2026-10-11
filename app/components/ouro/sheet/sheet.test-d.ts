import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import { Sheet, type SheetProps } from "~/components/ouro/sheet/sheet";

const trigger = createElement("button") as ReactElement;
type SetOpen = (open: boolean) => void;

// Valid shapes: a trigger, or open with onOpenChange.
expectTypeOf<{ title: "Save"; trigger: ReactElement; children: "Body" }>().toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; open: boolean; onOpenChange: SetOpen; children: "Body" }>().toExtend<SheetProps>();
expectTypeOf<{
  title: "Save";
  trigger: ReactElement;
  hideTitle: true;
  description: "Pick one";
  side: "left";
  snapPoints: [0.5, "320px", "20rem", 1];
  className: "mx-auto";
  children: "Body";
}>().toExtend<SheetProps>();
expectTypeOf<ComponentProps<typeof Sheet>>().toEqualTypeOf<SheetProps>();

// The title is required.
expectTypeOf<{ trigger: ReactElement; children: "Body" }>().not.toExtend<SheetProps>();
// Exactly one way to open: neither, both, or open without onOpenChange fail.
expectTypeOf<{ title: "Save"; children: "Body" }>().not.toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; trigger: ReactElement; open: true; onOpenChange: SetOpen; children: "Body" }>().not.toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; open: true; children: "Body" }>().not.toExtend<SheetProps>();
// Snap points take fractions, px or rem, not percentages.
expectTypeOf<{ title: "Save"; trigger: ReactElement; snapPoints: ["50%"]; children: "Body" }>().not.toExtend<SheetProps>();
// Unknown sides fail.
expectTypeOf<{ title: "Save"; trigger: ReactElement; side: "center"; children: "Body" }>().not.toExtend<SheetProps>();
// The guessed names are declared `never`.
expectTypeOf<{ title: "Save"; trigger: ReactElement; isOpen: true; children: "Body" }>().not.toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; trigger: ReactElement; onClose: () => void; children: "Body" }>().not.toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; trigger: ReactElement; position: "bottom"; children: "Body" }>().not.toExtend<SheetProps>();
expectTypeOf<{ title: "Save"; trigger: ReactElement; size: 400; children: "Body" }>().not.toExtend<SheetProps>();

// JSX: the same rules at a call site.
// @ts-expect-error -- neither trigger nor open
createElement(Sheet, { title: "Save", children: "Body" });
createElement(Sheet, { title: "Save", trigger, children: "Body" });
