import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import {
  Menu,
  MenuItem,
  type MenuEntry,
  type MenuItemProps,
  type MenuProps,
} from "~/components/ouro/menu/menu";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const trigger = createElement("button") as ReactElement;
type SetOpen = (open: boolean) => void;

// Menu: one of trigger, contextTrigger or label, with children or items.
expectTypeOf<{ trigger: ReactElement; children: "Items" }>().toExtend<MenuProps>();
expectTypeOf<{ contextTrigger: ReactElement; items: MenuEntry[] }>().toExtend<MenuProps>();
expectTypeOf<{ label: "File"; children: "Items" }>().toExtend<MenuProps>();
expectTypeOf<{
  trigger: ReactElement;
  side: "top";
  align: "end";
  open: boolean;
  onOpenChange: SetOpen;
  className: "w-64";
  children: "Items";
}>().toExtend<MenuProps>();
expectTypeOf<ComponentProps<typeof Menu>>().toEqualTypeOf<MenuProps>();

// One way to open; a context menu opens at the pointer.
expectTypeOf<{ trigger: ReactElement; contextTrigger: ReactElement; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ trigger: ReactElement; label: "File"; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ contextTrigger: ReactElement; side: "top"; children: "Items" }>().not.toExtend<MenuProps>();
// A dropdown can leave the page live; a context menu and a MenuBar's menu always hold it.
expectTypeOf<{ trigger: ReactElement; modal: false; children: "Items" }>().toExtend<MenuProps>();
expectTypeOf<{ contextTrigger: ReactElement; modal: false; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ label: "File"; modal: false; children: "Items" }>().not.toExtend<MenuProps>();
// Named options only.
expectTypeOf<{ trigger: ReactElement; side: "above"; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ trigger: ReactElement; align: "left"; children: "Items" }>().not.toExtend<MenuProps>();
// Guessed props are hint types.
expectTypeOf<{ trigger: ReactElement; placement: "bottom-start"; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ trigger: ReactElement; isOpen: true; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ trigger: ReactElement; asChild: true; children: "Items" }>().not.toExtend<MenuProps>();
expectTypeOf<{ trigger: ReactElement; options: [] }>().not.toExtend<MenuProps>();

// Entries: each type takes its own fields.
expectTypeOf<{ label: "Edit"; onClick: () => void; shortcut: ["mod", "e"]; tone: "destructive" }>().toExtend<MenuEntry>();
expectTypeOf<{ type: "checkbox"; label: "Pin"; checked: true; onCheckedChange: SetOpen }>().toExtend<MenuEntry>();
expectTypeOf<{ type: "radio"; label: "Sort"; options: [{ value: "a"; label: "A" }] }>().toExtend<MenuEntry>();
expectTypeOf<{ type: "submenu"; label: "Share"; items: [] }>().toExtend<MenuEntry>();
expectTypeOf<{ type: "separator" }>().toExtend<MenuEntry>();
expectTypeOf<{ type: "radio"; label: "Sort" }>().not.toExtend<MenuEntry>();
expectTypeOf<{ label: "Edit"; tone: "danger" }>().not.toExtend<MenuEntry>();

// MenuItem: tone, shortcut as an array, and the guessed props.
expectTypeOf<{ children: "Edit"; tone: "destructive"; shortcut: ["mod", "e"]; href: "/r" }>().toExtend<MenuItemProps>();
expectTypeOf<{ children: "Billing"; href: "/settings/billing"; current: true }>().toExtend<MenuItemProps>();
expectTypeOf<{ children: "Billing"; href: "/settings/billing"; current: "page" }>().not.toExtend<MenuItemProps>();
expectTypeOf<{ children: "Edit"; tone: "danger" }>().not.toExtend<MenuItemProps>();
expectTypeOf<{ children: "Edit"; shortcut: "mod+e" }>().not.toExtend<MenuItemProps>();
expectTypeOf<{ children: "Edit"; onSelect: () => void }>().not.toExtend<MenuItemProps>();
expectTypeOf<{ children: "Edit"; variant: "destructive" }>().not.toExtend<MenuItemProps>();
expectTypeOf<{ children: "Edit"; checked: true }>().not.toExtend<MenuItemProps>();

// JSX: the same rules at a call site.
// @ts-expect-error -- no way to open
createElement(Menu, { children: "Items" });
createElement(Menu, { trigger, children: "Items" });
createElement(MenuItem, { children: "Edit", onClick: (event) => event.currentTarget });
