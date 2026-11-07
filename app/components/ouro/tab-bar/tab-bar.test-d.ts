import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { TabBar, type TabBarProps } from "~/components/ouro/tab-bar/tab-bar";

// Type tests: `pnpm typecheck` compiles this file.

const items = [{ label: "Recipes", href: "/recipes", icon: null }];
expectTypeOf<{ label: "Main"; items: typeof items }>().toExtend<TabBarProps>();
expectTypeOf<{ label: "Main"; items: typeof items; currentPath: "/"; hideFrom: "lg"; accessory: (typeof items)[0] }>().toExtend<TabBarProps>();
expectTypeOf<ComponentProps<typeof TabBar>>().toEqualTypeOf<TabBarProps>();

// Required props.
expectTypeOf<{ items: typeof items }>().not.toExtend<TabBarProps>();
expectTypeOf<{ label: "Main" }>().not.toExtend<TabBarProps>();
expectTypeOf<{ label: "Main"; items: [{ label: "Recipes"; href: "/recipes" }] }>().not.toExtend<TabBarProps>();

// Guessed props and values name the fix.
expectTypeOf<{ label: "Main"; items: typeof items; tabs: typeof items }>().not.toExtend<TabBarProps>();
expectTypeOf<{ label: "Main"; items: typeof items; pathname: "/" }>().not.toExtend<TabBarProps>();
expectTypeOf<{ label: "Main"; items: typeof items; hideFrom: "desktop" }>().not.toExtend<TabBarProps>();

// @ts-expect-error pathname is not a prop.
createElement(TabBar, { label: "Main", items, pathname: "/" });
