import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { RouteProgress, type RouteProgressProps } from "~/components/ouro/route-progress/route-progress";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ active: true }>().toExtend<RouteProgressProps>();
expectTypeOf<{ active: false; label: "Opening"; className: "top-14" }>().toExtend<RouteProgressProps>();
expectTypeOf<ComponentProps<typeof RouteProgress>>().toEqualTypeOf<RouteProgressProps>();

// active is required.
expectTypeOf<Record<never, never>>().not.toExtend<RouteProgressProps>();

// Guessed props name the fix.
expectTypeOf<{ active: true; loading: true }>().not.toExtend<RouteProgressProps>();
expectTypeOf<{ active: true; isLoading: true }>().not.toExtend<RouteProgressProps>();
expectTypeOf<{ active: true; value: 50 }>().not.toExtend<RouteProgressProps>();

// @ts-expect-error loading is not a prop.
createElement(RouteProgress, { active: true, loading: true });
