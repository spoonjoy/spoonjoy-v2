import { createElement, type ComponentProps, type ReactElement, type RefObject } from "react";
import { expectTypeOf } from "vitest";
import { Popover, type PopoverProps } from "~/components/ouro/popover/popover";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const trigger = createElement("button") as ReactElement;
type Anchor = RefObject<HTMLButtonElement | null>;
type SetOpen = (open: boolean) => void;

// Popover: a trigger, or open with onOpenChange and anchor.
expectTypeOf<{ title: "Share"; trigger: ReactElement; children: "Body" }>().toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; open: boolean; onOpenChange: SetOpen; anchor: Anchor; children: "Body" }>().toExtend<PopoverProps>();
expectTypeOf<{
  title: "Share";
  trigger: ReactElement;
  hideTitle: true;
  description: "Anyone with the link";
  closeLabel: "Done";
  side: "top";
  align: "start";
  presentation: "auto";
  className: "w-96";
  children: "Body";
}>().toExtend<PopoverProps>();
expectTypeOf<ComponentProps<typeof Popover>>().toEqualTypeOf<PopoverProps>();

// The title is required, and exactly one way to open; controlled needs anchor.
expectTypeOf<{ trigger: ReactElement; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; open: boolean; onOpenChange: SetOpen; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; open: true; onOpenChange: SetOpen; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; anchor: Anchor; children: "Body" }>().not.toExtend<PopoverProps>();
// Named options only.
expectTypeOf<{ title: "Share"; trigger: ReactElement; side: "above"; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; align: "left"; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; presentation: "dialog"; children: "Body" }>().not.toExtend<PopoverProps>();
// Guessed props are hint types.
expectTypeOf<{ title: "Share"; trigger: ReactElement; placement: "bottom-start"; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; isOpen: true; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; onClose: () => void; children: "Body" }>().not.toExtend<PopoverProps>();
expectTypeOf<{ title: "Share"; trigger: ReactElement; content: "Body" }>().not.toExtend<PopoverProps>();

// JSX: the same rules at a call site.
// @ts-expect-error -- neither trigger nor open
createElement(Popover, { title: "Share", children: "Body" });
createElement(Popover, { title: "Share", trigger, children: "Body" });
