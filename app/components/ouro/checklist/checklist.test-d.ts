import { expectTypeOf } from "vitest";
import { type ChecklistItemData, type ChecklistProps } from "~/components/ouro/checklist/checklist";
import { type ChecklistItemProps, type ChecklistRootProps } from "~/components/ouro/checklist/checklist-parts";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

type OnCheckedChange = (id: string, checked: boolean) => void;

// Valid shapes: every prop, and the least a checklist needs.
expectTypeOf<{ label: "Ingredients"; items: ChecklistItemData[]; onCheckedChange: OnCheckedChange }>().toExtend<ChecklistProps>();
expectTypeOf<{
  label: "Ingredients";
  hideLabel: true;
  description: "For two bowls.";
  items: readonly ChecklistItemData[];
  onCheckedChange: OnCheckedChange;
  onClearChecked: () => void;
  clearLabel: "Start over";
  empty: "Nothing yet.";
  className: "mt-4";
}>().toExtend<ChecklistProps>();
expectTypeOf<{ id: "oats"; label: "rolled oats"; description: "or quick oats"; value: "1 cup"; checked: false; disabled: true; action: null }>().toExtend<ChecklistItemData>();

// The label, the items and onCheckedChange are required: a checklist without them has no name or never changes.
expectTypeOf<{ items: ChecklistItemData[]; onCheckedChange: OnCheckedChange }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; onCheckedChange: OnCheckedChange }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; items: ChecklistItemData[] }>().not.toExtend<ChecklistProps>();
// Each row needs an id, a label and its checked state.
expectTypeOf<{ label: "rolled oats"; checked: false }>().not.toExtend<ChecklistItemData>();
expectTypeOf<{ id: "oats"; label: "rolled oats" }>().not.toExtend<ChecklistItemData>();

// The props agents guess are hint types that name the real one.
expectTypeOf<{ label: "Ingredients"; items: []; onCheckedChange: OnCheckedChange; onChange: () => void }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; items: []; onCheckedChange: OnCheckedChange; isChecked: true }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; items: []; onCheckedChange: OnCheckedChange; onToggle: () => void }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; items: []; onCheckedChange: OnCheckedChange; onCheck: () => void }>().not.toExtend<ChecklistProps>();
expectTypeOf<{ label: "Ingredients"; items: []; onCheckedChange: OnCheckedChange; legend: "Ingredients" }>().not.toExtend<ChecklistProps>();

// Parts: a root needs its label; a row its label, state and handler.
expectTypeOf<{ label: "Steps" }>().toExtend<ChecklistRootProps>();
expectTypeOf<{ hideLabel: true }>().not.toExtend<ChecklistRootProps>();
expectTypeOf<{ label: "Preheat"; checked: true; onCheckedChange: (checked: boolean) => void; value: "5 min"; action: null; disabled: true }>().toExtend<ChecklistItemProps>();
expectTypeOf<{ label: "Preheat"; checked: true }>().not.toExtend<ChecklistItemProps>();
