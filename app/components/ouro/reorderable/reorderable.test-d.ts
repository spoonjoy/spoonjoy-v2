import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Reorderable, type ReorderableItem, type ReorderableMove, type ReorderableProps } from "~/components/ouro/reorderable/reorderable";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

expectTypeOf<ComponentProps<typeof Reorderable>>().toEqualTypeOf<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: [{ id: "1"; label: "Sear" }] }>().toExtend<ReorderableProps>();
expectTypeOf<{
  label: "Steps";
  items: readonly ReorderableItem[];
  onReorder: (ids: string[], move: ReorderableMove) => void;
  handleLabel: "Reorder {label}";
  instructionsLabel: "Press Space to pick up.";
  pickedUpLabel: "{label} picked up.";
  movedLabel: "{label} moved.";
  droppedLabel: "{label} dropped.";
  canceledLabel: "{label} put back.";
  className: "max-h-80 overflow-auto";
}>().toExtend<ReorderableProps>();
// onReorder may take only the ids, a state setter, or be an async function such as a server action.
expectTypeOf<(ids: string[]) => void>().toExtend<NonNullable<ReorderableProps["onReorder"]>>();
expectTypeOf<(ids: string[]) => Promise<void>>().toExtend<NonNullable<ReorderableProps["onReorder"]>>();
expectTypeOf<ReorderableMove>().toEqualTypeOf<{ id: string; from: number; to: number }>();

// The label and the items are required, and a row needs an id and a label.
expectTypeOf<{ items: [] }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps" }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ id: "1" }>().not.toExtend<ReorderableItem>();
expectTypeOf<{ label: "Sear" }>().not.toExtend<ReorderableItem>();
// The props agents guess are hint types.
expectTypeOf<{ label: "Steps"; items: []; values: [] }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; children: "x" }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; renderItem: () => null }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; onChange: () => void }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; onDragEnd: () => void }>().not.toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; axis: "y" }>().not.toExtend<ReorderableProps>();

// disabled pauses reordering, as while a save is in flight.
expectTypeOf<{ label: "Steps"; items: []; disabled: true }>().toExtend<ReorderableProps>();
expectTypeOf<{ label: "Steps"; items: []; disabled: "saving" }>().not.toExtend<ReorderableProps>();

// @ts-expect-error label is required.
createElement(Reorderable, { items: [] });
