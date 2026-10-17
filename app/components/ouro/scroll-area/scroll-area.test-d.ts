import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ScrollArea, type ScrollAreaProps } from "~/components/ouro/scroll-area/scroll-area";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof ScrollArea>>().toEqualTypeOf<ScrollAreaProps>();
expectTypeOf<{ children: "x"; orientation: "both"; label: "Method"; className: "h-72" }>().toExtend<ScrollAreaProps>();

expectTypeOf<{ orientation: "x" }>().not.toExtend<ScrollAreaProps>();
expectTypeOf<{ children: "x"; orientation: "x" }>().not.toExtend<ScrollAreaProps>();
expectTypeOf<{ children: "x"; type: "always" }>().not.toExtend<ScrollAreaProps>();
expectTypeOf<{ children: "x"; maxHeight: 320 }>().not.toExtend<ScrollAreaProps>();
expectTypeOf<{ children: "x"; height: "200px" }>().not.toExtend<ScrollAreaProps>();
