import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Skeleton, type SkeletonProps } from "~/components/ouro/skeleton/skeleton";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

expectTypeOf<Record<string, never>>().toExtend<SkeletonProps>();
expectTypeOf<{ shape: "circle"; className: "size-12"; id: "avatar" }>().toExtend<SkeletonProps>();
expectTypeOf<ComponentProps<typeof Skeleton>>().toEqualTypeOf<SkeletonProps>();

// Each shape takes the sizes of what it stands in for: Text's for lines, Avatar's for a circle, Item's and Card's for rows and cards.
expectTypeOf<{ shape: "text"; size: "sm"; lines: 3 }>().toExtend<SkeletonProps>();
expectTypeOf<{ shape: "circle"; size: "3xl" }>().toExtend<SkeletonProps>();
expectTypeOf<{ shape: "row"; size: "sm"; count: 6 }>().toExtend<SkeletonProps>();
expectTypeOf<{ shape: "card"; count: 3 }>().toExtend<SkeletonProps>();
expectTypeOf<{ lines: 3 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "rect"; size: "md" }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "circle"; count: 2 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "text"; count: 2 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "row"; lines: 2 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "row"; size: "lg" }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ shape: "avatar" }>().not.toExtend<SkeletonProps>();

// Shapes are named; size comes from layout classes; it has no children.
expectTypeOf<{ shape: "square" }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ variant: "circular" }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ animation: false }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ width: 120 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ height: 20 }>().not.toExtend<SkeletonProps>();
expectTypeOf<{ children: "Loading" }>().not.toExtend<SkeletonProps>();
// @ts-expect-error MUI's variant is shape here.
createElement(Skeleton, { variant: "circular" });
