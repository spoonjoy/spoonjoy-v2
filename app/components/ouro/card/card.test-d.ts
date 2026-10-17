import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Card, type CardProps } from "~/components/ouro/card/card";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof Card>>().toEqualTypeOf<CardProps>();
expectTypeOf<{ title: "Pantry"; description: "On hand"; children: "Flour" }>().toExtend<CardProps>();
expectTypeOf<{ children: "Just a body" }>().toExtend<CardProps>();
expectTypeOf<{ href: "/cookbooks/1"; title: "Dinners"; external: true; variant: "plain"; size: "sm"; as: "li"; headingLevel: 2 }>().toExtend<CardProps>();

// A link without a title is a development message, not a type error: a union on href
// would drop the hover docs on title whenever another prop has a type error.
expectTypeOf<{ href: "/cookbooks/1" }>().toExtend<CardProps>();
// Agents' habits are type errors that name the fix.
expectTypeOf<{ title: "x"; subtitle: "12 recipes" }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; image: "/a.jpg" }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; actions: "y" }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; to: "/x" }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; asChild: true }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; variant: "elevated" }>().not.toExtend<CardProps>();
expectTypeOf<{ title: "x"; headingLevel: 1 }>().not.toExtend<CardProps>();

// @ts-expect-error an unknown variant names the options.
createElement(Card, { title: "x", variant: "elevated" });
