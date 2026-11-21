import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Link, type LinkProps } from "~/components/ouro/link/link";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

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

// current marks the link you are on: true is the page, or an aria-current value; active is the habit.
expectTypeOf<{ href: "/guide/2"; current: true; children: "Chapter 2" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "/guide/2"; current: "step"; children: "Step 2" }>().toExtend<LinkProps>();
expectTypeOf<{ href: "/guide/2"; current: 1; children: "Chapter 2" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/guide/2"; active: true; children: "Chapter 2" }>().not.toExtend<LinkProps>();
expectTypeOf<{ href: "/guide/2"; isActive: true; children: "Chapter 2" }>().not.toExtend<LinkProps>();

// @ts-expect-error href is required.
propsOf<ComponentProps<typeof Link>>({ to: "/recipes", children: "Recipes" });
