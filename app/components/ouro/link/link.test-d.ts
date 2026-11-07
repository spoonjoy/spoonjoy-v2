import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Link, type LinkProps } from "~/components/ouro/link/link";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ href: "/recipes"; children: "Recipes" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "https://ouro.bot"; external: true; tone: "secondary"; rel: "nofollow"; children: "Ouro" }>().toExtend<LinkProps>();
expectTypeOf<ComponentProps<typeof Link>>().toEqualTypeOf<LinkProps>();

// inline says whether the link sits in running text.
expectTypeOf<{ href: "/terms"; inline: true; children: "terms" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "/terms"; inline: "yes"; children: "terms" }>().not.toExtend<LinkProps>();

// href is required; `to` is the router habit, and names href.
expectTypeOf<{ children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; to: "/recipes"; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; isExternal: true; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; color: "red"; children: "Recipes" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/x"; tone: "danger"; children: "Recipes" }>().not.toExtend<LinkProps>();

// reloadDocument takes a full page load; download links do too.
expectTypeOf<{ href: "/mcp"; reloadDocument: true; children: "MCP" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "/export.csv"; download: true; children: "Export" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "/mcp"; reloadDocument: "yes"; children: "MCP" }>().not.toExtend<LinkProps>();

// @ts-expect-error href is required.
createElement(Link, { to: "/recipes", children: "Recipes" });
