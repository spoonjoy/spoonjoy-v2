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

// onSelect makes the row a button; selected marks the chosen row, with onSelect or href only.
expectTypeOf<{ title: "x"; onSelect: () => void; selected: true }>().toExtend<ItemProps>();
// The handler gets the button's click, not the DOM's select event.
createElement(Item, { title: "x", onSelect: (event) => expectTypeOf(event.currentTarget).toEqualTypeOf<EventTarget & HTMLButtonElement>() });
createElement(Item, { title: "x", onSelect: (event) => void event.metaKey });
expectTypeOf<{ title: "x"; href: "/a"; selected: false }>().toExtend<ItemProps>();
expectTypeOf<{ title: "x"; selected: true }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; href: "/a"; onSelect: () => void }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; onSelect: () => void; external: true }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; buttonRef: null }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; onSelect: () => void; active: true }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; onSelect: () => void; isSelected: true }>().not.toExtend<ItemProps>();

// chevron is a decorative trailing mark, valid only on a linked row.
expectTypeOf<{ title: "x"; href: "/a"; chevron: true }>().toExtend<ItemProps>();
expectTypeOf<{ title: "x"; chevron: true }>().not.toExtend<ItemProps>();
expectTypeOf<{ title: "x"; onSelect: () => void; chevron: true }>().not.toExtend<ItemProps>();

// @ts-expect-error title is required.
createElement(Item, { description: "Four hours" });
