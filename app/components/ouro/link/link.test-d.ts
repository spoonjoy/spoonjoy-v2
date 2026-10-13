import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Link, type LinkProps } from "~/components/ouro/link/link";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ href: "/recipes"; children: "Recipes" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "https://ouro.bot"; external: true; tone: "secondary"; rel: "nofollow"; children: "Ouro" }>().toExtend<LinkProps>();
expectTypeOf<ComponentProps<typeof Link>>().toEqualTypeOf<LinkProps>();

// href is required; `to` is the router habit, and names href.
expectTypeOf<{ children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; to: "/recipes"; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; isExternal: true; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; color: "red"; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; tone: "danger"; children: "Recipes" }>().not.toExtend<LinkProps>();

// @ts-expect-error href is required.
createElement(Link, { to: "/recipes", children: "Recipes" });
