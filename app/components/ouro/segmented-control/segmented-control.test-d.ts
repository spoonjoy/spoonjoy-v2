import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import {
  SegmentedControl,
  type SegmentedControlProps,
} from "~/components/ouro/segmented-control/segmented-control";

// Type tests: `pnpm typecheck` compiles this file.

const items = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid", disabled: true },
  { value: "map", label: "Map", disabledReason: "Maps need a connection" },
  { value: "board", label: "Board", disabledReason: undefined },
];

expectTypeOf<{ label: "View"; items: typeof items }>().toExtend<SegmentedControlProps>();
expectTypeOf<{
  label: "View";
  hideLabel: true;
  items: typeof items;
  value: "list";
  onValueChange: (value: string) => void;
  fullWidth: true;
  disabled: false;
}>().toExtend<SegmentedControlProps>();
expectTypeOf<ComponentProps<typeof SegmentedControl>>().toEqualTypeOf<SegmentedControlProps>();

// label and items are required; the guessed props name the fix.
expectTypeOf<{ items: typeof items }>().not.toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; options: typeof items; items: typeof items }>().not.toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; items: typeof items; onChange: () => void }>().not.toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; items: Array<{ value: "a"; label: "A"; href: "/a" }> }>().not.toExtend<SegmentedControlProps>();
// One value, never a list.
expectTypeOf<{ label: "View"; items: typeof items; value: ["list"] }>().not.toExtend<SegmentedControlProps>();

// revealOnHover keeps a control over content out of the way until it is hovered or focused.
expectTypeOf<{ label: "View"; items: typeof items; revealOnHover: true }>().toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; items: typeof items; revealOnHover: "hover" }>().not.toExtend<SegmentedControlProps>();

// glass is a boolean, and a segment takes an icon and a count.
expectTypeOf<{ label: "View"; items: typeof items; glass: true }>().toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; items: Array<{ value: "a"; label: "A"; count: 3 }> }>().toExtend<SegmentedControlProps>();
expectTypeOf<{ label: "View"; items: Array<{ value: "a"; label: "A"; count: "3" }> }>().not.toExtend<SegmentedControlProps>();

// @ts-expect-error label is required.
createElement(SegmentedControl, { items });
