import { expectTypeOf } from "vitest";
import type { TextProps } from "~/components/ouro/text/text";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ children: "a"; as: "span"; tone: "muted"; size: "lg"; align: "center" }>().toExtend<TextProps>();
expectTypeOf<{ children: "a"; truncate: true }>().toExtend<TextProps>();
expectTypeOf<{ children: "a"; lines: 2 }>().toExtend<TextProps>();
expectTypeOf<{ children: "a"; as: "h2" }>().not.toExtend<TextProps>();
expectTypeOf<{ children: "a"; color: "red" }>().not.toExtend<TextProps>();
expectTypeOf<{ children: "a"; tone: "danger" }>().not.toExtend<TextProps>();
// truncate is one line; lines clamps to many. Use one.
expectTypeOf<{ children: "a"; truncate: true; lines: 2 }>().not.toExtend<TextProps>();
