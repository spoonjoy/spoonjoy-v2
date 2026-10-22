import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Separator, type SeparatorProps } from "~/components/ouro/separator/separator";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ className: "my-4" }>().toExtend<SeparatorProps>();
expectTypeOf<{ orientation: "vertical"; decorative: true; className: "my-4" }>().toExtend<SeparatorProps>();
expectTypeOf<{ label: "or"; className: "my-6" }>().toExtend<SeparatorProps>();
expectTypeOf<ComponentProps<typeof Separator>>().toEqualTypeOf<SeparatorProps>();

// Guessed props and values name the fix.
expectTypeOf<{ vertical: true }>().not.toExtend<SeparatorProps>();
expectTypeOf<{ orientation: "column" }>().not.toExtend<SeparatorProps>();
expectTypeOf<{ children: "or" }>().not.toExtend<SeparatorProps>();
expectTypeOf<{ text: "or" }>().not.toExtend<SeparatorProps>();

// @ts-expect-error vertical is not a prop.
createElement(Separator, { vertical: true });
