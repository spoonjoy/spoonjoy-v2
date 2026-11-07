import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from "~/components/ouro/breadcrumb/breadcrumb";

// Type tests: `pnpm typecheck` compiles this file.

const items = [{ label: "Home", href: "/" }, { label: "Ribs" }] as const;

expectTypeOf<ComponentProps<typeof Breadcrumb>>().toEqualTypeOf<BreadcrumbProps>();
expectTypeOf<{ items: typeof items }>().toExtend<BreadcrumbProps>();
expectTypeOf<{ items: typeof items; maxItems: 3; label: "Trail"; moreLabel: "More"; closeLabel: "Close"; className: "mb-4" }>().toExtend<BreadcrumbProps>();
expectTypeOf<{ label: "Ribs" }>().toExtend<BreadcrumbItem>();
expectTypeOf<{ label: "Home"; href: "/"; icon: "⌂" }>().toExtend<BreadcrumbItem>();

// items is required, an item needs a label, and the guessed props name the fix.
expectTypeOf<{ label: "Trail" }>().not.toExtend<BreadcrumbProps>();
expectTypeOf<{ href: "/" }>().not.toExtend<BreadcrumbItem>();
expectTypeOf<{ items: typeof items; links: typeof items }>().not.toExtend<BreadcrumbProps>();
expectTypeOf<{ items: typeof items; separator: "/" }>().not.toExtend<BreadcrumbProps>();
expectTypeOf<{ items: typeof items; children: "Home" }>().not.toExtend<BreadcrumbProps>();

// @ts-expect-error items is required.
createElement(Breadcrumb, {});
createElement(Breadcrumb, { items });
