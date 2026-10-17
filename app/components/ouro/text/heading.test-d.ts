import { expectTypeOf } from "vitest";
import type { HeadingProps } from "~/components/ouro/text/heading";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ children: "a"; level: 2; size: "xl" }>().toExtend<HeadingProps>();
expectTypeOf<{ children: "a"; level: 1; size: "display" }>().toExtend<HeadingProps>();
// level is required: it sets the tag and the document outline.
expectTypeOf<{ children: "a" }>().not.toExtend<HeadingProps>();
expectTypeOf<{ children: "a"; level: 7 }>().not.toExtend<HeadingProps>();
expectTypeOf<{ children: "a"; level: 1; as: "h2" }>().not.toExtend<HeadingProps>();
