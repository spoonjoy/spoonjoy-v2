import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Tabs, type TabsProps } from "~/components/ouro/tabs/tabs";
import { TabsList, TabsRoot, TabsTab, type TabsRootProps } from "~/components/ouro/tabs/tabs-parts";

// Type tests: `pnpm typecheck` compiles this file.

const items = [{ value: "a", label: "A", content: "Panel A" }] as const;

expectTypeOf<{ label: "Recipe"; items: typeof items }>().toExtend<TabsProps>();
expectTypeOf<{
  label: "Recipe";
  items: typeof items;
  value: "a";
  onValueChange: (value: string) => void;
  orientation: "vertical";
  activation: "manual";
}>().toExtend<TabsProps>();
expectTypeOf<ComponentProps<typeof Tabs>>().toEqualTypeOf<TabsProps>();

// Items with href make tabs that are links, marked from currentPath; an item cannot be both,
// and the items cannot mix the two.
const pages = [{ value: "all", label: "All", href: "/recipes" }] as const;
expectTypeOf<{ label: "Recipes"; items: typeof pages; currentPath: "/recipes"; orientation: "vertical" }>().toExtend<TabsProps>();
expectTypeOf<{ label: "Recipes"; items: typeof pages; value: "all" }>().toExtend<TabsProps>();
expectTypeOf<{ label: "Recipes"; items: readonly [{ value: "a"; label: "A"; href: "/a"; content: "A" }] }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipes"; items: readonly [{ value: "a"; label: "A"; href: "/a"; disabled: true }] }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipes"; items: ReadonlyArray<(typeof items)[number] | (typeof pages)[number]> }>().not.toExtend<TabsProps>();

// label and items are required; the guessed props name the fix.
expectTypeOf<{ items: typeof items }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe" }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe"; items: typeof items; orientation: "row" }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe"; items: typeof items; activation: "focus" }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe"; items: typeof items; onChange: () => void }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe"; items: typeof items; activateOnFocus: true }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipe"; tabs: typeof items; items: typeof items }>().not.toExtend<TabsProps>();
expectTypeOf<{ label: "Recipes"; items: typeof pages; pathname: "/recipes" }>().not.toExtend<TabsProps>();

// The parts take Base UI's props, with className for layout only.
expectTypeOf<{ defaultValue: "a"; className: "mt-4" }>().toExtend<TabsRootProps>();

// @ts-expect-error label is required.
createElement(Tabs, { items });
createElement(TabsRoot, { defaultValue: "a" }, createElement(TabsList, { "aria-label": "Parts" }, createElement(TabsTab, { value: "a" }, "A")));
createElement(Tabs, { label: "Recipes", items: pages, currentPath: "/recipes" });
// @ts-expect-error pathname is not a prop.
createElement(Tabs, { label: "Recipes", items: pages, pathname: "/recipes" });
