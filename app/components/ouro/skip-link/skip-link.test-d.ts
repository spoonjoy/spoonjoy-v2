import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { SkipLink, type SkipLinkProps } from "~/components/ouro/skip-link/skip-link";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<Record<never, never>>().toExtend<SkipLinkProps>();
expectTypeOf<{ target: "recipes"; children: "Skip to recipes" }>().toExtend<SkipLinkProps>();
expectTypeOf<ComponentProps<typeof SkipLink>>().toEqualTypeOf<SkipLinkProps>();

// Guessed props name the fix.
expectTypeOf<{ href: "#main" }>().not.toExtend<SkipLinkProps>();
expectTypeOf<{ to: "#main" }>().not.toExtend<SkipLinkProps>();
expectTypeOf<{ label: "Skip" }>().not.toExtend<SkipLinkProps>();

// @ts-expect-error href is not a prop.
createElement(SkipLink, { href: "#main" });
