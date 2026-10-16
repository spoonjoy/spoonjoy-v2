import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Item, type ItemProps } from "~/components/ouro/item/item";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof Item>>().toEqualTypeOf<ItemProps>();
expectTypeOf<{ title: "Ribs"; description: "Four hours"; mediaSize: "lg"; actions: "Save"; stackBelow: "sm" }>().toExtend<ItemProps>();
expectTypeOf<{ title: "Ribs"; href: "/recipes/1"; external: true; variant: "outline"; size: "sm"; as: "li" }>().toExtend<ItemProps>();

// The title is required: it names the row, and the link with href.
expectTypeOf<{ description: "Four hours" }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; external: true }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; subtitle: "y" }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; icon: "y" }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; action: "y" }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; label: "y" }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; mediaSize: "xl" }>().not.toExtend<ItemProps>();

// @ts-expect-error title is required.
createElement(Item, { description: "Four hours" });
