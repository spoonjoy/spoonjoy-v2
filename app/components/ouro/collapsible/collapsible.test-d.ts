import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Collapsible, type CollapsibleProps } from "~/components/ouro/collapsible/collapsible";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ title: "Nutrition facts"; children: "Calories" }>().toExtend<CollapsibleProps>();
expectTypeOf<{ title: "Nutrition facts"; children: "Calories"; open: true; onOpenChange: (open: boolean) => void }>().toExtend<CollapsibleProps>();
expectTypeOf<ComponentProps<typeof Collapsible>>().toEqualTypeOf<CollapsibleProps>();

// title is required; the guessed props name the fix.
expectTypeOf<{ children: "Calories" }>().not.toExtend<CollapsibleProps>();
expectTypeOf<{ title: "x"; children: "Calories"; trigger: "Open" }>().not.toExtend<CollapsibleProps>();
expectTypeOf<{ title: "x"; children: "Calories"; label: "Open" }>().not.toExtend<CollapsibleProps>();
expectTypeOf<{ title: "x"; children: "Calories"; isOpen: true }>().not.toExtend<CollapsibleProps>();
expectTypeOf<{ title: "x"; children: "Calories"; onChange: () => void }>().not.toExtend<CollapsibleProps>();

// @ts-expect-error title is required.
createElement(Collapsible, { children: "Calories" });
