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

// @ts-expect-error label is required.
createElement(SegmentedControl, { items });
