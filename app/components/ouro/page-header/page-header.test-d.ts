import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { PageHeader, type PageHeaderProps } from "~/components/ouro/page-header/page-header";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ title: "Billing" }>().toExtend<PageHeaderProps>();
expectTypeOf<{ title: "Billing"; eyebrow: "Settings"; description: "Plans"; actions: null; breadcrumb: null; media: null; level: 2; size: "lg"; divider: true; className: "mb-8" }>().toExtend<PageHeaderProps>();
expectTypeOf<ComponentProps<typeof PageHeader>>().toEqualTypeOf<PageHeaderProps>();

// title is required.
expectTypeOf<{ eyebrow: "Settings" }>().not.toExtend<PageHeaderProps>();

// Guessed props and values name the fix.
expectTypeOf<{ title: "T"; subtitle: "x" }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; overline: "x" }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; action: null }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; image: "x" }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; heading: "x" }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; level: 3 }>().not.toExtend<PageHeaderProps>();
expectTypeOf<{ title: "T"; size: "xl" }>().not.toExtend<PageHeaderProps>();

// @ts-expect-error subtitle is not a prop.
createElement(PageHeader, { title: "T", subtitle: "x" });
