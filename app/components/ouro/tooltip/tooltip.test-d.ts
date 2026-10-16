import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import { Tooltip, type TooltipProps } from "~/components/ouro/tooltip/tooltip";

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
createElement(Tooltip, { children: button });
createElement(Tooltip, { content: "Add", children: button });
