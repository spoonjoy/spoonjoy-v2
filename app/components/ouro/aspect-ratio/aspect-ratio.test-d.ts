import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { AspectRatio, type AspectRatioProps } from "~/components/ouro/aspect-ratio/aspect-ratio";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof AspectRatio>>().toEqualTypeOf<AspectRatioProps>();
expectTypeOf<{ ratio: 1.5; fit: "contain"; children: "x" }>().toExtend<AspectRatioProps>();

// ratio is required, and a number.
expectTypeOf<{ children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: "16:9"; children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: 1; aspectRatio: 1; children: "x" }>().not.toExtend<AspectRatioProps>();
expectTypeOf<{ ratio: 1; fit: "fill"; children: "x" }>().not.toExtend<AspectRatioProps>();

// @ts-expect-error ratio is required.
propsOf<ComponentProps<typeof AspectRatio>>({ children: "x" });
