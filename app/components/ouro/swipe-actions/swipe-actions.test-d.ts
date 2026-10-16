import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { SwipeActions, type SwipeAction, type SwipeActionsProps } from "~/components/ouro/swipe-actions/swipe-actions";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

expectTypeOf<ComponentProps<typeof SwipeActions>>().toEqualTypeOf<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row" }>().toExtend<SwipeActionsProps>();
expectTypeOf<{
  label: "Ribs";
  children: "Row";
  leading: [{ label: "Pin"; tone: "primary"; onClick: () => void }];
  trailing: readonly [{ label: "Delete"; tone: "destructive"; onClick: () => void }, { label: "Archive"; onClick: () => void }];
  actionsLabel: "Actions for {label}";
  className: "mt-2";
}>().toExtend<SwipeActionsProps>();
// An action may be an async function, such as a server action.
expectTypeOf<{ label: "Delete"; onClick: () => Promise<void> }>().toExtend<SwipeAction>();

// The label is required: it names the row's actions button.
expectTypeOf<{ children: "Row" }>().not.toExtend<SwipeActionsProps>();
// An action needs a label and what it does.
expectTypeOf<{ label: "Delete" }>().not.toExtend<SwipeAction>();
expectTypeOf<{ onClick: () => void }>().not.toExtend<SwipeAction>();
// Named tones only, and the props agents guess are hint types.
expectTypeOf<{ label: "Delete"; tone: "danger"; onClick: () => void }>().not.toExtend<SwipeAction>();
expectTypeOf<{ label: "Delete"; variant: "destructive"; onClick: () => void }>().not.toExtend<SwipeAction>();
expectTypeOf<{ label: "Delete"; onPress: () => void; onClick: () => void }>().not.toExtend<SwipeAction>();
expectTypeOf<{ label: "Ribs"; children: "Row"; actions: [] }>().not.toExtend<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row"; left: [] }>().not.toExtend<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row"; right: [] }>().not.toExtend<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row"; leftActions: [] }>().not.toExtend<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row"; rightActions: [] }>().not.toExtend<SwipeActionsProps>();
expectTypeOf<{ label: "Ribs"; children: "Row"; onDelete: () => void }>().not.toExtend<SwipeActionsProps>();

// @ts-expect-error label is required.
createElement(SwipeActions, { children: "Row" });
