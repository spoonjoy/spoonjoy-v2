import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ColorSchemeToggle, type ColorSchemeToggleProps } from "~/components/ouro/color-scheme-toggle/color-scheme-toggle";
import { colorSchemeScript } from "~/lib/ouro/color-scheme-script";
import { ColorSchemeProvider, useColorScheme, type ColorSchemeValue } from "~/lib/ouro/color-scheme";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<Record<never, never>>().toExtend<ColorSchemeToggleProps>();
expectTypeOf<{ variant: "segmented"; label: "Appearance"; labels: { dark: "Night" }; className: "ms-auto" }>().toExtend<ColorSchemeToggleProps>();
expectTypeOf<ComponentProps<typeof ColorSchemeToggle>>().toEqualTypeOf<ColorSchemeToggleProps>();

// Guessed props and values name the fix.
expectTypeOf<{ variant: "dropdown" }>().not.toExtend<ColorSchemeToggleProps>();
expectTypeOf<{ value: "dark" }>().not.toExtend<ColorSchemeToggleProps>();
expectTypeOf<{ onChange: () => void }>().not.toExtend<ColorSchemeToggleProps>();
expectTypeOf<{ theme: "dark" }>().not.toExtend<ColorSchemeToggleProps>();

// The provider, the hook and the script.
expectTypeOf(useColorScheme).returns.toEqualTypeOf<ColorSchemeValue>();
expectTypeOf<ColorSchemeValue["setScheme"]>().parameter(0).toEqualTypeOf<"light" | "dark" | "system">();
expectTypeOf(colorSchemeScript).returns.toBeString();
expectTypeOf<{ storageKey: "theme"; defaultScheme: "dark"; children: null }>().toExtend<ComponentProps<typeof ColorSchemeProvider>>();
expectTypeOf<{ defaultScheme: "sepia"; children: null }>().not.toExtend<ComponentProps<typeof ColorSchemeProvider>>();

// @ts-expect-error theme is not a prop.
createElement(ColorSchemeToggle, { theme: "dark" });
