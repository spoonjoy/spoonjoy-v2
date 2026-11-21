import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Cover, type CoverProps } from "~/components/ouro/cover/cover";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ title: "Lemon rice" }>().toExtend<CoverProps>();
expectTypeOf<{ title: "Lemon rice"; src: "/rice.jpg"; alt: "Rice"; size: "fill"; shape: "square"; className: "aspect-video" }>().toExtend<CoverProps>();
expectTypeOf<ComponentProps<typeof Cover>>().toEqualTypeOf<CoverProps>();

// title is required.
expectTypeOf<{ src: "/rice.jpg" }>().not.toExtend<CoverProps>();

// Guessed props and values name the fix.
expectTypeOf<{ title: "T"; image: "/a.png" }>().not.toExtend<CoverProps>();
expectTypeOf<{ title: "T"; name: "x" }>().not.toExtend<CoverProps>();
expectTypeOf<{ title: "T"; initials: "R" }>().not.toExtend<CoverProps>();
expectTypeOf<{ title: "T"; size: "xl" }>().not.toExtend<CoverProps>();
expectTypeOf<{ title: "T"; shape: "circle" }>().not.toExtend<CoverProps>();

// @ts-expect-error image is not a prop.
createElement(Cover, { title: "T", image: "/a.png" });
