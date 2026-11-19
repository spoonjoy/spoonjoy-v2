import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { SectionHeader, type SectionHeaderProps } from "~/components/ouro/section-header/section-header";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ title: "Recipes" }>().toExtend<SectionHeaderProps>();
expectTypeOf<{ title: "Recipes"; meta: "12 recipes"; actions: null; level: 3; divider: false; className: "mt-8" }>().toExtend<SectionHeaderProps>();
expectTypeOf<ComponentProps<typeof SectionHeader>>().toEqualTypeOf<SectionHeaderProps>();

// title is required.
expectTypeOf<{ meta: "12 recipes" }>().not.toExtend<SectionHeaderProps>();

// Guessed props and values name the fix.
expectTypeOf<{ title: "T"; count: "12" }>().not.toExtend<SectionHeaderProps>();
expectTypeOf<{ title: "T"; description: "x" }>().not.toExtend<SectionHeaderProps>();
expectTypeOf<{ title: "T"; action: null }>().not.toExtend<SectionHeaderProps>();
expectTypeOf<{ title: "T"; heading: "x" }>().not.toExtend<SectionHeaderProps>();
expectTypeOf<{ title: "T"; level: 1 }>().not.toExtend<SectionHeaderProps>();

// @ts-expect-error count is not a prop.
createElement(SectionHeader, { title: "T", count: "12" });
