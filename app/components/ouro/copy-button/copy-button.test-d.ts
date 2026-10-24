import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { CopyButton, type CopyButtonProps } from "~/components/ouro/copy-button/copy-button";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ value: "sk-123" }>().toExtend<CopyButtonProps>();
expectTypeOf<{ value: "x"; label: "Copy link"; copiedLabel: "Link copied"; hideLabel: true; variant: "plain"; size: "md"; onCopy: (value: string) => void; className: "ms-auto" }>().toExtend<CopyButtonProps>();
expectTypeOf<ComponentProps<typeof CopyButton>>().toEqualTypeOf<CopyButtonProps>();

// value is required.
expectTypeOf<{ label: "Copy" }>().not.toExtend<CopyButtonProps>();

// Guessed props and values name the fix.
expectTypeOf<{ value: "x"; text: "x" }>().not.toExtend<CopyButtonProps>();
expectTypeOf<{ value: "x"; children: "Copy" }>().not.toExtend<CopyButtonProps>();
expectTypeOf<{ value: "x"; onClick: () => void }>().not.toExtend<CopyButtonProps>();
expectTypeOf<{ value: "x"; variant: "ghost" }>().not.toExtend<CopyButtonProps>();
expectTypeOf<{ value: "x"; size: "icon" }>().not.toExtend<CopyButtonProps>();

// @ts-expect-error text is not a prop.
createElement(CopyButton, { value: "x", text: "x" });
