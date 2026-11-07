import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Empty, type EmptyProps } from "~/components/ouro/empty/empty";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof Empty>>().toEqualTypeOf<EmptyProps>();
expectTypeOf<{ title: "No recipes"; description: "Add one"; icon: "i"; action: "a"; variant: "plain"; align: "start"; headingLevel: 2 }>().toExtend<EmptyProps>();

// The title is required: it says what is empty.
expectTypeOf<{ description: "Add one" }>().not.toExtend<EmptyProps>();
expectTypeOf<{ title: "x"; heading: "y" }>().not.toExtend<EmptyProps>();
expectTypeOf<{ title: "x"; message: "y" }>().not.toExtend<EmptyProps>();
expectTypeOf<{ title: "x"; actions: "y" }>().not.toExtend<EmptyProps>();
expectTypeOf<{ title: "x"; align: "left" }>().not.toExtend<EmptyProps>();

// @ts-expect-error title is required.
createElement(Empty, { description: "Add one" });
