import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { RelativeTime, type RelativeTimeProps } from "~/components/ouro/relative-time/relative-time";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ value: Date }>().toExtend<RelativeTimeProps>();
expectTypeOf<{ value: string; numeric: "always"; locale: "de-DE"; className: "ms-1"; title: "Posted" }>().toExtend<RelativeTimeProps>();
expectTypeOf<ComponentProps<typeof RelativeTime>>().toEqualTypeOf<RelativeTimeProps>();

// value is required.
expectTypeOf<{ numeric: "auto" }>().not.toExtend<RelativeTimeProps>();

// Guessed props and values name the fix.
expectTypeOf<{ value: Date; numeric: "never" }>().not.toExtend<RelativeTimeProps>();
expectTypeOf<{ date: Date }>().not.toExtend<RelativeTimeProps>();
expectTypeOf<{ value: Date; now: number }>().not.toExtend<RelativeTimeProps>();

// @ts-expect-error now is not a prop.
createElement(RelativeTime, { value: new Date(), now: Date.now() });
