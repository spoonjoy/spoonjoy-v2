import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Toggle, type ToggleProps } from "~/components/ouro/toggle/toggle";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

type BoldIcon = () => null;

// Valid shapes.
expectTypeOf<{ label: "Bold" }>().toExtend<ToggleProps>();
expectTypeOf<{
  label: "Bold";
  hideLabel: true;
  icon: BoldIcon;
  pressed: true;
  onPressedChange: (pressed: boolean) => void;
  disabled: false;
  variant: "outline";
  size: "sm";
  className: "mt-2";
  title: "Bold (Ctrl+B)";
}>().toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; defaultPressed: true; variant: "plain"; size: "lg" }>().toExtend<ToggleProps>();

// The label is required, and is a string; children are not the label.
expectTypeOf<{ pressed: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; children: "Bold" }>().not.toExtend<ToggleProps>();

// Unknown looks, and shadcn's, are type errors whose hint names the fix.
expectTypeOf<{ label: "Bold"; variant: "default" }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; size: "default" }>().not.toExtend<ToggleProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Bold"; isPressed: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; checked: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; defaultChecked: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; onCheckedChange: () => void }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; onChange: () => void }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; selected: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; isSelected: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; active: true }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; startIcon: BoldIcon }>().not.toExtend<ToggleProps>();
expectTypeOf<{ label: "Bold"; tone: "primary" }>().not.toExtend<ToggleProps>();

// The same checks through JSX.
// @ts-expect-error label is required.
createElement(Toggle, { pressed: true });
// @ts-expect-error a toggle is pressed, not checked.
createElement(Toggle, { label: "Bold", checked: true });
