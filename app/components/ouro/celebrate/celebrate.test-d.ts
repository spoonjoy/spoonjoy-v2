import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Celebrate, type CelebrateProps } from "~/components/ouro/celebrate/celebrate";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ show: true; message: "List cleared" }>().toExtend<CelebrateProps>();
expectTypeOf<{ show: false; message: "Done"; hideMessage: true; className: "mx-auto" }>().toExtend<CelebrateProps>();
expectTypeOf<ComponentProps<typeof Celebrate>>().toEqualTypeOf<CelebrateProps>();

// show and message are required.
expectTypeOf<{ message: "Done" }>().not.toExtend<CelebrateProps>();
expectTypeOf<{ show: true }>().not.toExtend<CelebrateProps>();

// Guessed props name the fix.
expectTypeOf<{ show: true; message: "x"; open: true }>().not.toExtend<CelebrateProps>();
expectTypeOf<{ show: true; message: "x"; active: true }>().not.toExtend<CelebrateProps>();
expectTypeOf<{ show: true; message: "x"; children: "Hooray" }>().not.toExtend<CelebrateProps>();

// @ts-expect-error open is not a prop.
createElement(Celebrate, { show: true, message: "x", open: true });
