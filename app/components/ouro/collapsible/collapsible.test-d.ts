import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Collapsible, type CollapsibleProps } from "~/components/ouro/collapsible/collapsible";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

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
propsOf<ComponentProps<typeof Collapsible>>({ children: "Calories" });
