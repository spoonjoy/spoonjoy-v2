import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Spinner, type SpinnerProps } from "~/components/ouro/spinner/spinner";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

expectTypeOf<Record<string, never>>().toExtend<SpinnerProps>();
expectTypeOf<{ label: "Loading recipes"; size: "lg"; tone: "primary"; className: "ms-2"; id: "busy" }>().toExtend<SpinnerProps>();
expectTypeOf<ComponentProps<typeof Spinner>>().toEqualTypeOf<SpinnerProps>();

// A spinner has no children and its role is fixed; sizes and tones are named options.
expectTypeOf<{ children: "Loading" }>().not.toExtend<SpinnerProps>();
expectTypeOf<{ role: "img" }>().not.toExtend<SpinnerProps>();
expectTypeOf<{ size: "xl" }>().not.toExtend<SpinnerProps>();
expectTypeOf<{ tone: "danger" }>().not.toExtend<SpinnerProps>();
expectTypeOf<{ color: "red" }>().not.toExtend<SpinnerProps>();
// @ts-expect-error A size is "sm", "md" or "lg".
createElement(Spinner, { size: "xs" });
