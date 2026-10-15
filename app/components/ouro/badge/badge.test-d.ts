import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Badge, type BadgeButtonProps, type BadgeLinkProps, type BadgeProps } from "~/components/ouro/badge/badge";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ children: "Draft" }>().toExtend<BadgeProps>();
expectTypeOf<{ tone: "success"; variant: "soft"; children: "Published" }>().toExtend<BadgeProps>();
expectTypeOf<{ href: "/tags/vegan"; children: "Vegan" }>().toExtend<BadgeLinkProps>();
expectTypeOf<{ onClick: () => void; "aria-pressed": true; children: "Vegan" }>().toExtend<BadgeButtonProps>();
expectTypeOf<ComponentProps<typeof Badge>>().toEqualTypeOf<BadgeProps>();

// shadcn's variants, unknown tones and Radix's asChild name the fix.
expectTypeOf<{ variant: "destructive"; children: "x" }>().not.toExtend<BadgeProps>();
expectTypeOf<{ variant: "default"; children: "x" }>().not.toExtend<BadgeProps>();
expectTypeOf<{ tone: "danger"; children: "x" }>().not.toExtend<BadgeProps>();
expectTypeOf<{ asChild: true; children: "x" }>().not.toExtend<BadgeProps>();
expectTypeOf<{ color: "red"; children: "x" }>().not.toExtend<BadgeProps>();
// A link has no type and can't be disabled.
expectTypeOf<{ href: "/x"; type: "submit"; children: "x" }>().not.toExtend<BadgeProps>();
expectTypeOf<{ href: "/x"; disabled: true; children: "x" }>().not.toExtend<BadgeProps>();

// @ts-expect-error children are required.
createElement(Badge, { tone: "success" });
