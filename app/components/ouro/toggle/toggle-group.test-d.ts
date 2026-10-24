import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { ToggleGroup, type ToggleGroupProps } from "~/components/ouro/toggle/toggle-group";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const items = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right", icon: () => null, hideLabel: true, disabled: true },
] as const;

// One at a time: the value is a string or null.
expectTypeOf<{ label: "Alignment"; items: typeof items }>().toExtend<ToggleGroupProps>();
expectTypeOf<{
  label: "Alignment";
  hideLabel: true;
  items: typeof items;
  value: "left" | null;
  onValueChange: (value: string | null) => void;
  variant: "outline";
  size: "sm";
  disabled: true;
  className: "mt-2";
}>().toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; defaultValue: "left" }>().toExtend<ToggleGroupProps>();

// multiple makes the value a list (spec rule 7).
expectTypeOf<{ label: "Style"; items: typeof items; multiple: true; value: string[]; onValueChange: (value: string[]) => void }>().toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Style"; items: typeof items; multiple: true; value: "left" }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Style"; items: typeof items; value: string[] }>().not.toExtend<ToggleGroupProps>();

// label and items are required.
expectTypeOf<{ items: typeof items }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment" }>().not.toExtend<ToggleGroupProps>();

// Unknown looks, and the guessed names, are type errors whose hint names the fix.
expectTypeOf<{ label: "Alignment"; items: typeof items; variant: "default" }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; size: "xs" }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; options: typeof items }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; type: "multiple" }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; onChange: () => void }>().not.toExtend<ToggleGroupProps>();
expectTypeOf<{ label: "Alignment"; items: typeof items; children: "x" }>().not.toExtend<ToggleGroupProps>();

// The same checks through JSX.
// @ts-expect-error Radix's type="multiple" is multiple.
createElement(ToggleGroup, { label: "Style", items, type: "multiple" });
// @ts-expect-error a list of values needs multiple.
createElement(ToggleGroup, { label: "Style", items, value: ["left"] });
