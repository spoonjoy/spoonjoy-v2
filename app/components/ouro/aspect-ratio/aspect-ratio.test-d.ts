import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { AspectRatio, type AspectRatioProps } from "~/components/ouro/aspect-ratio/aspect-ratio";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof AspectRatio>>().toEqualTypeOf<AspectRatioProps>();
expectTypeOf<{ ratio: 1.5; fit: "contain"; children: "x" }>().toExtend<AspectRatioProps>();

// ratio is required, and a number.
expectTypeOf<{ children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: "16:9"; children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: 1; aspectRatio: 1; children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: 1; fit: "fill"; children: "x" }>().not.toExtend<AspectRatioProps>();

// @ts-expect-error ratio is required.
createElement(AspectRatio, { children: "x" });
