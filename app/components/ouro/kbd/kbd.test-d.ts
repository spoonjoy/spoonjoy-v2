import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Kbd, type KbdProps } from "~/components/ouro/kbd/kbd";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ keys: ["mod", "k"] }>().toExtend<KbdProps>();
expectTypeOf<{ keys: readonly ["shift", "enter"]; className: "ms-2" }>().toExtend<KbdProps>();
expectTypeOf<ComponentProps<typeof Kbd>>().toEqualTypeOf<KbdProps>();

// keys is a required array; children and shortcut name the fix.
expectTypeOf<{ className: "ms-2" }>().not.toExtend<KbdProps>();
expectTypeOf<{ keys: "mod+k" }>().not.toExtend<KbdProps>();
expectTypeOf<{ keys: ["k"]; children: "⌘K" }>().not.toExtend<KbdProps>();
expectTypeOf<{ keys: ["k"]; shortcut: "mod+k" }>().not.toExtend<KbdProps>();

// @ts-expect-error keys is required.
createElement(Kbd, {});
