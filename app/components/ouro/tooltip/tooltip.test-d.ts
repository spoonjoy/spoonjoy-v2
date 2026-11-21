import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import { Tooltip, type TooltipProps } from "~/components/ouro/tooltip/tooltip";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const button = createElement("button") as ReactElement;

expectTypeOf<{ content: "Add"; children: ReactElement }>().toExtend<TooltipProps>();
expectTypeOf<{ content: ReactElement; children: ReactElement; side: "bottom"; align: "end" }>().toExtend<TooltipProps>();
expectTypeOf<ComponentProps<typeof Tooltip>>().toEqualTypeOf<TooltipProps>();

// Content and a single trigger element are required.
expectTypeOf<{ children: ReactElement }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: "Save" }>().not.toExtend<TooltipProps>();
// Named options only, and no timing props.
expectTypeOf<{ content: "Add"; children: ReactElement; side: "above" }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: ReactElement; delayDuration: 0 }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: ReactElement; delay: 0 }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: ReactElement; asChild: true }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: ReactElement; title: "Add" }>().not.toExtend<TooltipProps>();
expectTypeOf<{ content: "Add"; children: ReactElement; placement: "top" }>().not.toExtend<TooltipProps>();

// @ts-expect-error -- no content
propsOf<ComponentProps<typeof Tooltip>>({ children: button });
propsOf<ComponentProps<typeof Tooltip>>({ content: "Add", children: button });
